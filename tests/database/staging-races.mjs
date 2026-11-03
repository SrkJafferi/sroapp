// SQL inputs for independent managed PostgreSQL connections. No credentials.
// The orchestrator MUST hard-allow only this explicitly approved staging ref.
export const stagingRef = 'ibulqvolmfouvkqczqhs';
export const protectedRef = 'jyigxpjvygvtvcypujel';
const id = (g, n) => `${g}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const org = id(1, 1),
  doctor = id(4, 1),
  branch = id(2, 1);
const context = (user, role = 'authenticated') =>
  `set local request.jwt.claim.sub=${q(id(3, user))}; set local request.jwt.claims=${q(JSON.stringify({ sub: id(3, user), role }))}; set local role ${role};`;
const book = (slot, patient = 1, reason = 'P2A5 race') =>
  `perform public.book_appointment(${q(slot)},${q(id(5, patient))},${q(reason)});`;
const expected = (operation, state) => `do $race$ declare outcome text; begin
  begin ${operation} outcome:='success'; exception when others then outcome:=sqlstate; end;
  if outcome<>${q(state)} then raise exception 'Race expected %, got %',${q(state)},outcome; end if;
end $race$;`;
const assert = (condition) =>
  `do $check$ begin if not (${condition}) then raise exception 'Post-race invariant failed'; end if; end $check$; select true as invariant_passed;`;
const cases = [];
function make(name, userA = 2, userB = 2) {
  const n = cases.length + 1;
  const slots = [0, 1, 2, 3].map((k) => id(6, 2000 + n * 10 + k));
  const date = `date '2100-04-01'+${n}`;
  const time = `((${date})::timestamp at time zone 'UTC')+interval '4 hours'`;
  const reason = `P2A5 ${name}`;
  const a = `(select id from public.appointments where reason=${q(reason)} and current_slot_id=${q(slots[0])})`;
  const c = {
    name,
    slots,
    reason,
    appointment: a,
    userA,
    userB,
    roleA: 'authenticated',
    roleB: 'authenticated',
    prep: `insert into public.appointment_slots(id,organization_id,doctor_id,branch_id,starts_at,ends_at) values
      (${q(slots[0])},${q(org)},${q(doctor)},${q(branch)},${time},${time}+interval '30 minutes'),
      (${q(slots[1])},${q(org)},${q(doctor)},${q(branch)},${time}+interval '30 minutes',${time}+interval '60 minutes'),
      (${q(slots[2])},${q(org)},${q(doctor)},${q(id(2, 2))},${time},${time}+interval '30 minutes'),
      (${q(slots[3])},${q(org)},${q(id(4, 2))},${q(branch)},${time},${time}+interval '30 minutes');`,
    time,
    after: '',
    cleanup: '',
    holdSeconds: 8,
  };
  cases.push(c);
  return c;
}
function prepareVisit(c, status = 'pending') {
  c.prep += `begin; ${context(2)} ${expected(book(c.slots[0], 1, c.reason), 'success')}`;
  if (status !== 'pending')
    c.prep += `select public.transition_appointment(${c.appointment},'confirmed');`;
  if (status === 'in_consultation')
    c.prep += `select public.transition_appointment(${c.appointment},'in_consultation');`;
  c.prep += 'commit;';
}
{
  const c = make('same_slot_commit');
  c.a = book(c.slots[0], 1, c.reason);
  c.b = book(c.slots[0], 2, c.reason + ' B');
  c.expect = '23P01';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where slot_id=${q(c.slots[0])} and active)=1`,
  );
}
{
  const c = make('same_slot_rollback');
  c.a = book(c.slots[0], 1, c.reason);
  c.aRollback = true;
  c.b = book(c.slots[0], 2, c.reason + ' B');
  c.expect = 'success';
  c.after = assert(
    `(select count(*) from public.appointments where current_slot_id=${q(c.slots[0])})=1 and (select patient_id from public.appointments where current_slot_id=${q(c.slots[0])})=${q(id(5, 2))}`,
  );
}
{
  const c = make('cross_branch_clinician');
  c.a = book(c.slots[0], 1, c.reason);
  c.b = book(c.slots[2], 3, c.reason + ' B');
  c.expect = '23P01';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where slot_id in (${q(c.slots[0])},${q(c.slots[2])}) and active)=1`,
  );
}
{
  const c = make('same_patient_two_doctors');
  c.a = book(c.slots[0], 1, c.reason);
  c.b = book(c.slots[3], 1, c.reason + ' B');
  c.expect = '23P01';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where slot_id in (${q(c.slots[0])},${q(c.slots[3])}) and active)=1`,
  );
}
for (const [first, second] of [
  ['confirmed', 'rejected'],
  ['rejected', 'confirmed'],
]) {
  const c = make(`status_${first}_then_${second}`);
  prepareVisit(c);
  c.a = `perform public.transition_appointment(${c.appointment},${q(first)});`;
  c.b = `perform public.transition_appointment(${c.appointment},${q(second)});`;
  c.expect = '23514';
  c.after = assert(
    `(select status::text from public.appointments where id=${c.appointment})=${q(first)}`,
  );
}
{
  const c = make('booking_wins_proposed_slot');
  prepareVisit(c, 'confirmed');
  c.a = book(c.slots[1], 2, c.reason + ' competitor');
  c.b = `perform public.request_reschedule(${c.appointment},${q(c.slots[1])},'Fictional race proposal');`;
  c.expect = '23P01';
  c.after = assert(
    `(select status='confirmed' from public.appointments where id=${c.appointment}) and not exists(select 1 from public.appointment_reservations where appointment_id=${c.appointment} and kind='proposed')`,
  );
}
{
  const c = make('proposal_wins_competing_booking');
  prepareVisit(c, 'confirmed');
  c.a = `perform public.request_reschedule(${c.appointment},${q(c.slots[1])},'Fictional race proposal');`;
  c.b = book(c.slots[1], 2, c.reason + ' competitor');
  c.expect = '23P01';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where appointment_id=${c.appointment} and active)=2`,
  );
}
{
  const c = make('leave_wins_booking', 3, 2);
  c.a = `perform public.add_doctor_leave(${q(doctor)},${c.time},${c.time}+interval '1 hour','Fictional race leave');`;
  c.b = book(c.slots[0], 1, c.reason);
  c.expect = '23514';
  c.after = assert(
    `not exists(select 1 from public.appointments where current_slot_id=${q(c.slots[0])})`,
  );
}
{
  const c = make('booking_then_leave', 2, 3);
  c.a = book(c.slots[0], 1, c.reason);
  c.b = `perform public.add_doctor_leave(${q(doctor)},${c.time},${c.time}+interval '1 hour','Fictional race leave');`;
  c.expect = 'success';
  c.after = assert(
    `(select status='doctor_unavailable' from public.appointments where id=${c.appointment}) and (select active from public.appointment_reservations where appointment_id=${c.appointment} and kind='original')`,
  );
}
{
  const c = make('booking_blocks_break', 2, 2);
  c.roleB = 'service_role';
  c.a = book(c.slots[0], 1, c.reason);
  c.b = `insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at)
    select ${q(org)},id,'09:00','09:30' from public.doctor_schedules where doctor_id=${q(doctor)} and branch_id=${q(branch)} and weekday=extract(dow from ${c.time});`;
  c.expect = '23514';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where appointment_id=${c.appointment} and active)=1`,
  );
}
{
  const c = make('break_blocks_booking', 2, 2);
  c.roleA = 'service_role';
  const breakId = id(8, 1200);
  c.a = `insert into public.schedule_breaks(id,organization_id,schedule_id,starts_at,ends_at)
    select ${q(breakId)},${q(org)},id,'09:00','09:30' from public.doctor_schedules where doctor_id=${q(id(4, 2))} and branch_id=${q(branch)} and weekday=extract(dow from ${c.time});`;
  c.b = book(c.slots[3], 1, c.reason);
  c.expect = '23514';
  c.after = assert(
    `not exists(select 1 from public.appointments where current_slot_id=${q(c.slots[3])})`,
  );
  c.cleanup = `delete from public.schedule_breaks where id=${q(breakId)};`;
}
for (const action of ['booking', 'approval', 'rescheduling', 'signing', 'leave']) {
  const c = make(
    `revocation_during_${action}`,
    2,
    action === 'signing' || action === 'leave' ? 3 : 1,
  );
  c.holdSeconds = 12;
  c.a = book(c.slots[1], 2, c.reason + ' blocker');
  if (action === 'approval') prepareVisit(c);
  if (action === 'rescheduling') prepareVisit(c, 'confirmed');
  if (action === 'signing') prepareVisit(c, 'in_consultation');
  const role = c.userB === 3 ? 'doctor' : 'admin';
  if (action === 'signing') {
    c.revoke = `update public.patient_assignments set active=false where appointment_id=${c.appointment};`;
    c.b = `perform public.save_encounter(${c.appointment},'{"diagnosis":"Fictional","plan":"Fictional"}'::jsonb,'[]',true);`;
  } else {
    c.revoke = `delete from public.role_assignments where organization_id=${q(org)} and user_id=${q(id(3, c.userB))} and role=${q(role)};`;
    c.cleanup = `insert into public.role_assignments(organization_id,user_id,role) values(${q(org)},${q(id(3, c.userB))},${q(role)}) on conflict do nothing;`;
    if (action === 'booking') c.b = book(c.slots[0], 1, c.reason);
    if (action === 'approval')
      c.b = `perform public.transition_appointment(${c.appointment},'confirmed');`;
    if (action === 'rescheduling')
      c.b = `perform public.request_reschedule(${c.appointment},${q(c.slots[1])},'Fictional revoked request');`;
    if (action === 'leave')
      c.b = `perform public.add_doctor_leave(${q(doctor)},${c.time},${c.time}+interval '1 hour','Fictional revoked leave');`;
  }
  c.expect = '42501';
  c.after = assert(
    action === 'booking'
      ? `not exists(select 1 from public.appointments where current_slot_id=${q(c.slots[0])})`
      : action === 'approval'
        ? `(select status='pending' from public.appointments where id=${c.appointment})`
        : action === 'rescheduling'
          ? `(select status='confirmed' from public.appointments where id=${c.appointment})`
          : action === 'signing'
            ? `not exists(select 1 from public.clinical_encounters where appointment_id=${c.appointment})`
            : `not exists(select 1 from public.doctor_leave where starts_at=${c.time})`,
  );
}

{
  const c = make('booking_blocks_duration_change');
  c.roleB = 'service_role';
  c.a = book(c.slots[0], 1, c.reason);
  c.b = `update public.doctor_branch_assignments set slot_minutes=15 where doctor_id=${q(doctor)} and branch_id=${q(branch)};`;
  c.expect = '23514';
  c.after = assert(
    `(select slot_minutes=30 from public.doctor_branch_assignments where doctor_id=${q(doctor)} and branch_id=${q(branch)})`,
  );
}
{
  const c = make('duration_change_blocks_booking');
  c.roleA = 'service_role';
  c.a = `update public.doctor_branch_assignments set slot_minutes=15 where doctor_id=${q(id(4, 2))} and branch_id=${q(branch)};`;
  c.b = book(c.slots[3], 1, c.reason);
  c.expect = '23514';
  c.after = assert(
    `not exists(select 1 from public.appointments where current_slot_id=${q(c.slots[3])})`,
  );
  c.cleanup = `update public.doctor_branch_assignments set slot_minutes=30 where doctor_id=${q(id(4, 2))} and branch_id=${q(branch)};`;
}
{
  const c = make('timezone_change_blocks_booking');
  c.roleA = 'service_role';
  c.prep += `update public.branches set timezone='Asia/Tokyo' where id=${q(id(2, 2))};`;
  c.a = `update public.branches set timezone='America/New_York' where id=${q(id(2, 2))};`;
  c.b = book(c.slots[2], 3, c.reason);
  c.expect = '23514';
  c.after = assert(
    `not exists(select 1 from public.appointments where current_slot_id=${q(c.slots[2])})`,
  );
}
{
  const c = make('booking_blocks_timezone_change');
  c.roleB = 'service_role';
  c.prep += `update public.branches set timezone='Asia/Tokyo' where id=${q(id(2, 2))};`;
  c.a = book(c.slots[2], 3, c.reason);
  c.b = `update public.branches set timezone='America/New_York' where id=${q(id(2, 2))};`;
  c.expect = '23514';
  const aid = `(select id from public.appointments where current_slot_id=${q(c.slots[2])} and reason=${q(c.reason)})`;
  c.after = assert(
    `(select timezone='Asia/Tokyo' from public.branches where id=${q(id(2, 2))}) and exists(select 1 from public.appointment_reservations where appointment_id=${aid} and active)`,
  );
  c.cleanup = `begin; ${context(2)} select public.transition_appointment(${aid},'cancellation_requested'); select public.transition_appointment(${aid},'cancelled'); commit;`;
}

{
  const c = make('cross_organization_clinician_identity', 2, 9);
  const otherOrg = id(1, 2),
    otherBranch = id(2, 3),
    otherDoctor = id(4, 5),
    slot = id(6, 9500);
  c.prep += `insert into public.organization_memberships(organization_id,user_id) values(${q(otherOrg)},${q(id(3, 3))});
    insert into public.role_assignments(organization_id,user_id,role) values(${q(otherOrg)},${q(id(3, 3))},'doctor');
    insert into public.branch_memberships(organization_id,branch_id,user_id) values(${q(otherOrg)},${q(otherBranch)},${q(id(3, 3))});
    insert into public.doctors(id,organization_id,user_id,specialization_id,name,active) values(${q(otherDoctor)},${q(otherOrg)},${q(id(3, 3))},${q(id(7, 2))},'Dr. Fictional Shared Identity',true);
    insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id) values(${q(otherOrg)},${q(otherDoctor)},${q(otherBranch)});
    insert into public.doctor_schedules(organization_id,doctor_id,branch_id,weekday,starts_at,ends_at,valid_from)
    select ${q(otherOrg)},${q(otherDoctor)},${q(otherBranch)},d,'09:00','17:00','2099-01-01' from generate_series(0,6) d;
    insert into public.appointment_slots(id,organization_id,doctor_id,branch_id,starts_at,ends_at) values(${q(slot)},${q(otherOrg)},${q(otherDoctor)},${q(otherBranch)},${c.time},${c.time}+interval '30 minutes');`;
  c.a = book(c.slots[0], 1, c.reason);
  c.b = book(slot, 4, c.reason + ' other organization');
  c.expect = '23P01';
  c.after = assert(
    `(select count(*) from public.appointment_reservations where slot_id=${q(c.slots[0])} and active)=1`,
  );
}

export const raceCases = cases.map((c) => ({
  ...c,
  beginA: `begin; set local application_name=${q('p2a5_' + c.name + '_a')}; set local statement_timeout='40s'; set local lock_timeout='30s'; ${context(c.userA, c.roleA)} ${expected(c.a, 'success')}`,
  beginB: `begin; set local application_name=${q('p2a5_' + c.name + '_b')}; set local statement_timeout='40s'; set local lock_timeout='30s'; ${context(c.userB, c.roleB)} ${expected(c.b, c.expect)}`,
  connectionA: `begin; set local application_name=${q('p2a5_' + c.name + '_a')}; set local statement_timeout='25s'; set local lock_timeout='18s'; ${context(c.userA, c.roleA)} ${expected(c.a, 'success')} select pg_sleep(${c.holdSeconds}); ${c.aRollback ? 'rollback' : 'commit'}; select 'A finished' as outcome;`,
  connectionB: `begin; set local application_name=${q('p2a5_' + c.name + '_b')}; set local statement_timeout='25s'; set local lock_timeout='18s'; ${context(c.userB, c.roleB)} ${expected(c.b, c.expect)} commit; select ${q(c.expect)} as expected_and_observed_outcome;`,
}));
if (process.argv.includes('--json'))
  console.log(JSON.stringify({ stagingRef, protectedRef, cases: raceCases }));
