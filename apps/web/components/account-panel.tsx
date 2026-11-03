'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Field, Panel, Modal } from './ui';
import { authRequest } from './auth-screen';
import { useIdentity } from './auth-workspace';
import { useClinic } from './clinic-context';
import { clearClinicalCache } from '@/lib/clinical-cache';
import {
  ACCOUNT_SECURITY_SECTION_ID,
  focusAccountSection,
  isAccountSection,
} from '@/lib/account-sections';
import { displayName } from '@/lib/clinical-clock';
import { ProfileInformation } from './profile-editor';

type AccountData = {
  patient: {
    name: string;
    phone: string;
    gender: string;
    address: string;
  } | null;
  branches: { id: string; name: string; organization_id: string }[];
  specializations: { id: string; name: string; organization_id: string }[];
};
function useAccount() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/auth/account', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Account details unavailable.');
        return r.json();
      })
      .then((r) => {
        if (active) setData(r);
      })
      .catch(() => {
        if (active) setError('Unable to load account details. Please sign in again.');
      });
    return () => {
      active = false;
    };
  }, []);
  return { data, error };
}
export function DoctorInvitation({ onClose }: { onClose: () => void }) {
  const { data, error: loadError } = useAccount();
  const { refresh, notify } = useClinic();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState('');
  const lock = useRef(false);
  return (
    <Modal title="Invite a doctor" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<
            string,
            string
          >;
          try {
            await authRequest('invite', values);
            onClose();
            notify({
              title: 'Invitation Sent Successfully',
              message: `An invitation has been sent to ${values.email}. The link expires in 24 hours.`,
            });
            refresh().catch(() => {});
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Invitation failed.');
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <p>
          A single-use invitation will be emailed from support@sropk.org. Confirm the recipient’s
          email before sending.
        </p>
        {(error || loadError) && (
          <p role="alert" className="form-error">
            {error || loadError}
          </p>
        )}
        <Field label="Doctor name">
          <input name="name" required minLength={3} />
        </Field>
        <Field label="Doctor email">
          <input name="email" type="email" required />
        </Field>
        <Field label="Authorized clinic branch">
          <select
            name="branchId"
            required
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">Select a branch</option>
            {data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {displayName(b.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Medical department">
          <select name="specializationId" required>
            <option value="">Select a department</option>
            {data?.specializations
              .filter(
                (s) =>
                  data.branches.find((b) => b.id === branch)?.organization_id === s.organization_id,
              )
              .sort((a, b) =>
                a.name === 'General Checkup' ? -1 : b.name === 'General Checkup' ? 1 : 0,
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Button type="submit" disabled={busy || !data}>
          {busy ? 'Sending…' : 'Send doctor invitation'}
        </Button>
      </form>
    </Modal>
  );
}
export function AccountPanel() {
  const identity = useIdentity();
  const { error: loadError } = useAccount();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [invite, setInvite] = useState(false);
  const [qr, setQr] = useState<{ factorId: string; qr: string } | null>(null);
  const [factors, setFactors] = useState<{ id: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    function focusFromHash() {
      const id = window.location.hash.slice(1);
      if (!isAccountSection(id) || focusAccountSection(id)) return;
      if (attempts++ < 20) frame = window.requestAnimationFrame(focusFromHash);
    }
    focusFromHash();
    window.addEventListener('hashchange', focusFromHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', focusFromHash);
    };
  }, []);
  async function run(action: string, input = {}) {
    setBusy(true);
    setError('');
    try {
      const result = await authRequest(action, input);
      setMessage(result.message ?? 'Done.');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <ProfileInformation />
      <Panel
        id={ACCOUNT_SECURITY_SECTION_ID}
        title="Your verified account"
        subtitle="Your verified email and clinic permissions"
      >
        <div className="panel-form form-stack">
          <strong>{displayName(identity?.name ?? '')}</strong>
          <p>{identity?.email}</p>
          <p className="small muted">Manage your account and security preferences.</p>
          {(error || loadError) && (
            <p className="form-error" role="alert">
              {error || loadError}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {identity?.memberships.some((m) => m.roles.includes('admin')) && (
            <Button onClick={() => setInvite(true)}>Invite a doctor</Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              const r = await run('logout');
              if (r) {
                clearClinicalCache();
                window.location.assign(r.next);
              }
            }}
          >
            Sign out of all sessions
          </Button>
          <Link className="text-link" href="/auth/forgot">
            Reset password by email
          </Link>
        </div>
      </Panel>
      <Panel
        title="Authenticator security"
        subtitle="Optional TOTP · Verified factors are required on subsequent sign-ins"
      >
        <div className="panel-form form-stack">
          <Button
            disabled={busy}
            variant="outline"
            onClick={async () => {
              const r = await run('mfa-list');
              if (r) setFactors(r.factors);
            }}
          >
            Manage authenticators
          </Button>
          {factors.map((f) => (
            <div key={f.id}>
              <span>Authenticator · {f.status}</span>
              <Button
                disabled={busy}
                variant="outline"
                onClick={async () => {
                  const r = await run('mfa-remove', { factorId: f.id });
                  if (r) setFactors(factors.filter((x) => x.id !== f.id));
                }}
              >
                Remove authenticator
              </Button>
            </div>
          ))}
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run('mfa-enroll');
              if (r) setQr(r);
            }}
          >
            Set up authenticator
          </Button>
          {qr && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const code = new FormData(e.currentTarget).get('code');
                const r = await run('mfa-verify', { factorId: qr.factorId, code });
                if (r) {
                  setQr(null);
                  setMessage('Authenticator enabled.');
                }
              }}
            >
              {/* Supabase provides this QR as SVG/data URI. Keep it out of logs and external image services. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Scan this QR code with your authenticator app"
                width={220}
                height={220}
                src={
                  qr.qr.startsWith('data:')
                    ? qr.qr
                    : `data:image/svg+xml;utf8,${encodeURIComponent(qr.qr)}`
                }
              />
              <Field label="Six-digit authenticator code">
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Verify and enable
              </Button>
            </form>
          )}
        </div>
      </Panel>
      {invite && <DoctorInvitation onClose={() => setInvite(false)} />}
    </div>
  );
}
