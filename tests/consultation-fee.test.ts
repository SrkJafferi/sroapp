import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultationFeeSchema, paisaToPkr } from '../packages/validation/src/index';
import { money } from '../packages/clinic-core/src/index';
import { createClinicalRepository } from '../apps/web/lib/clinical-client';
import { createMockRepository } from '../packages/data-access/src/index';

test('fee input converts decimal text to integer paisa exactly within the deployed limit', () => {
  for (const [value, paisa] of [
    ['0', 0],
    ['0.01', 1],
    ['1.13', 113],
    ['1500', 150000],
    ['1500.99', 150099],
    ['1000000.00', 100000000],
  ] as const) {
    assert.equal(consultationFeeSchema.parse(value), paisa);
    assert.equal(consultationFeeSchema.parse(paisaToPkr(paisa)), paisa);
  }
  for (const value of [
    '',
    '-1',
    '1.001',
    '1000000.01',
    'NaN',
    'Infinity',
    '1e3',
    '1,500',
    '0x10',
    '.5',
  ])
    assert.equal(consultationFeeSchema.safeParse(value).success, false, value);
  assert.equal(money(0), 'Free Consultation');
  assert.equal(money(1500), 'Rs. 1,500');
  assert.equal(money(1500.99), 'Rs. 1,500.99');
});

test('Web fee command sends exact decimal text to selected branch; failures propagate', async () => {
  const original = globalThis.fetch;
  const state = createMockRepository().getSnapshot();
  const actor = state.profiles.find((p) => p.role === 'admin')!;
  const repo = createClinicalRepository('admin', state.organization.id, actor.branchIds[0]);
  try {
    let sent: unknown;
    globalThis.fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ saved: true });
    };
    await repo.saveFee(actor, 'doctor', 'selected-branch', '1.13');
    assert.deepEqual(sent, {
      role: 'admin',
      organizationId: state.organization.id,
      command: 'configure',
      input: {
        branchId: 'selected-branch',
        action: 'fee',
        data: { doctorId: 'doctor', fee: '1.13' },
      },
    });
    await assert.rejects(repo.saveFee(actor, 'doctor', 'selected-branch', '1.001'));
    globalThis.fetch = async () =>
      Response.json({ error: 'Branch access denied.' }, { status: 403 });
    await assert.rejects(
      repo.saveFee(actor, 'doctor', 'selected-branch', '1500'),
      /Branch access denied/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
