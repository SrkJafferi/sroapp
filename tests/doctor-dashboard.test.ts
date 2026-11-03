import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  specialtyContent,
  statusGroup,
  shiftDay,
  doctorDashboardData,
} from '../apps/web/lib/doctor-dashboard';
import { createMockRepository } from '../packages/data-access/src/index';
import { getActor } from '../packages/clinic-core/src/index';
import type { AppointmentStatus } from '@sro/types';

test('specialty aliases are explicit, distinct and safe on rename', () => {
  assert.equal(specialtyContent('Dermatology (Skin Specialist)').key, 'skin');
  assert.equal(specialtyContent('General Checkup').key, 'general');
  assert.equal(specialtyContent('Cardiology (Heart Specialist)').key, 'heart');
  assert.equal(specialtyContent('  general   medicine ').key, 'general');
  assert.equal(specialtyContent('Dermatology and Other New Care').key, 'neutral');
  for (const name of [
    'Pediatrics (Child Specialist)',
    'Gynecology & Obstetrics',
    'Orthopedics',
    'ENT (Ear, Nose & Throat)',
    'Diabetes & Endocrinology',
    'Gastroenterology',
    'Ophthalmology (Eye Specialist)',
    'Dentistry (Dental Care)',
    'Pulmonology (Chest Specialist)',
  ])
    assert.notEqual(specialtyContent(name).key, 'neutral');
});
test('calendar date arithmetic crosses year and leap boundaries without local timezone drift', () => {
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
});
test('all workflow statuses enter exactly one meaningful chart category', () => {
  const states: AppointmentStatus[] = [
    'pending',
    'confirmed',
    'rejected',
    'reschedule_requested',
    'cancellation_requested',
    'cancelled',
    'checked_in',
    'in_consultation',
    'completed',
    'no_show',
    'doctor_unavailable',
  ];
  const base = createMockRepository().getSnapshot().appointments[0];
  const groups = states.map((status) => statusGroup({ ...base, status }));
  assert.equal(groups.length, states.length);
  assert.equal(groups.filter((g) => g === 'In consultation').length, 2);
  assert.equal(groups.filter((g) => g === 'Cancelled / unavailable').length, 4);
  assert.equal(statusGroup({ ...base, status: 'completed', source: 'follow_up' }), 'Completed');
});
test('doctor model isolates doctor and selected branch; counts match source arrays', () => {
  const state = createMockRepository().getSnapshot(),
    actor = getActor(state, 'doctor');
  const branch = actor.branchIds[0],
    today = state.appointments.find((a) => a.doctorId === actor.doctorId)!.date;
  const data = doctorDashboardData(state, actor, branch, today);
  assert.ok(data.appointments.every((a) => a.doctorId === actor.doctorId && a.branchId === branch));
  assert.equal(data.today.length, data.appointments.filter((a) => a.date === today).length);
  const denied = doctorDashboardData(state, actor, 'not-authorized', today);
  assert.equal(denied.appointments.length + denied.patients.length + denied.encounters.length, 0);
});
test('follow-up plans deduplicate patients and a later return appointment resolves awaiting status', () => {
  const state = createMockRepository().getSnapshot(),
    actor = getActor(state, 'doctor'),
    branch = actor.branchIds[0];
  const a = state.appointments.find((a) => a.doctorId === actor.doctorId && a.branchId === branch)!;
  state.appointments = [{ ...a, date: '2026-10-01' }];
  const c = state.consultations[0];
  state.consultations = [
    {
      ...c,
      id: 'followup',
      appointmentId: a.id,
      patientId: a.patientId,
      doctorId: actor.doctorId!,
      branchId: branch,
      date: '2026-10-01',
      status: 'signed',
      followUp: 'Return in two weeks',
    },
  ];
  assert.equal(doctorDashboardData(state, actor, branch, '2026-10-29').followUps, 1);
  state.appointments.push({ ...a, id: 'return', date: '2026-10-30', status: 'confirmed' });
  assert.equal(doctorDashboardData(state, actor, branch, '2026-10-29').followUps, 0);
});
