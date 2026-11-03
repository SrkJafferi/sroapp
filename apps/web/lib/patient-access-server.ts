import 'server-only';
import { randomUUID } from 'node:crypto';
import { provisioningClient } from './supabase/admin';
import type { AccessDependencies } from './patient-access-protocol';
import {
  completeDistributedPasswordChange,
  type CoordinationRpc,
} from './patient-account-coordination';
import { coordinatedPatientAccessRoutesEnabled, requireCoordinatedPatientAccessRoutes, requireCoordinatedPatientMutations } from './patient-access-coordinated';
import { patientWalkInPilotEnabled, pilotComplete } from './patient-walkin-pilot';
import {
  SRO0009_RECOVERY,
  handoverWindow,
  recoveryFirstChange,
  requireSro0009Recovery,
  sro0009RecoveryEnabled,
} from './sro0009-recovery';
import { createClient } from '@supabase/supabase-js';
import { sessionClient, publicConfig } from './supabase/server';
import { privateLogin, normalizeLogin } from './patient-access-protocol';
import { passwordSchema } from '@sro/validation';
import { guardPilotDependencies } from './patient-access-pilot-adapter';
import {
  PATIENT_ACCESS_PILOT,
  assertPilotExecution,
  assertPilotPatientBinding,
  pilotExecutionEnabled,
  type PilotOperatorScope,
} from './patient-access-pilot-policy';
import { limit } from './auth/rate-limit';

async function accountCommand(
  action: string,
  actor: string | null,
  patient: string | null,
  data: Record<string, unknown>,
) {
  const r = await provisioningClient().rpc(
    'patient_account_command' as never,
    { p_action: action, p_actor: actor, p_patient: patient, p_data: data } as never,
  );
  if (r.error) throw Error('Patient account request refused. Contact the clinic administrator.');
  return r.data;
}

export type ManagedPatientSelf = {
  state: string;
  internal: boolean;
  patientId: string;
};
export async function managedPatientSelf(userId: string): Promise<ManagedPatientSelf | null> {
  const access = (await accountCommand('self', userId, null, {})) as Partial<ManagedPatientSelf> | null;
  if (
    !access ||
    typeof access.patientId !== 'string' ||
    typeof access.state !== 'string' ||
    typeof access.internal !== 'boolean'
  )
    return null;
  return { state: access.state, internal: access.internal, patientId: access.patientId };
}
export async function patientAccessSelf(userId: string) {
  const access = await managedPatientSelf(userId);
  if (!access) return null;
  if (coordinatedPatientAccessRoutesEnabled()) return access;
  if (access.patientId !== PATIENT_ACCESS_PILOT.patientId)
    return { ...access, state: 'outside-pilot', patientId: '' };
  return pilotExecutionEnabled() ? access : { ...access, state: 'pilot-disabled' };
}
export async function patientIdSignIn(identifier: string, password: string, ip: string) {
  const client = await sessionClient();
  const coordinated = coordinatedPatientAccessRoutesEnabled();
  const normalized = normalizeLogin(identifier);
  let expectedUserId: string | undefined;
  await privateLogin(identifier, password, {
    minimumMs: 1500,
    limit: async () => {
      limit('patient-pilot-login-id', normalized.value || identifier, 10, 900000);
      limit('patient-pilot-login-ip', ip, 10, 900000);
      if (!pilotExecutionEnabled() && !coordinated) return;
      const { createHmac } = await import('node:crypto');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw Error('Unavailable');
      const hash = (s: string) => createHmac('sha256', key).update(s).digest('hex');
      const r = await provisioningClient().rpc(
        'patient_login_limit' as never,
        {
          p_identifier: hash(normalizeLogin(identifier).value || identifier),
          p_ip: hash(ip),
        } as never,
      );
      if (r.error) throw Error('Limited');
    },
    resolve: async (code) => {
      // Code is a routing hint only. Authorization additionally requires the exact private UUID binding.
      if (!coordinated) {
        assertPilotExecution();
        if (code !== PATIENT_ACCESS_PILOT.patientCode) return null;
      }
      const r = (await accountCommand('resolve', null, null, { code })) as {
        email: string;
        userId: string;
      } | null;
      if (!r) return null;
      const binding = await patientAccessSelf(r.userId);
      if (
        !binding ||
        !['active', 'change_required'].includes(binding.state) ||
        (!coordinated && binding.patientId !== PATIENT_ACCESS_PILOT.patientId)
      )
        return null;
      expectedUserId = r.userId;
      return { email: r.email };
    },
    authenticate: async (email, pw) => {
      if (!coordinated) assertPilotExecution();
      if (normalized.kind !== 'patientId') throw Error('Denied');
      const r = await client.auth.signInWithPassword({ email, password: pw });
      if (r.error || !r.data.user?.email_confirmed_at)
        throw Object.assign(Error('Denied'), {
          authCode: r.error?.code ?? 'identity_rejected',
        });
      return r.data.user;
    },
    allow: async (user) => {
      const managed = await patientAccessSelf(user.id);
      if (
        user.id !== expectedUserId ||
        !managed ||
        !['active', 'change_required'].includes(managed.state) ||
        (!coordinated && managed.patientId !== PATIENT_ACCESS_PILOT.patientId)
      ) {
        await client.auth.signOut({ scope: 'local' });
        return false;
      }
      return true;
    },
  });
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw Error('Sign-in failed.');
  return { client, user, access: await patientAccessSelf(user.id) };
}
export async function changeInitialPatientPassword(
  client: Awaited<ReturnType<typeof sessionClient>>,
  userId: string,
  password: string,
) {
  assertPilotExecution();
  const access = await patientAccessSelf(userId);
  assertPilotPatientBinding(access?.patientId ?? '');
  if (access?.state !== 'change_required') throw Error('Password change not eligible.');
  passwordSchema.parse(password);
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (
    assurance.error ||
    (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2')
  )
    throw Error('Authenticator verification required.');
  const claims = await client.auth.getClaims();
  const sid = claims.data?.claims.session_id;
  if (claims.error || claims.data?.claims.sub !== userId || typeof sid !== 'string')
    throw Error('Session verification failed.');
  const current = await provisioningClient().auth.admin.getUserById(userId);
  if (current.error || !current.data.user.email) throw Error('Identity unavailable.');
  // Verify the replacement differs from the current credential without storing the old password.
  const config = publicConfig(),
    probe = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const same = await probe.auth.signInWithPassword({ email: current.data.user.email, password });
  if (!same.error) {
    await probe.auth.signOut({ scope: 'local' });
    throw Error('Choose a password different from your temporary password.');
  }
  const changed = await client.auth.updateUser({ password });
  if (changed.error) throw Error('Password update was not confirmed.');
  assertPilotExecution();
  await accountCommand('change-complete', userId, access.patientId, {
    sessionId: sid,
  });
}

const coordinatedOperation: CoordinationRpc = async (action, input) => {
  const r = await provisioningClient().rpc(
    'patient_account_operation' as never,
    {
      p_action: action,
      p_actor: input.actorId,
      p_patient: input.patientId,
      p_operation: input.operationId,
      p_worker: input.workerId,
      p_proof: input.proof,
      p_data: input.data ?? {},
    } as never,
  );
  if (r.error) throw Error('Patient account operation refused.');
  return (r.data ?? {}) as Record<string, unknown>;
};

// Coordinated staff routes use the route-level Admin context and the SQL capability checks.
// Unlike the legacy pilot dependency guard, this is not pinned to SRO0007.
export function coordinatedPatientAccessDependencies(): AccessDependencies & {
  operation: CoordinationRpc;
} {
  return {
    async command(action, actor, patient, data) {
      if (action !== 'status') requireCoordinatedPatientMutations();
      return accountCommand(action, actor, patient, data);
    },
    async createInternalUser({ id, email, password }) {
      const r = await provisioningClient().auth.admin.createUser({
        id,
        email,
        password,
        email_confirm: true,
      });
      if (r.error)
        throw new Error(
          'Account provisioning remains pending; no credential handover is available.',
        );
    },
    async replacePassword(userId, password) {
      const r = await provisioningClient().auth.admin.updateUserById(userId, { password });
      if (r.error)
        throw new Error('Password replacement remains pending; clinic review is required.');
    },
    operation: coordinatedOperation,
    handoverWindow: (actorId, patientId) => handoverWindow(actorId, patientId),
  };
}

// Narrow recovery authority. It deliberately does not consult the broad mutation/reset gates;
// every call is pinned to SRO0009 and the exact reviewed Admin by the server and PostgreSQL.
export function coordinatedRecoveryDependencies(): AccessDependencies & {
  operation: CoordinationRpc;
} {
  return {
    async command(action, actor, patient, data) {
      requireSro0009Recovery(patient);
      return accountCommand(action, actor, patient, data);
    },
    async createInternalUser() {
      throw new Error('Recovery never creates an identity.');
    },
    async replacePassword(userId, password) {
      const r = await provisioningClient().auth.admin.updateUserById(userId, { password });
      if (r.error)
        throw new Error('Password replacement remains pending; clinic review is required.');
    },
    operation: coordinatedOperation,
    handoverWindow: (actorId, patientId) => handoverWindow(actorId, patientId),
  };
}

export async function changeManagedPatientPassword(
  client: Awaited<ReturnType<typeof sessionClient>>,
  userId: string,
  password: string,
) {
  requireCoordinatedPatientAccessRoutes();
  const access = await managedPatientSelf(userId);
  if (!access || access.state !== 'change_required')
    throw Error('Password change not eligible.');
  passwordSchema.parse(password);
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (
    assurance.error ||
    (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2')
  )
    throw Error('Authenticator verification required.');
  const claims = await client.auth.getClaims();
  const sid = claims.data?.claims.session_id;
  if (claims.error || claims.data?.claims.sub !== userId || typeof sid !== 'string')
    throw Error('Session verification failed.');
  const current = await provisioningClient().auth.admin.getUserById(userId);
  if (current.error || !current.data.user.email) throw Error('Identity unavailable.');
  const config = publicConfig(),
    probe = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const same = await probe.auth.signInWithPassword({ email: current.data.user.email, password });
  if (!same.error) {
    await probe.auth.signOut({ scope: 'local' });
    throw Error('Choose a password different from your temporary password.');
  }
  await completeDistributedPasswordChange({
    actorId: userId,
    patientId: access.patientId,
    requestId: randomUUID(),
    sessionId: sid,
    rpc: coordinatedOperation,
    command: accountCommand,
    replaceOwnPassword: async () => {
      const changed = await client.auth.updateUser({ password });
      if (changed.error) throw Error('Password update was not confirmed.');
    },
  });
  if (sro0009RecoveryEnabled() && access.patientId === SRO0009_RECOVERY.patientId) {
    // The password is already changed and the account active; a marker failure stays reviewable.
    await recoveryFirstChange(userId, access.patientId).catch(() => undefined);
  }
  if (patientWalkInPilotEnabled())
    await pilotComplete(access.patientId).catch(() => undefined);
}

// Not referenced by active APIs. Approval alone does not bypass a separately reviewed route gate.
export function patientAccessDependencies(scope: PilotOperatorScope): AccessDependencies {
  return guardPilotDependencies(scope, {
    async command(action, actor, patient, data) {
      return accountCommand(action, actor, patient, data);
    },
    async createInternalUser({ id, email, password }) {
      const r = await provisioningClient().auth.admin.createUser({
        id,
        email,
        password,
        email_confirm: true,
      });
      if (r.error)
        throw new Error(
          'Account provisioning remains pending; no credential handover is available.',
        );
    },
    async replacePassword(userId, password) {
      const r = await provisioningClient().auth.admin.updateUserById(userId, { password });
      if (r.error)
        throw new Error('Password replacement remains pending; clinic review is required.');
    },
  });
}
