'use client';
import { CLINIC_TODAY as DEMO_DATE } from '@/lib/clinical-clock';
import { useAvailability } from '@/lib/clinical-client';
import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  ShieldCheck,
  Video,
  Stethoscope,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  displayDate,
  displayTime,
  money,
  patientAgeLabel,
  suggestedDoctors,
  transitions,
  statusLabels,
  appointmentRequestSource,
  patientIdLabel,
} from '@sro/clinic-core';
import { canManageAppointment, canRequestChange } from '@sro/permissions';
import type { AppointmentStatus, AppointmentType, PrescriptionItem } from '@sro/types';
import { useClinic } from './clinic-context';
import { Avatar, Badge, Button, Empty, Field, Modal } from './ui';

export function BookingDialog({
  onClose,
  doctorId: initialDoctor,
  followUpPatient,
}: {
  onClose: () => void;
  doctorId?: string;
  followUpPatient?: string;
}) {
  const {
    state,
    actor,
    branchId: currentBranch,
    act,
    role,
    clinic,
    organizationId,
    pending,
  } = useClinic();
  const doctorBooking = role === 'doctor';
  const firstStep = doctorBooking ? 1 : 0;
  const [step, setStep] = useState(firstStep);
  const [branchId, setBranch] = useState(currentBranch);
  const [category, setCategory] = useState('All departments');
  const [doctorId, setDoctor] = useState(
    doctorBooking ? (actor.doctorId ?? '') : (initialDoctor ?? ''),
  );
  const [patientId, setPatient] = useState(followUpPatient ?? actor.patientId ?? '');
  const [date, setDate] = useState(DEMO_DATE);
  const [time, setTime] = useState('');
  const [type, setType] = useState<AppointmentType>('physical');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [savedStatus, setSavedStatus] = useState<AppointmentStatus>('pending');
  const submitLock = useRef(false);
  const staffBooking = role === 'admin' || (role === 'doctor' && doctorId === actor.doctorId);
  const doctors = suggestedDoctors(state, category, branchId).filter(
    (d) => role !== 'doctor' || d.id === actor.doctorId,
  );
  const doctor = state.doctors.find((d) => d.id === doctorId);
  const assignment = state.assignments.find(
    (a) => a.branchId === branchId && a.doctorId === doctorId && a.active,
  );
  const doctorScopeReady =
    !doctorBooking || (!!doctor && !!assignment && actor.branchIds.includes(branchId));
  const availability = useAvailability(
    role,
    organizationId,
    doctorScopeReady ? branchId : '',
    doctorId,
    date,
  );
  const slots = availability.slots.map((slot) => slot.time);
  const submit = async () => {
    if (submitLock.current || pending || !doctorScopeReady || !patientId) return;
    submitLock.current = true;
    let actualStatus: AppointmentStatus = 'pending';
    try {
      if (
        await act(
          async () => {
            const saved = await clinic.book(actor, {
              branchId,
              slotId: availability.slots.find((slot) => slot.time === time)?.id ?? '',
              patientId,
              doctorId,
              date,
              time,
              type,
              reason,
              source: appointmentRequestSource(
                actor,
                state,
                patientId,
                branchId,
                !!followUpPatient,
              ),
            });
            actualStatus = saved.status;
            setSavedStatus(saved.status);
          },
          () =>
            actualStatus === 'confirmed'
              ? 'Appointment confirmed.'
              : 'Appointment requested. Approval is required.',
        )
      )
        setSubmitted(true);
    } finally {
      submitLock.current = false;
    }
  };
  return (
    <Modal
      title={
        submitted
          ? savedStatus === 'confirmed'
            ? 'Your appointment is confirmed'
            : 'Your request is in good hands'
          : appointmentRequestSource(actor, state, patientId, branchId, !!followUpPatient) ===
              'follow_up'
            ? 'Schedule a follow-up'
            : staffBooking
              ? 'Create an appointment'
              : 'Request an appointment'
      }
      description={
        doctorBooking
          ? 'Choose an appointment time for your patient.'
          : 'Choose your care team and a time that works for you.'
      }
      onClose={onClose}
      wide
    >
      {!doctorScopeReady && (
        <p className="form-error" role="alert">
          Your Doctor schedule is not available for this branch. Select an assigned branch in your
          workspace and reopen the appointment form.
        </p>
      )}
      {availability.loading && <p role="status">Loading available appointment times…</p>}
      {availability.error && (
        <p className="form-error" role="alert">
          {availability.error}
        </p>
      )}
      {submitted ? (
        <div className="booking-success">
          <span className="success-circle">
            <Check size={32} />
          </span>
          <h2>
            {savedStatus === 'confirmed'
              ? 'Appointment confirmed'
              : 'Appointment request submitted'}
          </h2>
          <p>
            {doctor?.name} · {displayDate(date)} at {displayTime(time)}
          </p>
          <Badge status={savedStatus} />
          <p>
            {savedStatus === 'confirmed'
              ? 'The appointment is confirmed and ready in your clinic calendar.'
              : 'Your Admin or Doctor will review this request. A confirmation will appear in your notifications.'}
          </p>
          <Button onClick={onClose}>Back to the clinic</Button>
        </div>
      ) : (
        <>
          <div className="steps">
            {['Care team', 'Date & time', 'Review request'].slice(firstStep).map((s, i) => (
              <span key={s} className={step >= i + firstStep ? 'active' : ''}>
                <b>{i + firstStep < step ? <Check size={13} /> : i + 1}</b>
                {s}
              </span>
            ))}
          </div>
          {!doctorBooking && step === 0 && (
            <div className="form-stack">
              <div className="form-grid">
                <Field label="Clinic branch">
                  <select
                    value={branchId}
                    onChange={(e) => {
                      setBranch(e.target.value);
                      setDoctor('');
                      setTime('');
                    }}
                  >
                    {state.branches
                      .filter((b) => b.active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Department or concern">
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setDoctor('');
                      setTime('');
                    }}
                  >
                    <option>All departments</option>
                    {state.specializations.map((s) => (
                      <option key={s.id}>{s.name}</option>
                    ))}
                    <optgroup label="Browse by concern">
                      {state.specializations
                        .flatMap((s) => s.symptomCategories)
                        .map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                    </optgroup>
                  </select>
                </Field>
              </div>
              <p className="muted small">
                Categories help you browse departments. They do not provide a diagnosis or emergency
                triage.
              </p>
              <div className="doctor-options">
                {doctors.map((d) => (
                  <button
                    key={d.id}
                    className={`doctor-option ${doctorId === d.id ? 'selected' : ''}`}
                    onClick={() => {
                      setDoctor(d.id);
                      setTime('');
                    }}
                  >
                    <Avatar kind="doctor" entityId={d.id} initials={d.initials} color={d.color} />
                    <span>
                      <strong>{d.name}</strong>
                      <small>
                        {state.specializations.find((s) => s.id === d.specializationId)?.name}
                      </small>
                      <small>{d.experience} years of experience</small>
                    </span>
                    <span className="option-fee">
                      {money(
                        state.assignments.find(
                          (a) => a.doctorId === d.id && a.branchId === branchId,
                        )?.fee ?? 0,
                      )}
                      {doctorId === d.id && <Check size={16} />}
                    </span>
                  </button>
                ))}
              </div>
              {!doctors.length && (
                <Empty title="No doctors assigned" text="Choose another department or branch." />
              )}
            </div>
          )}
          {step === 1 && (
            <div className="form-stack">
              <div className="soft-banner">
                <Stethoscope size={22} />
                <div>
                  <strong>{doctor?.name}</strong>
                  <p>
                    {assignment?.slotMinutes} minute consultation · {money(assignment?.fee ?? 0)}
                  </p>
                  {doctorBooking && (
                    <p>
                      {state.branches.find((b) => b.id === branchId)?.name} ·{' '}
                      {state.specializations.find((s) => s.id === doctor?.specializationId)?.name}
                    </p>
                  )}
                </div>
              </div>
              <div className="form-grid">
                <Field label="Appointment date">
                  <input
                    type="date"
                    min={DEMO_DATE}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setTime('');
                    }}
                  />
                </Field>
                <Field label="Visit type">
                  <select value={type} onChange={(e) => setType(e.target.value as AppointmentType)}>
                    <option value="physical">Physical clinic visit</option>
                    <option value="remote">Remote consultation · video coming later</option>
                  </select>
                </Field>
              </div>
              <h3>
                Available times <span className="muted small">Asia/Karachi</span>
              </h3>
              <div className="slot-grid">
                {slots.map((s) => (
                  <button
                    key={s}
                    className={`slot ${s === time ? 'selected' : ''}`}
                    aria-pressed={s === time}
                    onClick={() => setTime(s)}
                  >
                    {displayTime(s)}
                  </button>
                ))}
              </div>
              {!slots.length && (
                <Empty
                  title="No available slots"
                  text="This doctor is off or fully booked. Please try another date."
                />
              )}
            </div>
          )}
          {step === 2 && (
            <div className="form-stack">
              <div className="review-card">
                <Avatar
                  kind="doctor"
                  entityId={doctor?.id}
                  initials={doctor?.initials ?? ''}
                  color={doctor?.color}
                  size="avatar-lg"
                />
                <div>
                  <h3>{doctor?.name}</h3>
                  <p>
                    {state.specializations.find((s) => s.id === doctor?.specializationId)?.name}
                  </p>
                </div>
                <span>{staffBooking ? 'Confirm on creation' : 'Approval required'}</span>
              </div>
              <div className="detail-grid">
                <div>
                  <CalendarDays size={17} />
                  <span>
                    Date<strong>{displayDate(date)}</strong>
                  </span>
                </div>
                <div>
                  <Clock3 size={17} />
                  <span>
                    Time
                    <strong>
                      {displayTime(time)} · {assignment?.slotMinutes} min
                    </strong>
                  </span>
                </div>
                <div>
                  <MapPin size={17} />
                  <span>
                    Clinic<strong>{state.branches.find((b) => b.id === branchId)?.name}</strong>
                  </span>
                </div>
                <div>
                  {type === 'physical' ? <Stethoscope size={17} /> : <Video size={17} />}
                  <span>
                    Consultation
                    <strong>
                      {type === 'physical' ? 'Physical visit' : 'Remote · no built-in video'}
                    </strong>
                  </span>
                </div>
              </div>
              {role !== 'patient' && (
                <Field label="Patient">
                  <select value={patientId} onChange={(e) => setPatient(e.target.value)}>
                    <option value="">Select a patient</option>
                    {state.patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p?.name ?? 'Patient details restricted until approval'} ·{' '}
                        {patientIdLabel(p)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Reason for visit">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Briefly describe what you would like to discuss…"
                  rows={3}
                  maxLength={1000}
                />
              </Field>
              <div className="fee-summary">
                <span>Consultation fee</span>
                <strong>{money(assignment?.fee ?? 0)}</strong>
              </div>
              <div className="info-note">
                <ShieldCheck size={18} />
                <p>
                  {staffBooking
                    ? 'This appointment will be confirmed when saved.'
                    : 'This request needs approval.'}{' '}
                  Payment is recorded manually at the clinic; no online payment is taken.
                </p>
              </div>
            </div>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={step > firstStep ? () => setStep(step - 1) : onClose}
            >
              {step > firstStep ? (
                <>
                  <ArrowLeft size={16} />
                  Back
                </>
              ) : (
                'Cancel'
              )}
            </Button>
            {step < 2 ? (
              <Button
                disabled={
                  !doctorScopeReady ||
                  (step === 0 ? !doctorId : !time || availability.loading || !slots.includes(time))
                }
                onClick={() => setStep(step + 1)}
              >
                Continue
                <ArrowRight size={16} />
              </Button>
            ) : (
              <Button
                disabled={reason.trim().length < 3 || !patientId || !doctorScopeReady || pending}
                onClick={submit}
              >
                {pending
                  ? 'Saving appointment…'
                  : staffBooking
                    ? 'Confirm appointment'
                    : 'Submit appointment request'}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export function AppointmentDialog({
  appointmentId,
  onClose,
  onConsult,
}: {
  appointmentId: string;
  onClose: () => void;
  onConsult: (id: string) => void;
}) {
  const { state, actor, act, clinic, role, organizationId } = useClinic();
  const a = state.appointments.find((a) => a.id === appointmentId);
  const [reschedule, setReschedule] = useState(false);
  const [date, setDate] = useState(DEMO_DATE);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const availability = useAvailability(
    role,
    organizationId,
    a?.branchId ?? '',
    a?.doctorId ?? '',
    date,
  );
  if (!a) return null;
  const d = state.doctors.find((d) => d.id === a.doctorId)!;
  const p = state.patients.find((p) => p.id === a.patientId);
  const manager = canManageAppointment(actor, a);
  const requester = canRequestChange(actor, a);
  const change = (status: AppointmentStatus) =>
    act(() => clinic.transition(actor, a.id, status), `Appointment: ${statusLabels[status]}.`);
  const slots = availability.slots.map((slot) => slot.time);
  return (
    <Modal
      title="Appointment details"
      description={`${a.id.toUpperCase()} · ${a.source === 'walk_in' ? 'Walk-in patient' : 'Appointment request'}`}
      onClose={onClose}
    >
      <div className="review-card">
        <Avatar
          kind="doctor"
          entityId={d.id}
          initials={d.initials}
          color={d.color}
          size="avatar-lg"
        />
        <div>
          <h3>{d.name}</h3>
          <p>{state.specializations.find((s) => s.id === d.specializationId)?.name}</p>
        </div>
        <Badge status={a.status} />
      </div>
      <div className="detail-grid">
        <div>
          <CalendarDays size={17} />
          <span>
            Date<strong>{displayDate(a.date)}</strong>
          </span>
        </div>
        <div>
          <Clock3 size={17} />
          <span>
            Time
            <strong>
              {displayTime(a.time)} · {a.duration} min
            </strong>
          </span>
        </div>
        <div>
          <MapPin size={17} />
          <span>
            Location<strong>{state.branches.find((b) => b.id === a.branchId)?.name}</strong>
          </span>
        </div>
        <div>
          <Stethoscope size={17} />
          <span>
            Type
            <strong>
              {a.type === 'physical' ? 'Physical clinic visit' : 'Remote consultation'}
            </strong>
          </span>
        </div>
      </div>
      <div className="soft-banner">
        <Avatar kind="patient" entityId={p?.id} initials={p?.initials ?? '—'} color="blue" />
        <div>
          <strong>{p?.name ?? 'Patient details restricted until approval'}</strong>
          <p>
            {p
              ? `${patientAgeLabel(p)} · ${p.gender} · ${patientIdLabel(p)}`
              : 'Patient information is restricted until approval.'}
          </p>
        </div>
      </div>
      <div className="note-block">
        <span className="eyebrow">REASON FOR VISIT</span>
        <p>{a.reason}</p>
      </div>
      {a.requestedSlot && (
        <div className="info-note">
          <CalendarDays size={18} />
          <p>
            Requested:{' '}
            <strong>
              {displayDate(a.requestedSlot.date)} at {displayTime(a.requestedSlot.time)}
            </strong>
            <br />
            {a.requestReason}
          </p>
        </div>
      )}
      <div className="fee-summary">
        <span>{money(a.fee)}</span>
        <Badge status={a.paymentStatus} />
      </div>
      {reschedule && (
        <div className="form-stack reschedule-box">
          {availability.error && (
            <p role="alert" className="form-error">
              {availability.error}
            </p>
          )}
          <Field label="New date">
            <input
              type="date"
              min={DEMO_DATE}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTime('');
              }}
            />
          </Field>
          <Field label="New time">
            <select value={time} onChange={(e) => setTime(e.target.value)}>
              <option value="">Choose available time</option>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {displayTime(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason for rescheduling">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            disabled={!time || reason.length < 3 || availability.loading || !slots.includes(time)}
            onClick={async () => {
              if (
                await act(
                  () =>
                    clinic.requestReschedule(
                      actor,
                      a.id,
                      date,
                      time,
                      reason,
                      availability.slots.find((slot) => slot.time === time)?.id ?? '',
                    ),
                  'Reschedule request sent for approval.',
                )
              )
                setReschedule(false);
            }}
          >
            Submit reschedule request
          </Button>
        </div>
      )}
      <div className="dialog-actions wrap">
        {requester &&
          ['confirmed', 'doctor_unavailable', 'reschedule_requested'].includes(a.status) && (
            <Button variant="outline" onClick={() => setReschedule(!reschedule)}>
              Request reschedule
            </Button>
          )}
        {requester && transitions[a.status].includes('cancellation_requested') && (
          <Button variant="danger" onClick={() => change('cancellation_requested')}>
            Request cancellation
          </Button>
        )}
        {manager &&
          transitions[a.status]
            .filter(
              (s) =>
                ![
                  'cancellation_requested',
                  'reschedule_requested',
                  'doctor_unavailable',
                  'completed',
                ].includes(s),
            )
            .map((s) => (
              <Button
                key={s}
                variant={s === 'rejected' || s === 'no_show' ? 'outline' : 'default'}
                onClick={() => change(s)}
              >
                {s === 'confirmed'
                  ? a.status === 'reschedule_requested'
                    ? 'Approve new time'
                    : a.status === 'cancellation_requested'
                      ? 'Keep appointment'
                      : 'Approve appointment'
                  : s === 'cancelled'
                    ? 'Approve cancellation'
                    : s === 'in_consultation'
                      ? 'Start consultation'
                      : statusLabels[s]}
              </Button>
            ))}
        {actor.role === 'doctor' && a.status === 'in_consultation' && (
          <Button onClick={() => onConsult(a.id)}>
            Open consultation
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
      <p className="muted small">Changes are saved securely. Notifications update automatically.</p>
    </Modal>
  );
}

const blankItem = (): PrescriptionItem => ({
  medication: '',
  strength: '',
  dosage: '',
  frequency: '',
  duration: '',
  instructions: '',
});
export function ConsultationDialog({
  appointmentId,
  onClose,
}: {
  appointmentId: string;
  onClose: () => void;
}) {
  const { state, actor, act, clinic } = useClinic();
  const a = state.appointments.find((a) => a.id === appointmentId)!;
  const p = state.patients.find((p) => p.id === a.patientId);
  const existing = state.consultations.find((c) => c.appointmentId === appointmentId);
  const [symptoms, setSymptoms] = useState(existing?.symptoms ?? a.reason);
  const [examination, setExamination] = useState(existing?.examination ?? '');
  const [diagnosis, setDiagnosis] = useState(existing?.diagnosis ?? '');
  const [plan, setPlan] = useState(existing?.plan ?? '');
  const [followUp, setFollowUp] = useState(existing?.followUp ?? '');
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
  const [items, setItems] = useState<PrescriptionItem[]>(
    state.prescriptions.find((rx) => rx.consultationId === existing?.id)?.items ?? [],
  );
  const save = async (status: 'draft' | 'signed') => {
    if (
      await act(
        () =>
          clinic.saveConsultation(
            actor,
            {
              appointmentId,
              patientId: a.patientId,
              symptoms,
              vitals,
              examination,
              diagnosis,
              plan,
              followUp,
              status,
            },
            items,
          ),
        status === 'signed'
          ? 'Consultation signed. Visit completed and prescription shared.'
          : 'Consultation draft saved.',
      )
    )
      onClose();
  };
  return (
    <Modal
      title="Consultation workspace"
      description={`${p?.name ?? 'Patient details restricted until approval'} · ${p ? patientAgeLabel(p) : 'Age not recorded'} · ${p ? patientIdLabel(p) : 'Patient details restricted'}`}
      onClose={onClose}
      wide
    >
      <div className="clinical-alert">
        <ShieldCheck size={18} />
        <span>
          Allergies:{' '}
          <strong>
            {p?.history.reviewState === 'reviewed'
              ? p.history.allergies.join(', ') || 'None reported'
              : 'Not yet reviewed'}
          </strong>{' '}
          · Conditions: {p?.history.conditions.join(', ') || 'None reported'}
        </span>
      </div>
      <div className="form-stack">
        <Field label="Presenting symptoms">
          <textarea rows={3} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
        </Field>
        <h3>Vitals</h3>
        <div className="vitals-grid">
          {(
            [
              ['bloodPressure', 'BP (mmHg)'],
              ['pulse', 'Pulse (bpm)'],
              ['temperature', 'Temp (°C)'],
              ['oxygen', 'SpO₂ (%)'],
              ['weight', 'Weight (kg)'],
              ['height', 'Height (cm)'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                value={vitals[key]}
                onChange={(e) => setVitals({ ...vitals, [key]: e.target.value })}
                placeholder="Not recorded"
              />
            </Field>
          ))}
        </div>
        <Field label="Examination findings">
          <textarea rows={2} value={examination} onChange={(e) => setExamination(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Diagnosis">
            <textarea rows={3} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </Field>
          <Field label="Treatment plan">
            <textarea rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} />
          </Field>
        </div>
        <div className="section-line">
          <h3>Digital prescription</h3>
          <Button variant="outline" size="sm" onClick={() => setItems([...items, blankItem()])}>
            <Plus size={15} />
            Add medication
          </Button>
        </div>
        {items.map((item, index) => (
          <div className="medication-row" key={index}>
            <div className="section-line">
              <strong>Medication {index + 1}</strong>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove medication ${index + 1}`}
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="form-grid">
              {Object.keys(item).map((key) => (
                <Field label={key[0].toUpperCase() + key.slice(1)} key={key}>
                  <input
                    value={item[key as keyof PrescriptionItem]}
                    onChange={(e) =>
                      setItems(
                        items.map((x, i) => (i === index ? { ...x, [key]: e.target.value } : x)),
                      )
                    }
                    required
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
        <Field label="Follow-up instructions">
          <textarea rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        </Field>
        <div className="info-note">
          <ShieldCheck size={18} />
          <p>
            Signing completes the visit and releases the record to the patient. Review every
            recommendation.
          </p>
        </div>
      </div>
      <div className="dialog-actions">
        <Button variant="outline" onClick={() => save('draft')}>
          Save draft
        </Button>
        <Button onClick={() => save('signed')}>
          Sign & complete consultation
          <Check size={16} />
        </Button>
      </div>
    </Modal>
  );
}
