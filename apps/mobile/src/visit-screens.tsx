import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, CalendarDays, Clock3, MapPin, ShieldCheck } from 'lucide-react-native';
import { clinic } from '@sro/data-access';
import {
  age,
  availableSlots,
  DEMO_DATE,
  displayDate,
  displayTime,
  money,
  suggestedDoctors,
  transitions,
  statusLabels,
} from '@sro/clinic-core';
import { canManageAppointment, canRequestChange } from '@sro/permissions';
import type { AppointmentType, PrescriptionItem } from '@sro/types';
import { colors } from '@sro/design-tokens';
import { useClinic } from './context';
import { Avatar, Badge, Btn, Card, Empty, go, Input, Page, Row, Select, Txt } from './ui';

export function Booking() {
  const params = useLocalSearchParams<{ doctorId?: string; patientId?: string }>();
  const { state, role, actor, branchId: initialBranch, act } = useClinic();
  const [step, setStep] = useState(0);
  const [branchId, setBranch] = useState(initialBranch);
  const [category, setCategory] = useState('All departments');
  const [doctorId, setDoctor] = useState(params.doctorId ?? '');
  const [patientId, setPatient] = useState(params.patientId ?? actor.patientId ?? 'p1');
  const [date, setDate] = useState(DEMO_DATE);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [type, setType] = useState<AppointmentType>('physical');
  const [done, setDone] = useState(false);
  const d = state.doctors.find((d) => d.id === doctorId);
  const slots = availableSlots(state, doctorId, branchId, date);
  const assignment = state.assignments.find(
    (a) => a.doctorId === doctorId && a.branchId === branchId,
  );
  const doctors = suggestedDoctors(state, category, branchId);
  return (
    <Page
      title={done ? 'Request submitted' : 'Book an appointment'}
      subtitle={
        done
          ? 'Your care team will review your request.'
          : `Step ${step + 1} of 3 · ${['Choose your care team', 'Choose a date and time', 'Review your request'][step]}`
      }
    >
      {done ? (
        <Card>
          <View style={{ alignItems: 'center', gap: 18, paddingVertical: 20 }}>
            <Check size={42} color={colors.care} />
            <Txt bold size={20}>
              Your request is in good hands.
            </Txt>
            <Badge status="pending" />
            <Txt muted size={13}>
              {d?.name} · {displayDate(date)} · {displayTime(time)}
            </Txt>
            <Txt muted size={12}>
              Confirmation will appear in demo notifications after Admin or Doctor approval.
            </Txt>
          </View>
          <Btn title="View appointments" onPress={() => router.dismissTo('/(tabs)/appointments')} />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[0, 1, 2].map((n) => (
              <View
                key={n}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: n <= step ? colors.brand : '#e5dfed',
                }}
              />
            ))}
          </View>
          {step === 0 && (
            <>
              <Select
                label="Clinic branch"
                value={branchId}
                options={state.branches
                  .filter((b) => b.active)
                  .map((b) => ({ value: b.id, label: b.name }))}
                onChange={(id) => {
                  setBranch(id);
                  setDoctor('');
                  setTime('');
                }}
              />
              <Select
                label="Department or concern"
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  setDoctor('');
                  setTime('');
                }}
                options={[
                  'All departments',
                  ...state.specializations.map((s) => s.name),
                  ...state.specializations.flatMap((s) => s.symptomCategories),
                ].map((s) => ({ value: s, label: s }))}
              />
              <Txt muted size={10}>
                Categories are for browsing; they are not diagnosis or emergency triage.
              </Txt>
              {doctors.map((doctor) => (
                <Pressable
                  key={doctor.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: doctorId === doctor.id }}
                  onPress={() => {
                    setDoctor(doctor.id);
                    setTime('');
                  }}
                  style={{
                    padding: 17,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: doctorId === doctor.id ? colors.brand : colors.border,
                    backgroundColor: doctorId === doctor.id ? '#f4effc' : '#fff',
                    gap: 12,
                  }}
                >
                  <Row>
                    <Avatar initials={doctor.initials} color={doctor.color} />
                    <View style={{ flex: 1 }}>
                      <Txt bold>{doctor.name}</Txt>
                      <Txt muted size={11}>
                        {state.specializations.find((s) => s.id === doctor.specializationId)?.name}
                      </Txt>
                    </View>
                    {doctorId === doctor.id && <Check size={18} color={colors.brand} />}
                  </Row>
                  <Txt muted size={12}>
                    {money(
                      state.assignments.find(
                        (a) => a.doctorId === doctor.id && a.branchId === branchId,
                      )?.fee ?? 0,
                    )}{' '}
                    · {doctor.experience} years experience
                  </Txt>
                </Pressable>
              ))}
              {!doctors.length && (
                <Empty
                  title="No doctors assigned here"
                  text="Choose another branch or department."
                />
              )}
            </>
          )}
          {step === 1 && (
            <>
              <Card>
                <Row>
                  <Avatar initials={d?.initials ?? ''} color={d?.color} />
                  <View>
                    <Txt bold>{d?.name}</Txt>
                    <Txt muted size={11}>
                      {assignment?.slotMinutes} minutes · {money(assignment?.fee ?? 0)}
                    </Txt>
                  </View>
                </Row>
              </Card>
              <Input
                label="Appointment date (YYYY-MM-DD)"
                value={date}
                onChange={(v) => {
                  setDate(v);
                  setTime('');
                }}
                placeholder="2026-10-26"
              />
              <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
                {Array.from({ length: 6 }, (_, i) => {
                  const d = new Date(DEMO_DATE + 'T12:00:00');
                  d.setDate(d.getDate() + i);
                  const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityLabel={displayDate(value)}
                      accessibilityState={{ selected: date === value }}
                      onPress={() => {
                        setDate(value);
                        setTime('');
                      }}
                      style={{
                        flex: 1,
                        minWidth: 44,
                        paddingVertical: 12,
                        alignItems: 'center',
                        backgroundColor: date === value ? colors.brand : '#fff',
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: '#e1dce9',
                        gap: 5,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: 'Inter_400Regular',
                          fontSize: 10,
                          color: date === value ? '#fff' : '#9381a3',
                        }}
                      >
                        {d.toLocaleDateString('en', { weekday: 'short' })}
                      </Text>
                      <Text
                        style={{
                          fontFamily: 'Inter_400Regular',
                          fontSize: 17,
                          fontWeight: '600',
                          color: date === value ? '#fff' : colors.text,
                        }}
                      >
                        {d.getDate()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Select
                label="Visit type"
                value={type}
                onChange={(v) => setType(v as AppointmentType)}
                options={[
                  { value: 'physical', label: 'Physical clinic visit' },
                  { value: 'remote', label: 'Remote consultation · video later' },
                ]}
              />
              <Txt bold size={14}>
                Available times · Asia/Karachi
              </Txt>
              <View style={{ flexDirection: 'row', gap: 9, flexWrap: 'wrap' }}>
                {slots.map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    accessibilityState={{ selected: time === s }}
                    onPress={() => setTime(s)}
                    style={{
                      width: '31%',
                      minHeight: 48,
                      padding: 10,
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: '#dcd3e8',
                      borderRadius: 8,
                      backgroundColor: time === s ? colors.brand : '#fff',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: 'Inter_400Regular',
                        color: time === s ? '#fff' : '#795b96',
                        fontSize: 12,
                      }}
                    >
                      {displayTime(s)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {!slots.length && (
                <Empty
                  title="No slots on this day"
                  text="Try another date; this doctor may be off or fully booked."
                />
              )}
            </>
          )}
          {step === 2 && (
            <>
              <Card>
                <Row>
                  <Avatar initials={d?.initials ?? ''} color={d?.color} large />
                  <View style={{ flex: 1 }}>
                    <Txt bold>{d?.name}</Txt>
                    <Txt muted size={12}>
                      {state.specializations.find((s) => s.id === d?.specializationId)?.name}
                    </Txt>
                  </View>
                </Row>
                <Row>
                  <CalendarDays size={17} color="#9980aa" />
                  <Txt>{displayDate(date)}</Txt>
                </Row>
                <Row>
                  <Clock3 size={17} color="#9980aa" />
                  <Txt>
                    {displayTime(time)} · {assignment?.slotMinutes} min
                  </Txt>
                </Row>
                <Row>
                  <MapPin size={17} color="#9980aa" />
                  <Txt size={12}>{state.branches.find((b) => b.id === branchId)?.name}</Txt>
                </Row>
                <Txt muted size={12}>
                  {type === 'physical'
                    ? 'Physical clinic visit'
                    : 'Remote consultation · no built-in video'}
                </Txt>
                <Txt bold>{money(assignment?.fee ?? 0)}</Txt>
                <Badge status="pending" />
              </Card>
              {role !== 'patient' && (
                <Select
                  label="Patient"
                  value={patientId}
                  onChange={setPatient}
                  options={state.patients.map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
              <Input
                label="Reason for visit"
                value={reason}
                onChange={setReason}
                multiline
                placeholder="What would you like to discuss?"
              />
              <Txt muted size={11}>
                Approval is required. Manual payment only; nothing is charged by this demo.
              </Txt>
            </>
          )}
          {step < 2 ? (
            <Btn
              title="Continue"
              disabled={step === 0 ? !doctorId : !time}
              onPress={() => setStep(step + 1)}
            />
          ) : (
            <Btn
              title="Submit appointment request"
              disabled={reason.trim().length < 3}
              onPress={() => {
                if (
                  act(
                    () =>
                      clinic.book(actor, {
                        doctorId,
                        branchId,
                        patientId,
                        date,
                        time,
                        type,
                        reason,
                        source: params.patientId
                          ? 'follow_up'
                          : role === 'patient'
                            ? 'patient'
                            : 'walk_in',
                      }),
                    'Appointment request submitted. Approval is required.',
                  )
                )
                  setDone(true);
              }}
            />
          )}
          {step > 0 && <Btn title="Back" outline onPress={() => setStep(step - 1)} />}
        </>
      )}
    </Page>
  );
}
export function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actor, act } = useClinic();
  const a = state.appointments.find((a) => a.id === id);
  const [reschedule, setReschedule] = useState(false);
  const [date, setDate] = useState('2026-10-27');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  if (!a || !canRequestChange(actor, a))
    return (
      <Page title="Appointment unavailable">
        <Empty title="Choose one of your appointments" />
      </Page>
    );
  const d = state.doctors.find((d) => d.id === a.doctorId)!;
  const p = state.patients.find((p) => p.id === a.patientId)!;
  const manager = canManageAppointment(actor, a);
  return (
    <Page title="Appointment details" subtitle={a.id.toUpperCase()}>
      <Card>
        <Row>
          <Avatar initials={d.initials} color={d.color} large />
          <View style={{ flex: 1 }}>
            <Txt bold>{d.name}</Txt>
            <Txt muted size={12}>
              {state.specializations.find((s) => s.id === d.specializationId)?.name}
            </Txt>
          </View>
        </Row>
        <Badge status={a.status} />
        <Txt bold>
          {displayDate(a.date)} · {displayTime(a.time)}
        </Txt>
        <Txt muted size={12}>
          {state.branches.find((b) => b.id === a.branchId)?.name}
        </Txt>
        <Txt size={12}>
          {a.type === 'physical' ? 'Physical clinic visit' : 'Remote consultation'} · {a.duration}{' '}
          minutes
        </Txt>
        <Txt muted size={12}>
          Patient: {p.name} · {age(p.dateOfBirth)} years
        </Txt>
        <Txt size={12}>{a.reason}</Txt>
        <Row>
          <View style={{ flex: 1 }}>
            <Txt bold>{money(a.fee)}</Txt>
          </View>
          <Badge status={a.paymentStatus} />
        </Row>
        {a.requestedSlot && (
          <Txt muted size={12}>
            Requested new time: {displayDate(a.requestedSlot.date)} at{' '}
            {displayTime(a.requestedSlot.time)}. Original slot held pending approval.
          </Txt>
        )}
      </Card>
      {manager && a.fee > 0 && (
        <Btn
          outline
          title={
            a.paymentStatus === 'paid' ? 'Mark manual payment unpaid' : 'Record manual payment'
          }
          onPress={() => act(() => clinic.setPayment(actor, a.id, a.paymentStatus !== 'paid'))}
        />
      )}
      {['confirmed', 'reschedule_requested', 'doctor_unavailable'].includes(a.status) && (
        <Btn
          outline
          title={reschedule ? 'Hide reschedule form' : 'Request reschedule'}
          onPress={() => setReschedule(!reschedule)}
        />
      )}
      {reschedule && (
        <Card title="Request a new time">
          <Input
            label="New date (YYYY-MM-DD)"
            value={date}
            onChange={(v) => {
              setDate(v);
              setTime('');
            }}
          />
          <Select
            label="Available time"
            value={time}
            onChange={setTime}
            options={availableSlots(state, a.doctorId, a.branchId, date, a.id).map((t) => ({
              value: t,
              label: displayTime(t),
            }))}
          />
          <Input label="Reason for rescheduling" value={reason} onChange={setReason} multiline />
          <Btn
            title="Submit reschedule request"
            disabled={!time || reason.length < 3}
            onPress={() => {
              if (
                act(
                  () => clinic.requestReschedule(actor, a.id, date, time, reason),
                  'Reschedule request submitted for approval.',
                )
              )
                setReschedule(false);
            }}
          />
        </Card>
      )}
      {transitions[a.status].includes('cancellation_requested') && (
        <Btn
          danger
          title="Request cancellation"
          onPress={() =>
            act(
              () => clinic.transition(actor, a.id, 'cancellation_requested'),
              'Cancellation request submitted. Approval is required.',
            )
          }
        />
      )}
      {manager &&
        transitions[a.status]
          .filter(
            (s) =>
              ![
                'reschedule_requested',
                'cancellation_requested',
                'doctor_unavailable',
                'completed',
              ].includes(s),
          )
          .map((status) => (
            <Btn
              key={status}
              outline={['no_show', 'rejected'].includes(status)}
              title={
                status === 'confirmed'
                  ? a.status === 'reschedule_requested'
                    ? 'Approve new time'
                    : a.status === 'cancellation_requested'
                      ? 'Keep appointment'
                      : 'Approve appointment'
                  : status === 'cancelled'
                    ? 'Approve cancellation'
                    : status === 'in_consultation'
                      ? 'Start consultation'
                      : statusLabels[status]
              }
              onPress={() =>
                act(
                  () => clinic.transition(actor, a.id, status),
                  `Appointment: ${statusLabels[status]}.`,
                )
              }
            />
          ))}
      {actor.role === 'doctor' && a.status === 'in_consultation' && (
        <Btn title="Open consultation workspace" onPress={() => go('consultation', { id: a.id })} />
      )}
      <Card title="Before your visit">
        <Txt muted size={12}>
          Arrive 10 minutes early. Bring previous medical reports and a current medication list.
          Remote appointments do not include built-in video in this demo.
        </Txt>
      </Card>
    </Page>
  );
}
export function Consultation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actor, act } = useClinic();
  const a = state.appointments.find((a) => a.id === id);
  const existing = state.consultations.find((c) => c.appointmentId === id);
  const [notes, setNotes] = useState({
    symptoms: existing?.symptoms ?? a?.reason ?? '',
    examination: existing?.examination ?? '',
    diagnosis: existing?.diagnosis ?? '',
    plan: existing?.plan ?? '',
    followUp: existing?.followUp ?? '',
  });
  const [vitals, setVitals] = useState(
    existing?.vitals ?? {
      bloodPressure: '',
      pulse: '',
      temperature: '',
      weight: '',
      oxygen: '',
      height: '',
    },
  );
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  if (!a || actor.role !== 'doctor' || a.doctorId !== actor.doctorId)
    return (
      <Page title="Consultation unavailable">
        <Empty title="Only assigned clinicians can edit this consultation" />
      </Page>
    );
  const p = state.patients.find((p) => p.id === a.patientId)!;
  const save = (status: 'draft' | 'signed') => {
    if (
      act(
        () =>
          clinic.saveConsultation(
            actor,
            { ...notes, vitals, status, patientId: a.patientId, appointmentId: a.id },
            items,
          ),
        status === 'signed' ? 'Consultation signed. Visit completed.' : 'Draft saved.',
      )
    )
      router.back();
  };
  return (
    <Page title="Consultation workspace" subtitle={`${p.name} · ${age(p.dateOfBirth)} years`}>
      <Card>
        <Row>
          <ShieldCheck size={20} color="#a58145" />
          <Txt bold size={12}>
            Allergies: {p.history.allergies.join(', ') || 'None reported'}
          </Txt>
        </Row>
        <Txt muted size={11}>
          Conditions: {p.history.conditions.join(', ') || 'None reported'}
        </Txt>
      </Card>
      <Input
        label="Presenting symptoms"
        value={notes.symptoms}
        onChange={(v) => setNotes({ ...notes, symptoms: v })}
        multiline
      />
      <Card title="Vitals">
        {(
          [
            ['bloodPressure', 'Blood pressure (mmHg)'],
            ['pulse', 'Pulse (bpm)'],
            ['temperature', 'Temperature (°C)'],
            ['oxygen', 'SpO₂ (%)'],
            ['weight', 'Weight (kg)'],
            ['height', 'Height (cm)'],
          ] as const
        ).map(([key, label]) => (
          <Input
            key={key}
            label={label}
            value={vitals[key]}
            onChange={(v) => setVitals({ ...vitals, [key]: v })}
            placeholder="Not recorded"
          />
        ))}
      </Card>
      {(['examination', 'diagnosis', 'plan', 'followUp'] as const).map((key) => (
        <Input
          key={key}
          label={
            {
              examination: 'Examination findings',
              diagnosis: 'Diagnosis',
              plan: 'Treatment plan',
              followUp: 'Follow-up instructions',
            }[key]
          }
          value={notes[key]}
          onChange={(v) => setNotes({ ...notes, [key]: v })}
          multiline
        />
      ))}
      <Txt bold size={16}>
        Digital prescription
      </Txt>
      {items.map((item, index) => (
        <Card key={index} title={`Medication ${index + 1}`}>
          {(Object.keys(item) as (keyof PrescriptionItem)[]).map((key) => (
            <Input
              key={key}
              label={key[0].toUpperCase() + key.slice(1)}
              value={item[key]}
              onChange={(v) =>
                setItems(items.map((x, i) => (index === i ? { ...x, [key]: v } : x)))
              }
            />
          ))}
          <Btn
            title="Remove medication"
            outline
            onPress={() => setItems(items.filter((_, i) => i !== index))}
          />
        </Card>
      ))}
      <Btn
        title="Add medication"
        outline
        onPress={() =>
          setItems([
            ...items,
            {
              medication: '',
              strength: '',
              dosage: '',
              frequency: '',
              duration: '',
              instructions: '',
            },
          ])
        }
      />
      <Txt muted size={11}>
        Fictional clinical data only. Signing completes the visit. No real medical advice is
        provided.
      </Txt>
      <Btn title="Save draft" outline onPress={() => save('draft')} />
      <Btn title="Sign & complete consultation" onPress={() => save('signed')} />
    </Page>
  );
}
