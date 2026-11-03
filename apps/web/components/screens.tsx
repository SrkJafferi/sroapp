'use client';
import { useEffect, useState } from 'react';
import { CLINIC_TODAY as DEMO_DATE, localParts } from '@/lib/clinical-clock';
import { useAvailability } from '@/lib/clinical-client';
import { WorkspaceLink } from './workspace-route';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Download,
  FileHeart,
  HeartPulse,
  Mail,
  MapPin,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  bloodGroupLabel,
  displayDate,
  displayTime,
  money,
  patientAgeLabel,
  suggestedDoctors,
  patientIdLabel,
  matchesPatientSearch,
} from '@sro/clinic-core';
import { canViewPatient } from '@sro/permissions';
import type { Prescription } from '@sro/types';
import { useClinic } from './clinic-context';
import { AccountAccessForPatient } from './patient-access-client';
import { MedicalDocuments } from './medical-documents';
import { DoctorProfileHeader, EditProfileAction } from './profile-editor';
import { PendingInvitations } from './pending-invitations';
import { PatientActions } from './patient-actions';
import { AdminForm, type FormKind } from './admin-forms';
import { Avatar, Button, Empty, Field, Modal, Panel, SearchBox } from './ui';

function DirectoryTimestamp({
  value,
  timezone,
  date,
}: {
  value?: string;
  timezone: string;
  date?: string;
}) {
  if (value && Number.isFinite(new Date(value).getTime())) {
    const local = localParts(value, timezone);
    return (
      <time dateTime={value} title={timezone}>
        {displayDate(local.date)}
        <small>{displayTime(local.time)}</small>
      </time>
    );
  }
  return date ? (
    <span>
      {displayDate(date)}
      <small>Time not recorded</small>
    </span>
  ) : (
    <span className="muted">Not recorded</span>
  );
}

export function Directories({
  kind,
  onBook,
}: {
  kind: 'doctors' | 'patients';
  onBook: (patientId?: string) => void;
}) {
  const { state, role, actor, branchId, organizationId } = useClinic();
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('All departments');
  const [sort, setSort] = useState('name');
  const [doctorScope, setDoctorScope] = useState('all');
  const [patientScope, setPatientScope] = useState('all');
  const [form, setForm] = useState<FormKind | null>(null);
  const adminDoctorDirectory = kind === 'doctors' && role === 'admin';
  const adminPatientDirectory = kind === 'patients' && role === 'admin';
  const localBranchDirectory = adminDoctorDirectory || adminPatientDirectory;
  const scope = kind === 'patients' ? patientScope : doctorScope;
  const setScope = kind === 'patients' ? setPatientScope : setDoctorScope;
  const authorizedBranches = state.branches.filter(
    (b) => b.active && actor.branchIds.includes(b.id),
  );
  const authorizedBranchIds = new Set(authorizedBranches.map((b) => b.id));
  const selectedScope = localBranchDirectory
    ? scope === 'all' || authorizedBranchIds.has(scope)
      ? scope
      : 'all'
    : branchId;
  const visibleBranches = localBranchDirectory
    ? selectedScope === 'all'
      ? authorizedBranches
      : authorizedBranches.filter((b) => b.id === selectedScope)
    : state.branches.filter((b) => b.id === branchId);
  const visibleBranchIds = new Set(visibleBranches.map((b) => b.id));
  const scopedDoctors = adminDoctorDirectory
    ? [
        ...new Set(
          visibleBranches.flatMap((b) =>
            suggestedDoctors(state, department, b.id).map((d) => d.id),
          ),
        ),
      ]
        .map((id) => state.doctors.find((d) => d.id === id))
        .filter((d): d is (typeof state.doctors)[number] => Boolean(d))
    : suggestedDoctors(state, department, branchId);
  const doctors = scopedDoctors
    .filter((d) => `${d.name} ${d.qualifications}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === 'experience' ? b.experience - a.experience : a.name.localeCompare(b.name),
    );
  const patientBranchIds = (patientId: string, homeBranchId: string) => [
    ...new Set([
      homeBranchId,
      ...state.appointments.filter((a) => a.patientId === patientId).map((a) => a.branchId),
    ]),
  ];
  const patients = state.patients
    .filter(
      (p) =>
        canViewPatient(actor, p.id, state) &&
        patientBranchIds(p.id, p.branchId).some((id) => visibleBranchIds.has(id)) &&
        matchesPatientSearch(p, query),
    )
    .sort((a, b) => {
      if (!adminPatientDirectory) return a.name.localeCompare(b.name);
      const aCode = a.patientCode ?? '';
      const bCode = b.patientCode ?? '';
      if (!aCode || !bCode) return aCode ? -1 : bCode ? 1 : a.name.localeCompare(b.name);
      return bCode.localeCompare(aCode, undefined, { numeric: true });
    });
  return (
    <>
      <Panel
        title={kind === 'doctors' ? 'A care team you can count on' : 'Patient directory'}
        subtitle={
          kind === 'doctors'
            ? 'Find the right specialist for your next step.'
            : 'Patient profiles and their connected health records.'
        }
        action={
          kind === 'doctors' && role === 'admin' ? (
            <div className="row-actions">
              <span className="directory-count" aria-live="polite">
                {doctors.length} {doctors.length === 1 ? 'doctor' : 'doctors'}
              </span>
              <Button size="sm" onClick={() => setForm('invite')}>
                <Mail size={15} />
                Invite doctor
              </Button>
            </div>
          ) : kind === 'patients' ? (
            <div className="row-actions">
              {role === 'admin' && (
                <span className="directory-count" aria-live="polite">
                  {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
                </span>
              )}
              <Button size="sm" onClick={() => setForm('patient')}>
                <Plus size={15} />
                Register walk-in
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="table-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={kind === 'doctors' ? 'Search doctors…' : 'Search patient, ID or phone…'}
          />
          {localBranchDirectory && (
            <label className="directory-scope">
              <span>Branch</span>
              <select
                aria-label={
                  kind === 'doctors' ? 'Filter doctors by branch' : 'Filter patients by branch'
                }
                value={selectedScope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">All Authorized Branches</option>
                {authorizedBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'doctors' && (
            <>
              <select
                aria-label="Filter department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
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
              <select
                aria-label="Sort doctors"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="name">Sort by name</option>
                <option value="experience">Most experienced</option>
              </select>
            </>
          )}
        </div>
        {kind === 'doctors' ? (
          <div className="doctor-grid">
            {doctors.map((d) => {
              const doctorAssignments = state.assignments.filter(
                (a) => a.doctorId === d.id && a.active && visibleBranchIds.has(a.branchId),
              );
              const doctorBranches = visibleBranches.filter((b) =>
                doctorAssignments.some((a) => a.branchId === b.id),
              );
              const fees = [...new Set(doctorAssignments.map((a) => a.fee))];
              const feeRange = adminDoctorDirectory && selectedScope === 'all' && fees.length > 1;
              const fee = feeRange ? Math.min(...fees) : (fees[0] ?? 0);
              return (
                <article className="doctor-card" key={d.id}>
                  <div className="doctor-card-top">
                    <Avatar
                      kind="doctor"
                      entityId={d.id}
                      initials={d.initials}
                      color={d.color}
                      size="avatar-xl"
                    />
                    <span className="availability-label">
                      <span />
                      On clinic roster
                    </span>
                  </div>
                  <h3>{d.name}</h3>
                  <p className="doctor-specialty">
                    {state.specializations.find((s) => s.id === d.specializationId)?.name}
                  </p>
                  <p className="muted small">{d.qualifications}</p>
                  <div className="doctor-meta">
                    <span>
                      <ShieldCheck size={15} />
                      {d.experience} years experience
                    </span>
                    {doctorBranches.map((b) => (
                      <span key={b.id}>
                        <MapPin size={15} />
                        {b.name}
                      </span>
                    ))}
                  </div>
                  <div className="doctor-card-footer">
                    <strong>{feeRange ? `From ${money(fee)}` : money(fee)}</strong>
                    <Button asChild variant="outline" size="sm">
                      <WorkspaceLink href={`/${role}/doctors/${d.id}`}>
                        View profile
                        <ArrowRight size={14} />
                      </WorkspaceLink>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table patient-directory-table">
              <thead>
                <tr>
                  <th scope="col">PATIENT ID</th>
                  <th scope="col">PATIENT NAME</th>
                  <th scope="col">BRANCH</th>
                  <th scope="col">AGE</th>
                  <th scope="col">CONTACT</th>
                  <th scope="col">GENDER</th>
                  <th scope="col">REGISTER DATE</th>
                  <th scope="col">LAST VISIT</th>
                  <th scope="col">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const lastVisit = state.consultations
                    .filter(
                      (c) => c.patientId === p.id && (role !== 'patient' || c.status === 'signed'),
                    )
                    .sort((a, b) => (a.recordedAt ?? a.date).localeCompare(b.recordedAt ?? b.date))
                    .at(-1);
                  const branches = patientBranchIds(p.id, p.branchId)
                    .filter((id) => visibleBranchIds.has(id))
                    .map((id) => state.branches.find((b) => b.id === id)?.name)
                    .filter((name): name is string => Boolean(name));
                  return (
                    <tr key={p.id}>
                      <td data-label="Patient ID" className="patient-code-cell">
                        {p.patientCode || 'Not assigned'}
                      </td>
                      <td data-label="Patient name">
                        <div className="person-cell">
                          <Avatar
                            kind="patient"
                            entityId={p.id}
                            initials={p.initials}
                            color="blue"
                          />
                          <span>
                            <strong>{p.name}</strong>
                          </span>
                        </div>
                      </td>
                      <td data-label="Branch">
                        <span className="patient-branch-cell">
                          {branches.length ? branches.join(' · ') : 'Not recorded'}
                        </span>
                      </td>
                      <td data-label="Age">{patientAgeLabel(p)}</td>
                      <td data-label="Contact">
                        <span className="patient-contact">
                          {p.phone && <strong>{p.phone}</strong>}
                          {p.email && <small>{p.email}</small>}
                          {!p.phone && !p.email && <span className="muted">Not provided</span>}
                        </span>
                      </td>
                      <td data-label="Gender">{p.gender || 'Not recorded'}</td>
                      <td data-label="Register date">
                        <DirectoryTimestamp value={p.registeredAt} timezone="Asia/Karachi" />
                      </td>
                      <td data-label="Last visit">
                        {lastVisit ? (
                          <DirectoryTimestamp
                            value={lastVisit.recordedAt}
                            date={lastVisit.date}
                            timezone={
                              state.branches.find((b) => b.id === lastVisit.branchId)?.timezone ??
                              state.organization.timezone
                            }
                          />
                        ) : (
                          'No visits yet'
                        )}
                      </td>
                      <td data-label="Actions">
                        <PatientActions
                          name={p.name}
                          target={{ organizationId, kind: 'patient', id: p.id }}
                          recordsHref={`/${role}/records/${p.id}`}
                          clinicalAccess={canViewPatient(actor, p.id, state)}
                          onFollowUp={() => onBook(p.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!(kind === 'doctors' ? doctors.length : patients.length) && (
          <Empty title="No matches found" text="Try a different search or choose another branch." />
        )}
      </Panel>
      {kind === 'doctors' && role === 'admin' && <PendingInvitations />}
      {kind === 'doctors' && (
        <p className="discovery-note">
          <ShieldCheck size={15} />
          Department suggestions are for browsing only and do not provide medical diagnosis or
          emergency triage.
        </p>
      )}
      {form && <AdminForm kind={form} onClose={() => setForm(null)} />}
    </>
  );
}

export function DoctorProfile({ id, onBook }: { id: string; onBook: (id: string) => void }) {
  const { state, branchId, role, organizationId, actor } = useClinic();
  const d = state.doctors.find((d) => d.id === id);
  const [date, setDate] = useState(DEMO_DATE);
  const [tab, setTab] = useState('About');
  const [form, setForm] = useState<FormKind | null>(null);
  const activeAssignments = state.assignments.filter((a) => a.doctorId === id && a.active);
  // All-branch directories can open a Doctor whose roster is outside the topbar branch.
  const displayBranchId = activeAssignments.some((a) => a.branchId === branchId)
    ? branchId
    : (activeAssignments.find((a) => state.branches.some((b) => b.id === a.branchId))?.branchId ??
      branchId);
  const availability = useAvailability(role, organizationId, displayBranchId, id, date);
  if (!d) return <Empty title="Doctor not found" />;
  const slots = availability.slots.map((slot) => slot.time);
  const assigned = activeAssignments;
  const spec = state.specializations.find((s) => s.id === d.specializationId);
  return (
    <>
      <WorkspaceLink className="text-link back-link" href={`/${role}/doctors`}>
        <ArrowLeft size={16} />
        Back to doctors
      </WorkspaceLink>
      <div className="profile-grid">
        <Panel>
          <DoctorProfileHeader
            key={`${organizationId}:${actor.id}:${role}:${d.id}`}
            doctor={d}
            specialization={spec?.name}
          />
          <div className="tabs" role="tablist" aria-label="Doctor profile sections">
            {['About', 'Schedule', 'Availability'].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="profile-content">
            {tab === 'About' ? (
              <>
                <h3>Care that starts with listening</h3>
                <p>{d.bio}</p>
                <h3>Areas of care</h3>
                <div className="pill-group">
                  {spec?.symptomCategories.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                <div className="profile-facts">
                  <div>
                    <ShieldCheck size={24} />
                    <span>
                      <strong>{d.experience}+ years</strong>
                      <small>Clinical experience</small>
                    </span>
                  </div>
                  <div>
                    <Building2 size={24} />
                    <span>
                      <strong>
                        {assigned.length} clinic {assigned.length === 1 ? 'branch' : 'branches'}
                      </strong>
                      <small>Connected care locations</small>
                    </span>
                  </div>
                </div>
              </>
            ) : tab === 'Schedule' ? (
              <>
                <h3>Weekly clinic hours</h3>
                {state.schedules
                  .filter((s) => s.doctorId === id)
                  .map((s) => (
                    <div className="schedule-row" key={s.id}>
                      <Building2 size={20} />
                      <span>
                        <strong>{state.branches.find((b) => b.id === s.branchId)?.name}</strong>
                        <small>
                          {s.days
                            .map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i])
                            .join(', ')}
                        </small>
                      </span>
                      <strong>
                        {displayTime(s.start)} – {displayTime(s.end)}
                      </strong>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <Field label="Check availability">
                  <input
                    type="date"
                    min={DEMO_DATE}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <div className="slot-grid availability-preview">
                  {slots.map((t) => (
                    <button className="slot" key={t} onClick={() => onBook(id)}>
                      {displayTime(t)}
                    </button>
                  ))}
                </div>
                {!slots.length && (
                  <Empty title="No slots on this day" text="Try another date or branch." />
                )}
              </>
            )}
          </div>
        </Panel>
        <Panel title="Plan your visit">
          <div className="profile-booking">
            <div className="soft-banner">
              <Wallet size={23} />
              <span>
                Consultation fee
                <strong>
                  {money(
                    state.assignments.find(
                      (a) => a.doctorId === id && a.branchId === displayBranchId,
                    )?.fee ?? 0,
                  )}
                </strong>
              </span>
            </div>
            <p>
              <Clock3 size={17} />
              30 minute appointments
            </p>
            <p>
              <MapPin size={17} />
              {state.branches.find((b) => b.id === displayBranchId)?.name}
            </p>
            <p>
              <CalendarDays size={17} />
              Approval required for all bookings
            </p>
            <Button onClick={() => onBook(id)}>
              Request appointment
              <ArrowRight size={16} />
            </Button>
            {role === 'admin' && (
              <Button variant="outline" onClick={() => setForm('fee')}>
                Edit Consultation Fee
              </Button>
            )}
            {role === 'admin' && (
              <Button variant="outline" onClick={() => setForm('assignment')}>
                Assign another branch
              </Button>
            )}
            <small>
              Remote consultations are supported as a visit type. Built-in video will be added
              later.
            </small>
          </div>
        </Panel>
      </div>
      {form && <AdminForm kind={form} id={id} onClose={() => setForm(null)} />}
    </>
  );
}

function PrescriptionDialog({
  prescription,
  onClose,
}: {
  prescription: Prescription;
  onClose: () => void;
}) {
  const { state } = useClinic();
  const p = state.patients.find((p) => p.id === prescription.patientId)!;
  const d = state.doctors.find((d) => d.id === prescription.doctorId)!;
  return (
    <Modal title="Digital prescription" onClose={onClose} wide>
      <article className="prescription-print">
        <div className="prescription-heading">
          <HeartPulse size={33} />
          <div>
            <h2>SRO Clinic</h2>
            <p>Social Responsibility Organization</p>
          </div>
          <span>Digital prescription</span>
        </div>
        <div className="section-line">
          <div>
            <h3>{p.name}</h3>
            <p>
              {patientAgeLabel(p)} · {patientIdLabel(p)}
            </p>
          </div>
          <div>
            <strong>{d.name}</strong>
            <p>{displayDate(prescription.date)}</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>MEDICATION</th>
                <th>DOSAGE & FREQUENCY</th>
                <th>DURATION</th>
              </tr>
            </thead>
            <tbody>
              {prescription.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <strong>
                      {item.medication} · {item.strength}
                    </strong>
                    <small>{item.instructions}</small>
                  </td>
                  <td>
                    {item.dosage}
                    <small>{item.frequency}</small>
                  </td>
                  <td>{item.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Follow-up instructions</h3>
        <p>{prescription.instructions || 'No additional instructions recorded.'}</p>
        <p className="clinical-alert">
          Follow your clinician’s instructions and contact the clinic with questions.
        </p>
      </article>
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => window.print()}>
          <Download size={16} />
          Print / save as PDF
        </Button>
      </div>
    </Modal>
  );
}
export function Records({
  kind,
  selectedPatientId,
  onFollowUp,
}: {
  kind: string;
  selectedPatientId?: string;
  onFollowUp: (id: string) => void;
}) {
  const { state, role, actor, branchId, organizationId } = useClinic();
  const visible = state.patients.filter((p) => canViewPatient(actor, p.id, state));
  const [selection, setSelection] = useState(
    selectedPatientId ?? actor.patientId ?? visible[0]?.id ?? '',
  );
  const [tab, setTab] = useState(
    kind === 'prescriptions'
      ? 'Prescriptions'
      : kind === 'reports'
        ? 'Reports & documents'
        : 'Consultations',
  );
  const [form, setForm] = useState<'grant' | 'history' | null>(null);
  const [rx, setRx] = useState<Prescription | null>(null);
  const p = visible.find((p) => p.id === selection);
  if (!p)
    return (
      <Empty
        title="Record access unavailable"
        text="Only your own, assigned, or explicitly authorized patient records are visible."
      />
    );
  const consultations = state.consultations.filter(
    (c) => c.patientId === p.id && (role !== 'patient' || c.status === 'signed'),
  );
  const prescriptions = state.prescriptions.filter((r) => r.patientId === p.id);
  return (
    <>
      <AccountAccessForPatient key={actor.id + ':' + p.id} patientId={p.id} />
      <div className="record-toolbar">
        {role !== 'patient' && (
          <Field label="Patient record">
            <select value={selection} onChange={(e) => setSelection(e.target.value)}>
              {visible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {patientIdLabel(p)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {role === 'doctor' && (
          <Button variant="outline" size="sm" onClick={() => setForm('history')}>
            Edit medical history
          </Button>
        )}
        <span className="access-label">
          <ShieldCheck size={15} />
          {role === 'admin'
            ? 'Admin oversight access'
            : role === 'patient'
              ? 'Your personal health record'
              : 'Assigned / authorized clinician access'}
        </span>
        {role === 'admin' && (
          <Button variant="outline" size="sm" onClick={() => setForm('grant')}>
            Add authorized clinician
          </Button>
        )}
      </div>
      <div className="record-layout">
        <div>
          <Panel>
            <div className="patient-profile">
              <Avatar
                kind="patient"
                entityId={p.id}
                initials={p.initials}
                color="blue"
                size="avatar-xl"
              />
              <h2>{p.name}</h2>
              {role !== 'patient' && (
                <EditProfileAction target={{ organizationId, kind: 'patient', id: p.id }} />
              )}
              <p>
                {patientIdLabel(p)} · {patientAgeLabel(p)} · {p.gender}
              </p>
              <span className="specialty-pill">
                Blood group {bloodGroupLabel(p.history.bloodGroup)}
              </span>
            </div>
            <div className="patient-contact">
              <p>
                <Mail size={15} />
                {p.email}
              </p>
              <p>{p.phone}</p>
              <p>{p.address || 'Address not recorded'}</p>
            </div>
            <div className="medical-flags">
              <span className="eyebrow">ALLERGIES</span>
              <p className="allergy-text">
                {p.history.reviewState === 'reviewed'
                  ? p.history.allergies.join(', ') || 'None reported'
                  : 'Not yet reviewed'}
              </p>
              <span className="eyebrow">CHRONIC CONDITIONS</span>
              <p>
                {p.history.reviewState === 'reviewed'
                  ? p.history.conditions.join(', ') || 'None reported'
                  : 'Not yet reviewed'}
              </p>
              <span className="eyebrow">CURRENT MEDICATIONS</span>
              <p>
                {p.history.reviewState === 'reviewed'
                  ? p.history.medications.join(', ') || 'None reported'
                  : 'Not yet reviewed'}
              </p>
            </div>
          </Panel>
        </div>
        <Panel
          title="A connected view of health"
          subtitle="Consultations, care plans and documents in one place"
        >
          <div className="tabs" role="tablist" aria-label="Medical record sections">
            {['Consultations', 'Medical history', 'Prescriptions', 'Reports & documents'].map(
              (t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={t === tab}
                  className={tab === t ? 'active' : ''}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ),
            )}
          </div>
          <div className="record-content">
            {tab === 'Consultations' &&
              (consultations.length ? (
                consultations.map((c) => (
                  <article className="consultation-record" key={c.id}>
                    <div className="section-line">
                      <div>
                        <span className="eyebrow">
                          {patientIdLabel(p)} · {displayDate(c.date)}
                        </span>
                        <h3>{state.doctors.find((d) => d.id === c.doctorId)?.name}</h3>
                      </div>
                      <span className="specialty-pill">
                        {c.status === 'signed' ? 'Signed consultation' : 'Draft note'}
                      </span>
                    </div>
                    <p>{c.symptoms}</p>
                    <div className="vital-summary">
                      {Object.entries(c.vitals)
                        .filter(([, value]) => value)
                        .map(([key, value]) => (
                          <span key={key}>
                            <small>
                              {
                                (
                                  {
                                    bloodPressure: 'BP (mmHg)',
                                    pulse: 'Pulse (bpm)',
                                    temperature: 'Temp (°C)',
                                    oxygen: 'SpO₂ (%)',
                                    weight: 'Weight (kg)',
                                    height: 'Height (cm)',
                                  } as Record<string, string>
                                )[key]
                              }
                            </small>
                            <strong>{value}</strong>
                          </span>
                        ))}
                    </div>
                    <div className="form-grid">
                      <div>
                        <h4>Diagnosis</h4>
                        <p>{c.diagnosis || 'Not recorded'}</p>
                        <h4>Examination</h4>
                        <p>{c.examination || 'Not recorded'}</p>
                      </div>
                      <div>
                        <h4>Treatment plan</h4>
                        <p>{c.plan || 'Not recorded'}</p>
                        <h4>Follow-up</h4>
                        <p>{c.followUp || 'Not recorded'}</p>
                      </div>
                    </div>
                    {role !== 'patient' && (
                      <Button variant="outline" size="sm" onClick={() => onFollowUp(p.id)}>
                        <CalendarDays size={15} />
                        Schedule follow-up
                      </Button>
                    )}
                  </article>
                ))
              ) : (
                <Empty
                  title="No consultations yet"
                  text="Completed and draft consultation notes will appear here."
                />
              ))}
            {tab === 'Medical history' && (
              <div className="history-grid">
                {[
                  ['Age', patientAgeLabel(p)],
                  ['Blood group', bloodGroupLabel(p.history.bloodGroup)],
                  ['Emergency contact', p.history.emergencyContact],
                  ['Surgical history', p.history.surgeries],
                  ['Family history', p.history.familyHistory],
                  ['Social history', p.history.socialHistory],
                  [
                    'Additional authorized clinicians',
                    state.grants
                      .filter((g) => g.patientId === p.id)
                      .map((g) => state.profiles.find((u) => u.id === g.userId)?.name)
                      .join(', ') || 'Assigned care team only',
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <h4>{label}</h4>
                    <p>{value}</p>
                  </div>
                ))}
              </div>
            )}
            {tab === 'Prescriptions' &&
              (prescriptions.length ? (
                prescriptions.map((r) => (
                  <div className="document-card" key={r.id}>
                    <span className="stat-icon avatar-purple">
                      <ClipboardIcon />
                    </span>
                    <div>
                      <h3>Digital prescription</h3>
                      <p>
                        {state.doctors.find((d) => d.id === r.doctorId)?.name} ·{' '}
                        {displayDate(r.date)}
                      </p>
                      <small>
                        {r.items.length} medication {r.items.length === 1 ? 'entry' : 'entries'}
                      </small>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setRx(r)}>
                      View prescription
                    </Button>
                  </div>
                ))
              ) : (
                <Empty title="No prescriptions yet" />
              ))}
            {tab === 'Reports & documents' && (
              <MedicalDocuments key={`${p.id}-${branchId}`} patientId={p.id} />
            )}
          </div>
        </Panel>
      </div>
      {form && <AdminForm kind={form} patientId={p.id} onClose={() => setForm(null)} />}
      {rx && <PrescriptionDialog prescription={rx} onClose={() => setRx(null)} />}
    </>
  );
}
function ClipboardIcon() {
  return <FileHeart size={22} />;
}

export function Administration({
  section,
}: {
  section: string;
  onBook: (doctorId?: string) => void;
}) {
  const { state, actor, role, branchId } = useClinic();
  const [form, setForm] = useState<{ kind: FormKind; id?: string } | null>(null);
  const [query, setQuery] = useState('');
  const doctors = state.doctors.filter(
    (d) =>
      (role === 'admin' || d.id === actor.doctorId) &&
      d.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      {section === 'branches' && (
        <Panel
          title="One organization. Connected clinics."
          subtitle="Start with one clinic and grow without changing how you work."
          action={
            <Button size="sm" onClick={() => setForm({ kind: 'branch' })}>
              <Plus size={15} />
              Add branch
            </Button>
          }
        >
          <div className="branch-grid">
            {state.branches.map((b) => (
              <article className="branch-card" key={b.id}>
                <span className="stat-icon avatar-purple">
                  <Building2 size={26} />
                </span>
                <span className={`specialty-pill ${b.active ? 'green-pill' : ''}`}>
                  {b.active ? 'Active branch' : 'Inactive'}
                </span>
                <h3>{b.name}</h3>
                <p>
                  <MapPin size={15} />
                  {b.address}
                </p>
                <p>{b.phone}</p>
                <div className="branch-card-bottom">
                  <span>
                    {state.assignments.filter((a) => a.branchId === b.id && a.active).length}{' '}
                    doctors assigned
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ kind: 'branch', id: b.id })}
                  >
                    Edit branch
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
      {section === 'specializations' && (
        <Panel
          title="Care for every chapter"
          subtitle="Browse medical departments and their areas of care."
          action={
            role === 'admin' && (
              <Button size="sm" onClick={() => setForm({ kind: 'department' })}>
                <Plus size={15} />
                Add department
              </Button>
            )
          }
        >
          <div className="department-grid">
            {state.specializations.map((s, i) => (
              <article key={s.id} className="department-card">
                <span
                  className={`stat-icon avatar-${['purple', 'blue', 'rose', 'green', 'orange', 'teal'][i % 6]}`}
                >
                  <HeartPulse size={25} />
                </span>
                <h3>{s.name}</h3>
                <p>{s.description}</p>
                <span>
                  {state.doctors.filter((d) => d.specializationId === s.id).length} specialists
                </span>
                <div className="pill-group">
                  {s.symptomCategories.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {role === 'admin' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setForm({ kind: 'department', id: s.id })}
                  >
                    Edit department
                  </Button>
                )}
                {role === 'patient' && (
                  <WorkspaceLink className="text-link" href="/patient/doctors">
                    Explore doctors
                    <ArrowRight size={15} />
                  </WorkspaceLink>
                )}
              </article>
            ))}
          </div>
          <p className="discovery-note">
            Department browsing is not diagnosis or emergency triage.
          </p>
        </Panel>
      )}
      {section === 'schedules' && (
        <>
          <Panel
            title="Availability & clinic hours"
            subtitle="All times in Asia/Karachi. Leave applies across a doctor's branches."
            action={
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setForm({ kind: 'leave', id: actor.doctorId })}
                >
                  Record leave
                </Button>
                <Button size="sm" onClick={() => setForm({ kind: 'schedule', id: actor.doctorId })}>
                  Edit availability
                </Button>
              </div>
            }
          >
            <div className="table-toolbar">
              <SearchBox value={query} onChange={setQuery} placeholder="Search doctor schedule…" />
            </div>
            {doctors.map((d) =>
              state.schedules
                .filter((s) => s.doctorId === d.id && s.branchId === branchId)
                .map((s) => (
                  <div className="schedule-row" key={s.id}>
                    <Avatar kind="doctor" entityId={d.id} initials={d.initials} color={d.color} />
                    <span>
                      <strong>{d.name}</strong>
                      <small>
                        {state.specializations.find((p) => p.id === d.specializationId)?.name}
                      </small>
                    </span>
                    <div className="schedule-days">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                        <span
                          key={i}
                          className={s.days.includes(i) ? 'on' : ''}
                          title={
                            [
                              'Sunday',
                              'Monday',
                              'Tuesday',
                              'Wednesday',
                              'Thursday',
                              'Friday',
                              'Saturday',
                            ][i]
                          }
                        >
                          {day}
                        </span>
                      ))}
                    </div>
                    <strong>
                      {displayTime(s.start)} – {displayTime(s.end)}
                    </strong>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setForm({ kind: 'schedule', id: d.id })}
                    >
                      Edit
                    </Button>
                  </div>
                )),
            )}
          </Panel>
          <Panel title="Doctor leave" className="spaced-panel">
            {state.leaves.length ? (
              state.leaves.map((l) => (
                <div className="schedule-row" key={l.id}>
                  <CalendarDays size={22} />
                  <span>
                    <strong>{state.doctors.find((d) => d.id === l.doctorId)?.name}</strong>
                    <small>{l.reason}</small>
                  </span>
                  <span>
                    {displayDate(l.startDate)} – {displayDate(l.endDate)}
                  </span>
                  <span className="specialty-pill">Unavailable</span>
                </div>
              ))
            ) : (
              <Empty title="No leave recorded" text="Your care team is on its regular schedule." />
            )}
          </Panel>
        </>
      )}
      {section === 'fees' && (
        <Panel
          title="Consultation fees"
          subtitle="Set free or paid consultations per doctor and branch. Existing bookings keep their quoted fee."
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>DOCTOR</th>
                  <th>BRANCH</th>
                  <th>CONSULTATION FEE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {state.assignments
                  .filter((a) => a.branchId === branchId)
                  .map((a) => (
                    <tr key={a.doctorId}>
                      <td>
                        <strong>{state.doctors.find((d) => d.id === a.doctorId)?.name}</strong>
                      </td>
                      <td>{state.branches.find((b) => b.id === a.branchId)?.name}</td>
                      <td>{money(a.fee)}</td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setForm({ kind: 'fee', id: a.doctorId })}
                        >
                          Edit fee
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="info-note">
            Consultation charges are recorded with each appointment. Payment processing is not
            enabled.
          </div>
        </Panel>
      )}
      {section === 'activity' && (
        <Panel title="Activity & audit trail" subtitle="Authorized clinic activity">
          <div className="table-toolbar">
            <SearchBox value={query} onChange={setQuery} placeholder="Search activity…" />
          </div>
          <div className="activity-list audit-list">
            {state.audit
              .filter((a) => a.action.toLowerCase().includes(query.toLowerCase()))
              .map((a) => (
                <div className="activity-item" key={a.id}>
                  <span className="activity-symbol avatar-purple">
                    <ShieldCheck size={17} />
                  </span>
                  <div>
                    <strong>{a.action}</strong>
                    <p>{state.profiles.find((p) => p.id === a.actorId)?.name ?? a.actorId}</p>
                    <small>{a.time}</small>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      )}
      {form && <AdminForm kind={form.kind} id={form.id} onClose={() => setForm(null)} />}
    </>
  );
}

export function Notifications({ onAppointment }: { onAppointment: (id: string) => void }) {
  const { state, actor, act, clinic, role, refresh, setBranchId } = useClinic();
  const [filter, setFilter] = useState('All');
  // Opening the notification panel forces a fresh authorized snapshot so
  // onboarding notices created in another session appear without a page reload.
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  const list = state.notifications.filter(
    (n) => n.recipientIds.includes(actor.id) && (filter === 'All' || !n.readBy.includes(actor.id)),
  );
  return (
    <Panel
      title="Your clinic, in the loop"
      subtitle="Updates from your clinic and care team."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => act(() => clinic.markRead(actor), 'Notifications marked as read.')}
        >
          <CheckCheck size={16} />
          Mark all as read
        </Button>
      }
    >
      <div className="tabs">
        {['All', 'Unread'].map((t) => (
          <button className={filter === t ? 'active' : ''} key={t} onClick={() => setFilter(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="notifications-list">
        {list.map((n) => {
          const branch = n.branchId ? state.branches.find((b) => b.id === n.branchId) : undefined;
          const doctor = n.doctorId ? state.doctors.find((d) => d.id === n.doctorId) : undefined;
          const specialization = doctor
            ? state.specializations.find((s) => s.id === doctor.specializationId)?.name
            : undefined;
          return (
            <article
              key={n.id}
              className={`notification-row ${!n.readBy.includes(actor.id) ? 'unread' : ''}`}
            >
              <span className="stat-icon avatar-purple">
                <Bell size={20} />
              </span>
              <div>
                <h3>
                  {role === 'admin' && n.doctorId ? (
                    <WorkspaceLink
                      className="notification-title"
                      href={`/admin/doctors/${n.doctorId}`}
                      onClick={() => {
                        if (n.branchId) setBranchId(n.branchId);
                      }}
                    >
                      {n.title}
                    </WorkspaceLink>
                  ) : (
                    n.title
                  )}
                </h3>
                <p>{n.message}</p>
                <small>
                  {n.time} · {n.kind}
                  {branch && <> · {branch.name}</>}
                  {specialization && <> · {specialization}</>}
                </small>
              </div>
              {!n.readBy.includes(actor.id) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="notification-read-button"
                  aria-label={`Mark "${n.title}" as read`}
                  title="Mark as read"
                  onClick={() =>
                    act(
                      () => clinic.markNotificationRead(actor, n.id),
                      'Notification marked as read.',
                    )
                  }
                >
                  <Check size={16} />
                </Button>
              )}
              {n.appointmentId && (
                <Button variant="ghost" size="sm" onClick={() => onAppointment(n.appointmentId!)}>
                  View
                  <ChevronRight size={15} />
                </Button>
              )}
              {n.doctorId && role === 'admin' && (
                <WorkspaceLink
                  className="text-link"
                  href={`/admin/doctors/${n.doctorId}`}
                  onClick={() => {
                    if (n.branchId) setBranchId(n.branchId);
                  }}
                >
                  View Doctor <ChevronRight size={15} />
                </WorkspaceLink>
              )}
            </article>
          );
        })}
        {!list.length && (
          <Empty
            title="You're all caught up"
            text="New updates from your clinic will appear here."
          />
        )}
      </div>
      <div className="info-note">
        Clinic notifications refresh automatically while this workspace is open.
      </div>
    </Panel>
  );
}
