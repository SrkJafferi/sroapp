'use client';
import { useEffect, useState, useRef } from 'react';
import { BellRing, Send, Users, ShieldCheck, RefreshCw } from 'lucide-react';
import { useClinic } from './clinic-context';
import { Button, Panel, Field, Modal } from './ui';
import { audienceRoles, templates } from '@/lib/push/contracts';
import styles from './notification-composer.module.css';
type Role = (typeof audienceRoles)[number];
type History = {
  id: string;
  title: string;
  message: string;
  created_at: string;
  recipient_count: number;
  delivery: Record<string, number> | null;
};
export function NotificationComposer() {
  const { role, organizationId, branchId, state, notify, refresh } = useClinic();
  const [branch, setBranch] = useState(branchId);
  const [template, setTemplate] = useState<keyof typeof templates>('general');
  const [title, setTitle] = useState<string>(templates.general.title);
  const [message, setMessage] = useState<string>(templates.general.message);
  const [roles, setRoles] = useState<Role[]>(['doctor', 'patient']);
  const [preview, setPreview] = useState<{ count: number; confirmation: string } | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const requestId = useRef<string>('');
  const invalidate = () => {
    setPreview(null);
    setError('');
    requestId.current = '';
  };
  const endpoint = `/api/push/broadcast?organizationId=${organizationId}&branchId=${branch}`;
  useEffect(() => {
    if (role !== 'admin') return;
    let current = true;
    void fetch(endpoint, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error || 'History is unavailable.');
        if (current) {
          setHistory(data);
          setHistoryError('');
        }
      })
      .catch((e) => {
        if (current) setHistoryError(e.message);
      });
    return () => {
      current = false;
    };
  }, [role, endpoint]);
  if (role !== 'admin') return null;
  async function submit(action: 'preview' | 'send') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          organizationId,
          branchId: branch,
          roles,
          title,
          message,
          requestId: requestId.current,
          confirmation: preview?.confirmation,
          confirm: action === 'send',
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Notification request failed.');
      if (action === 'preview') setPreview(data);
      else {
        setConfirm(false);
        setPreview(null);
        requestId.current = '';
        notify({ message: `Notification sent to ${data.count} recipients.` });
        await refresh();
        const h = await fetch(endpoint, { cache: 'no-store' });
        if (h.ok) {
          setHistory(await h.json());
          setHistoryError('');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this request.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.center}>
      <Panel
        title="Notification center"
        subtitle="Keep your clinic connected with thoughtful, targeted updates."
      >
        <div className={styles.heading}>
          <span className={styles.icon}>
            <BellRing size={24} />
          </span>
          <div>
            <h3>Compose an announcement</h3>
            <p>Choose your audience, preview recipients and confirm before sending.</p>
          </div>
          <span className={styles.admin}>
            <ShieldCheck size={15} /> Admin only
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit('preview');
          }}
          className={styles.form}
        >
          <Field label="Start with a template">
            <select
              value={template}
              onChange={(e) => {
                const value = e.target.value as keyof typeof templates;
                setTemplate(value);
                setTitle(templates[value].title);
                setMessage(templates[value].message);
                invalidate();
              }}
            >
              <option value="general">General announcement</option>
              <option value="doctor">New Doctor</option>
              <option value="branch">New branch</option>
              <option value="appointment">Appointment update</option>
            </select>
          </Field>
          <Field label="Clinic branch">
            <select
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                invalidate();
              }}
            >
                <option value="">All branches — organization-wide authority required</option>
              {state.branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <div className={styles.wide}>
            <Field label="Notification title">
              <input
                value={title}
                maxLength={120}
                required
                onChange={(e) => {
                  setTitle(e.target.value);
                  invalidate();
                }}
              />
            </Field>
            <small>{title.length}/120</small>
          </div>
          <div className={styles.wide}>
            <Field label="Message">
              <textarea
                  aria-label="Message"
                rows={4}
                value={message}
                maxLength={250}
                required
                onChange={(e) => {
                  setMessage(e.target.value);
                  invalidate();
                }}
              />
            </Field>
            <small>{message.length}/250 · Do not include patient or medical information.</small>
          </div>
          <fieldset className={styles.wide}>
            <legend>Audience</legend>
            <div className={styles.audience}>
              {audienceRoles.map((r) => (
                <label key={r} className={roles.includes(r) ? styles.selected : ''}>
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={() => {
                      setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
                      invalidate();
                    }}
                  />
                  <Users size={18} />
                  {r === 'admin' ? 'Admins' : r === 'doctor' ? 'Doctors' : 'Patients'}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={`${styles.privacy} ${styles.wide}`}>
            <ShieldCheck size={20} />
            <p>
              Mobile alerts show a private, generic message. Full announcements are available only
              after secure sign-in. Recipients are verified against current clinic and branch
              permissions.
            </p>
          </div>
          {error && (
            <p role="alert" className={`${styles.error} ${styles.wide}`}>
              {error}
            </p>
          )}
          <div className={`${styles.actions} ${styles.wide}`}>
            <span aria-live="polite">
              {preview
                ? `${preview.count} authorized recipients`
                : 'Preview the audience before sending.'}
            </span>
            <Button variant="outline" type="submit" disabled={busy || !roles.length}>
              <Users size={16} />
              {busy ? 'Checking…' : 'Preview recipients'}
            </Button>
            <Button
              type="button"
              disabled={busy || !preview?.count}
              onClick={() => setConfirm(true)}
            >
              <Send size={16} /> Review & send
            </Button>
          </div>
        </form>
      </Panel>
      <Panel
        title="Notification history"
        subtitle="Audited announcements and device delivery outcomes."
      >
        {historyError ? (
          <p className="info-note">{historyError}</p>
        ) : !history.length ? (
          <p className="muted">No announcements have been sent.</p>
        ) : (
          <div className={styles.history}>
            {history.map((h) => (
              <article key={h.id}>
                <BellRing size={19} />
                <div>
                  <h3>{h.title}</h3>
                  <p>{h.message}</p>
                  <small>
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone: 'Asia/Karachi',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(h.created_at))}{' '}
                    · {h.recipient_count} recipients
                  </small>
                  <p>
                    {Object.entries(h.delivery ?? {})
                      .map(([s, n]) => `${n} ${s}`)
                      .join(' · ') || 'No registered push devices'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className={styles.receipts}>
          <RefreshCw size={14} /> Accepted tickets are not delivery receipts. Delivery status
          updates when the approved worker checks Expo receipts.
        </p>
      </Panel>
      {confirm && (
        <Modal
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
          title="Confirm notification"
          description="Review the final audience and announcement before sending."
        >
          <h3>{title}</h3>
          <p>{message}</p>
          <p>
            <strong>{preview?.count ?? 0} authorized recipients</strong> · {roles.join(', ')}
          </p>
          <p className="muted">
            This creates one WebApp notification and queues eligible mobile alerts. Sending cannot
            be undone.
          </p>
          {!!error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !preview?.count} onClick={() => void submit('send')}>
              <Send size={16} />
              {busy ? 'Sending…' : 'Confirm & send'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
