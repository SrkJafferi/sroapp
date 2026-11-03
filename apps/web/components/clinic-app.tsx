'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { DemoRole } from '@sro/types';
import { patientIdLabel, matchesPatientSearch } from '@sro/clinic-core';
import { useIdentity } from './auth-workspace';
import { authRequest } from './auth-screen';
import { useClinicFrame, useClinicOptional } from './clinic-context';
import { writeSidebarPreference } from '@/lib/sidebar-preference';
import { clearClinicalCache } from '@/lib/clinical-cache';
import {
  ACCOUNT_PROFILE_SECTION_ID,
  ACCOUNT_SECURITY_SECTION_ID,
  focusAccountSection,
} from '@/lib/account-sections';
import { Avatar, Button, Modal, SearchBox } from './ui';
import { AppointmentDialog, BookingDialog, ConsultationDialog } from './appointment-flows';
import { workspaceHref, workspaceNav } from './workspace-nav';
import { useWorkspaceNavigate, useWorkspaceRoute, WorkspaceLink } from './workspace-route';
import adminStyles from './admin-dashboard.module.css';

type WorkspaceUi = {
  openBooking: (options?: { doctorId?: string; patientId?: string }) => void;
  openAppointment: (id: string) => void;
  openConsult: (id: string) => void;
  openSearch: () => void;
};
const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);
export function useWorkspaceUi() {
  const context = useContext(WorkspaceUiContext);
  if (!context) throw new Error('ClinicShell is required');
  return context;
}
export function ClinicShell({
  children,
  initialSidebarCollapsed = false,
}: {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}) {
  const identity = useIdentity();
  const frame = useClinicFrame();
  const clinical = useClinicOptional();
  const { role, branchId, setBranchId, setRole } = frame;
  const state = clinical?.state;
  const actor = clinical?.actor;
  const doctorDepartment = state?.specializations.find(
    (s) => s.id === state.doctors.find((d) => d.id === actor?.doctorId)?.specializationId,
  )?.name;
  const displayName = actor?.name ?? identity?.name ?? 'Your account';
  const { section, entityId } = useWorkspaceRoute();
  const navigate = useWorkspaceNavigate();
  const reducedMotion = useReducedMotion();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [booking, setBooking] = useState<{ doctorId?: string; patientId?: string } | null>(null);
  const [appointment, setAppointment] = useState<string | null>(null);
  const [consult, setConsult] = useState<string | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => workspaceNav.filter((n) => n.roles.includes(role)), [role]);
  const title = workspaceNav.find((n) => n.key === section)?.title ?? 'Page not found';
  const notifications = clinical?.state.notifications;
  const actorId = clinical?.actor.id;
  const unread = useMemo(() => {
    if (!notifications || !actorId) return 0;
    return notifications.filter(
      (n) => n.recipientIds.includes(actorId) && !n.readBy.includes(actorId),
    ).length;
  }, [actorId, notifications]);
  const pendingApprovals = clinical
    ? clinical.state.appointments.filter(
        (a) =>
          a.branchId === branchId &&
          (role === 'admin' || a.doctorId === clinical.actor.doctorId) &&
          ['pending', 'reschedule_requested', 'cancellation_requested'].includes(a.status),
      ).length
    : 0;
  const initials = displayName
    .replace('Dr. ', '')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('');
  const accountAvatar = {
    organizationId: clinical?.organizationId,
    kind:
      role === 'doctor'
        ? ('doctor' as const)
        : role === 'patient'
          ? ('patient' as const)
          : ('profile' as const),
    entityId:
      role === 'doctor' ? actor?.doctorId : role === 'patient' ? actor?.patientId : identity?.id,
    initials,
  };
  const accountRoleLabel =
    role === 'admin' ? 'Administrator' : role === 'doctor' ? 'Doctor' : 'Patient';
  const href = (key: string) => workspaceHref(role, key);
  useEffect(() => {
    if (!drawer) return;
    const sidebar = document.getElementById('clinic-sidebar');
    sidebar?.querySelector<HTMLElement>('.nav-link.active, .nav-link')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawer(false);
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus(),
      );
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawer]);
  function closeDrawer() {
    if (!drawer) return;
    setDrawer(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus());
  }
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    setTooltip(null);
    writeSidebarPreference(next);
  }
  useEffect(() => {
    if (!accountOpen) return;
    const wrapper = accountMenuRef.current;
    wrapper?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [accountOpen]);
  function openAccountSection(sectionId: string) {
    setAccountOpen(false);
    const path = href('settings');
    const target = `${path}#${sectionId}`;
    if (window.location.pathname.replace(/\/+$/, '') === path) {
      window.history.replaceState(null, '', target);
      if (!focusAccountSection(sectionId))
        requestAnimationFrame(() => focusAccountSection(sectionId));
      return;
    }
    navigate(target);
  }
  function handleAccountMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : index <= 0
            ? items.length - 1
            : index - 1;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setAccountOpen(false);
    }
  }
  async function signOut() {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountError('');
    try {
      const result = await authRequest('logout');
      clearClinicalCache();
      window.location.assign(result.next ?? '/auth/login');
    } catch (error) {
      setAccountBusy(false);
      setAccountError(error instanceof Error ? error.message : 'Sign-out failed. Please retry.');
    }
  }
  function showSidebarTooltip(label: string, element: HTMLElement) {
    if (!collapsed || window.matchMedia('(max-width: 760px)').matches) return;
    const rect = element.getBoundingClientRect();
    setTooltip({
      label,
      top: Math.min(Math.max(rect.top + rect.height / 2, 28), window.innerHeight - 28),
    });
  }
  const ui = useMemo<WorkspaceUi>(
    () => ({
      openBooking: (options) => setBooking(options ?? {}),
      openAppointment: (id) => setAppointment(id),
      openConsult: (id) => setConsult(id),
      openSearch: () => setSearch(''),
    }),
    [],
  );
  useEffect(() => {
    // The shell is mounted only after workspace authorization. Wait for real clinical data.
    if (!clinical || !identity || !actor) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('book') !== '1') return;
    const frame = window.requestAnimationFrame(() => {
      url.searchParams.delete('book');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      setBooking({});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clinical, identity, actor]);
  return (
    <WorkspaceUiContext.Provider value={ui}>
      <div
        className={`clinic-shell${collapsed ? ' sidebar-collapsed' : ''}${role === 'admin' ? ` ${adminStyles.shell}${section === 'dashboard' ? ` ${adminStyles.dashboardShell}` : ''}` : ''}`}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {drawer && (
          <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeDrawer} />
        )}
        <aside
          id="clinic-sidebar"
          className={`sidebar ${drawer ? 'sidebar-open' : ''}`}
          aria-label="Main navigation"
        >
          <WorkspaceLink className="brand" href={href('dashboard')} aria-label="SRO Clinic home">
            <div className="brand-logo">
              <Image
                className="brand-logo-full"
                src="/sro-logo.png"
                alt="Social Responsibility Organization"
                width={989}
                height={415}
                sizes="216px"
                priority
              />
              <Image
                className="brand-emblem"
                src="/sro-emblem.png"
                alt=""
                aria-hidden="true"
                width={343}
                height={343}
                sizes="42px"
                priority
              />
            </div>
            <span>CLINIC MANAGEMENT</span>
          </WorkspaceLink>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-controls="clinic-sidebar"
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          {role !== 'doctor' && (
            <div className="workspace-label">
              {role === 'admin' ? 'ADMIN WORKSPACE' : 'PATIENT WORKSPACE'}
            </div>
          )}
          <nav aria-label="Workspace navigation" onScroll={() => setTooltip(null)}>
            {items.map((item) => (
              <div key={item.key}>
                {item.group && <div className="nav-group">{item.group}</div>}
                <WorkspaceLink
                  href={href(item.key)}
                  onClick={() => {
                    closeDrawer();
                    setTooltip(null);
                  }}
                  onMouseEnter={(e) => showSidebarTooltip(item.title, e.currentTarget)}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(e) => showSidebarTooltip(item.title, e.currentTarget)}
                  onBlur={() => setTooltip(null)}
                  className={`nav-link ${section === item.key ? 'active' : ''}`}
                  aria-current={section === item.key ? 'page' : undefined}
                >
                  <item.icon size={18} strokeWidth={1.7} />
                  <span>{item.title}</span>
                  {item.key === 'approvals' && pendingApprovals > 0 && (
                    <b className="nav-count">{pendingApprovals}</b>
                  )}
                  {item.key === 'notifications' && unread > 0 && <span className="nav-unread" />}
                </WorkspaceLink>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="care-message">
              <HeartPulse size={22} />
              <strong>Care that connects.</strong>
              <p>Healthier lives. Stronger communities.</p>
            </div>
            <WorkspaceLink
              href={href('settings')}
              className="sidebar-user"
              aria-label={collapsed ? `${displayName}, settings and profile` : undefined}
            >
              <Avatar
                organizationId={clinical?.organizationId}
                kind={role === 'doctor' ? 'doctor' : role === 'patient' ? 'patient' : 'profile'}
                entityId={
                  role === 'doctor'
                    ? actor?.doctorId
                    : role === 'patient'
                      ? actor?.patientId
                      : identity?.id
                }
                initials={initials}
                color="green"
              />
              <span className="sidebar-user-copy">
                <strong>{displayName}</strong>
                <small>
                  {role === 'admin'
                    ? 'Clinic administrator'
                    : role === 'doctor'
                      ? (doctorDepartment ?? 'Doctor')
                      : 'Patient'}
                </small>
              </span>
              <ChevronRight size={15} />
            </WorkspaceLink>
          </div>
        </aside>
        {tooltip && (
          <div className="sidebar-tooltip" aria-hidden="true" style={{ top: tooltip.top }}>
            {tooltip.label}
          </div>
        )}
        <div className="workspace">
          <header className="topbar">
            <div className="header-left">
              <Button
                variant="ghost"
                size="icon"
                className="menu-toggle"
                aria-label="Open navigation"
                onClick={() => setDrawer(true)}
              >
                <Menu size={21} />
              </Button>
              <span className="breadcrumb">
                Workspace
                <ChevronRight size={13} />
                <strong>{title}</strong>
              </span>
            </div>
            <div className="header-controls">
              <button
                className="global-search"
                onClick={() => setSearch('')}
                aria-label="Search clinic"
                disabled={!clinical}
              >
                <Search size={17} />
                <span>Search anything…</span>
                <kbd>⌕</kbd>
              </button>
              {state ? (
                <label className="branch-select">
                  <Building2 size={15} />
                  <select
                    aria-label="Active clinic branch"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                  >
                    {state.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {!b.active ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </select>
                  {role === 'admin' && (
                    <ChevronDown className="branch-select-chevron" size={16} aria-hidden="true" />
                  )}
                </label>
              ) : (
                <span className="branch-select branch-select-pending">
                  <Building2 size={15} />
                  <span className="skeleton-line skeleton-branch" aria-hidden="true" />
                  <span className="sr-only">Loading clinic branches</span>
                </span>
              )}
              <WorkspaceLink
                className="notification-button"
                href={href('notifications')}
                aria-label={
                  unread > 0
                    ? `Notifications, ${unread} unread notification${unread === 1 ? '' : 's'}`
                    : 'Notifications, no unread notifications'
                }
              >
                <Bell size={20} />
                {unread > 0 && (
                  <span key={unread} className="notification-badge" aria-hidden="true">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </WorkspaceLink>
              <span className="header-divider" />
              <div className="account-menu-wrap" ref={accountMenuRef}>
                <button
                  ref={accountButtonRef}
                  type="button"
                  className={`account-trigger${accountOpen ? ' account-trigger-open' : ''}`}
                  aria-label={`Account menu for ${displayName}`}
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  aria-controls={accountOpen ? 'account-menu' : undefined}
                  onClick={() => {
                    setAccountError('');
                    setAccountOpen((open) => !open);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setAccountOpen(true);
                    }
                  }}
                >
                  <Avatar {...accountAvatar} color="purple" />
                  <ChevronDown className="account-trigger-chevron" size={13} aria-hidden="true" />
                </button>
                {accountOpen && (
                  <div
                    id="account-menu"
                    role="menu"
                    aria-label="Account menu"
                    className="account-menu"
                    onKeyDown={handleAccountMenuKeyDown}
                  >
                    <div className="account-menu-header">
                      <Avatar {...accountAvatar} color="purple" size="avatar-lg" />
                      <div className="account-menu-identity">
                        <strong>{displayName}</strong>
                        <span className="account-menu-role">{accountRoleLabel}</span>
                        {identity?.email && <small title={identity.email}>{identity.email}</small>}
                      </div>
                    </div>
                    <div className="account-menu-divider" role="separator" />
                    <div className="account-menu-items">
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="account-menu-item"
                        onClick={() => openAccountSection(ACCOUNT_PROFILE_SECTION_ID)}
                      >
                        <UserRound size={17} strokeWidth={1.8} aria-hidden="true" />
                        <span>My Profile</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="account-menu-item"
                        onClick={() => openAccountSection(ACCOUNT_SECURITY_SECTION_ID)}
                      >
                        <Settings size={17} strokeWidth={1.8} aria-hidden="true" />
                        <span>Settings &amp; Security</span>
                      </button>
                    </div>
                    <div className="account-menu-divider" role="separator" />
                    <div className="account-menu-items">
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="account-menu-item account-menu-signout"
                        disabled={accountBusy}
                        onClick={signOut}
                      >
                        <LogOut size={17} strokeWidth={1.8} aria-hidden="true" />
                        <span>{accountBusy ? 'Signing out…' : 'Sign Out'}</span>
                      </button>
                    </div>
                    {accountError && (
                      <p className="account-menu-error" role="alert">
                        {accountError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          <div className="demo-strip">
            <span>
              <span className="live-dot" />
              CONNECTED CARE <span className="demo-strip-detail">Signed in as {displayName}</span>
            </span>
            <label>
              Viewing as
              <select
                aria-label="Workspace role"
                value={role}
                onChange={(e) => setRole(e.target.value as DemoRole)}
              >
                {(['admin', 'doctor', 'patient'] as DemoRole[])
                  .filter((r) =>
                    identity?.memberships.some(
                      (m) => m.roles.includes(r) && m.branchIds.length > 0,
                    ),
                  )
                  .map((r) => (
                    <option key={r} value={r}>
                      {r[0].toUpperCase() + r.slice(1)}
                    </option>
                  ))}
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
          <main id="main-content" className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {section === 'dashboard' ? 'YOUR CLINIC, AT A GLANCE' : 'SRO CLINIC WORKSPACE'}
                </div>
                <h1>
                  {section === 'dashboard'
                    ? role === 'admin'
                      ? `Welcome back, ${displayName.split(' ')[0]}`
                      : role === 'doctor'
                        ? `Good morning, ${displayName.split(' ').slice(0, 2).join(' ')}`
                        : `Welcome back, ${displayName.split(' ')[0]}`
                    : entityId && section === 'doctors'
                      ? 'Meet your doctor'
                      : title}
                  <span className="heading-dot">.</span>
                </h1>
                <p>
                  {section === 'dashboard'
                    ? role === 'admin'
                      ? 'A little organization. A lot of better care. Here’s your day ahead.'
                      : role === 'doctor'
                        ? 'Your patients, your schedule, and everything you need to care.'
                        : 'Your health, all in one place. Let’s take care of you.'
                    : 'Connected care, thoughtfully organized.'}
                </p>
              </div>
              <div className="heading-actions">
                <span className="date-label">
                  <CalendarDays size={16} />
                  {state ? (
                    <>
                      {new Date().toLocaleDateString('en-PK', {
                        timeZone: state.organization.timezone,
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      <small>{state.organization.timezone}</small>
                    </>
                  ) : (
                    <>
                      <span className="skeleton-line skeleton-date" aria-hidden="true" />
                      <small className="skeleton-line skeleton-tz" aria-hidden="true" />
                    </>
                  )}
                </span>
                <Button onClick={() => setBooking({})} disabled={!clinical}>
                  <Plus size={17} />
                  {role === 'patient' ? 'Book appointment' : 'New appointment'}
                </Button>
              </div>
            </div>
            <motion.div
              key={`${role}-${section}-${entityId}`}
              initial={reducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {children}
            </motion.div>
            <footer className="workspace-footer">
              <span>© 2026 Social Responsibility Organization</span>
              <span>
                <ShieldCheck size={13} />
                Built around better care
              </span>
            </footer>
          </main>
        </div>
        {booking && clinical && (
          <BookingDialog
            doctorId={booking.doctorId}
            followUpPatient={booking.patientId}
            onClose={() => setBooking(null)}
          />
        )}
        {appointment && clinical && (
          <AppointmentDialog
            appointmentId={appointment}
            onClose={() => setAppointment(null)}
            onConsult={(id) => {
              setAppointment(null);
              setConsult(id);
            }}
          />
        )}
        {consult && clinical && (
          <ConsultationDialog appointmentId={consult} onClose={() => setConsult(null)} />
        )}
        {search !== null && clinical && (
          <Modal title="Search your clinic" onClose={() => setSearch(null)}>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search patients, doctors, departments…"
            />
            <div className="search-results">
              {search.length < 2 ? (
                <p className="muted">Type at least two characters to search your workspace.</p>
              ) : (
                <>
                  {role !== 'patient' &&
                    clinical.state.patients
                      .filter((p) => matchesPatientSearch(p, search))
                      .filter(
                        (p) =>
                          role === 'admin' ||
                          clinical.state.appointments.some(
                            (a) => a.doctorId === clinical.actor.doctorId && a.patientId === p.id,
                          ) ||
                          clinical.state.grants.some(
                            (g) => g.userId === clinical.actor.id && g.patientId === p.id,
                          ),
                      )
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            navigate(`/${role}/records/${p.id}`);
                            setSearch(null);
                          }}
                        >
                          <Avatar
                            kind="patient"
                            entityId={p.id}
                            initials={p.initials}
                            color="blue"
                          />
                          <span>
                            <strong>{p.name}</strong>
                            <small>{patientIdLabel(p)}</small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                  {role !== 'doctor' &&
                    clinical.state.doctors
                      .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
                      .map((d) => (
                        <button
                          key={d.id}
                          onClick={() => {
                            navigate(`/${role}/doctors/${d.id}`);
                            setSearch(null);
                          }}
                        >
                          <Avatar
                            kind="doctor"
                            entityId={d.id}
                            initials={d.initials}
                            color={d.color}
                          />
                          <span>
                            <strong>{d.name}</strong>
                            <small>Doctor profile</small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                  <WorkspaceLink href={href('appointments')} onClick={() => setSearch(null)}>
                    Browse all appointments
                    <ArrowRight size={16} />
                  </WorkspaceLink>
                </>
              )}
            </div>
          </Modal>
        )}
      </div>
    </WorkspaceUiContext.Provider>
  );
}
