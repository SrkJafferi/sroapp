'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';
import { buildCredentialPrint, credentialText, type CredentialSlip } from '@/lib/credential-slip';
import { handoverWindowState } from '@/lib/credential-handover-window';
export type { CredentialSlip } from '@/lib/credential-slip';
// Intentionally unmounted before approved deployment. Parent MUST discard its handover response
// on close/account change; it must never cache, persist, log or serialize the slip into a URL.
export function PatientCredentialHandover({
  slip,
  expiresAt = null,
  serverNow = null,
  recoveryMarkerWarning = false,
  onConfirm,
  onDismiss,
}: {
  slip: CredentialSlip;
  expiresAt?: string | null;
  serverNow?: string | null;
  recoveryMarkerWarning?: boolean;
  onConfirm: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [revealed, setRevealed] = useState(false),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clockNow, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const lock = useRef(false);
  const printWindow = useRef<Window | null>(null);
  const windowState = handoverWindowState(expiresAt, serverNow, mountedAt, clockNow);
  const expired = windowState?.expired === true;
  useEffect(
    () => () => {
      printWindow.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (confirmed || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [confirmed, expiresAt]);
  if (confirmed)
    return (
      <Modal
        title="Handover confirmed"
        description="The one-time credential handover was recorded. No credential is shown in this confirmation."
        onClose={onDismiss}
      >
        <div className="form-stack">
          <strong>{slip.name}</strong>
          <p>Patient ID: {slip.patientCode}</p>
          <p role="status">
            Handover confirmed. The Patient must choose a new private password at first sign-in
            before any clinical access is allowed.
          </p>
          <Button onClick={onDismiss}>Done</Button>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={expired ? 'Handover expired' : 'Patient login credentials'}
      description={
        expired
          ? 'The one-time proof expired before acknowledgement. The account remains pending and cannot be acknowledged here.'
          : 'Hand these credentials privately to the identified Patient. They cannot be retrieved after this window closes.'
      }
      onClose={() => {
        if (!lock.current) onDismiss();
      }}
    >
      <div className="form-stack">
        <strong>{slip.name}</strong>
        <p>Patient ID: {slip.patientCode}</p>
        <label className="field">
          <span>Temporary Password</span>
          <input
            readOnly
            type={revealed ? 'text' : 'password'}
            value={slip.temporaryPassword}
            autoComplete="off"
          />
        </label>
        <Button
          variant="outline"
          onClick={() => setRevealed((v) => !v)}
          disabled={busy}
          aria-pressed={revealed}
        >
          {revealed ? 'Hide temporary password' : 'Show temporary password'}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(slip.temporaryPassword);
              setError('');
              setNotice('Temporary password copied. Use it only in the password field.');
            } catch {
              setError('Copy failed. Reveal the temporary password and enter it privately.');
            }
          }}
        >
          Copy temporary password only
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(credentialText(slip));
              setError('');
              setNotice('Full credential slip copied. It includes the Patient ID and instructions.');
            } catch {
              setError('Copy failed. Reveal and hand over the credentials privately.');
            }
          }}
        >
          Copy full credential slip
        </Button>
        <p>
          Use the password-only copy for the Patient login password field. The full slip includes
          the Patient ID and instructions and must not be pasted as the password.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            printWindow.current?.close();
            const print = window.open('', '_blank');
            if (!print) {
              setError('Allow the print window, or copy credentials privately.');
              return;
            }
            printWindow.current = print;
            print.opener = null;
            const logo = buildCredentialPrint(print.document, slip, window.location.origin);
            print.addEventListener('afterprint', () => print.close(), { once: true });
            await logo.decode().catch(() => undefined);
            if (print.closed) return;
            print.focus();
            print.print();
            setError('');
            setNotice('Private credential slip opened for printing.');
          }}
        >
          Print Login Credentials
        </Button>
        {windowState && !windowState.expired && (
          <p role="status" aria-live="polite">
            Handover expires in <strong>{windowState.label}</strong>. The 10-minute limit cannot be
            extended or reset.
          </p>
        )}
        {windowState?.warning && (
          <p role="alert">
            Handover expires soon. Complete the acknowledgement now; an expired handover requires
            clinic review.
          </p>
        )}
        {expired && (
          <p role="alert">
            Handover expired — account needs review. Close this window; the account remains pending.
          </p>
        )}
        {!expiresAt && (
          <p role="alert">
            Expiry time unavailable. Acknowledge immediately; the server still enforces the
            10-minute limit.
          </p>
        )}
        {recoveryMarkerWarning && (
          <p role="alert">
            The handover was recorded, but its recovery review marker needs clinic attention. Do not
            retry or reissue credentials.
          </p>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={verified}
            disabled={expired || busy}
            onChange={(e) => setVerified(e.target.checked)}
          />
          I verified the Patient in person and handed over the credentials privately.
        </label>
        {error && <p role="alert">{error}</p>}
        <p role="status" aria-live="polite">
          {notice ||
            'Choose a new private password at first sign-in. These credentials cannot be retrieved after dismissal.'}
        </p>
        <Button
          disabled={!verified || busy || expired}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              await onConfirm();
              setConfirmed(true);
            } catch {
              setError(
                'Handover was not confirmed. Keep the account pending and request clinic review.',
              );
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          Confirm private handover
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDismiss}>
          Close and keep access pending
        </Button>
      </div>
    </Modal>
  );
}
