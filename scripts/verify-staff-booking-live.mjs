// Explicitly approved protected-project fictional-record checks. User sessions only.
import { request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const mode = process.argv[2],
  origin = 'http://localhost:3100',
  ref = 'jyigxpjvygvtvcypujel';
assert.ok(['admin', 'finish'].includes(mode));
assert.ok(process.argv.includes('--approved-live-verification'));
const dir = 'artifacts/staff-booking-validation';
await mkdir(dir, { recursive: true });
const evidence = `${dir}/${mode}-live.json`;
try {
  await readFile(evidence);
  throw new Error('This verification has already completed; reuse the evidence.');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const vault = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const admin = JSON.parse(await readFile(path.join(vault, 'phase2b-demo-admin.json'), 'utf8'));
const accounts = JSON.parse(
  await readFile(path.join(vault, 'phase2c-demo-accounts.json'), 'utf8'),
).accounts;
const sessions = {},
  contexts = [],
  checks = [];
let step = 'login';
try {
  for (const person of [{ ...admin, role: 'admin' }, ...accounts]) {
    const c = await request.newContext({ baseURL: origin });
    contexts.push(c);
    assert.equal(
      (
        await c.post('/api/auth/login', {
          headers: { Origin: origin },
          data: { email: person.email, password: person.password },
        })
      ).status(),
      200,
    );
    const identity = (await (await c.get('/api/auth/session')).json()).identity;
    const member = identity.memberships.find(
      (m) => m.roles.includes(person.role) && m.branchIds.length,
    );
    assert.ok(member);
    sessions[person.role] = { c, member };
  }
  const snapshot = async (role) => {
    const { c, member } = sessions[role];
    const r = await c.get(
      '/api/clinic?' + new URLSearchParams({ role, organizationId: member.organizationId }),
    );
    assert.equal(r.status(), 200);
    return r.json();
  };
  const profile = async (role, id) => {
    const { c, member } = sessions[role];
    const r = await c.get(
      '/api/profiles?' +
        new URLSearchParams({ organizationId: member.organizationId, kind: 'patient', id }),
    );
    assert.equal(r.status(), 200);
    return (await r.json()).profile;
  };
  const save = async (role, id, fields) => {
    const { c, member } = sessions[role];
    return c.post('/api/profiles', {
      headers: { Origin: origin },
      multipart: {
        organizationId: member.organizationId,
        kind: 'patient',
        id,
        fields: JSON.stringify(fields),
        photo: 'keep',
        requestId: randomUUID(),
      },
    });
  };
  const id = '398cf267-bc60-41a4-91e6-478dcd86a069';
  if (mode === 'admin') {
    step = 'baseline';
    const baseline = await snapshot('admin');
    const p = baseline.state.patients.find((p) => p.id === id);
    assert.equal(p?.patientCode, 'SRO0001');
    await writeFile(`${dir}/live-baseline.json`, JSON.stringify(baseline, null, 2) + '\n');
    const before = await profile('admin', id);
    assert.equal(before.canEditBloodGroup, true);
    assert.equal((await profile('doctor', id)).canEditBloodGroup, true);
    assert.equal((await profile('patient', id)).canEditBloodGroup, false);
    checks.push(
      'Trusted Admin and treating Doctor capabilities enabled; Patient capability denied',
    );
    step = 'Admin blood-group save';
    const newGroup = before.bloodGroup === 'O+' ? 'A+' : 'O+';
    const saved = await save('admin', id, { name: before.name, bloodGroup: newGroup });
    assert.equal(saved.status(), 200);
    assert.equal((await saved.json()).profile.bloodGroup, newGroup);
    assert.equal((await profile('admin', id)).bloodGroup, newGroup);
    assert.equal((await profile('patient', id)).bloodGroup, newGroup);
    const after = await snapshot('admin');
    const updated = after.state.patients.find((p) => p.id === id);
    assert.deepEqual({ ...updated.history, bloodGroup: p.history.bloodGroup }, p.history);
    assert.deepEqual(after.state.consultations, baseline.state.consultations);
    assert.deepEqual(after.state.prescriptions, baseline.state.prescriptions);
    assert.deepEqual(after.state.appointments, baseline.state.appointments);
    checks.push(
      'Admin atomic blood-group write persisted and Patient reads it; other history and signed records unchanged',
    );
    step = 'Patient write denial';
    assert.equal(
      (await save('patient', id, { name: before.name, bloodGroup: before.bloodGroup })).status(),
      403,
    );
    assert.equal((await profile('admin', id)).bloodGroup, newGroup);
    checks.push('Owning Patient blood-group write rejected without change');
    for (const role of ['doctor', 'patient']) {
      const { c, member } = sessions[role];
      assert.equal(
        (
          await c.get(
            '/api/clinic?' +
              new URLSearchParams({ role: 'admin', organizationId: member.organizationId }),
          )
        ).status(),
        403,
      );
    }
    checks.push('Doctor and Patient cannot request Admin clinical workspace');
    const anonymous = await request.newContext({ baseURL: origin });
    contexts.push(anonymous);
    assert.equal((await anonymous.get('/api/clinic?role=admin')).status(), 401);
    checks.push('Anonymous clinical access denied');
    const unrelated = baseline.state.patients.find(
      (p) => !after.state.patientIntakes?.some((i) => i.patientId === p.id) && p.id !== id,
    );
    const doctorState = await snapshot('doctor');
    const privatePatient = baseline.state.patients.find(
      (p) => !doctorState.state.patients.some((d) => d.id === p.id),
    );
    if (privatePatient) {
      const { c, member } = sessions.doctor;
      assert.equal(
        (
          await c.get(
            '/api/profiles?' +
              new URLSearchParams({
                organizationId: member.organizationId,
                kind: 'patient',
                id: privatePatient.id,
              }),
          )
        ).status(),
        403,
      );
      checks.push('Unrelated patient profile denied to treating Doctor');
    }
    await writeFile(
      evidence,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          projectRef: ref,
          checks,
          patientCode: p.patientCode,
          restoreBloodGroup: before.bloodGroup,
          newBloodGroup: newGroup,
          clinicalWrites: 1,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    const baseline = JSON.parse(await readFile(`${dir}/live-baseline.json`, 'utf8'));
    const setup = JSON.parse(await readFile(`${dir}/admin-live.json`, 'utf8'));
    const current = await snapshot('admin');
    const p = current.state.patients.find((p) => p.id === id),
      old = baseline.state.patients.find((p) => p.id === id);
    assert.deepEqual(p, old);
    checks.push(
      'Doctor browser blood-group save restored original value; all original patient fields/history preserved',
    );
    assert.deepEqual(current.state.consultations, baseline.state.consultations);
    assert.deepEqual(current.state.prescriptions, baseline.state.prescriptions);
    checks.push('All existing signed consultations and prescriptions unchanged');
    const newAppointments = current.state.appointments.filter(
      (a) => !baseline.state.appointments.some((b) => b.id === a.id),
    );
    assert.equal(newAppointments.length, 1);
    const a = newAppointments[0];
    assert.equal(a.patientId, id);
    assert.equal(a.status, 'confirmed');
    assert.equal(a.doctorId, (await snapshot('doctor')).actor.doctorId);
    for (const old of baseline.state.appointments)
      assert.deepEqual(
        current.state.appointments.find((a) => a.id === old.id),
        old,
      );
    checks.push(
      'Exactly one Doctor-created appointment persisted as confirmed; original appointments and pending requests unchanged',
    );
    const patientState = await snapshot('patient');
    assert.equal(patientState.state.appointments.find((x) => x.id === a.id)?.status, 'confirmed');
    assert.equal((await profile('patient', id)).bloodGroup, setup.restoreBloodGroup);
    assert.ok(patientState.state.patients.every((p) => p.id === id));
    checks.push(
      'Owning Patient sees confirmed appointment and restored blood group; unrelated patients remain hidden',
    );
    await writeFile(
      evidence,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          projectRef: ref,
          checks,
          appointmentId: a.id,
          status: a.status,
          date: a.date,
          time: a.time,
          patientCode: p.patientCode,
          clinicalWrites: 0,
        },
        null,
        2,
      ) + '\n',
    );
  }
  console.log(JSON.stringify({ mode, passed: checks.length, checks }));
} catch {
  console.error(
    JSON.stringify({
      mode,
      failed: step,
      details: 'Stopped on failed verification; credential values not logged.',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.dispose();
}
