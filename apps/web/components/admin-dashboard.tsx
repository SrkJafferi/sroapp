'use client';
import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  FileHeart,
  HeartPulse,
  MapPin,
  Plus,
  Stethoscope,
  Users,
} from 'lucide-react';
import { appointmentsFor, displayDate } from '@sro/clinic-core';
import type { Appointment } from '@sro/types';
import { CLINIC_TODAY, localParts } from '@/lib/clinical-clock';
import { useClinic } from './clinic-context';
import { WorkspaceLink } from './workspace-route';
import { Avatar, Button } from './ui';
import styles from './admin-dashboard.module.css';

function Sparkline({ values, label, color }: { values: number[]; label: string; color: string }) {
  const max = Math.max(1, ...values);
  const points = values.map((value, i) => `${i * 12},${29 - (value / max) * 25}`).join(' ');
  return (
    <svg
      className={styles.sparkline}
      viewBox="0 0 74 34"
      role="img"
      aria-label={`${label}: ${values.join(', ')}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AdminDashboard({
  onBook,
  onAppointment,
  renderAppointments,
}: {
  onBook: () => void;
  onAppointment: (id: string) => void;
  renderAppointments: (items: Appointment[]) => ReactNode;
}) {
  const { state, actor, timezone } = useClinic();
  const [scope, setScope] = useState('all');
  const [period, setPeriod] = useState('today');
  const branches = state.branches.filter((b) => b.active && actor.branchIds.includes(b.id));
  const selectedScope = scope === 'all' || branches.some((b) => b.id === scope) ? scope : 'all';
  const visibleBranches = branches.filter((b) => selectedScope === 'all' || b.id === selectedScope);
  const branchIds = new Set(visibleBranches.map((b) => b.id));
  const scopeLabel =
    selectedScope === 'all'
      ? 'All Authorized Branches'
      : (visibleBranches[0]?.name ?? 'Authorized branch');
  const appointments = appointmentsFor(state, actor).filter((a) => branchIds.has(a.branchId));
  const patients = state.patients.filter((p) => branchIds.has(p.branchId));
  const doctors = state.doctors
    .filter((d) =>
      state.assignments.some((a) => a.active && a.doctorId === d.id && branchIds.has(a.branchId)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const today = appointments
    .filter((a) => a.date === CLINIC_TODAY)
    .sort((a, b) => a.time.localeCompare(b.time));
  const pending = appointments.filter((a) =>
    ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status),
  );
  const notifications = state.notifications.filter((n) => n.recipientIds.includes(actor.id));
  const shift = (offset: number) => {
    const d = new Date(`${CLINIC_TODAY}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const weekday = new Date(`${CLINIC_TODAY}T12:00:00Z`).getUTCDay();
  const mondayOffset = -((weekday + 6) % 7);
  const overview = appointments.filter((a) =>
    period === 'today'
      ? a.date === CLINIC_TODAY
      : period === 'week'
        ? a.date >= shift(mondayOffset) && a.date <= shift(mondayOffset + 6)
        : a.date.slice(0, 7) === CLINIC_TODAY.slice(0, 7),
  );
  const groups = [
    {
      label: 'Confirmed',
      color: '#4c2696',
      count: overview.filter((a) => a.status === 'confirmed').length,
    },
    {
      label: 'In progress',
      color: '#05a46c',
      count: overview.filter((a) => ['checked_in', 'in_consultation'].includes(a.status)).length,
    },
    {
      label: 'Needs review',
      color: '#f1a600',
      count: overview.filter((a) =>
        [
          'pending',
          'reschedule_requested',
          'cancellation_requested',
          'doctor_unavailable',
        ].includes(a.status),
      ).length,
    },
    {
      label: 'Cancelled',
      color: '#e93e59',
      count: overview.filter((a) => a.status === 'cancelled').length,
    },
    {
      label: 'Completed',
      color: '#388bd5',
      count: overview.filter((a) => a.status === 'completed').length,
    },
    {
      label: 'Closed',
      color: '#8c819c',
      count: overview.filter((a) => ['rejected', 'no_show'].includes(a.status)).length,
    },
  ];
  let cursor = 0;
  const slices = groups.map((g) => {
    const start = cursor;
    cursor += (g.count / (overview.length || 1)) * 100;
    return `${g.color} ${start}% ${cursor}%`;
  });
  const days = Array.from({ length: 7 }, (_, i) => shift(i - 6));
  const patientTrend = days.map(
    (day) =>
      patients.filter((p) => p.registeredAt && localParts(p.registeredAt, timezone).date === day)
        .length,
  );
  const appointmentTrend = days.map((day) => appointments.filter((a) => a.date === day).length);
  const reviewTrend = days.map((day) => pending.filter((a) => a.date === day).length);
  const stats = [
    {
      label: 'Registered patients',
      value: patients.length,
      Icon: Users,
      color: '#16b97b',
      tone: 'mint',
      detail:
        selectedScope === 'all'
          ? 'Registered at all authorized branches'
          : `Registered at ${scopeLabel}`,
      href: '/admin/patients',
      values: patientTrend,
      badge: 'Live total',
    },
    {
      label: 'Active doctors',
      value: doctors.length,
      Icon: Stethoscope,
      color: '#398ded',
      tone: 'blue',
      detail:
        selectedScope === 'all'
          ? 'On roster at all authorized branches'
          : `On roster at ${scopeLabel}`,
      href: '/admin/doctors',
      badge: 'On roster',
    },
    {
      label: 'Awaiting approval',
      value: pending.length,
      Icon: CalendarCheck2,
      color: '#f2aa17',
      tone: 'amber',
      detail:
        selectedScope === 'all'
          ? 'Requests in all authorized branches'
          : `Requests in ${scopeLabel}`,
      href: '/admin/approvals',
      values: reviewTrend,
      badge: pending.length ? 'Needs review' : 'Up to date',
    },
    {
      label: "Today's appointments",
      value: today.length,
      Icon: CalendarDays,
      color: '#a57ce8',
      tone: 'purple',
      detail: `${today.filter((a) => a.status === 'confirmed').length} confirmed · ${today.filter((a) => ['checked_in', 'in_consultation'].includes(a.status)).length} in progress`,
      href: '/admin/appointments',
      values: appointmentTrend,
      badge: 'Today',
    },
  ];
  return (
    <div className={styles.dashboard}>
      <section className={styles.hero} aria-labelledby="admin-welcome-heading">
        <div className={styles.heroPhoto}>
          <Image
            src="/login-clinic-background.avif"
            alt=""
            fill
            unoptimized
            sizes="(max-width:900px) 100vw, 80vw"
          />
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>YOUR CLINIC, AT A GLANCE</p>
          <h1 id="admin-welcome-heading">
            Welcome back, <em>{actor.name.split(' ')[0]}.</em>
          </h1>
          <p>
            A little organization. A lot of better care.
            <br />
            Here’s your day ahead.
          </p>
          <div className={styles.heroActions}>
            <WorkspaceLink href="/admin/appointments">
              <CalendarDays />
              <span>
                Manage
                <br />
                appointments
              </span>
            </WorkspaceLink>
            <WorkspaceLink href="/admin/patients">
              <Users />
              <span>
                Support
                <br />
                your patients
              </span>
            </WorkspaceLink>
            <WorkspaceLink href="/admin/doctors">
              <HeartPulse />
              <span>
                Empower
                <br />
                your care team
              </span>
            </WorkspaceLink>
          </div>
        </div>
        <blockquote className={styles.quote}>
          <span aria-hidden="true">“</span>
          <p>
            Compassionate care.
            <br />A healthier, brighter tomorrow.
          </p>
          <i aria-hidden="true" />
        </blockquote>
      </section>

      <section className={styles.stats} aria-label="Clinic summary">
        {stats.map(({ label, value, Icon, color, tone, detail, href, values, badge }) => (
          <WorkspaceLink href={href} key={label} className={styles.stat} data-stat={label}>
            <span className={`${styles.icon} ${styles[tone]}`}>
              <Icon aria-hidden="true" size={23} />
            </span>
            <div className={styles.statCopy}>
              <h2>{label}</h2>
              <strong>{value}</strong>
              <p>{detail}</p>
            </div>
            <span className={`${styles.statBadge} ${styles[tone]}`}>{badge}</span>
            {values && (
              <Sparkline values={values} color={color} label={`${label}, last seven days`} />
            )}
          </WorkspaceLink>
        ))}
      </section>

      <div className={styles.grid}>
        <section
          className={`${styles.panel} ${styles.appointments}`}
          aria-labelledby="admin-today-heading"
        >
          <header className={styles.panelHeader}>
            <span className={styles.icon}>
              <CalendarDays aria-hidden="true" />
            </span>
            <div>
              <h2 id="admin-today-heading">Today’s appointments</h2>
              <p>
                {displayDate(CLINIC_TODAY)} · {timezone} · {scopeLabel}
              </p>
            </div>
            <WorkspaceLink className={styles.viewAll} href="/admin/appointments">
              View all <ArrowRight size={15} />
            </WorkspaceLink>
          </header>
          <label className={styles.scope}>
            <span>Dashboard branch scope</span>
            <select
              aria-label="Filter dashboard by branch"
              value={selectedScope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">All Authorized Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {today.length ? (
            renderAppointments(today.slice(0, 6))
          ) : (
            <div className={styles.empty}>
              <span>
                <CalendarDays size={30} aria-hidden="true" />
              </span>
              <h3>No appointments found</h3>
              <p>Try another date or filter, or request a new appointment.</p>
              <Button size="sm" onClick={onBook}>
                <Plus size={17} />
                New appointment
              </Button>
            </div>
          )}
        </section>
        <section className={styles.panel} aria-labelledby="admin-overview-heading">
          <header className={styles.panelHeader}>
            <span className={`${styles.icon} ${styles.blue}`}>
              <MapPin aria-hidden="true" />
            </span>
            <h2 id="admin-overview-heading">Appointment overview</h2>
            <select
              className={styles.period}
              aria-label="Appointment overview period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </header>
          <div className={styles.overview}>
            <div
              className={styles.donut}
              style={{
                background: overview.length ? `conic-gradient(${slices.join(',')})` : '#eeebf7',
              }}
              role="img"
              aria-label={`${overview.length} appointments. ${groups.map((g) => `${g.label}: ${g.count}`).join('. ')}`}
            >
              <div>
                <strong>{overview.length}</strong>
                <span>appointments</span>
              </div>
            </div>
            <div className={styles.legend}>
              {groups
                .filter((g, i) => i < 4 || g.count > 0)
                .map((g) => (
                  <div key={g.label}>
                    <i style={{ background: g.color }} />
                    <span>{g.label}</span>
                    <strong>{g.count}</strong>
                  </div>
                ))}
            </div>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="admin-team-heading">
          <header className={styles.panelHeader}>
            <span className={styles.icon}>
              <Users aria-hidden="true" />
            </span>
            <div>
              <h2 id="admin-team-heading">Your care team</h2>
              <p>
                {doctors.length} active doctors · {scopeLabel}
              </p>
            </div>
            <WorkspaceLink className={styles.viewAll} href="/admin/doctors">
              View all <ArrowRight size={15} />
            </WorkspaceLink>
          </header>
          <div className={styles.careTeam}>
            {doctors.map((d) => (
              <WorkspaceLink className={styles.doctor} href={`/admin/doctors/${d.id}`} key={d.id}>
                <Avatar kind="doctor" entityId={d.id} initials={d.initials} color={d.color} />
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {state.specializations.find((s) => s.id === d.specializationId)?.name ??
                      'Department not recorded'}
                  </small>
                  <span className={styles.active}>
                    <i />
                    Active
                  </span>
                </div>
              </WorkspaceLink>
            ))}
          </div>
          {!doctors.length && <p className={styles.noItems}>No active doctors in this scope.</p>}
        </section>
        <section className={styles.panel} aria-labelledby="admin-branches-heading">
          <header className={styles.panelHeader}>
            <span className={styles.icon}>
              <MapPin aria-hidden="true" />
            </span>
            <h2 id="admin-branches-heading">Branches</h2>
            <WorkspaceLink className={styles.viewAll} href="/admin/branches">
              View all <ArrowRight size={15} />
            </WorkspaceLink>
          </header>
          <div className={styles.branches}>
            {visibleBranches.map((b) => (
              <WorkspaceLink href="/admin/branches" key={b.id}>
                <span className={`${styles.icon} ${styles.branchIcon}`}>
                  <Building2 aria-hidden="true" />
                </span>
                <div>
                  <strong>{b.name}</strong>
                  <small>{b.address || 'Address not recorded'}</small>
                </div>
                <span className={styles.active}>
                  <i />
                  Active
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </WorkspaceLink>
            ))}
          </div>
          {!visibleBranches.length && (
            <p className={styles.noItems}>No active branches in this scope.</p>
          )}
        </section>

        <section
          className={`${styles.panel} ${styles.recent}`}
          aria-labelledby="admin-activity-heading"
        >
          <header className={styles.panelHeader}>
            <span className={styles.icon}>
              <Activity aria-hidden="true" />
            </span>
            <div>
              <h2 id="admin-activity-heading">Recent activity</h2>
              <p>Account-wide · independent of dashboard scope</p>
            </div>
            <WorkspaceLink className={styles.viewAll} href="/admin/notifications">
              See all <ArrowRight size={15} />
            </WorkspaceLink>
          </header>
          <div className={styles.activities}>
            {notifications.slice(0, 4).map((n, i) => (
              <article key={n.id}>
                <span className={`${styles.icon} ${i % 2 ? styles.mint : ''}`}>
                  {i % 2 ? (
                    <FileHeart aria-hidden="true" size={19} />
                  ) : (
                    <CalendarDays aria-hidden="true" size={19} />
                  )}
                </span>
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                  <small>{n.time}</small>
                </div>
                {n.appointmentId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`View appointment: ${n.title}`}
                    onClick={() => onAppointment(n.appointmentId!)}
                  >
                    <ChevronRight size={17} />
                  </Button>
                )}
              </article>
            ))}
          </div>
          {!notifications.length && (
            <p className={styles.noItems}>No recent activity to display.</p>
          )}
        </section>
      </div>
    </div>
  );
}
