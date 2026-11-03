import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Bell, Building2, HeartPulse, ShieldCheck } from 'lucide-react-native';
import { clinic } from '@sro/data-access';
import { displayDate, displayTime, money } from '@sro/clinic-core';
import { emailSchema, loginSchema, passwordSchema, registrationSchema } from '@sro/validation';
import { useClinic } from './context';
import { Btn, Card, Empty, go, Input, Item, Page, Row, Select, Txt } from './ui';

export function AdminScreen({ section }: { section: string }) {
  const params = useLocalSearchParams<{ kind?: string; id?: string; patientId?: string }>();
  const { state, actor, role, branchId, act } = useClinic();
  const kind = params.kind ?? '';
  const doctor = state.doctors.find((d) => d.id === (params.id ?? actor.doctorId ?? 'd1'))!;
  const branch = state.branches.find((b) => b.id === params.id);
  const currentSchedule = state.schedules.find(
    (s) => s.doctorId === doctor.id && s.branchId === branchId,
  );
  const patient = state.patients.find((p) => p.id === params.patientId);
  const [values, setValues] = useState<Record<string, string>>({
    name: branch?.name ?? '',
    email: '',
    phone: branch?.phone ?? '',
    address: branch?.address ?? '',
    branchId,
    doctorId: doctor.id,
    specializationId: doctor.specializationId,
    dateOfBirth: '1995-01-01',
    gender: 'Female',
    reason: '',
    userId: 'u-d2',
    description: '',
    startDate: '2026-10-27',
    endDate: '2026-10-27',
    start: currentSchedule?.start ?? '09:00',
    end: currentSchedule?.end ?? '17:00',
    fee: String(
      state.assignments.find((a) => a.doctorId === doctor.id && a.branchId === branchId)?.fee ?? 0,
    ),
    qualifications: doctor.qualifications,
    bio: doctor.bio,
    experience: String(doctor.experience),
    active: branch?.active === false ? 'false' : 'true',
    allergies: patient?.history.allergies.join(', ') ?? '',
    conditions: patient?.history.conditions.join(', ') ?? '',
    medications: patient?.history.medications.join(', ') ?? '',
    surgeries: patient?.history.surgeries ?? '',
    familyHistory: patient?.history.familyHistory ?? '',
    socialHistory: patient?.history.socialHistory ?? '',
    bloodGroup: patient?.history.bloodGroup ?? '',
    emergencyContact: patient?.history.emergencyContact ?? '',
  });
  const [days, setDays] = useState(currentSchedule?.days ?? [1, 2, 3, 4, 5, 6]);
  const [invite, setInvite] = useState('');
  const input = (key: string, label: string, multiline = false) => (
    <Input
      label={label}
      value={values[key] ?? ''}
      onChange={(v) => setValues({ ...values, [key]: v })}
      multiline={multiline}
    />
  );
  const doctorSelect = (
    <Select
      label="Doctor"
      value={values.doctorId}
      onChange={(v) => {
        const s = state.schedules.find((s) => s.doctorId === v && s.branchId === values.branchId);
        setValues({ ...values, doctorId: v, start: s?.start ?? '09:00', end: s?.end ?? '17:00' });
        setDays(s?.days ?? [1, 2, 3, 4, 5, 6]);
      }}
      options={state.doctors
        .filter((d) => role === 'admin' || actor.doctorId === d.id)
        .map((d) => ({ value: d.id, label: d.name }))}
    />
  );
  const branchSelect = (
    <Select
      label="Clinic branch"
      value={values.branchId}
      onChange={(v) => setValues({ ...values, branchId: v })}
      options={state.branches.map((b) => ({ value: b.id, label: b.name }))}
    />
  );
  const submit = () => {
    const ok = act(
      () => {
        switch (kind) {
          case 'branch':
            clinic.saveBranch(
              actor,
              {
                name: values.name,
                address: values.address,
                phone: values.phone,
                active: values.active === 'true',
              },
              params.id,
            );
            break;
          case 'invite': {
            const invite = clinic.invite(actor, {
              name: values.name,
              email: values.email,
              specializationId: values.specializationId,
              branchId: values.branchId,
            });
            setInvite(invite.token);
            break;
          }
          case 'patient':
            clinic.addPatient(actor, {
              name: values.name,
              email: values.email,
              phone: values.phone,
              dateOfBirth: values.dateOfBirth,
              gender: values.gender,
              branchId: values.branchId,
            });
            break;
          case 'department':
            clinic.addSpecialization(actor, values.name, values.description);
            break;
          case 'fee':
            clinic.saveFee(actor, values.doctorId, values.branchId, Number(values.fee));
            break;
          case 'grant':
            clinic.grant(actor, params.patientId!, values.userId, values.reason);
            break;
          case 'leave':
            clinic.addLeave(
              actor,
              values.doctorId,
              values.branchId,
              values.startDate,
              values.endDate,
              values.reason,
            );
            break;
          case 'doctor':
            clinic.saveDoctor(actor, doctor.id, {
              qualifications: values.qualifications,
              experience: Number(values.experience),
              specializationId: values.specializationId,
              bio: values.bio,
            });
            break;
          case 'history':
            clinic.saveHistory(actor, params.patientId!, {
              allergies: values.allergies
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
              conditions: values.conditions
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
              medications: values.medications
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
              surgeries: values.surgeries,
              familyHistory: values.familyHistory,
              socialHistory: values.socialHistory,
              bloodGroup: values.bloodGroup,
              emergencyContact: values.emergencyContact,
            });
            break;
          case 'assignment':
            clinic.assignDoctor(actor, values.doctorId, values.branchId);
            break;
          case 'schedule': {
            const schedule = state.schedules.find(
              (s) => s.doctorId === values.doctorId && s.branchId === values.branchId,
            );
            if (!schedule) throw new Error('Assign the doctor to this branch first.');
            clinic.saveSchedule(actor, {
              ...schedule,
              days,
              start: values.start,
              end: values.end,
              breaks:
                values.start <= '13:00' && values.end >= '14:00'
                  ? [{ start: '13:00', end: '14:00' }]
                  : [],
            });
            break;
          }
        }
      },
      kind === 'invite' ? 'Demo invitation prepared. No email sent.' : 'Demo changes saved.',
    );
    if (ok && kind !== 'invite') router.back();
  };
  const titles: Record<string, string> = {
    branches: 'Clinic branches',
    departments: 'Medical departments',
    schedules: 'Schedules & leave',
    fees: 'Consultation fees',
    activity: 'Activity & audit',
    form:
      {
        branch: 'Clinic branch',
        invite: 'Invite a doctor',
        patient: 'Register a patient',
        department: 'Add department',
        fee: 'Consultation fee',
        grant: 'Authorize a clinician',
        leave: 'Record doctor leave',
        doctor: 'Professional profile',
        assignment: 'Branch assignment',
        schedule: 'Weekly availability',
        history: 'Medical history',
      }[kind] ?? 'Demo form',
  };
  if (
    (role === 'patient' && section !== 'departments') ||
    (role === 'doctor' && ['branches', 'fees', 'activity'].includes(section))
  )
    return (
      <Page title="Page unavailable">
        <Empty title="Choose a page from your workspace" />
      </Page>
    );
  return (
    <Page title={titles[section]} subtitle="Fictional data · changes stay in this demo session.">
      {section === 'branches' && (
        <>
          <Btn title="Add clinic branch" onPress={() => go('form', { kind: 'branch' })} />
          {state.branches.map((b) => (
            <Card key={b.id}>
              <Building2 size={25} color="#8765a1" />
              <Txt bold size={17}>
                {b.name}
              </Txt>
              <Txt muted size={12}>
                {b.address}
              </Txt>
              <Txt muted size={12}>
                {b.phone}
              </Txt>
              <Txt size={12}>
                {b.active ? 'Active' : 'Inactive'} ·{' '}
                {state.assignments.filter((a) => a.branchId === b.id).length} doctors assigned
              </Txt>
              <Btn
                outline
                title="Edit branch"
                onPress={() => go('form', { kind: 'branch', id: b.id })}
              />
            </Card>
          ))}
        </>
      )}
      {section === 'departments' && (
        <>
          {role === 'admin' && (
            <Btn title="Add department" onPress={() => go('form', { kind: 'department' })} />
          )}
          {state.specializations.map((s) => (
            <Card key={s.id}>
              <HeartPulse size={24} color="#9873b5" />
              <Txt bold>{s.name}</Txt>
              <Txt muted size={12}>
                {s.description}
              </Txt>
              <Txt muted size={11}>
                {s.symptomCategories.join(' · ')}
              </Txt>
              {role === 'patient' && (
                <Btn outline title="Explore doctors" onPress={() => go('doctors')} />
              )}
            </Card>
          ))}
          <Txt muted size={10}>
            Department browsing is not diagnosis or emergency triage.
          </Txt>
        </>
      )}
      {section === 'schedules' && (
        <>
          <Btn
            title="Edit availability"
            onPress={() => go('form', { kind: 'schedule', id: actor.doctorId ?? 'd1' })}
          />
          <Btn
            outline
            title="Record doctor leave"
            onPress={() => go('form', { kind: 'leave', id: actor.doctorId ?? 'd1' })}
          />
          {state.schedules
            .filter(
              (s) => s.branchId === branchId && (role === 'admin' || s.doctorId === actor.doctorId),
            )
            .map((s) => (
              <Card key={s.id}>
                <Txt bold>{state.doctors.find((d) => d.id === s.doctorId)?.name}</Txt>
                <Txt muted size={12}>
                  {s.days
                    .map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i])
                    .join(', ')}
                </Txt>
                <Txt>
                  {displayTime(s.start)} – {displayTime(s.end)}
                </Txt>
                <Txt muted size={11}>
                  Break:{' '}
                  {s.breaks
                    .map((b) => `${displayTime(b.start)}–${displayTime(b.end)}`)
                    .join(', ') || 'None'}
                </Txt>
                <Btn
                  outline
                  title="Edit schedule"
                  onPress={() => go('form', { kind: 'schedule', id: s.doctorId })}
                />
              </Card>
            ))}
          <Txt bold size={17}>
            Doctor leave
          </Txt>
          {state.leaves
            .filter((l) => role === 'admin' || l.doctorId === actor.doctorId)
            .map((l) => (
              <Card key={l.id}>
                <Txt bold>{state.doctors.find((d) => d.id === l.doctorId)?.name}</Txt>
                <Txt muted size={12}>
                  {displayDate(l.startDate)} – {displayDate(l.endDate)}
                </Txt>
                <Txt muted size={12}>
                  {l.reason}
                </Txt>
              </Card>
            ))}
          {!state.leaves.length && <Empty title="No leave recorded" />}
        </>
      )}
      {section === 'fees' && (
        <>
          {state.assignments
            .filter((a) => a.branchId === branchId)
            .map((a) => (
              <Card key={a.doctorId}>
                <Txt bold>{state.doctors.find((d) => d.id === a.doctorId)?.name}</Txt>
                <Txt muted>{money(a.fee)}</Txt>
                <Btn
                  outline
                  title="Edit consultation fee"
                  onPress={() => go('form', { kind: 'fee', id: a.doctorId })}
                />
              </Card>
            ))}
          <Txt muted size={11}>
            Fees apply to future bookings. Payments are recorded manually; no processor is
            connected.
          </Txt>
        </>
      )}
      {section === 'activity' && (
        <Card>
          {state.audit.map((a) => (
            <Item
              key={a.id}
              title={a.action}
              subtitle={`${state.profiles.find((p) => p.id === a.actorId)?.name ?? 'Demo user'} · ${a.time}`}
              onPress={() => act(() => {}, 'This activity is a local demo audit entry.')}
            />
          ))}
        </Card>
      )}
      {section === 'form' &&
        (invite ? (
          <Card title="Mock invitation prepared">
            <Txt muted size={12}>
              No email was sent. The production flow will use expiring, one-use invitation links.
            </Txt>
            <Btn
              title="Preview invitation acceptance"
              onPress={() => go('auth', { mode: 'invitation', token: invite })}
            />
          </Card>
        ) : (
          <Card>
            {['branch', 'invite', 'patient', 'department'].includes(kind) &&
              input(
                'name',
                kind === 'branch'
                  ? 'Branch name'
                  : kind === 'department'
                    ? 'Department name'
                    : 'Full name',
              )}
            {['invite', 'patient'].includes(kind) && input('email', 'Email address')}
            {['branch', 'patient'].includes(kind) && input('phone', 'Phone number')}
            {kind === 'branch' && (
              <>
                {input('address', 'Branch address')}
                <Select
                  label="Branch status"
                  value={values.active}
                  onChange={(v) => setValues({ ...values, active: v })}
                  options={[
                    { value: 'true', label: 'Active' },
                    { value: 'false', label: 'Inactive' },
                  ]}
                />
              </>
            )}
            {['invite', 'patient', 'assignment'].includes(kind) && branchSelect}
            {kind === 'patient' && (
              <>
                {input('dateOfBirth', 'Date of birth (YYYY-MM-DD)')}
                <Select
                  label="Gender"
                  value={values.gender}
                  onChange={(v) => setValues({ ...values, gender: v })}
                  options={['Female', 'Male', 'Other', 'Prefer not to say'].map((g) => ({
                    value: g,
                    label: g,
                  }))}
                />
              </>
            )}
            {['invite', 'doctor'].includes(kind) && (
              <Select
                label="Specialization"
                value={values.specializationId}
                onChange={(v) => setValues({ ...values, specializationId: v })}
                options={state.specializations.map((s) => ({ value: s.id, label: s.name }))}
              />
            )}
            {['schedule', 'leave', 'fee', 'assignment'].includes(kind) && doctorSelect}
            {kind === 'department' && input('description', 'Department description', true)}
            {kind === 'fee' && input('fee', 'Fee in PKR · 0 for free')}
            {kind === 'doctor' && (
              <>
                {input('qualifications', 'Qualifications')}
                {input('experience', 'Years of experience')}
                {input('bio', 'Professional biography', true)}
              </>
            )}
            {kind === 'leave' && (
              <>
                {input('startDate', 'From (YYYY-MM-DD)')}
                {input('endDate', 'Through (YYYY-MM-DD)')}
                <Txt muted size={11}>
                  Leave blocks new slots across all branches and flags affected bookings.
                </Txt>
              </>
            )}
            {['leave', 'grant'].includes(kind) && input('reason', 'Reason', true)}
            {kind === 'grant' && (
              <Select
                label="Additional clinician"
                value={values.userId}
                onChange={(v) => setValues({ ...values, userId: v })}
                options={state.profiles
                  .filter((p) => ['doctor', 'clinical_staff'].includes(p.role))
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            {kind === 'schedule' && (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                    <Pressable
                      key={label}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: days.includes(i) }}
                      onPress={() =>
                        setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])
                      }
                      style={{
                        padding: 12,
                        backgroundColor: days.includes(i) ? '#eee7f8' : '#fff',
                        borderWidth: 1,
                        borderColor: '#dfd5ea',
                        borderRadius: 7,
                      }}
                    >
                      <Txt size={12}>{label}</Txt>
                    </Pressable>
                  ))}
                </View>
                {input('start', 'Clinic opens (HH:mm)')}
                {input('end', 'Clinic closes (HH:mm)')}
                <Txt muted size={11}>
                  A 1–2 PM break applies if within clinic hours. Resolve existing appointment
                  conflicts first.
                </Txt>
              </>
            )}
            {kind === 'history' && (
              <>
                <Txt muted size={11}>
                  Separate allergies, conditions and medications with commas. Keep unknown values
                  explicit.
                </Txt>
                {[
                  ['allergies', 'Reported allergies'],
                  ['conditions', 'Chronic conditions'],
                  ['medications', 'Current medications'],
                  ['surgeries', 'Surgical history'],
                  ['familyHistory', 'Family history'],
                  ['socialHistory', 'Social history'],
                  ['bloodGroup', 'Blood group'],
                  ['emergencyContact', 'Emergency contact'],
                ].map(([key, label]) => (
                  <View key={key}>{input(key, label, true)}</View>
                ))}
              </>
            )}
            <Btn
              title={kind === 'invite' ? 'Prepare demo invitation' : 'Save demo changes'}
              onPress={submit}
            />
          </Card>
        ))}
      {section === 'branches' && role === 'admin' && (
        <Btn outline title="Invite a doctor" onPress={() => go('form', { kind: 'invite' })} />
      )}
    </Page>
  );
}

export function Notifications() {
  const { state, actor, act } = useClinic();
  const [filter, setFilter] = useState('all');
  const list = state.notifications.filter(
    (n) => n.recipientIds.includes(actor.id) && (filter === 'all' || !n.readBy.includes(actor.id)),
  );
  return (
    <Page title="Notifications" subtitle="Your clinic, in the loop.">
      <Select
        label="Show updates"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All updates' },
          { value: 'unread', label: 'Unread updates' },
        ]}
      />
      <Btn
        outline
        title="Mark all as read"
        onPress={() => act(() => clinic.markRead(actor), 'Notifications marked as read.')}
      />
      {list.map((n) => (
        <Card key={n.id}>
          <Row>
            <Bell color="#9470ac" size={20} />
            <View style={{ flex: 1 }}>
              <Txt bold>{n.title}</Txt>
              <Txt muted size={10}>
                {n.time} · {n.readBy.includes(actor.id) ? 'Read' : 'Unread'}
              </Txt>
            </View>
          </Row>
          <Txt muted size={12}>
            {n.message}
          </Txt>
          {n.appointmentId && (
            <Btn
              outline
              title="View appointment"
              onPress={() => go('appointment', { id: n.appointmentId! })}
            />
          )}
        </Card>
      ))}
      {!list.length && <Empty title="You're all caught up" />}
      <Txt muted size={10}>
        Instant in this app session only. Cross-device realtime and background push arrive in Phase
        2.
      </Txt>
    </Page>
  );
}

export function Settings() {
  const { state, actor, role, act } = useClinic();
  const [name, setName] = useState(actor.name);
  const [email, setEmail] = useState(actor.email);
  const patient = state.patients.find((p) => p.id === actor.patientId);
  const [details, setDetails] = useState({
    phone: patient?.phone ?? '',
    dateOfBirth: patient?.dateOfBirth ?? '',
    gender: patient?.gender ?? '',
    address: patient?.address ?? '',
  });
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(false);
  const [reset, setReset] = useState(false);
  return (
    <Page title="Settings & profile" subtitle="Your clinic account, your preferences.">
      <Card title="Profile details">
        <Input label="Full name" value={name} onChange={setName} />
        <Input label="Email address" value={email} onChange={setEmail} />
        {role === 'patient' &&
          Object.entries(details).map(([key, value]) => (
            <Input
              key={key}
              label={
                {
                  phone: 'Phone number',
                  dateOfBirth: 'Date of birth (YYYY-MM-DD)',
                  gender: 'Gender',
                  address: 'Address',
                }[key as keyof typeof details]
              }
              value={value}
              onChange={(v) => setDetails({ ...details, [key]: v })}
            />
          ))}
        <Btn
          title="Save profile"
          onPress={() =>
            act(
              () =>
                clinic.saveProfile(actor, name, email, role === 'patient' ? details : undefined),
              'Demo profile saved.',
            )
          }
        />
        {role === 'doctor' && (
          <Btn
            outline
            title="Edit professional profile"
            onPress={() => go('form', { kind: 'doctor', id: actor.doctorId! })}
          />
        )}
      </Card>
      <Card title="Optional two-factor authentication">
        <ShieldCheck size={27} color="#9470ac" />
        <Txt muted size={12}>
          {actor.twoFactorEnabled ? 'Demo preference enabled' : 'Not enabled'} · optional TOTP
          authenticator
        </Txt>
        <Txt muted size={11}>
          No real TOTP secret, QR code or recovery codes are created in Phase 1.
        </Txt>
        <Btn
          outline
          title={actor.twoFactorEnabled ? 'Disable demo 2FA' : 'Set up demo 2FA'}
          onPress={() =>
            actor.twoFactorEnabled ? act(() => clinic.setTwoFactor(actor, false)) : setSetup(true)
          }
        />
        {setup && (
          <>
            <Input
              label="Demo verification code · 123456"
              value={code}
              onChange={setCode}
              numeric
            />
            <Btn
              title="Verify demo code"
              disabled={code !== '123456'}
              onPress={() => {
                act(
                  () => clinic.setTwoFactor(actor, true),
                  'Demo 2FA preference enabled. No real authentication is active.',
                );
                setSetup(false);
              }}
            />
          </>
        )}
        <Btn
          outline
          title="Preview authentication screens"
          onPress={() => go('auth', { mode: 'login' })}
        />
      </Card>
      <Card title="Demo session">
        <Txt muted size={12}>
          English · Asia/Karachi · PKR. Changes reset when the app restarts. Web and native use
          separate memory stores.
        </Txt>
        <Btn outline title="Reset demo data" onPress={() => setReset(true)} />
        {reset && (
          <>
            <Txt size={12}>Return all fictional data to its initial values?</Txt>
            <Btn
              title="Confirm demo reset"
              onPress={() => {
                clinic.reset();
                setReset(false);
              }}
            />
            <Btn outline title="Keep changes" onPress={() => setReset(false)} />
          </>
        )}
      </Card>
    </Page>
  );
}

export function Auth() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode ?? 'login';
  const { role, setRole, act } = useClinic();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('ali.raza@example.test');
  const [password, setPassword] = useState('DemoClinic2026');
  const [phone, setPhone] = useState('+92 300 000 0000');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);
  const title: Record<string, string> = {
    login: 'Welcome back',
    register: 'Patient registration',
    forgot: 'Reset your access',
    reset: 'Choose a password',
    invitation: 'Doctor invitation',
    'verify-email': 'Verify your email',
    'two-factor': 'One more step',
  };
  const submit = () => {
    const valid = act(
      () => {
        if (mode === 'login') loginSchema.parse({ email, password });
        else if (mode === 'register' || mode === 'invitation')
          registrationSchema.parse({ name, email, phone, password, consent });
        else if (mode === 'reset') {
          passwordSchema.parse(password);
          if (password !== confirm) throw new Error('Passwords must match.');
        } else if (mode === 'forgot') emailSchema.parse(email);
        else if (mode === 'two-factor' && code !== '123456')
          throw new Error('Use demo code 123456.');
      },
      mode === 'login'
        ? 'Mock sign-in complete. No credentials were verified.'
        : 'Prototype step completed. No account, email, password change or invitation was created.',
    );
    if (valid) {
      if (mode === 'login') router.replace('/(tabs)');
      else setDone(true);
    }
  };
  return (
    <Page
      title={done ? 'Ready to explore' : (title[mode] ?? 'Authentication preview')}
      subtitle="Phase 1 prototype · no real authentication."
    >
      {done ? (
        <Card>
          <Txt muted>
            No account or email was created. You can continue exploring the local demo.
          </Txt>
          <Btn
            title="Open demo workspace"
            onPress={() => {
              if (mode === 'invitation') setRole('doctor');
              router.replace('/(tabs)');
            }}
          />
        </Card>
      ) : (
        <Card>
          {mode === 'login' && (
            <Select
              label="Demo workspace"
              value={role}
              onChange={(v) => setRole(v as typeof role)}
              options={['admin', 'doctor', 'patient'].map((r) => ({
                value: r,
                label: r[0].toUpperCase() + r.slice(1),
              }))}
            />
          )}
          {['register', 'invitation'].includes(mode) && (
            <Input label="Full name" value={name} onChange={setName} />
          )}
          {!['two-factor', 'verify-email', 'reset'].includes(mode) && (
            <Input label="Email address" value={email} onChange={setEmail} />
          )}
          {['register', 'invitation'].includes(mode) && (
            <Input label="Phone number" value={phone} onChange={setPhone} />
          )}
          {!['forgot', 'two-factor', 'verify-email'].includes(mode) && (
            <Input label="Password" value={password} onChange={setPassword} secret />
          )}
          {mode === 'reset' && (
            <Input label="Confirm password" value={confirm} onChange={setConfirm} secret />
          )}
          {['register', 'invitation', 'reset'].includes(mode) && (
            <Txt muted size={11}>
              Use at least 10 characters, one uppercase letter and one number.
            </Txt>
          )}
          {['register', 'invitation'].includes(mode) && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
              onPress={() => setConsent(!consent)}
              style={{ paddingVertical: 13 }}
            >
              <Txt size={12}>
                {consent ? '☑' : '☐'} I understand this uses fictional demo data only.
              </Txt>
            </Pressable>
          )}
          {mode === 'invitation' && (
            <Txt muted size={11}>
              Admin invitation preview only. Doctors cannot publicly self-register.
            </Txt>
          )}
          {mode === 'two-factor' && (
            <Input label="Demo code · enter 123456" value={code} onChange={setCode} numeric />
          )}
          {mode === 'verify-email' && (
            <Txt muted size={12}>
              No verification email was sent. This screen previews the intended experience.
            </Txt>
          )}
          <Btn
            title={
              mode === 'login'
                ? 'Enter demo workspace'
                : mode === 'forgot'
                  ? 'Preview recovery email'
                  : 'Continue prototype'
            }
            onPress={submit}
          />
          {mode === 'login' && (
            <>
              <Btn outline title="Forgot password" onPress={() => go('auth', { mode: 'forgot' })} />
              <Btn
                outline
                title="Register as a patient"
                onPress={() => go('auth', { mode: 'register' })}
              />
              <Btn
                outline
                title="Preview optional 2FA"
                onPress={() => go('auth', { mode: 'two-factor' })}
              />
              <Txt muted size={11}>
                Doctors join through Admin invitations.
              </Txt>
            </>
          )}
          {mode === 'forgot' && (
            <Btn
              outline
              title="Preview reset screen"
              onPress={() => go('auth', { mode: 'reset' })}
            />
          )}
          {mode === 'register' && (
            <Btn
              outline
              title="Preview email verification"
              onPress={() => go('auth', { mode: 'verify-email' })}
            />
          )}
        </Card>
      )}
    </Page>
  );
}
