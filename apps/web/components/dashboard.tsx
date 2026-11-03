'use client';
import { useState } from 'react';
import { DoctorDashboard } from './doctor-dashboard';
import { AdminDashboard } from './admin-dashboard';
import { WorkspaceLink } from './workspace-route';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CalendarCheck2,
  ChevronRight,
  FileHeart,
  HeartPulse,
  MapPin,
  Stethoscope,
  Users,
  ClipboardList,
  Download,
} from 'lucide-react';
import {
  appointmentsFor,
  displayDate,
  displayTime,
  money,
  patientAgeLabel,
  statusLabels,
  patientIdLabel,
} from '@sro/clinic-core';
import { canViewPatient } from '@sro/permissions';
import { CLINIC_TODAY as DEMO_DATE } from '@/lib/clinical-clock';
import type { Appointment } from '@sro/types';
import { useClinic } from './clinic-context';
import { Avatar, Badge, Button, Empty, Panel, SearchBox, Stat } from './ui';
export function AppointmentTable({
  appointments,
  onAppointment,
  compact = false,
}: {
  appointments: Appointment[];
  onAppointment: (id: string) => void;
  compact?: boolean;
}) {
  const { state, role } = useClinic();
  const showBranch = role === 'admin' && !compact;
  if (!appointments.length)
    return (
      <Empty
        title="No appointments found"
        text="Try another date or filter, or request a new appointment."
      />
    );
  return (
    <div className="table-scroll">
      <table className={`data-table ${compact ? 'compact-table' : ''}`}>
        <thead>
          <tr>
            <th>TIME & DATE</th>
            <th>{role === 'patient' ? 'DOCTOR' : 'PATIENT'}</th>
            {!compact && <th>{role === 'patient' ? 'VISIT TYPE' : 'DOCTOR'}</th>}
            {showBranch && <th>BRANCH</th>}
            <th>STATUS</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => {
            const p = state.patients.find((p) => p.id === a.patientId)!;
            const d = state.doctors.find((d) => d.id === a.doctorId)!;
            return (
              <tr key={a.id} data-appointment-id={a.id}>
                <td>
                  <strong>{displayTime(a.time)}</strong>
                  <small>
                    {compact
                      ? `${a.duration} min · ${a.type === 'remote' ? 'Remote' : 'Clinic visit'}`
                      : displayDate(a.date)}
                  </small>
                </td>
                <td>
                  <div className="person-cell">
                    <Avatar
                      kind={role === 'patient' ? 'doctor' : 'patient'}
                      entityId={role === 'patient' ? d.id : p?.id}
                      initials={role === 'patient' ? d.initials : (p?.initials ?? '—')}
                      color={role === 'patient' ? d.color : 'blue'}
                    />
                    <span>
                      <strong>
                        {role === 'patient'
                          ? d.name
                          : (p?.name ?? 'Patient details available after approval')}
                      </strong>
                      <small>
                        {role !== 'patient' && p && <>{patientIdLabel(p)} · </>}
                        {role === 'patient'
                          ? state.specializations.find((s) => s.id === d.specializationId)?.name
                          : a.reason}
                      </small>
                    </span>
                  </div>
                </td>
                {!compact && (
                  <td>
                    <strong>
                      {role === 'patient'
                        ? a.type === 'physical'
                          ? 'Physical visit'
                          : 'Remote consultation'
                        : d.name}
                    </strong>
                    <small>
                      {role === 'patient'
                        ? money(a.fee)
                        : state.specializations.find((s) => s.id === d.specializationId)?.name}
                    </small>
                  </td>
                )}
                {showBranch && (
                  <td data-label="Branch">
                    <span className="appointment-branch-cell">
                      {state.branches.find((b) => b.id === a.branchId)?.name ?? 'Not recorded'}
                    </span>
                  </td>
                )}
                <td>
                  <Badge status={a.status} />
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`View appointment for ${p?.name ?? 'patient'} at ${displayTime(a.time)}`}
                    onClick={() => onAppointment(a.id)}
                  >
                    View
                    <ChevronRight size={14} />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function Dashboard(props: { onAppointment: (id: string) => void; onBook: () => void }) {
  const { role } = useClinic();
  if (role === 'admin')
    return (
      <AdminDashboard
        {...props}
        renderAppointments={(items) => (
          <AppointmentTable appointments={items} onAppointment={props.onAppointment} compact />
        )}
      />
    );
  return role === 'doctor' ? <DoctorDashboard {...props} /> : <LegacyDashboard {...props} />;
}
function LegacyDashboard({
  onAppointment,
  onBook,
}: {
  onAppointment: (id: string) => void;
  onBook: () => void;
}) {
  const { state, actor, branchId, role } = useClinic();
  const adminView = role === 'admin';
  const [dashboardScope, setDashboardScope] = useState('all');
  const authorizedBranches = state.branches.filter(
    (b) => b.active && actor.branchIds.includes(b.id),
  );
  const authorizedBranchIds = new Set(authorizedBranches.map((b) => b.id));
  const selectedScope = adminView
    ? dashboardScope === 'all' || authorizedBranchIds.has(dashboardScope)
      ? dashboardScope
      : 'all'
    : branchId;
  const scopedBranches = adminView
    ? selectedScope === 'all'
      ? authorizedBranches
      : authorizedBranches.filter((b) => b.id === selectedScope)
    : state.branches.filter((b) => b.id === branchId);
  const scopeBranchIds = new Set(scopedBranches.map((b) => b.id));
  const scopeLabel = adminView
    ? selectedScope === 'all'
      ? 'All Authorized Branches'
      : (authorizedBranches.find((b) => b.id === selectedScope)?.name ?? 'Authorized branch')
    : (state.branches.find((b) => b.id === branchId)?.name ?? 'selected branch');
  const ownAppointments = appointmentsFor(state, actor);
  const appointments = ownAppointments.filter((a) => scopeBranchIds.has(a.branchId));
  const today = appointments
    .filter((a) => a.date === DEMO_DATE)
    .sort((a, b) => a.time.localeCompare(b.time));
  const pending = appointments.filter((a) =>
    ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status),
  );
  const scopedPatients = adminView
    ? state.patients.filter((p) => scopeBranchIds.has(p.branchId))
    : state.patients;
  const adminCareTeam = adminView
    ? state.doctors
        .map((d) => ({
          doctor: d,
          branches: [
            ...new Set(
              state.assignments
                .filter((a) => a.doctorId === d.id && a.active && scopeBranchIds.has(a.branchId))
                .map((a) => state.branches.find((b) => b.id === a.branchId)?.name)
                .filter((name): name is string => Boolean(name)),
            ),
          ],
        }))
        .filter((entry) => entry.branches.length > 0)
        .sort((a, b) => a.doctor.name.localeCompare(b.doctor.name))
    : [];
  const confirmedToday = today.filter((a) => a.status === 'confirmed');
  const activeToday = today.filter((a) =>
    ['in_consultation', 'checked_in', 'completed'].includes(a.status),
  );
  const reviewToday = today.filter(
    (a) => !['confirmed', 'in_consultation', 'checked_in', 'completed'].includes(a.status),
  );
  const confirmedShare = (confirmedToday.length / (today.length || 1)) * 100;
  const activeShare = confirmedShare + (activeToday.length / (today.length || 1)) * 100;
  const notifications = state.notifications.filter((n) => n.recipientIds.includes(actor.id));
  const href = (section: string) => `/${role}/${section}`;
  const myPatients =
    role === 'doctor'
      ? state.patients
          .filter((p) => canViewPatient(actor, p.id, state))
          .map((patient) => ({
            patient,
            latest: ownAppointments
              .filter((a) => a.patientId === patient.id)
              .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))[0],
          }))
          .sort(
            (a, b) =>
              (b.latest ? `${b.latest.date}${b.latest.time}` : '').localeCompare(
                a.latest ? `${a.latest.date}${a.latest.time}` : '',
              ) || a.patient.name.localeCompare(b.patient.name),
          )
      : [];
  return (
    <div className="dashboard">
      {adminView && (
        <div className="dashboard-scope">
          <span className="dashboard-scope-icon">
            <Building2 size={18} />
          </span>
          <div className="dashboard-scope-copy">
            <strong>Dashboard scope</strong>
            <small>Independent of the topbar clinic</small>
          </div>
          <label className="directory-scope">
            <span>Branch</span>
            <select
              aria-label="Filter dashboard by branch"
              value={selectedScope}
              onChange={(e) => setDashboardScope(e.target.value)}
            >
              <option value="all">All Authorized Branches</option>
              {authorizedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {role === 'patient' ? (
        <div className="quick-actions">
          {[
            {
              title: 'Book appointment',
              text: 'Find a time for your care',
              icon: CalendarDays,
              color: 'green',
              click: onBook,
            },
            {
              title: 'Find a doctor',
              text: 'Meet your care team',
              icon: Stethoscope,
              color: 'blue',
              href: href('doctors'),
            },
            {
              title: 'Medical records',
              text: 'Your health, organized',
              icon: FileHeart,
              color: 'orange',
              href: href('records'),
            },
            {
              title: 'Prescriptions',
              text: 'Review your care plan',
              icon: ClipboardList,
              color: 'purple',
              href: href('prescriptions'),
            },
          ].map((a) => (
            <div className="quick-action" key={a.title}>
              <span className={`stat-icon avatar-${a.color}`}>
                <a.icon size={23} />
              </span>
              {a.href ? (
                <WorkspaceLink href={a.href}>
                  {a.title}
                  <ArrowUpRight size={16} />
                </WorkspaceLink>
              ) : (
                <button onClick={a.click}>
                  {a.title}
                  <ArrowUpRight size={16} />
                </button>
              )}
              <p>{a.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="stats-grid">
          <Stat
            label={adminView ? 'Registered patients' : "Today's appointments"}
            value={adminView ? scopedPatients.length : today.length}
            icon={adminView ? Users : CalendarDays}
            color="green"
            detail={adminView ? `Registered at ${scopeLabel}` : 'Your care schedule today'}
          />
          <Stat
            label={adminView ? 'Active doctors' : 'Completed visits'}
            value={
              adminView
                ? adminCareTeam.length
                : appointments.filter((a) => a.status === 'completed').length
            }
            icon={Stethoscope}
            color="blue"
            detail={adminView ? `On roster at ${scopeLabel}` : 'Consultations documented'}
          />
          <Stat
            label="Awaiting approval"
            value={pending.length}
            icon={CalendarCheck2}
            color="orange"
            detail={adminView ? `Requests in ${scopeLabel}` : 'Requests that need your attention'}
          />
          <Stat
            label={adminView ? "Today's appointments" : 'Upcoming follow-ups'}
            value={adminView ? today.length : today.filter((a) => /follow/i.test(a.reason)).length}
            icon={CalendarDays}
            color="purple"
            detail={
              adminView
                ? `${confirmedToday.length} confirmed · ${activeToday.length} in progress in ${scopeLabel}`
                : 'Continuity of care matters'
            }
          />
        </div>
      )}
      {role === 'patient' && (
        <div className="patient-welcome">
          <div>
            <span className="eyebrow">YOUR NEXT STEP TO BETTER HEALTH</span>
            <h2>A little care goes a long way.</h2>
            <p>Book a visit, keep your records together, and stay connected with your doctor.</p>
            <Button variant="outline" onClick={onBook}>
              Find your next appointment
              <ArrowRight size={16} />
            </Button>
          </div>
          <HeartPulse size={100} strokeWidth={0.8} />
        </div>
      )}
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <Panel
            title={role === 'patient' ? 'Your appointments' : "Today's appointments"}
            subtitle={
              role === 'patient'
                ? 'Your upcoming care, all in one place'
                : adminView
                  ? `${displayDate(DEMO_DATE)} · ${state.organization.timezone} · ${scopeLabel}`
                  : `${displayDate(DEMO_DATE)} · ${state.organization.timezone}`
            }
            action={
              <WorkspaceLink className="text-link" href={href('appointments')}>
                View all
                <ArrowRight size={14} />
              </WorkspaceLink>
            }
          >
            <AppointmentTable
              appointments={role === 'patient' || adminView ? today : today.slice(0, 7)}
              onAppointment={onAppointment}
              compact={!adminView}
            />
          </Panel>
          <Panel
            title={
              role === 'patient'
                ? 'Your recent care'
                : role === 'doctor'
                  ? 'My Patients'
                  : 'Your care team'
            }
            subtitle={
              role === 'patient'
                ? 'A connected picture of your health'
                : role === 'doctor'
                  ? 'Patients assigned to your care.'
                  : `${adminCareTeam.length} active doctors · ${scopeLabel}`
            }
            action={
              <WorkspaceLink
                className="text-link"
                href={href(role === 'admin' ? 'doctors' : 'records')}
              >
                {role === 'doctor' ? 'View all' : 'Explore'}
                <ArrowRight size={14} />
              </WorkspaceLink>
            }
          >
            {role === 'doctor' ? (
              myPatients.length ? (
                <div className="my-patients">
                  {myPatients.map(({ patient: p, latest }) => (
                    <article className="my-patient" key={p.id}>
                      <Avatar kind="patient" entityId={p.id} initials={p.initials} color="blue" />
                      <div className="my-patient-copy">
                        <strong>{p.name}</strong>
                        <small>
                          {patientIdLabel(p)} · {patientAgeLabel(p)}
                        </small>
                        <div className="my-patient-status">
                          {latest ? (
                            <>
                              <Badge status={latest.status} />
                              <small>{displayDate(latest.date)}</small>
                            </>
                          ) : (
                            <small className="muted">No visits yet</small>
                          )}
                        </div>
                      </div>
                      <WorkspaceLink
                        className="text-link my-patient-link"
                        href={href(`records/${p.id}`)}
                      >
                        View Record
                        <ChevronRight size={14} />
                      </WorkspaceLink>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No patients assigned yet."
                  text="Patients you see for appointments or who authorize your care will appear here."
                />
              )
            ) : role === 'patient' ? (
              <div className="care-team">
                {state.consultations
                  .filter((c) => c.patientId === actor.patientId)
                  .map((c) => (
                    <WorkspaceLink key={c.id} className="care-team-member" href={href('records')}>
                      <span className="stat-icon avatar-green">
                        <FileHeart size={22} />
                      </span>
                      <span>
                        <strong>
                          {state.specializations.find(
                            (s) =>
                              s.id ===
                              state.doctors.find((d) => d.id === c.doctorId)?.specializationId,
                          )?.name ?? 'Consultation'}
                        </strong>
                        <small>{displayDate(c.date)}</small>
                      </span>
                      <Badge status="completed" />
                    </WorkspaceLink>
                  ))}
              </div>
            ) : adminCareTeam.length ? (
              <div className="admin-care-team">
                {adminCareTeam.map(({ doctor: d, branches }) => (
                  <article className="admin-care-member" key={d.id} data-doctor-id={d.id}>
                    <div className="admin-care-identity">
                      <Avatar kind="doctor" entityId={d.id} initials={d.initials} color={d.color} />
                      <div>
                        <strong>{d.name}</strong>
                        <small>
                          {state.specializations.find((s) => s.id === d.specializationId)?.name ??
                            'General practice'}
                        </small>
                      </div>
                    </div>
                    <div className="admin-care-branches">
                      <MapPin size={12} aria-hidden="true" />
                      {branches.map((name) => (
                        <span key={name}>{name}</span>
                      ))}
                    </div>
                    <div className="admin-care-footer">
                      <span className="availability-label">
                        <span />
                        On clinic roster
                      </span>
                      <WorkspaceLink
                        className="text-link admin-care-link"
                        href={href(`doctors/${d.id}`)}
                      >
                        View Profile
                        <ChevronRight size={13} />
                      </WorkspaceLink>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title="No active doctors in this scope"
                text="Choose another branch or review doctor assignments."
              />
            )}
          </Panel>
        </div>
        <div className="dashboard-secondary">
          {role !== 'patient' && (
            <Panel
              title="Appointment overview"
              subtitle={adminView ? `Today · ${scopeLabel}` : "Today's clinic activity"}
            >
              <div className="overview-chart">
                <div
                  className="donut"
                  style={{
                    background: today.length
                      ? `conic-gradient(#3e2986 0 ${confirmedShare}%, #13a36a ${confirmedShare}% ${activeShare}%, #e9b75f ${activeShare}% 100%)`
                      : '#eceaf3',
                  }}
                >
                  <div>
                    <strong>{today.length}</strong>
                    <span>appointments</span>
                  </div>
                </div>
                <div className="chart-legend">
                  {[
                    ['Confirmed', confirmedToday.length, 'purple'],
                    ['Active / completed', activeToday.length, 'green'],
                    ['Needs review', reviewToday.length, 'orange'],
                  ].map(([label, count, color]) => (
                    <div key={label as string}>
                      <span className={`legend-dot ${color}`} />
                      {label}
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}
          {role !== 'patient' && (
            <WorkspaceLink href={href('approvals')} className="approval-banner">
              <span className="stat-icon avatar-orange">
                <CalendarCheck2 size={22} />
              </span>
              <div>
                <strong>{pending.length} requests need a review</strong>
                <p>Help patients plan their next visit.</p>
              </div>
              <ArrowRight size={18} />
            </WorkspaceLink>
          )}
          <Panel
            title={role === 'patient' ? 'Your health updates' : 'Recent activity'}
            subtitle={adminView ? 'Account-wide · independent of dashboard scope' : undefined}
            action={
              <WorkspaceLink className="text-link" href={href('notifications')}>
                See all
              </WorkspaceLink>
            }
          >
            <div className="activity-list">
              {notifications.slice(0, 4).map((n, i) => (
                <div key={n.id} className="activity-item">
                  <span
                    className={`activity-symbol avatar-${['purple', 'green', 'blue', 'orange'][i % 4]}`}
                  >
                    {i % 2 === 0 ? <CalendarDays size={16} /> : <FileHeart size={16} />}
                  </span>
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                    <small>{n.time}</small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="community-card">
            <span className="eyebrow">CARE WITH A PURPOSE</span>
            <h3>
              Healthcare for a<br />
              better tomorrow.
            </h3>
            <p>Social Responsibility Organization</p>
            <span className="community-line" />
          </div>
        </div>
      </div>
    </div>
  );
}
export function Appointments({
  approvals,
  onAppointment,
}: {
  approvals: boolean;
  onAppointment: (id: string) => void;
}) {
  const { state, actor, branchId, role } = useClinic();
  const adminView = role === 'admin';
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('all');
  const [scope, setScope] = useState('all');
  const [view, setView] = useState<'list' | 'week'>('list');
  const [sort, setSort] = useState('time');
  const authorizedBranches = state.branches.filter(
    (b) => b.active && actor.branchIds.includes(b.id),
  );
  const authorizedBranchIds = new Set(authorizedBranches.map((b) => b.id));
  const selectedScope = adminView
    ? scope === 'all' || authorizedBranchIds.has(scope)
      ? scope
      : 'all'
    : branchId;
  const visibleBranches = adminView
    ? selectedScope === 'all'
      ? authorizedBranches
      : authorizedBranches.filter((b) => b.id === selectedScope)
    : state.branches.filter((b) => b.id === branchId);
  const visibleBranchIds = new Set(visibleBranches.map((b) => b.id));
  const all = appointmentsFor(state, actor).filter(
    (a) =>
      visibleBranchIds.has(a.branchId) &&
      (!approvals ||
        ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status)),
  );
  const filtered = all
    .filter(
      (a) =>
        (!date || a.date === date) &&
        (status === 'all' || a.status === status) &&
        `${state.patients.find((p) => p.id === a.patientId)?.name} ${patientIdLabel(state.patients.find((p) => p.id === a.patientId))} ${state.doctors.find((d) => d.id === a.doctorId)?.name} ${a.reason}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? (state.patients.find((p) => p.id === a.patientId)?.name ?? '').localeCompare(
            state.patients.find((p) => p.id === b.patientId)?.name ?? '',
          )
        : `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
    );
  const exportCsv = () => {
    const rows = [
      ['Appointment', 'Date', 'Time', 'Patient', 'Patient ID', 'Doctor', 'Status'],
      ...filtered.map((a) => [
        a.id,
        a.date,
        a.time,
        state.patients.find((p) => p.id === a.patientId)?.name ?? 'Restricted patient',
        state.patients.some((p) => p.id === a.patientId)
          ? patientIdLabel(state.patients.find((p) => p.id === a.patientId))
          : 'Restricted patient',
        state.doctors.find((d) => d.id === a.doctorId)!.name,
        statusLabels[a.status],
      ]),
    ];
    const blob = new Blob(
      [rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\r\n')],
      { type: 'text/csv' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sro-appointments.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel
      title={approvals ? 'Appointment requests' : 'Appointment calendar'}
      subtitle={`${all.length} ${approvals ? 'requests awaiting your decision' : 'appointments in this workspace'}`}
      action={
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={15} />
          Export CSV
        </Button>
      }
    >
      <div className="table-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search patient or doctor…" />
        {adminView && (
          <label className="directory-scope">
            <span>Branch</span>
            <select
              aria-label="Filter appointments by branch"
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
        <input
          aria-label="Filter appointment date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          aria-label="Filter appointment status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort appointments"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="time">Sort by time</option>
          <option value="name">Sort by patient</option>
        </select>
        <div className="segmented">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            List
          </button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>
            Week
          </button>
        </div>
      </div>
      {view === 'week' && (
        <div className="week-strip">
          {Array.from({ length: 7 }, (_, i) => {
            const day = new Date((date || DEMO_DATE) + 'T12:00:00');
            day.setDate(day.getDate() - day.getDay() + 1 + i);
            const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            return (
              <button
                key={value}
                onClick={() => setDate(value)}
                className={date === value ? 'selected' : ''}
              >
                <small>{day.toLocaleDateString('en', { weekday: 'short' })}</small>
                <strong>{day.getDate()}</strong>
                <span>{all.filter((a) => a.date === value).length} visits</span>
              </button>
            );
          })}
        </div>
      )}
      <AppointmentTable appointments={filtered} onAppointment={onAppointment} />
      <div className="table-footer">
        <span>Showing {filtered.length} appointments</span>
        <span>All times in Asia/Karachi</span>
      </div>
    </Panel>
  );
}
