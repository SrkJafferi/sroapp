import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileHeart,
  HeartPulse,
  Stethoscope,
  Users,
} from 'lucide-react-native';
import {
  appointmentsFor,
  availableSlots,
  DEMO_DATE,
  displayDate,
  displayTime,
  money,
  suggestedDoctors,
} from '@sro/clinic-core';
import { canViewPatient } from '@sro/permissions';
import type { Appointment, DemoRole } from '@sro/types';
import { colors } from '@sro/design-tokens';
import { useClinic } from './context';
import { Avatar, Badge, Btn, Card, Empty, go, Input, Item, Page, Row, Select, Txt } from './ui';

export function AppointmentCard({ appointment: a }: { appointment: Appointment }) {
  const { state, role } = useClinic();
  const d = state.doctors.find((d) => d.id === a.doctorId)!;
  const p = state.patients.find((p) => p.id === a.patientId)!;
  return (
    <Card>
      <Row>
        <Avatar initials={role === 'patient' ? d.initials : p.initials} color={d.color} />
        <View style={{ flex: 1 }}>
          <Txt bold size={14}>
            {role === 'patient' ? d.name : p.name}
          </Txt>
          <Txt muted size={11}>
            {role === 'patient'
              ? state.specializations.find((s) => s.id === d.specializationId)?.name
              : d.name}
          </Txt>
        </View>
      </Row>
      <Badge status={a.status} />
      <Row>
        <CalendarDays size={15} color="#92809f" />
        <Txt muted size={12}>
          {displayDate(a.date)} · {displayTime(a.time)}
        </Txt>
      </Row>
      <Txt muted size={11}>
        {a.type === 'physical' ? 'Physical clinic visit' : 'Remote consultation'} · {a.duration} min
      </Txt>
      <Btn title="View appointment" outline onPress={() => go('appointment', { id: a.id })} />
    </Card>
  );
}
export function Home() {
  const { state, role, actor, branchId } = useClinic();
  const all = appointmentsFor(state, actor).filter((a) => a.branchId === branchId);
  const today = all.filter((a) => a.date === DEMO_DATE);
  const pending = today.filter((a) =>
    ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status),
  );
  return (
    <Page
      back={false}
      title={
        role === 'admin'
          ? `Welcome back, ${actor.name.split(' ')[0]}`
          : role === 'doctor'
            ? `Good morning, ${actor.name.split(' ').slice(0, 2).join(' ')}`
            : `Good morning, ${actor.name.split(' ')[0]}`
      }
      subtitle="Your clinic. Your health. Connected care."
    >
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {(role === 'patient'
          ? [
              { label: 'Book appointment', icon: CalendarDays, screen: 'book', color: '#e7f6ed' },
              { label: 'Find a doctor', icon: Stethoscope, screen: 'doctors', color: '#eaf2fe' },
              { label: 'My records', icon: FileHeart, screen: 'records', color: '#fff3e1' },
              {
                label: 'Prescriptions',
                icon: ClipboardList,
                screen: 'prescriptions',
                color: '#eeebfa',
              },
            ]
          : [
              {
                label: "Today's visits",
                icon: CalendarDays,
                screen: 'approvals',
                color: '#eeebfa',
                value: today.length,
              },
              {
                label: 'Pending requests',
                icon: ClipboardList,
                screen: 'approvals',
                color: '#fff3e1',
                value: pending.length,
              },
              {
                label: role === 'admin' ? 'Patients' : 'Completed',
                icon: Users,
                screen: 'patients',
                color: '#e7f6ed',
                value:
                  role === 'admin'
                    ? state.patients.length
                    : all.filter((a) => a.status === 'completed').length,
              },
              {
                label: role === 'admin' ? 'Active doctors' : 'Your schedule',
                icon: Stethoscope,
                screen: role === 'admin' ? 'doctors' : 'schedules',
                color: '#eaf2fe',
                value: role === 'admin' ? state.doctors.length : today.length,
              },
            ]
        ).map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={() =>
              item.label === "Today's visits"
                ? router.push('/(tabs)/appointments')
                : go(item.screen)
            }
            style={{
              width: '47.8%',
              backgroundColor: '#fff',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 17,
              gap: 12,
            }}
          >
            <View
              style={{
                backgroundColor: item.color,
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <item.icon color="#73578e" size={23} />
            </View>
            {'value' in item && (
              <Txt bold size={27}>
                {item.value}
              </Txt>
            )}
            <Txt bold size={12}>
              {item.label}
            </Txt>
          </Pressable>
        ))}
      </View>
      {role !== 'patient' && <Btn title="New appointment" onPress={() => go('book')} />}
      <Row>
        <View style={{ flex: 1 }}>
          <Txt bold size={17}>
            {role === 'patient' ? 'Your upcoming appointment' : "Today's appointments"}
          </Txt>
          <Txt muted size={10}>
            Monday, 26 October · demo clinic day
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all appointments"
          onPress={() => router.push('/(tabs)/appointments')}
        >
          <ArrowRight size={20} color={colors.brand} />
        </Pressable>
      </Row>
      {today.slice(0, 3).map((a) => (
        <AppointmentCard key={a.id} appointment={a} />
      ))}
      {!today.length && (
        <Card>
          <Empty title="Your schedule is clear" text="Request an appointment to get started." />
        </Card>
      )}
      <Card title="Care with a purpose">
        <HeartPulse size={26} color="#58a17a" />
        <Txt bold size={21}>
          Healthcare for a better tomorrow.
        </Txt>
        <Txt muted size={12}>
          Social Responsibility Organization · Pakistan
        </Txt>
      </Card>
    </Page>
  );
}
export function Appointments({ approvals = false }: { approvals?: boolean }) {
  const { state, actor, branchId } = useClinic();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState('');
  const all = appointmentsFor(state, actor).filter(
    (a) =>
      a.branchId === branchId &&
      (!approvals ||
        ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status)),
  );
  const list = all
    .filter(
      (a) =>
        (!date || a.date === date) &&
        (status === 'all' || status === 'upcoming'
          ? status !== 'upcoming' ||
            (a.date >= DEMO_DATE && !['completed', 'cancelled', 'rejected'].includes(a.status))
          : a.status === status) &&
        `${state.patients.find((p) => p.id === a.patientId)?.name} ${state.doctors.find((d) => d.id === a.doctorId)?.name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => `${b.date}${a.time}`.localeCompare(`${a.date}${b.time}`));
  return (
    <Page
      title={approvals ? 'Pending approvals' : 'Your appointments'}
      subtitle="Plan your visits and keep track of every step."
      back={approvals}
    >
      <Input
        label="Search appointments"
        value={query}
        onChange={setQuery}
        placeholder="Patient or doctor name"
      />
      <Select
        label="Show appointments"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: 'All appointments' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'pending', label: 'Pending approval' },
          { value: 'confirmed', label: 'Confirmed' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      <Input
        label="Date filter (YYYY-MM-DD, blank for all)"
        value={date}
        onChange={setDate}
        placeholder="2026-10-26"
      />
      <Btn title="Request an appointment" onPress={() => go('book')} />
      <Txt muted size={11}>
        {list.length} appointments · Asia/Karachi
      </Txt>
      {list.map((a) => (
        <AppointmentCard key={a.id} appointment={a} />
      ))}
      {!list.length && (
        <Card>
          <Empty title="No appointments found" text="Try another filter or request a visit." />
        </Card>
      )}
    </Page>
  );
}
export function Workspace() {
  const { role, setRole, state, branchId, setBranch, actor } = useClinic();
  const items = [
    { screen: 'doctors', title: 'Find a doctor', roles: ['admin', 'patient'] },
    { screen: 'patients', title: 'Patients', roles: ['admin', 'doctor'] },
    { screen: 'approvals', title: 'Pending approvals', roles: ['admin', 'doctor'] },
    { screen: 'branches', title: 'Clinic branches', roles: ['admin'] },
    { screen: 'departments', title: 'Medical departments', roles: ['admin', 'patient'] },
    { screen: 'schedules', title: 'Schedules & leave', roles: ['admin', 'doctor'] },
    { screen: 'prescriptions', title: 'Prescriptions', roles: ['patient', 'doctor'] },
    { screen: 'reports', title: 'Medical reports', roles: ['patient', 'doctor'] },
    { screen: 'fees', title: 'Consultation fees', roles: ['admin'] },
    { screen: 'activity', title: 'Activity & audit', roles: ['admin'] },
    { screen: 'notifications', title: 'Notifications', roles: ['admin', 'doctor', 'patient'] },
    { screen: 'settings', title: 'Settings & profile', roles: ['admin', 'doctor', 'patient'] },
  ];
  return (
    <Page
      title="Your workspace"
      subtitle="Everything you need, thoughtfully organized."
      back={false}
    >
      <Card>
        <Row>
          <Avatar
            initials={actor.name
              .replace('Dr. ', '')
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')}
          />
          <View>
            <Txt bold>{actor.name}</Txt>
            <Txt muted size={11}>
              {role} · demo persona
            </Txt>
          </View>
        </Row>
        <Select
          label="Demo role"
          value={role}
          onChange={(v) => setRole(v as DemoRole)}
          options={['admin', 'doctor', 'patient'].map((r) => ({
            value: r,
            label: r[0].toUpperCase() + r.slice(1),
          }))}
        />
        <Select
          label="Active clinic branch"
          value={branchId}
          onChange={setBranch}
          options={state.branches.map((b) => ({
            value: b.id,
            label: `${b.name}${b.active ? '' : ' (inactive)'}`,
          }))}
        />
      </Card>
      <Card>
        {items
          .filter((i) => i.roles.includes(role))
          .map((i) => (
            <Item key={i.screen} title={i.title} onPress={() => go(i.screen)} />
          ))}
      </Card>
      <Btn outline title="Back to role selection" onPress={() => router.replace('/')} />
    </Page>
  );
}
export function Doctors() {
  const { state, branchId, role } = useClinic();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All departments');
  const list = suggestedDoctors(state, category, branchId).filter((d) =>
    d.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Page title="Find a doctor" subtitle="The right specialist for your next step.">
      {role === 'admin' && (
        <Btn title="Invite a doctor" onPress={() => go('form', { kind: 'invite' })} />
      )}
      <Input label="Search doctors" value={query} onChange={setQuery} placeholder="Doctor's name" />
      <Select
        label="Department or concern"
        value={category}
        onChange={setCategory}
        options={[
          'All departments',
          ...state.specializations.map((s) => s.name),
          ...state.specializations.flatMap((s) => s.symptomCategories),
        ].map((c) => ({ value: c, label: c }))}
      />
      <Txt muted size={10}>
        Suggestions help you browse; they are not diagnosis or emergency triage.
      </Txt>
      {list.map((d) => (
        <Card key={d.id}>
          <Row>
            <Avatar initials={d.initials} color={d.color} large />
            <View style={{ flex: 1 }}>
              <Txt bold size={15}>
                {d.name}
              </Txt>
              <Txt muted size={12}>
                {state.specializations.find((s) => s.id === d.specializationId)?.name}
              </Txt>
              <Txt muted size={10}>
                {d.experience} years experience
              </Txt>
            </View>
          </Row>
          <Txt muted size={11}>
            {d.qualifications}
          </Txt>
          <Row>
            <View style={{ flex: 1 }}>
              <Txt bold size={12}>
                {money(
                  state.assignments.find((a) => a.doctorId === d.id && a.branchId === branchId)
                    ?.fee ?? 0,
                )}
              </Txt>
            </View>
            <Btn title="View profile" outline onPress={() => go('doctor', { id: d.id })} />
          </Row>
        </Card>
      ))}
      {!list.length && <Empty title="No doctors found" text="Try another department or branch." />}
    </Page>
  );
}
export function DoctorDetail() {
  const { id = 'd1' } = useLocalSearchParams<{ id: string }>();
  const { state, branchId, role } = useClinic();
  const [tab, setTab] = useState('About');
  const d = state.doctors.find((d) => d.id === id);
  if (!d)
    return (
      <Page title="Doctor unavailable">
        <Empty title="Return to the directory" />
      </Page>
    );
  return (
    <Page
      title={d.name}
      subtitle={state.specializations.find((s) => s.id === d.specializationId)?.name}
    >
      <Card>
        <Row>
          <Avatar initials={d.initials} color={d.color} large />
          <View style={{ flex: 1 }}>
            <Txt bold>{d.name}</Txt>
            <Txt muted size={11}>
              {d.qualifications}
            </Txt>
          </View>
        </Row>
        <Select
          label="Profile section"
          value={tab}
          onChange={setTab}
          options={['About', 'Schedule', 'Availability'].map((t) => ({ value: t, label: t }))}
        />
        {tab === 'About' ? (
          <>
            <Txt muted>{d.bio}</Txt>
            <Txt bold size={12}>
              {d.experience}+ years of clinical experience
            </Txt>
            <Txt muted size={12}>
              {money(
                state.assignments.find((a) => a.doctorId === id && a.branchId === branchId)?.fee ??
                  0,
              )}
            </Txt>
          </>
        ) : tab === 'Schedule' ? (
          state.schedules
            .filter((s) => s.doctorId === id)
            .map((s) => (
              <View key={s.id} style={{ gap: 7 }}>
                <Txt bold>{state.branches.find((b) => b.id === s.branchId)?.name}</Txt>
                <Txt muted size={12}>
                  {s.days
                    .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
                    .join(', ')}
                </Txt>
                <Txt size={12}>
                  {displayTime(s.start)} – {displayTime(s.end)}
                </Txt>
              </View>
            ))
        ) : (
          <>
            <Txt bold size={12}>
              {displayDate(DEMO_DATE)} · available slots
            </Txt>
            <Txt muted size={12}>
              {availableSlots(state, id, branchId, DEMO_DATE).map(displayTime).join(' · ') ||
                'No slots available today.'}
            </Txt>
          </>
        )}
        <Btn title="Request appointment" onPress={() => go('book', { doctorId: id })} />
        {role === 'admin' && (
          <>
            <Btn
              outline
              title="Edit professional profile"
              onPress={() => go('form', { kind: 'doctor', id })}
            />
            <Btn
              outline
              title="Assign another branch"
              onPress={() => go('form', { kind: 'assignment', id })}
            />
          </>
        )}
      </Card>
    </Page>
  );
}
export function Patients() {
  const { state, actor } = useClinic();
  const [query, setQuery] = useState('');
  const list = state.patients.filter(
    (p) =>
      canViewPatient(actor, p.id, state) &&
      `${p.name} ${p.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Page title="Patient directory" subtitle="People at the heart of your clinic.">
      <Input
        label="Search patients"
        value={query}
        onChange={setQuery}
        placeholder="Patient name or phone"
      />
      <Btn title="Register a walk-in patient" onPress={() => go('form', { kind: 'patient' })} />
      <Card>
        {list.map((p) => (
          <Item
            key={p.id}
            title={p.name}
            subtitle={`${p.id.toUpperCase()} · ${p.gender} · ${p.phone}`}
            icon={<Avatar initials={p.initials} color="blue" />}
            onPress={() => go('records', { patientId: p.id })}
          />
        ))}
        {!list.length && <Empty title="No accessible patients found" />}
      </Card>
    </Page>
  );
}
