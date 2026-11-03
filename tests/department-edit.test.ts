import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentSchema } from '../packages/validation/src/index';
import { createClinicalRepository } from '../apps/web/lib/clinical-client';
import { createMockRepository } from '../packages/data-access/src/index';
test('department form trims fields and rejects invalid names or excessive descriptions', () => {
  assert.deepEqual(
    departmentSchema.parse({ name: ' General Checkup ', description: ' Updated description ' }),
    { name: 'General Checkup', description: 'Updated description' },
  );
  for (const data of [
    { name: ' ' },
    { name: 'x'.repeat(101) },
    { name: 'Valid', description: 'x'.repeat(2001) },
    { name: 'Valid', organizationId: 'forged' },
  ])
    assert.equal(departmentSchema.safeParse(data).success, false);
});
test('update command carries original ID in a separate action; never falls back to Add', async () => {
  const original = globalThis.fetch,
    state = createMockRepository().getSnapshot(),
    actor = state.profiles.find((p) => p.role === 'admin')!;
  const clinic = createClinicalRepository('admin', state.organization.id, actor.branchIds[0]);
  let payload: unknown;
  try {
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ saved: true });
    };
    await clinic.updateSpecialization(actor, 'original-id', ' General Checkup ', ' Description ');
    assert.deepEqual(payload, {
      role: 'admin',
      organizationId: state.organization.id,
      command: 'configure',
      input: {
        branchId: actor.branchIds[0],
        action: 'department_update',
        data: { id: 'original-id', name: 'General Checkup', description: 'Description' },
      },
    });
    globalThis.fetch = async () =>
      Response.json({ error: 'Department editing is awaiting activation.' }, { status: 503 });
    await assert.rejects(
      clinic.updateSpecialization(actor, 'original-id', 'New name', ''),
      /awaiting activation/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
