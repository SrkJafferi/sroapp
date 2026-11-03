'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  ArrowRight,
  Baby,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Ear,
  Eye,
  FileHeart,
  Heart,
  Smile,
  Sparkles,
  Stethoscope,
  Sun,
  Users,
  UserPlus,
  Wind,
} from 'lucide-react';
import { displayDate, displayTime, patientAgeLabel } from '@sro/clinic-core';
import { canViewPatient } from '@sro/permissions';
import type { Appointment } from '@sro/types';
import {
  doctorDashboardData,
  shiftDay,
  specialtyContent,
  statusGroup,
} from '@/lib/doctor-dashboard';
import { localParts } from '@/lib/clinical-clock';
import { useClinic } from './clinic-context';
import { WorkspaceLink } from './workspace-route';
import { AdminForm } from './admin-forms';
import { Avatar, Badge, Button, Empty, Panel } from './ui';

export function DoctorDashboard({
  onAppointment,
  onBook,
}: {
  onAppointment: (id: string) => void;
  onBook: () => void;
}) {
  const { state, actor, branchId } = useClinic();
  const [clock, setClock] = useState(() => localParts(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClock(localParts(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [selection, setSelection] = useState<string | null>(null);
  const [register, setRegister] = useState(false);
  const selected = selection ?? clock.date;
  const doctor = state.doctors.find((d) => d.id === actor.doctorId);
  const department =
    state.specializations.find((s) => s.id === doctor?.specializationId)?.name ?? 'Your care team';
  const specialty = specialtyContent(department);
  const Theme = {
    stethoscope: Stethoscope,
    sparkles: Sparkles,
    baby: Baby,
    heart: Heart,
    activity: Activity,
    ear: Ear,
    eye: Eye,
    smile: Smile,
    wind: Wind,
  }[specialty.theme];
  const model = doctorDashboardData(state, actor, branchId, clock.date);
  const hour = Number(clock.time.slice(0, 2));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const weekStart = shiftDay(selected, -new Date(selected + 'T12:00:00Z').getUTCDay());
  const calendar = model.appointments.filter((a) => a.date === selected);
  const groups = [
    'In consultation',
    'Follow-up scheduled',
    'Completed',
    'Cancelled / unavailable',
    'Scheduled / awaiting review',
  ];
  const colors = ['#5692fc', '#ffba49', '#2ab67a', '#f16b80', '#b5a1e2'];
  const counts = groups.map((g) => model.today.filter((a) => statusGroup(a) === g).length);
  let offset = 0;
  const segments = counts.map((count, i) => {
    const from = offset;
    offset += (count / (model.today.length || 1)) * 100;
    return `${colors[i]} ${from}% ${offset}%`;
  });
  const activity = [
    ...model.patients
      .filter((p) => p.registeredAt)
      .map((p) => ({
        id: 'patient-' + p.id,
        title: 'Patient registered',
        context: `${p.name} · ${p.patientCode ?? 'Patient'}`,
        time: p.registeredAt!,
        patient: p.id,
      })),
    ...model.encounters
      .filter((c) => c.recordedAt)
      .map((c) => ({
        id: 'consultation-' + c.id,
        title: 'Consultation signed',
        context: state.patients.find((p) => p.id === c.patientId)?.name ?? 'Patient',
        time: c.recordedAt!,
        patient: c.patientId,
      })),
  ]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 4);
  const viewAll = (href: string) => (
    <WorkspaceLink className="text-link" href={href}>
      View all <ArrowRight size={15} />
    </WorkspaceLink>
  );
  const appointmentRow = (a: Appointment, mini = false) => {
    const p = state.patients.find((p) => p.id === a.patientId);
    return (
      <div className={`dd-appointment ${mini ? 'dd-mini-appointment' : ''}`} key={a.id}>
        <div className="dd-time">
          <strong>{displayTime(a.time)}</strong>
          <small>{a.duration} min</small>
        </div>
        {!mini && (
          <Avatar kind="patient" entityId={p?.id} initials={p?.initials ?? '—'} color="blue" />
        )}
        <div className="dd-person">
          <strong>{p?.name ?? 'Patient details restricted'}</strong>
          {!mini && (
            <>
              <small>
                {p?.patientCode ?? 'ID not available'}
                {p && ` · ${patientAgeLabel(p)} · ${p.gender}`}
              </small>
              <span className="dd-reason">{a.reason || 'Clinic visit'}</span>
            </>
          )}
        </div>
        <Badge status={a.status} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAppointment(a.id)}
          aria-label={`View appointment at ${displayTime(a.time)} for ${p?.name ?? 'patient'}`}
        >
          {mini ? (
            <ChevronRight size={15} />
          ) : (
            <>
              View <ChevronRight size={15} />
            </>
          )}
        </Button>
      </div>
    );
  };
  return (
    <div className="doctor-dashboard" data-specialty={specialty.key}>
      <h1 className="sr-only">Doctor Dashboard</h1>
      <section className="dd-welcome" aria-label="Your clinic overview">
        <div className="dd-intro">
          <Sun size={31} className="dd-sun" />
          <div>
            <h2>
              {greeting}, {doctor?.name ?? actor.name} <span aria-hidden="true">👋</span>
            </h2>
            <p>
              Here’s your clinic overview for today. You have {model.today.length} appointments and{' '}
              {model.today.filter((a) => a.status === 'in_consultation').length} in consultation.
            </p>
            <div className="dd-chips">
              <span>
                <Theme size={14} />
                {department}
              </span>
              <span>
                <Building2 size={14} />
                {state.branches.find((b) => b.id === branchId)?.name ?? 'Authorized clinic'}
              </span>
              <span>
                <CalendarDays size={14} />
                {displayDate(clock.date)}
              </span>
              <span>
                <Clock3 size={14} />
                Asia/Karachi
              </span>
            </div>
          </div>
        </div>
        {/* Generic decorative illustration, never presented as the authenticated Doctor's likeness. */}
        <Image
          width={400}
          height={480}
          priority
          sizes="240px"
          className="dd-illustration"
          src="/doctor-dashboard-clinician.png"
          alt=""
          aria-hidden="true"
        />
        <blockquote>
          <span aria-hidden="true">“</span>
          <strong>{specialty.quote}</strong>
          <p>Care today for a brighter tomorrow.</p>
          <Theme size={22} aria-hidden="true" />
        </blockquote>
      </section>
      <div className="dd-kpis">
        {[
          {
            label: "Today's appointments",
            value: model.today.length,
            text: 'Your schedule for today',
            Icon: CalendarDays,
            color: 'purple',
          },
          {
            label: 'My patients',
            value: model.patients.length,
            text: 'Patients under your care',
            Icon: Users,
            color: 'green',
          },
          {
            label: 'Completed visits',
            value: model.encounters.length,
            text: 'Signed consultations',
            Icon: Stethoscope,
            color: 'blue',
          },
          {
            label: 'Awaiting follow-ups',
            value: model.followUps,
            text: 'Follow-up plans awaiting a return visit',
            Icon: Clock3,
            color: 'amber',
          },
        ].map(({ label, value, text, Icon, color }) => (
          <article className="dd-kpi" key={label}>
            <span className={`dd-icon ${color}`}>
              <Icon size={25} />
            </span>
            <div>
              <h3>{label}</h3>
              <strong>{value}</strong>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="dd-schedule-grid">
        <Panel
          title="Today's Appointments"
          subtitle={`${displayDate(clock.date)} · Asia/Karachi`}
          action={viewAll('/doctor/appointments')}
          className="dd-appointments"
        >
          <div className="dd-section-icon">
            <CalendarDays size={21} />
          </div>
          {model.today.length ? (
            model.today.map((a) => appointmentRow(a))
          ) : (
            <Empty title="Your day has room for care" text="No appointments scheduled for today." />
          )}
        </Panel>
        <Panel
          className="dd-calendar"
          title="Mini Calendar"
          action={
            <div className="dd-calendar-controls">
              <Button variant="ghost" size="sm" onClick={() => setSelection(clock.date)}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous week"
                onClick={() => setSelection(shiftDay(selected, -7))}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next week"
                onClick={() => setSelection(shiftDay(selected, 7))}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          }
        >
          <span className="dd-panel-icon">
            <CalendarDays size={21} />
          </span>
          <h3 className="dd-month">
            {new Intl.DateTimeFormat('en-GB', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(selected + 'T12:00:00Z'))}
          </h3>
          <div className="dd-week">
            {Array.from({ length: 7 }, (_, i) => {
              const date = shiftDay(weekStart, i),
                d = new Date(date + 'T12:00:00Z');
              return (
                <button
                  key={date}
                  onClick={() => setSelection(date)}
                  aria-label={displayDate(date)}
                  aria-pressed={selected === date}
                  className={selected === date ? 'selected' : ''}
                >
                  <small>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</small>
                  <strong>{d.getUTCDate()}</strong>
                  <i
                    className={
                      model.appointments.some((a) => a.date === date) ? 'has-appointments' : ''
                    }
                  />
                </button>
              );
            })}
          </div>
          <div className="dd-calendar-list" aria-live="polite">
            {calendar.length ? (
              calendar.map((a) => appointmentRow(a, true))
            ) : (
              <p className="dd-calendar-empty">No appointments on {displayDate(selected)}.</p>
            )}
          </div>
        </Panel>
      </div>
      <div className="dd-middle-grid">
        <Panel
          title="My Patients"
          className="dd-patient-panel"
          subtitle="Patients assigned to your care."
          action={viewAll('/doctor/patients')}
        >
          <span className="dd-panel-icon">
            <Users size={21} />
          </span>
          <div className="dd-patients">
            {model.patients.slice(0, 2).map((p) => {
              const latest = model.appointments.filter((a) => a.patientId === p.id).at(-1);
              return (
                <article key={p.id}>
                  <div className="dd-patient-top">
                    <Avatar kind="patient" entityId={p.id} initials={p.initials} color="blue" />
                    <div>
                      <strong>{p.name}</strong>
                      <small>{p.patientCode ?? 'ID not available'}</small>
                      <small>
                        {patientAgeLabel(p)} · {p.gender}
                      </small>
                      <div className="dd-patient-status">
                        {latest && (
                          <>
                            <Badge status={latest.status} />
                            <small>{displayDate(latest.date)}</small>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {canViewPatient(actor, p.id, state) ? (
                    <WorkspaceLink
                      className="btn btn-outline btn-sm"
                      href={`/doctor/records/${p.id}`}
                    >
                      View Record <ArrowRight size={16} />
                    </WorkspaceLink>
                  ) : (
                    <WorkspaceLink className="btn btn-outline btn-sm" href="/doctor/patients">
                      View patient <ArrowRight size={16} />
                    </WorkspaceLink>
                  )}
                </article>
              );
            })}
          </div>
          {!model.patients.length && (
            <Empty
              title="No assigned patients yet"
              text="Your authorized patients will appear here."
            />
          )}
        </Panel>
        <Panel title="Quick Actions" subtitle="Common tasks for your clinic." className="dd-quick">
          <span className="dd-panel-icon amber">
            <Sparkles size={21} />
          </span>
          <div className="dd-actions">
            <button onClick={onBook}>
              <span className="dd-icon purple">
                <CalendarDays size={23} />
              </span>
              <span>
                <strong>New Appointment</strong>
                <small>Schedule a patient</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setRegister(true)}>
              <span className="dd-icon blue">
                <UserPlus size={23} />
              </span>
              <span>
                <strong>Register Patient</strong>
                <small>Add to your clinic</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <WorkspaceLink href="/doctor/patients">
              <span className="dd-icon purple">
                <Users size={23} />
              </span>
              <span>
                <strong>View Patients</strong>
                <small>Access patient records</small>
              </span>
              <ChevronRight size={16} />
            </WorkspaceLink>
            <WorkspaceLink href="/doctor/records">
              <span className="dd-icon green">
                <FileHeart size={23} />
              </span>
              <span>
                <strong>Clinical Notes</strong>
                <small>Choose a patient record</small>
              </span>
              <ChevronRight size={16} />
            </WorkspaceLink>
          </div>
        </Panel>
      </div>
      <div className="dd-bottom-grid">
        <Panel
          title="Recent Activity"
          className="dd-activity-panel"
          subtitle="Latest updates from your clinic."
          action={viewAll('/doctor/notifications')}
        >
          <span className="dd-panel-icon">
            <Activity size={21} />
          </span>
          <div className="dd-activity">
            {activity.map((e) => (
              <div key={e.id}>
                <span className="dd-icon purple">
                  <Activity size={18} />
                </span>
                <div>
                  <strong>{e.title}</strong>
                  <p>{e.context}</p>
                  <time dateTime={e.time}>
                    {displayDate(localParts(e.time).date)} · {displayTime(localParts(e.time).time)}
                  </time>
                </div>
              </div>
            ))}
            {!activity.length && (
              <Empty
                title="No recent activity"
                text="Recorded patient registrations and signed consultations appear here."
              />
            )}
          </div>
        </Panel>
        <Panel title="Today's Patient Status" className="dd-status">
          <span className="dd-panel-icon">
            <Users size={21} />
          </span>
          <div
            className="dd-donut"
            role="img"
            aria-label={`${model.today.length} appointments. ${groups.map((g, i) => `${g}: ${counts[i]}`).join('. ')}`}
            style={{
              background: model.today.length ? `conic-gradient(${segments.join(',')})` : '#eeebf6',
            }}
          >
            <div>
              <strong>{model.today.length}</strong>
              <small>Total appointments</small>
            </div>
          </div>
          <div className="dd-legend">
            {groups.map((g, i) => (
              <div key={g}>
                <i style={{ background: colors[i] }} />
                {g}
                <strong>{counts[i]}</strong>
              </div>
            ))}
          </div>
        </Panel>
        <aside className="dd-purpose">
          <div>
            <Heart size={20} />
            <strong>Care with a purpose</strong>
          </div>
          <h3>{specialty.heading}</h3>
          <p>Compassionate care for a healthier tomorrow.</p>
          <Theme className="dd-purpose-symbol" size={100} strokeWidth={1} aria-hidden="true" />
          <svg className="dd-botanical" viewBox="0 0 100 170" aria-hidden="true">
            <path d="M50 165Q70 90 52 15" fill="none" stroke="#9a80cf" strokeWidth="3" />
            <path
              d="M55 75Q8 70 20 32Q57 39 55 75M59 110Q100 92 95 57Q56 66 59 110M53 148Q13 135 19 101Q57 113 53 148M52 40Q90 27 85 1Q50 9 52 40"
              fill="#9e83d1"
              opacity=".65"
            />
          </svg>
          <WorkspaceLink className="btn btn-primary" href="/doctor/patients">
            View Patient Insights <ArrowRight size={16} />
          </WorkspaceLink>
        </aside>
      </div>
      {register && <AdminForm kind="patient" onClose={() => setRegister(false)} />}
    </div>
  );
}
