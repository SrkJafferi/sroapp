'use client';
import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useClinicFrame, useClinicOptional } from './clinic-context';
import { useWorkspaceRoute } from './workspace-route';
import { useWorkspaceUi } from './clinic-app';
import { workspaceNav } from './workspace-nav';
import { AccountPanel } from './account-panel';
import { Appointments, Dashboard } from './dashboard';
import { Administration, Directories, DoctorProfile, Notifications, Records } from './screens';
import { Button, Empty } from './ui';

function ContentSkeleton() {
  return (
    <div className="content-skeleton" role="status" aria-busy="true">
      <span className="sr-only">Loading clinic records…</span>
      <div className="skeleton-stats" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-card skeleton-stat" />
        ))}
      </div>
      <div className="skeleton-panels" aria-hidden="true">
        <div className="skeleton-card skeleton-panel" />
        <div className="skeleton-card skeleton-panel" />
      </div>
    </div>
  );
}

export function ClinicPage() {
  const { section, entityId } = useWorkspaceRoute();
  const frame = useClinicFrame();
  const clinical = useClinicOptional();
  const ui = useWorkspaceUi();
  const [retrying, setRetrying] = useState(false);
  const { role } = frame;
  const retry = async () => {
    setRetrying(true);
    try {
      await frame.refresh();
    } catch {
      // The provider keeps the error message for the retry panel.
    } finally {
      setRetrying(false);
    }
  };
  const canOpen = workspaceNav.some((n) => n.key === section && n.roles.includes(role));
  if (!canOpen)
    return (
      <Empty
        title="This page is unavailable"
        text="Choose a page from your workspace navigation."
      />
    );
  if (!clinical) {
    if (frame.error)
      return (
        <div role="alert">
          <Empty
            title="We couldn’t load your clinic records"
            text={frame.error}
            action={
              <Button disabled={retrying} onClick={() => void retry()}>
                {retrying ? 'Retrying…' : 'Try again'}
              </Button>
            }
          />
        </div>
      );
    return <ContentSkeleton />;
  }
  const screen = () => {
    if (section === 'dashboard')
      return <Dashboard onAppointment={ui.openAppointment} onBook={ui.openBooking} />;
    if (section === 'appointments' || section === 'approvals')
      return (
        <Appointments approvals={section === 'approvals'} onAppointment={ui.openAppointment} />
      );
    if (section === 'doctors' && entityId)
      return <DoctorProfile id={entityId} onBook={(id) => ui.openBooking({ doctorId: id })} />;
    if (section === 'doctors' || section === 'patients')
      return <Directories kind={section} onBook={(patientId) => ui.openBooking({ patientId })} />;
    if (section === 'records' || section === 'prescriptions' || section === 'reports')
      return (
        <Records
          kind={section}
          selectedPatientId={entityId}
          onFollowUp={(id) => ui.openBooking({ patientId: id })}
        />
      );
    if (section === 'notifications') return <Notifications onAppointment={ui.openAppointment} />;
    if (section === 'settings') return <AccountPanel />;
    return <Administration section={section} onBook={(id) => ui.openBooking({ doctorId: id })} />;
  };
  return (
    <>
      {frame.error && (
        <div className="content-error-banner" role="alert">
          <CircleAlert size={17} />
          <span>{frame.error}</span>
          <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}
      {screen()}
    </>
  );
}
