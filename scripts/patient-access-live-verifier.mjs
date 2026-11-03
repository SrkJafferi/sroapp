// Private in-memory pilot verifier. Never serialize credentials, Auth clients or response bodies.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const localRequire = createRequire('file:///G:/xampp/htdocs/sroapp/sro-clinic/package.json');
const { createClient } = localRequire('@supabase/supabase-js');
const { request } = localRequire('@playwright/test');
const ref = 'jyigxpjvygvtvcypujel',
  org = '88645fbe-34da-48aa-a509-c24441b7cf72',
  patient = 'b9cb9ff4-0c77-4caa-b412-e5794b419f75',
  operator = 'c9095e1e-b718-4c09-842f-df48970125af';
const origin = 'http://localhost:3100';
const fail = (ok, message) => {
  if (!ok) throw Error(message);
};
export class PilotLiveVerifier {
  #env;
  #root;
  #alias;
  #uid;
  #temporary;
  #previousTemporary;
  #current;
  #previousCurrent;
  #patientContext;
  #adminContext;
  #pendingAuth;
  #oldTokens = [];
  #retiredTokens = [];
  #proofs = {};
  #resetUsed = false;
  #evidence = [];
  #clinicalFingerprint;
  static async initialize() {
    const v = new PilotLiveVerifier();
    v.#env = parseEnv(
      await readFile('G:/xampp/htdocs/sroapp/sro-clinic/apps/web/.env.local', 'utf8'),
    );
    fail(
      new URL(v.#env.NEXT_PUBLIC_SUPABASE_URL).hostname === ref + '.supabase.co',
      'Verifier target mismatch',
    );
    v.#root = createClient(v.#env.NEXT_PUBLIC_SUPABASE_URL, v.#env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return v;
  }
  redact(text) {
    for (const value of [
      this.#temporary,
      this.#previousTemporary,
      this.#current,
      this.#previousCurrent,
      this.#alias,
      this.#env.SUPABASE_SERVICE_ROLE_KEY,
      this.#env.RESEND_API_KEY,
    ])
      if (value) text = text.replaceAll(value, '[PRIVATE]');
    return text;
  }
  captureTemporary(value) {
    fail(typeof value === 'string' && value.length >= 40, 'Temporary credential was not captured');
    this.#previousTemporary = this.#temporary;
    this.#temporary = value;
    return { capturedPrivately: true };
  }
  captureExistingPassword(value) {
    fail(
      typeof value === 'string' && value.length >= 8 && value.length <= 128,
      'Existing private credential was not captured',
    );
    this.#current = value;
    return { existingCredentialHeldInMemoryOnly: true };
  }
  async loginWithExistingPassword() {
    fail(!!this.#current, 'Existing private credential unavailable');
    this.#patientContext = await request.newContext({ baseURL: origin });
    const r = await this.#patientContext.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: 'SRO0007', password: this.#current },
    });
    const body = await r.json();
    fail(
      r.status() === 200 && body.next === '/patient',
      'Active pilot sign-in failed; STOP writes',
    );
    this.#oldTokens.push(await this.#token(this.#patientContext));
    const provider = this.#publicClient();
    const s = await provider.auth.signInWithPassword({
      email: this.#alias,
      password: this.#current,
    });
    fail(!s.error && s.data.user?.id === this.#uid, 'Active provider sign-in failed; STOP writes');
    this.#pendingAuth = provider;
    this.#oldTokens.push(s.data.session.access_token);
    let oldTemporaryRejected = null;
    if (this.#temporary) {
      const old = await this.#publicClient().auth.signInWithPassword({
        email: this.#alias,
        password: this.#temporary,
      });
      fail(!!old.error, 'Old temporary credential was not rejected');
      oldTemporaryRejected = true;
    }
    this.#evidence.push({
      phase: 'operator-first-change',
      freshPatientIdLogin: 200,
      oldTemporaryRejected,
    });
    return this.#evidence.at(-1);
  }
  async resetExactlyOnce() {
    fail(!this.#resetUsed && !!this.#current, 'Reset budget unavailable');
    this.#resetUsed = true;
    this.#retiredTokens = [...this.#oldTokens];
    const c = await this.admin();
    const r = await c.post('/api/patient-access', {
      headers: { Origin: origin },
      data: { action: 'reset', patientId: patient, organizationId: org, identityVerified: true },
    });
    fail(r.status() === 200, 'Reset provider/commit failed or ambiguous; STOP writes');
    const data = await r.json();
    fail(
      data.patientId === patient &&
        data.patientCode === 'SRO0007' &&
        typeof data.temporaryPassword === 'string' &&
        typeof data.handoverNonce === 'string' &&
        typeof data.operationId === 'string',
      'Reset handover result ambiguous; STOP writes',
    );
    this.captureTemporary(data.temporaryPassword);
    this.rememberHandover(data.handoverNonce, data.operationId);
    this.#evidence.push({
      phase: 'controlled-reset',
      status: 200,
      resetsPerformed: 1,
      targetOnly: true,
    });
    return this.#evidence.at(-1);
  }
  async acknowledgeResetHandover() {
    fail(this.#resetUsed && !!this.#proofs.nonce, 'Reset handover proof unavailable');
    const c = await this.admin();
    const data = {
      action: 'handover',
      patientId: patient,
      organizationId: org,
      nonce: this.#proofs.nonce,
      operationId: this.#proofs.operationId,
    };
    const r = await c.post('/api/patient-access', { headers: { Origin: origin }, data });
    fail(r.status() === 200, 'Reset handover failed; STOP writes');
    const replay = await c.post('/api/patient-access', { headers: { Origin: origin }, data });
    fail(replay.status() === 400, 'Consumed handover proof was reusable; STOP writes');
    this.#proofs = {};
    this.#evidence.push({
      phase: 'reset-handover',
      status: 200,
      replayStatus: replay.status(),
      proofDiscarded: true,
    });
    return this.#evidence.at(-1);
  }
  copyMatches(text) {
    const ok =
      typeof text === 'string' && text.includes(this.#temporary) && text.includes('SRO0007');
    fail(ok, 'Private clipboard verification failed');
    return { clipboardMatched: true };
  }
  async bindAuthUser(uid) {
    fail(/^[0-9a-f-]{36}$/.test(uid), 'Invalid pilot Auth identifier');
    const r = await this.#root.auth.admin.getUserById(uid);
    fail(
      !r.error && r.data.user?.id === uid && !!r.data.user.email_confirmed_at,
      'Pilot Auth identity unavailable',
    );
    fail(
      /^[0-9a-f]{32}@accounts\.sro\.invalid$/.test(r.data.user.email ?? ''),
      'Pilot private identity mismatch',
    );
    this.#uid = uid;
    this.#alias = r.data.user.email;
    return { pilotAuthBound: true, confirmedInternalPrincipal: true };
  }
  #publicClient() {
    return createClient(
      this.#env.NEXT_PUBLIC_SUPABASE_URL,
      this.#env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  async #readWithToken(
    token,
    table,
    query = table === 'patient_medical_history' ? 'select=patient_id' : 'select=id',
  ) {
    const r = await fetch(this.#env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + table + '?' + query, {
      headers: {
        apikey: this.#env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + token,
      },
    });
    return { status: r.status, body: await r.json() };
  }
  async #token(c) {
    const cookies = (await c.storageState()).cookies
      .filter(
        (x) =>
          x.name === 'sb-' + ref + '-auth-token' || x.name.startsWith('sb-' + ref + '-auth-token.'),
      )
      .sort(
        (a, b) => Number(a.name.split('.').at(-1) || 0) - Number(b.name.split('.').at(-1) || 0),
      );
    const text = cookies.map((x) => x.value).join('');
    const s = JSON.parse(
      text.startsWith('base64-') ? Buffer.from(text.slice(7), 'base64url').toString() : text,
    );
    fail(!!s.access_token, 'Verified session token unavailable');
    return s.access_token;
  }
  async pendingProviderChecks() {
    const client = this.#publicClient();
    const r = await client.auth.signInWithPassword({
      email: this.#alias,
      password: this.#temporary,
    });
    fail(!r.error && r.data.user.id === this.#uid, 'Pending pilot credential sign-in failed');
    this.#pendingAuth = client;
    this.#oldTokens.push(r.data.session.access_token);
    if (this.#resetUsed) this.#retiredTokens.push(r.data.session.access_token);
    for (const table of [
      'patients',
      'appointments',
      'clinical_encounters',
      'prescriptions',
      'patient_medical_history',
    ]) {
      const q = await this.#readWithToken(r.data.session.access_token, table);
      fail(
        q.status === 200 && Array.isArray(q.body) && q.body.length === 0,
        'Pending-handover clinical access was not denied',
      );
    }
    this.#evidence.push({ phase: 'pending-handover', authAccepted: true, protectedTablesEmpty: 5 });
    return this.#evidence.at(-1);
  }
  async admin() {
    if (this.#adminContext) return this.#adminContext;
    const cred = JSON.parse(
      await readFile(
        'C:/Users/Shahrukh/.codex/secrets/sro-clinic/' + ref + '/phase2b-demo-admin.json',
        'utf8',
      ),
    );
    const c = await request.newContext({ baseURL: origin });
    const r = await c.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: cred.email, password: cred.password },
    });
    fail(r.status() === 200, 'Existing operator login failed');
    const s = await (await c.get('/api/auth/session')).json();
    fail(
      s.identity?.id === operator &&
        s.identity.memberships.some((m) => m.organizationId === org && m.roles.includes('admin')),
      'Operator authorization mismatch',
    );
    this.#adminContext = c;
    return c;
  }
  async duplicateProvisioning() {
    const c = await this.admin();
    const responses = await Promise.all(
      [0, 1].map(() =>
        c.post('/api/patient-access', {
          headers: { Origin: origin },
          data: { action: 'provision', patientId: patient, organizationId: org },
        }),
      ),
    );
    fail(
      responses.every((r) => [400, 409].includes(r.status())),
      'Duplicate provisioning unexpectedly succeeded',
    );
    this.#evidence.push({
      phase: 'simultaneous-duplicate-provisioning',
      statuses: responses.map((r) => r.status()),
      successes: 0,
    });
    return this.#evidence.at(-1);
  }
  async patientLogin() {
    this.#patientContext = await request.newContext({ baseURL: origin });
    const r = await this.#patientContext.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: 'SRO0007', password: this.#temporary },
    });
    const body = await r.json();
    fail(
      r.status() === 200 && body.next === '/auth/change-password',
      'Mandatory first-change redirect failed',
    );
    const token = await this.#token(this.#patientContext);
    this.#oldTokens.push(token);
    const clinical = await this.#patientContext.get(
      '/api/clinic?' + new URLSearchParams({ role: 'patient', organizationId: org }),
    );
    fail(clinical.status() === 403, 'Pre-change clinical API was not denied');
    for (const table of ['patients', 'appointments', 'clinical_encounters', 'prescriptions']) {
      const q = await this.#readWithToken(token, table);
      fail(q.status === 200 && q.body.length === 0, 'First-change RLS did not deny records');
    }
    this.#evidence.push({
      phase: 'first-change',
      patientIdLogin: 200,
      next: body.next,
      clinicalApi: 403,
      directProtectedTablesEmpty: 4,
    });
    return this.#evidence.at(-1);
  }
  async changePasswordViaAuthorizedApi(candidate) {
    // The operator enters the replacement in a non-echoing local terminal prompt.
    fail(
      typeof candidate === 'string' && candidate.length >= 10 && candidate.length <= 128,
      'Operator replacement password required',
    );
    this.#previousCurrent = this.#current;
    const r = await this.#patientContext.post('/api/patient-access', {
      headers: { Origin: origin },
      data: { action: 'change-password', password: candidate },
    });
    const body = await r.json();
    fail(
      r.status() === 200 && body.next === '/patient',
      'Password provider/completion failed or ambiguous; STOP writes',
    );
    this.#current = candidate;
    const check = this.#publicClient();
    const old = await check.auth.signInWithPassword({
      email: this.#alias,
      password: this.#temporary,
    });
    fail(!!old.error, 'Old temporary password was not rejected');
    this.#evidence.push({ phase: 'password-change', status: 200, oldTemporaryRejected: true });
    return this.#evidence.at(-1);
  }
  currentPasswordForExistingLogin() {
    fail(!!this.#current, 'Current pilot credential unavailable');
    return this.#current;
  }
  temporaryPasswordForExistingLogin() {
    fail(!!this.#temporary, 'Temporary credential unavailable');
    return this.#temporary;
  }
  async activeChecks() {
    const c = this.#patientContext;
    const r = await c.get(
      '/api/clinic?' + new URLSearchParams({ role: 'patient', organizationId: org }),
    );
    fail(r.status() === 200, 'Active pilot clinical API failed');
    const { state } = await r.json();
    fail(
      !JSON.stringify(state).includes('@accounts.sro.invalid'),
      'Internal identity leaked in clinical snapshot',
    );
    fail(
      state.patients.length === 1 &&
        state.patients[0].id === patient &&
        state.patients[0].patientCode === 'SRO0007',
      'Pilot Patient scope mismatch',
    );
    fail(
      state.appointments.every((a) => a.patientId === patient) &&
        state.prescriptions.every((p) => p.patientId === patient),
      'Foreign clinical record visible',
    );
    const token = await this.#token(c);
    for (const table of ['patients', 'appointments', 'clinical_encounters', 'prescriptions']) {
      const q = await this.#readWithToken(token, table);
      fail(q.status === 200, 'Authorized PostgREST read failed');
      if (table === 'patients')
        fail(q.body.length === 1 && q.body[0].id === patient, 'Direct Patient RLS mismatch');
      if (table === 'appointments')
        fail(
          q.body.every((row) => state.appointments.some((a) => a.id === row.id)),
          'Unrelated appointment visible',
        );
      if (table === 'prescriptions')
        fail(
          q.body.every((row) => state.prescriptions.some((p) => p.id === row.id)),
          'Unrelated prescription visible',
        );
      // SRO0007 has only an unsigned draft at this approved baseline.
      if (table === 'clinical_encounters')
        fail(q.body.length === 0, 'Unsigned or unrelated encounter visible');
    }
    for (const role of ['admin', 'doctor'])
      fail(
        (
          await c.get('/api/clinic?' + new URLSearchParams({ role, organizationId: org }))
        ).status() === 403,
        'Cross-role workspace access was not denied',
      );
    const hidden = await this.#readWithToken(
      token,
      'patients',
      'select=id&id=eq.24e1c0ed-4419-43d4-abf0-a93fa1d97f4a',
    );
    fail(hidden.status === 200 && hidden.body.length === 0, 'Unrelated Patient visible');
    this.#evidence.push({
      phase: 'active',
      clinicalApi: 200,
      patients: 1,
      appointments: state.appointments.length,
      prescriptions: state.prescriptions.length,
      crossRoleDenied: true,
      unrelatedPatientHidden: true,
    });
    return this.#evidence.at(-1);
  }
  async freshLogin() {
    const c = await request.newContext({ baseURL: origin });
    const r = await c.post('/api/auth/login', {
      headers: { Origin: origin },
      data: { email: 'SRO0007', password: this.#current },
    });
    fail(r.status() === 200, 'Fresh pilot login failed');
    const s = await (await c.get('/api/auth/session')).json();
    fail(s.identity?.id === this.#uid, 'Fresh pilot identity mismatch');
    await c.dispose();
    return { freshPatientIdLogin: 200 };
  }
  async verifyRetiredTemporary() {
    fail(!!this.#temporary, 'Retired temporary credential unavailable');
    const r = await this.#publicClient().auth.signInWithPassword({
      email: this.#alias,
      password: this.#temporary,
    });
    fail(!!r.error, 'Retired temporary credential still accepted');
    this.#evidence.push({ phase: 'retired-initial-temporary', rejected: true });
    return this.#evidence.at(-1);
  }
  async resetPreflight() {
    const c = await this.admin();
    const r = await c.post('/api/patient-access', {
      headers: { Origin: origin },
      data: { action: 'status', patientId: patient, organizationId: org },
    });
    const s = await r.json();
    fail(
      r.status() === 200 &&
        s.patientCode === 'SRO0007' &&
        s.status === 'Active' &&
        s.mustChangePassword === false &&
        s.pilotExecutionEnabled === true,
      'Pilot status drift; STOP',
    );
    const token = await this.#token(c);
    const resets = await this.#readWithToken(
      token,
      'audit_logs',
      'select=id&entity_type=eq.patients&entity_id=eq.' +
        patient +
        '&action=eq.patient.account_reset',
    );
    fail(
      resets.status === 200 && Array.isArray(resets.body) && resets.body.length === 0,
      'Reset already recorded or audit check unavailable; STOP',
    );
    const snapshot = await c.get(
      '/api/clinic?' + new URLSearchParams({ role: 'admin', organizationId: org }),
    );
    fail(snapshot.status() === 200, 'Admin baseline unavailable; STOP');
    const { state } = await snapshot.json();
    fail(
      state.patients?.length === 8 &&
        state.patients.some((p) => p.id === patient && p.patientCode === 'SRO0007'),
      'Patient baseline drift; STOP',
    );
    this.#clinicalFingerprint = this.#snapshotHash(state);
    this.#evidence.push({
      phase: 'reset-preflight',
      patientCount: 8,
      priorResets: 0,
      adminScopeConfirmed: true,
    });
    return this.#evidence.at(-1);
  }
  #snapshotHash(state) {
    const keys = [
      'patients',
      'appointments',
      'consultations',
      'prescriptions',
      'documents',
      'branches',
      'doctors',
    ];
    return createHash('sha256')
      .update(
        JSON.stringify(
          Object.fromEntries(keys.filter((k) => k in state).map((k) => [k, state[k]])),
        ),
      )
      .digest('hex');
  }
  async resetPostflight() {
    const c = await this.admin();
    const r = await this.#readWithToken(
      await this.#token(c),
      'audit_logs',
      'select=id&entity_type=eq.patients&entity_id=eq.' +
        patient +
        '&action=eq.patient.account_reset',
    );
    fail(r.status === 200 && r.body.length === 1, 'Reset count mismatch; STOP');
    const snapshot = await c.get(
      '/api/clinic?' + new URLSearchParams({ role: 'admin', organizationId: org }),
    );
    fail(snapshot.status() === 200, 'Final Admin snapshot failed');
    const { state } = await snapshot.json();
    fail(
      this.#snapshotHash(state) === this.#clinicalFingerprint,
      'Clinical snapshot changed; STOP',
    );
    this.#evidence.push({
      phase: 'reset-postflight',
      resetsRecorded: 1,
      clinicalSnapshotUnchanged: true,
      patients: 8,
    });
    return this.#evidence.at(-1);
  }
  async disposeAndForget() {
    await this.#patientContext?.dispose();
    await this.#adminContext?.dispose();
    this.#temporary = this.#previousTemporary = this.#current = this.#previousCurrent = undefined;
    this.#alias = undefined;
    this.#oldTokens = [];
    this.#retiredTokens = [];
    this.#proofs = {};
    this.#pendingAuth = undefined;
    this.#root = undefined;
    this.#env = undefined;
  }
  async checkResetFencing() {
    const c = this.#publicClient();
    const old = await c.auth.signInWithPassword({ email: this.#alias, password: this.#current });
    fail(!!old.error, 'Previous pilot password still accepted after reset');
    for (const token of this.#oldTokens) {
      const q = await this.#readWithToken(token, 'patients');
      fail(
        (q.status === 200 && q.body.length === 0) || q.status === 401 || q.status === 403,
        'Old JWT regained clinical access',
      );
    }
    let refreshOutcome = 'not-captured';
    if (this.#pendingAuth) {
      const refresh = await this.#pendingAuth.auth.refreshSession();
      if (refresh.error) refreshOutcome = 'revoked';
      else {
        const fenced = await this.#readWithToken(refresh.data.session.access_token, 'patients');
        fail(
          (fenced.status === 200 && fenced.body.length === 0) || [401, 403].includes(fenced.status),
          'Refreshed old session regained clinical access',
        );
        refreshOutcome = 'refreshed-but-clinically-fenced';
      }
    }
    this.#evidence.push({
      phase: 'reset-fencing',
      previousPasswordRejected: true,
      oldJwtDenied: this.#oldTokens.length,
      oldRefreshOutcome: refreshOutcome,
    });
    return this.#evidence.at(-1);
  }
  async verifyRetiredSessionsAfterActivation() {
    fail(this.#retiredTokens.length >= 2, 'Pre-reset sessions unavailable');
    for (const token of this.#retiredTokens) {
      const r = await this.#readWithToken(token, 'patients');
      fail(
        (r.status === 200 && r.body.length === 0) || [401, 403].includes(r.status),
        'Retired JWT regained access after activation',
      );
    }
    this.#evidence.push({
      phase: 'post-activation-retired-sessions',
      oldJwtDenied: this.#retiredTokens.length,
    });
    return this.#evidence.at(-1);
  }
  async privatePrintMatches(text) {
    const ok =
      typeof text === 'string' && text.includes(this.#temporary) && text.includes('SRO0007');
    fail(ok, 'Private print document did not match handover');
    return { privatePrintDocumentMatched: true };
  }
  rememberHandover(nonce, operationId) {
    this.#proofs = { nonce, operationId };
    return { proofCapturedPrivately: true };
  }
  async saveEvidence() {
    await mkdir('G:/xampp/htdocs/sroapp/sro-clinic/artifacts/patient-access-live-pilot', {
      recursive: true,
    });
    let previous = [];
    try {
      previous = JSON.parse(
        await readFile(
          'G:/xampp/htdocs/sroapp/sro-clinic/artifacts/patient-access-live-pilot/functional-evidence.json',
          'utf8',
        ),
      );
    } catch {
      /* No earlier evidence. */
    }
    const combined = [...previous];
    for (const entry of this.#evidence)
      if (!combined.some((x) => JSON.stringify(x) === JSON.stringify(entry))) combined.push(entry);
    await writeFile(
      'G:/xampp/htdocs/sroapp/sro-clinic/artifacts/patient-access-live-pilot/functional-evidence.json',
      JSON.stringify(combined, null, 2),
    );
    return { savedSanitizedEvidence: true };
  }
}
