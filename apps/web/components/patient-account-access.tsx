'use client';
import { useEffect, useState } from 'react';
import { Button, Modal, Panel } from './ui';
import { handoverWindowState } from '@/lib/credential-handover-window';
export type PatientAccountCapabilities = {
  role: 'admin' | 'doctor' | null;
  provision: boolean;
  reset: boolean;
  disable: boolean;
  enable: boolean;
  handover: boolean;
  autoProvision: boolean;
};
export type Sro0009RecoveryStatus = {
  recoveryId: string | null;
  state: string | null;
  reissueCount: number;
  accountState: string | null;
  pilotState: string | null;
  handoverExpiresAt: string | null;
  handoverExpired: boolean;
  canSetup: boolean;
  canReset: boolean;
  canHandover: boolean;
  serverNow: string;
  attestation: string;
};
export type PatientAccountStatus = {
  patientCode: string;
  status:
    | 'Not Provisioned'
    | 'Pending Handover'
    | 'Active'
    | 'Disabled'
    | 'Password Change Required'
    | 'Needs Review';
  loginMethod: string | null;
  emailVerified: boolean;
  lastSignInAt: string | null;
  passwordChangedAt: string | null;
  mustChangePassword: boolean;
  handoverExpiresAt?: string | null;
  serverNow?: string | null;
  handoverExpired?: boolean;
  recovery?: Sro0009RecoveryStatus | null;
  capabilities?: PatientAccountCapabilities;
};
// Prepared Admin-only panel. Server authorization MUST be reapplied for every callback.
export function PatientAccountAccess({
  status,
  admin,
  mutationsEnabled = false,
  onAction,
  onRecoveryAction,
}: {
  status: PatientAccountStatus;
  admin: boolean;
  mutationsEnabled?: boolean;
  onAction: (
    action: 'provision' | 'reset' | 'disable' | 'enable',
    identityVerified: boolean,
  ) => Promise<void>;
  onRecoveryAction?: (action: 'setup' | 'reset', attestation?: string) => Promise<void>;
}) {
  const [action, setAction] = useState<'reset' | 'disable' | 'enable' | null>(null),
    [identity, setIdentity] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!admin) return null;
  const capabilities = status.capabilities ?? {
    role: 'admin' as const,
    provision: mutationsEnabled,
    reset: mutationsEnabled,
    disable: mutationsEnabled,
    enable: mutationsEnabled,
    handover: mutationsEnabled,
    autoProvision: false,
  };
  const displayStatus =
    status.status === 'Active' && status.mustChangePassword
      ? 'Password Change Required'
      : status.status;
  const run = async (a: 'provision' | 'reset' | 'disable' | 'enable') => {
    const allowed =
      a === 'provision'
        ? capabilities.provision
        : a === 'reset'
          ? capabilities.reset
          : capabilities.disable;
    if (busy || !allowed) return;
    setBusy(true);
    try {
      await onAction(a, identity);
      setAction(null);
      setIdentity(false);
    } catch {
      setError('Account operation was not confirmed. Refresh the status or request clinic review.');
    } finally {
      setBusy(false);
    }
  };
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Karachi',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value))
      : 'Not available';
  return (
    <Panel
      title="Account Access"
      subtitle="Patient login security is managed separately from clinical records."
    >
      <div className="panel-form form-stack">
        <dl>
          <dt>Patient ID</dt>
          <dd>{status.patientCode}</dd>
          <dt>Account status</dt>
          <dd>
            {displayStatus}
            {status.mustChangePassword ? ' · Password change required' : ''}
          </dd>
          <dt>Login method</dt>
          <dd>{status.loginMethod ?? 'Not provisioned'}</dd>
          <dt>Verified login email</dt>
          <dd>{status.emailVerified ? 'Verified' : 'No verified login email'}</dd>
          <dt>Last successful sign-in</dt>
          <dd>{date(status.lastSignInAt)}</dd>
          <dt>Last confirmed password change</dt>
          <dd>{date(status.passwordChangedAt)}</dd>
        </dl>
        {status.status === 'Pending Handover' && (
          <HandoverExpiryNotice
            key={`${status.handoverExpiresAt ?? ''}|${status.serverNow ?? ''}`}
            expiresAt={status.handoverExpiresAt ?? null}
            serverNow={status.serverNow ?? null}
            expired={status.handoverExpired === true}
          />
        )}
        {status.recovery && onRecoveryAction && (
          <Sro0009RecoveryPanel recovery={status.recovery} onAction={onRecoveryAction} />
        )}
        {error && <p role="alert">{error}</p>}
        {!mutationsEnabled && (
          <p role="status">Patient account changes require separate clinic authorization.</p>
        )}
        {status.status === 'Needs Review' ? (
          <p role="status">
            Account setup needs review. No account changes are available from this panel.
          </p>
        ) : status.status === 'Not Provisioned' ? (
          <Button disabled={busy || !capabilities.provision} onClick={() => void run('provision')}>
            Provision Account
          </Button>
        ) : !status.recovery ? (
          <>
            <Button
              variant="outline"
              disabled={busy || !capabilities.reset}
              onClick={() => {
                setIdentity(false);
                setAction('reset');
              }}
            >
              Reset / Reissue Credentials
            </Button>
            <Button
              variant="outline"
              disabled={busy || !capabilities.disable}
              onClick={() => setAction(status.status === 'Disabled' ? 'enable' : 'disable')}
            >
              {status.status === 'Disabled' ? 'Enable Patient Login' : 'Disable Patient Login'}
            </Button>
          </>
        ) : (
          <p role="status">
            Broad account controls are not available for this one-time fictional-pilot recovery.
          </p>
        )}
        {action && (
          <Modal
            title={action === 'reset' ? 'Verify Patient identity' : 'Confirm account access change'}
            description={
              action === 'reset'
                ? 'Verify the Patient in person against the existing clinic record and your clinic identity-check procedure. Knowing an SRO ID alone is insufficient. No current password will be shown.'
                : 'This changes login access only; clinical records remain intact.'
            }
            onClose={() => {
              if (!busy) setAction(null);
            }}
          >
            {action === 'reset' && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={identity}
                  onChange={(e) => setIdentity(e.target.checked)}
                />
                I completed the in-person clinic identity check.
              </label>
            )}
            <Button
              disabled={busy || (action === 'reset' && !identity)}
              onClick={() => void run(action)}
            >
              Confirm
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
          </Modal>
        )}
      </div>
    </Panel>
  );
}

function Sro0009RecoveryPanel({
  recovery,
  onAction,
}: {
  recovery: Sro0009RecoveryStatus;
  onAction: (action: 'setup' | 'reset', attestation?: string) => Promise<void>;
}) {
  const [attestationChecked, setAttestationChecked] = useState(false),
    [readyChecked, setReadyChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (action: 'setup' | 'reset') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onAction(action, action === 'setup' ? recovery.attestation : undefined);
      setAttestationChecked(false);
      setReadyChecked(false);
    } catch {
      setError('The one-time recovery action was not confirmed. Refresh the status or request review.');
    } finally {
      setBusy(false);
    }
  };
  const locked = recovery.state === 'claimed' || recovery.state === 'handover_pending';
  return (
    <section aria-label="SRO0009 one-time recovery" className="form-stack">
      <h3>One-time fictional-pilot recovery — SRO0009</h3>
      <p role="status">
        Account: {recovery.accountState ?? 'unknown'} · Pilot: {recovery.pilotState ?? 'unknown'} ·
        Recovery: {recovery.state ?? 'not prepared'}
      </p>
      {recovery.state === null && recovery.canSetup && (
        <>
          <p>
            This action is limited to the fictional pilot record. It does not claim physical
            Patient identity verification and does not enable a general password reset.
          </p>
          <blockquote>{recovery.attestation}</blockquote>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={attestationChecked}
              disabled={busy}
              onChange={(e) => setAttestationChecked(e.target.checked)}
            />
            I confirm the fictional-pilot attestation above.
          </label>
          <Button
            variant="outline"
            disabled={busy || !attestationChecked}
            onClick={() => void run('setup')}
          >
            Prepare one-time recovery
          </Button>
        </>
      )}
      {recovery.state === 'prepared' && recovery.canReset && (
        <>
          <p role="alert">
            This creates one temporary credential. Continue only if you are ready to complete the
            private handover immediately. The proof expires in 10 minutes and cannot be extended or
            reissued here.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={readyChecked}
              disabled={busy}
              onChange={(e) => setReadyChecked(e.target.checked)}
            />
            I am ready to complete the private handover immediately and understand that an expired
            or lost proof requires clinic review.
          </label>
          <Button
            variant="outline"
            disabled={busy || !readyChecked}
            onClick={() => void run('reset')}
          >
            Reissue one test credential
          </Button>
        </>
      )}
      {locked && (
        <p role="alert">
          Recovery reset is already authorized. The one-time handover proof can only be completed
          in the session that created it. If it expired or was lost, stop and request clinic review;
          no reissue is available.
        </p>
      )}
      {recovery.state === 'handover_confirmed' && (
        <p role="status">
          Handover confirmed. Waiting for the mandatory first password change; no further reset is
          available.
        </p>
      )}
      {recovery.state === 'completed' && (
        <p role="status">
          Recovery completed. The original pilot row remains quarantined and is not reactivated.
        </p>
      )}
      {recovery.state === 'quarantined' && (
        <p role="alert">
          Recovery is quarantined and fenced. Do not retry or create another identity; request clinic
          review.
        </p>
      )}
      {recovery.state === null && !recovery.canSetup && (
        <p role="alert">
          Recovery is not eligible in the current account or pilot state. Do not retry; request
          clinic review.
        </p>
      )}
      {recovery.state === 'prepared' && !recovery.canReset && (
        <p role="alert">
          The prepared recovery is not currently reset-eligible. Do not retry; request clinic
          review.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function HandoverExpiryNotice({
  expiresAt,
  serverNow,
  expired,
}: {
  expiresAt: string | null;
  serverNow: string | null;
  expired: boolean;
}) {
  const [clockNow, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const windowState = handoverWindowState(expiresAt, serverNow, mountedAt, clockNow);
  const isExpired = expired || windowState?.expired === true;
  useEffect(() => {
    if (isExpired || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, isExpired]);
  if (isExpired)
    return (
      <p role="alert">
        Handover expired — account needs review. The proof cannot be extended or replayed.
      </p>
    );
  if (windowState)
    return (
      <p role="status" aria-live="polite">
        Handover proof expires in <strong>{windowState.label}</strong>. The 10-minute limit cannot
        be extended.
      </p>
    );
  return (
    <p role="alert">
      Handover proof expiry is unavailable. Acknowledge immediately; the server still enforces the
      10-minute limit.
    </p>
  );
}
