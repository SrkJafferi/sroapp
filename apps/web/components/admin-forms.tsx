'use client';
import { useState, useRef, useEffect } from 'react';
import {
  patientAccessRequest,
  patientAccessCapabilities,
  patientAccessPilotStatus,
  type OneTimeHandover,
  type PilotRegistration,
} from './patient-access-client';
import { PatientCredentialHandover } from './patient-credential-handover';
import { CLINIC_TODAY as DEMO_DATE } from '@/lib/clinical-clock';
import { bloodGroupOptionLabel, bloodGroupOptions } from '@sro/clinic-core';
import { useClinic } from './clinic-context';
import { Button, Field, Modal } from './ui';
import { DoctorInvitation } from './account-panel';
import { walkInPatientSchema, departmentSchema } from '@sro/validation';
import { ConsultationFeeForm } from './consultation-fee';
export type FormKind =
  | 'invite'
  | 'branch'
  | 'patient'
  | 'department'
  | 'fee'
  | 'leave'
  | 'schedule'
  | 'grant'
  | 'doctor'
  | 'assignment'
  | 'history';
export function AdminForm(props: {
  kind: FormKind;
  id?: string;
  patientId?: string;
  onClose: () => void;
}) {
  return props.kind === 'invite' ? (
    <DoctorInvitation onClose={props.onClose} />
  ) : props.kind === 'fee' ? (
    <ConsultationFeeForm doctorId={props.id} onClose={props.onClose} />
  ) : (
    <ClinicAdminForm {...props} />
  );
}
function ClinicAdminForm({
  kind,
  id,
  patientId,
  onClose,
}: {
  kind: FormKind;
  id?: string;
  patientId?: string;
  onClose: () => void;
}) {
  const { state, actor, branchId, act, clinic, pending } = useClinic();
  const requestId = useRef(crypto.randomUUID());
  const submitLock = useRef(false);
  const [formError, setFormError] = useState('');
  const [handover, setHandover] = useState<OneTimeHandover | null>(null);
  const [registrationNotice, setRegistrationNotice] = useState<{
    patientCode: string;
    review: boolean;
    message: string;
  } | null>(null);
  const [pilotRegistration, setPilotRegistration] = useState<PilotRegistration | null>(null);
  useEffect(() => {
    if (kind !== 'patient') return;
    let active = true;
    patientAccessPilotStatus()
      .then((result) => {
        if (!active || !result.pilot) return;
        const pilot = result.pilot;
        setPilotRegistration(pilot);
        requestId.current = pilot.registrationRequestId;
        setValues((current) => ({
          ...current,
          name: pilot.expectedFields.name,
          email: pilot.expectedFields.email,
          phone: pilot.expectedFields.phone,
          ageYears: String(pilot.expectedFields.ageYears),
          gender: pilot.expectedFields.gender,
          bloodGroup: pilot.expectedFields.bloodGroup,
          address: pilot.expectedFields.address,
          branchId: pilot.branchId,
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind]);
  const branch = state.branches.find((b) => b.id === id);
  const department = state.specializations.find((s) => s.id === id);
  const doctor = state.doctors.find((d) => d.id === (id ?? actor.doctorId));
  const patient = state.patients.find((p) => p.id === patientId);
  const initialDoctor = doctor?.id ?? state.doctors[0]?.id ?? '';
  const schedule = state.schedules.find(
    (s) => s.doctorId === initialDoctor && s.branchId === branchId,
  );
  const [values, setValues] = useState<Record<string, string>>({
    name:
      kind === 'branch'
        ? (branch?.name ?? '')
        : kind === 'department'
          ? (department?.name ?? '')
          : '',
    email: '',
    phone: kind === 'branch' ? (branch?.phone ?? '') : '',
    address: branch?.address ?? '',
    branchId,
    specializationId: doctor?.specializationId ?? state.specializations[0]?.id ?? '',
    doctorId: initialDoctor,
    ageYears: '',
    gender: 'Female',
    description: kind === 'department' ? (department?.description ?? '') : '',
    fee: String(
      state.assignments.find((a) => a.doctorId === initialDoctor && a.branchId === branchId)?.fee ??
        0,
    ),
    startDate: DEMO_DATE,
    endDate: DEMO_DATE,
    reason: '',
    userId:
      state.profiles.find((p) => p.role === 'doctor' || p.role === 'clinical_staff')?.id ?? '',
    start: schedule?.start ?? '09:00',
    end: schedule?.end ?? '17:00',
    bio: doctor?.bio ?? '',
    qualifications: doctor?.qualifications ?? '',
    experience: String(doctor?.experience ?? 0),
    allergies: patient?.history.allergies.join(', ') ?? '',
    conditions: patient?.history.conditions.join(', ') ?? '',
    medications: patient?.history.medications.join(', ') ?? '',
    surgeries: patient?.history.surgeries ?? '',
    familyHistory: patient?.history.familyHistory ?? '',
    socialHistory: patient?.history.socialHistory ?? '',
    bloodGroup: patient?.history.bloodGroup ?? '',
    emergencyContact: patient?.history.emergencyContact ?? '',
  });
  const [active, setActive] = useState(branch?.active ?? true);
  const [days, setDays] = useState(schedule?.days ?? [1, 2, 3, 4, 5, 6]);
  const titles: Record<FormKind, string> = {
    invite: 'Invite a doctor',
    branch: id ? 'Edit clinic branch' : 'Add clinic branch',
    patient: 'Register a walk-in patient',
    department: id ? 'Edit department' : 'Add medical department',
    fee: 'Set consultation fee',
    leave: 'Record doctor leave',
    schedule: 'Edit weekly availability',
    grant: 'Authorize clinical access',
    doctor: 'Edit doctor profile',
    assignment: 'Assign doctor to a branch',
    history: 'Edit structured medical history',
  };
  const input = (key: string, label: string, type = 'text', required = true) => (
    <Field label={label}>
      <input
        type={type}
        required={required}
        value={values[key]}
        min={type === 'number' ? 0 : undefined}
        max={key === 'ageYears' ? 120 : undefined}
        step={key === 'ageYears' ? 1 : undefined}
        inputMode={key === 'ageYears' ? 'numeric' : undefined}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </Field>
  );
  const selectDoctor = (
    <Field label="Doctor">
      <select
        value={values.doctorId}
        onChange={(e) => {
          const next = state.schedules.find(
            (s) => s.doctorId === e.target.value && s.branchId === values.branchId,
          );
          setValues({
            ...values,
            doctorId: e.target.value,
            start: next?.start ?? '09:00',
            end: next?.end ?? '17:00',
          });
          setDays(next?.days ?? [1, 2, 3, 4, 5, 6]);
        }}
        disabled={actor.role === 'doctor'}
      >
        {state.doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const selectBranch = (
    <Field label="Clinic branch">
      <select
        value={values.branchId}
        onChange={(e) => setValues({ ...values, branchId: e.target.value })}
      >
        {state.branches
          .filter(
            (b) =>
              kind !== 'patient' ||
              (b.active &&
                actor.branchIds.includes(b.id) &&
                (actor.role === 'admin' ||
                  state.assignments.some(
                    (a) => a.doctorId === actor.doctorId && a.branchId === b.id && a.active,
                  ))),
          )
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
    </Field>
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || pending) return;
    setFormError('');
    if (kind === 'department') {
      const parsed = departmentSchema.safeParse({
        name: values.name,
        description: values.description,
      });
      if (!parsed.success) {
        setFormError(parsed.error.issues[0].message);
        return;
      }
    }
    if (kind === 'patient') {
      const parsed = walkInPatientSchema.safeParse({
        ...Object.fromEntries(
          ['name', 'email', 'phone', 'bloodGroup', 'gender', 'branchId', 'address'].map((k) => [
            k,
            values[k],
          ]),
        ),
        ageYears: Number(values.ageYears),
        requestId: requestId.current,
      });
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? 'Please check the patient details.');
        return;
      }
    }
    submitLock.current = true;
    let registeredCode = '';
    let newHandover: OneTimeHandover | null = null;
    let accountNotice: { patientCode: string; review: boolean; message: string } | null = null;
    const message = 'Changes saved successfully.';
    const success = await act(
      async () => {
        switch (kind) {
          case 'invite':
            throw new Error('Use the secure invitation form.');
          case 'branch':
            await clinic.saveBranch(
              actor,
              { name: values.name, address: values.address, phone: values.phone, active },
              id,
            );
            break;
          case 'patient': {
            const registered = await clinic.addPatient(actor, {
              name: values.name,
              email: values.email,
              phone: values.phone,
              ageYears: Number(values.ageYears),
              bloodGroup: values.bloodGroup,
              gender: values.gender,
              branchId: values.branchId,
              address: values.address,
              requestId: requestId.current,
            });
            registeredCode = registered.patientCode;
            let autoProvision = false;
            let capabilityReadFailed = false;
            try {
              const capability = await patientAccessCapabilities();
              autoProvision =
                capability.role === actor.role &&
                capability.capabilities.autoProvision === true;
            } catch {
              capabilityReadFailed = true;
            }
            if (autoProvision) {
              try {
                newHandover = await patientAccessRequest({
                  action: 'provision',
                  patientId: registered.id,
                  organizationId: state.organization.id,
                });
              } catch {
                accountNotice = {
                  patientCode: registered.patientCode,
                  review: true,
                  message:
                    'Account setup needs review. The patient is registered; do not create a duplicate. An Admin must review the account.',
                };
              }
            } else if (capabilityReadFailed) {
              accountNotice = {
                patientCode: registered.patientCode,
                review: true,
                message:
                  'Account setup needs review. The patient is registered; do not create a duplicate. An Admin must review the account.',
              };
            } else {
              accountNotice = {
                patientCode: registered.patientCode,
                review: false,
                message:
                  'Patient registered. Login account setup is pending separate clinic activation.',
              };
            }
            break;
          }
          case 'department':
            if (id) await clinic.updateSpecialization(actor, id, values.name, values.description);
            else await clinic.addSpecialization(actor, values.name, values.description);
            break;
          case 'fee':
            await clinic.saveFee(actor, values.doctorId, values.branchId, values.fee);
            break;
          case 'leave':
            await clinic.addLeave(
              actor,
              values.doctorId,
              values.branchId,
              values.startDate,
              values.endDate,
              values.reason,
            );
            break;
          case 'grant':
            await clinic.grant(actor, patientId!, values.userId, values.reason);
            break;
          case 'doctor':
            await clinic.saveDoctor(actor, doctor!.id, {
              bio: values.bio,
              qualifications: values.qualifications,
              experience: Number(values.experience),
              specializationId: values.specializationId,
            });
            break;
          case 'history':
            await clinic.saveHistory(actor, patientId!, {
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
            await clinic.assignDoctor(actor, values.doctorId, values.branchId);
            break;
          case 'schedule': {
            const current = state.schedules.find(
              (s) => s.doctorId === values.doctorId && s.branchId === values.branchId,
            );
            if (
              !state.assignments.some(
                (a) => a.doctorId === values.doctorId && a.branchId === values.branchId && a.active,
              )
            )
              throw new Error('Assign this doctor to the branch first.');
            await clinic.saveSchedule(actor, {
              id: current?.id ?? '',
              doctorId: values.doctorId,
              branchId: values.branchId,
              start: values.start,
              end: values.end,
              days,
              breaks:
                values.start <= '13:00' && values.end >= '14:00'
                  ? [{ start: '13:00', end: '14:00' }]
                  : [],
            });
            break;
          }
        }
      },
      () =>
        kind === 'patient'
          ? `Patient registered successfully. Patient ID # ${registeredCode}`
          : message,
    );
    submitLock.current = false;
    if (success && newHandover) setHandover(newHandover);
    else if (success && accountNotice) setRegistrationNotice(accountNotice);
    else if (success && kind !== 'invite') onClose();
  };
  if (handover)
    return (
      <PatientCredentialHandover
        key={`${handover.operationId}:${handover.handoverExpiresAt ?? ''}`}
        slip={handover}
        expiresAt={handover.handoverExpiresAt ?? null}
        serverNow={handover.serverNow ?? null}
        recoveryMarkerWarning={handover.recoveryMarkerWarning}
        onConfirm={async () => {
          await patientAccessRequest({
            action: 'handover',
            patientId: handover.patientId,
            organizationId: state.organization.id,
            operationId: handover.operationId,
            nonce: handover.handoverNonce,
          });
        }}
        onDismiss={() => {
          setHandover(null);
          onClose();
        }}
      />
    );
  if (registrationNotice)
    return (
      <Modal title="Patient registered" onClose={onClose}>
        <div className="form-stack">
          <p>
            <strong>{registrationNotice.patientCode}</strong>
          </p>
          <p role={registrationNotice.review ? 'alert' : 'status'}>
            {registrationNotice.message}
          </p>
          <div className="dialog-actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={titles[kind]}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form onSubmit={submit} className="form-stack">
        <fieldset disabled={pending} className="profile-form-fields form-stack">
          {['invite', 'branch', 'patient', 'department'].includes(kind) &&
            input(
              'name',
              kind === 'branch'
                ? 'Branch name'
                : kind === 'department'
                  ? 'Department name'
                  : 'Full name',
            )}
          {['invite', 'patient'].includes(kind) &&
            input(
              'email',
              kind === 'patient' ? 'Email address (optional)' : 'Email address',
              'email',
              kind !== 'patient',
            )}
          {['branch', 'patient'].includes(kind) &&
            input(
              'phone',
              kind === 'patient' ? 'Phone number (optional)' : 'Phone number',
              'tel',
              kind !== 'patient',
            )}
          {kind === 'branch' && (
            <>
              {input('address', 'Branch address')}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Active branch
              </label>
            </>
          )}
          {kind === 'patient' && (
            <>
              <div className="form-grid">
                {input('ageYears', 'Age (Years)', 'number')}
                <Field label="Blood group">
                  <select
                    value={values.bloodGroup}
                    onChange={(e) => setValues({ ...values, bloodGroup: e.target.value })}
                  >
                    {bloodGroupOptions.map((group) => (
                      <option key={group || 'unknown'} value={group}>
                        {bloodGroupOptionLabel(group)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Gender">
                  <select
                    value={values.gender}
                    onChange={(e) => setValues({ ...values, gender: e.target.value })}
                  >
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                    <option>Prefer not to say</option>
                  </select>
                </Field>
                {selectBranch}
              </div>
              <div className="info-note">
                Patients can access their clinic account using their unique SRO Patient ID. Email
                is optional. Portal access can be activated later.
              </div>
              {pilotRegistration && (
                <div className="info-note" role="status">
                  Approved pilot registration is active. The server-issued request and approved
                  fictional details are fixed; changing them will be refused.
                </div>
              )}
              {input('address', 'Residential address (optional)', 'text', false)}
            </>
          )}
          {['invite', 'assignment'].includes(kind) && selectBranch}
          {['invite', 'doctor'].includes(kind) && (
            <Field label="Specialization">
              <select
                value={values.specializationId}
                onChange={(e) => setValues({ ...values, specializationId: e.target.value })}
              >
                {state.specializations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {['leave', 'schedule', 'fee', 'assignment'].includes(kind) && selectDoctor}
          {kind === 'fee' && input('fee', 'Consultation fee (PKR) · enter 0 for free', 'number')}
          {kind === 'department' && (
            <Field label="Description">
              <textarea
                aria-label="Description"
                rows={4}
                maxLength={2000}
                value={values.description}
                onChange={(e) => setValues({ ...values, description: e.target.value })}
              />
            </Field>
          )}
          {kind === 'doctor' && (
            <>
              {input('qualifications', 'Qualifications')}
              {input('experience', 'Years of experience', 'number')}
              <Field label="Professional biography">
                <textarea
                  rows={4}
                  value={values.bio}
                  onChange={(e) => setValues({ ...values, bio: e.target.value })}
                  required
                />
              </Field>
            </>
          )}
          {kind === 'leave' && (
            <>
              <div className="form-grid">
                {input('startDate', 'From', 'date')}
                {input('endDate', 'Through', 'date')}
              </div>
              <div className="info-note">
                Doctor-wide leave blocks new bookings at all branches. Affected appointments will be
                flagged for review.
              </div>
            </>
          )}
          {['leave', 'grant'].includes(kind) &&
            input('reason', kind === 'grant' ? 'Clinical access reason' : 'Reason for leave')}
          {kind === 'grant' && (
            <Field label="Additional authorized clinician">
              <select
                value={values.userId}
                onChange={(e) => setValues({ ...values, userId: e.target.value })}
              >
                {state.profiles
                  .filter((p) => ['doctor', 'clinical_staff'].includes(p.role))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {kind === 'schedule' && (
            <>
              <div className="day-checkboxes">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      checked={days.includes(i)}
                      onChange={(e) =>
                        setDays(e.target.checked ? [...days, i] : days.filter((n) => n !== i))
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
              <div className="form-grid">
                {input('start', 'Clinic opens', 'time')}
                {input('end', 'Clinic closes', 'time')}
              </div>
              <p className="muted small">
                A 1–2 PM break applies when within working hours. Existing appointment conflicts
                must be resolved first.
              </p>
            </>
          )}
          {kind === 'history' && (
            <>
              <p className="muted small">
                Use commas to separate allergies, conditions and medication entries. Keep unknown
                values explicit.
              </p>
              <Field label="Blood group">
                <select
                  value={values.bloodGroup}
                  onChange={(e) => setValues({ ...values, bloodGroup: e.target.value })}
                >
                  {bloodGroupOptions.map((group) => (
                    <option key={group || 'unknown'} value={group}>
                      {bloodGroupOptionLabel(group)}
                    </option>
                  ))}
                </select>
              </Field>
              {[
                ['allergies', 'Reported allergies'],
                ['conditions', 'Chronic conditions'],
                ['medications', 'Current medications'],
                ['surgeries', 'Surgical history'],
                ['familyHistory', 'Family history'],
                ['socialHistory', 'Social history'],
                ['emergencyContact', 'Emergency contact'],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <textarea
                    rows={2}
                    value={values[key]}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  />
                </Field>
              ))}
            </>
          )}
        </fieldset>
        {formError && (
          <p role="alert" className="form-error">
            {formError}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="outline" type="button" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              pending ||
              (pilotRegistration !== null &&
                !['issued', 'registering'].includes(pilotRegistration.state))
            }
          >
            {pending
              ? 'Saving…'
              : kind === 'patient'
                ? 'Register Patient'
                : kind === 'invite'
                  ? 'Send invitation'
                  : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
