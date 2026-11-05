'use client';
import { useEffect, useState, useRef } from 'react';
import { BellRing, Send, Users, ShieldCheck, RefreshCw } from 'lucide-react';
import { useClinic } from './clinic-context';
import { Button, Panel, Field, Modal } from './ui';
import { audienceRoles, templates } from '@/lib/push/contracts';
import styles from './notification-composer.module.css';
import { WorkspaceLink } from './workspace-route';
import {
  deliveryCounts,
  notificationTotals,
  type BroadcastHistory as History,
} from '@/lib/push/history-model';
type Role = (typeof audienceRoles)[number];
type Publishing = {ready:boolean;reason:string;scope?:{recipientName:string;recipientId:string;installationId:string;expiresAt:string}};
type Capability = {
  version: number;
  webEnabled: boolean;
  databaseEnabled: boolean;
  broadcastsEnabled: boolean;
  individualTargeting: boolean;
  pilotEligible: boolean;
  pilotOwnDevice: boolean;
  pilotPrepared: boolean;
};
export function NotificationComposer() {
  const {role,organizationId,branchId}=useClinic();
  if(role!=='admin')return null;
  return <Composer key={`${organizationId}:${branchId}`}/>;
}
function Composer() {
  const { role, organizationId, branchId, state, actor, notify, refresh } = useClinic();
  const [branch, setBranch] = useState(branchId);
  const [template, setTemplate] = useState<keyof typeof templates>('general');
  const [title, setTitle] = useState<string>(templates.general.title);
  const [message, setMessage] = useState<string>(templates.general.message);
  const [roles, setRoles] = useState<Role[]>(['doctor', 'patient']);
  const [preview, setPreview] = useState<{ count: number; confirmation: string; publishing?:Publishing } | null>(null);
  const [history, setHistory] = useState<History[] | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [setupError, setSetupError] = useState('');
  const [mode, setMode] = useState<'roles' | 'individuals' | 'pilot'>('roles');
  const [recipients, setRecipients] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientError, setRecipientError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const requestId = useRef<string>('');
  const inFlight = useRef(false);
  const generation = useRef(0);
  const invalidate = () => {
    generation.current++;
    setPreview(null);
    setError('');
    requestId.current = '';
  };
  const endpoint = `/api/push/broadcast?organizationId=${organizationId}&branchId=${branch}`;
  const management = `/api/push/management?organizationId=${organizationId}&branchId=${branch}`;
  useEffect(() => {
    if (role !== 'admin') return;
    const controller = new AbortController();
    void fetch(management, { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || 'Publishing setup unavailable.');
        if (!controller.signal.aborted) setCapability(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSetupError(e.message);
      });
    return () => controller.abort();
  }, [role, management]);
  useEffect(() => {
    if (role !== 'admin' || mode !== 'individuals' || !capability?.individualTargeting) return;
    const controller = new AbortController();
    void fetch(management + '&audience=1&roles=' + roles.join(','), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || 'Recipients unavailable.');
        if (!controller.signal.aborted) setRecipients(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setRecipientError(e.message);
      });
    return () => controller.abort();
  }, [role, mode, management, roles, capability?.individualTargeting]);
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
  useEffect(() => {
    const scope=preview?.publishing?.scope;
    if(!preview?.publishing?.ready||!scope)return;
    const timer=setTimeout(()=>setPreview(current=>current?{...current,publishing:{ready:false,reason:'The approved delivery window has expired. Publishing remains paused.'}}:current),Math.max(0,Date.parse(scope.expiresAt)-Date.now()));
    return ()=>clearTimeout(timer);
  },[preview]);
  if (role !== 'admin') return null;
  const totals = history ? notificationTotals(history) : null;
  const canPublish =
    !!capability?.webEnabled &&
    !!capability?.databaseEnabled &&
    mode === 'pilot' && !capability.broadcastsEnabled &&
    capability.pilotEligible && capability.pilotOwnDevice && !capability.pilotPrepared &&
    !!preview?.publishing?.ready && !!preview.publishing.scope;
  const chooseMode = (value: typeof mode) => {
    setRecipients([]);setRecipientError('');
    setMode(value);
    setSelected(value === 'pilot' ? [actor.id] : []);
    if (value === 'pilot') {
      setRoles(['admin']);
      setTitle('SRO Clinic');
      setMessage('Your clinic notification connection is ready.');
      if (!branch) setBranch(branchId || state.branches[0]?.id || '');
    }
    invalidate();
  };
  async function submit(action: 'preview' | 'send') {
    if (inFlight.current) return;
    if (action === 'send' && !canPublish) {
      setError('Publishing is paused. No notification was created.');
      return;
    }
    inFlight.current = true;
    const version = generation.current;
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
          audienceMode: mode,
          recipientIds: selected,
          title,
          message,
          requestId: requestId.current,
          confirmation: preview?.confirmation,
          confirm: action === 'send',
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Notification request failed.');
      if (action === 'preview') {
        if (version === generation.current) setPreview(data);
      } else {
        setConfirm(false);
        setPreview(null);
        requestId.current = '';
        notify({
          message: `Notification created for ${data.count} recipients. Mobile delivery is not yet confirmed.`,
        });
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
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.center}>
      <div className={styles.dashboard}>
        {(
          [
            ['Inbox recipients', totals?.recipients],
            ['Pending delivery', totals?.pending],
            ['Provider accepted', totals?.accepted],
            ['Failed delivery', totals?.failed],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value ?? '—'}</strong>
            <small>Latest 50 announcements</small>
          </div>
        ))}
      </div>
      <div className={styles.publishing} role="status">
        <ShieldCheck size={22} />
        <div>
          <strong>{canPublish ? 'Scoped publishing available' : 'Publishing paused'}</strong>
          <p>
            {setupError ||
              'Prepare messages, preview authorized recipients and review history. Publishing requires an approved delivery scope.'}
          </p>
        </div>
        <WorkspaceLink href="/admin/notifications" className="btn btn-outline">
          My notification inbox
        </WorkspaceLink>
      </div>
      <Panel
        title="Compose notification"
        subtitle="Keep your clinic connected with thoughtful, targeted updates."
      >
        <div className={styles.heading}>
          <span className={styles.icon}>
            <BellRing size={24} />
          </span>
          <div>
            <h3>Keep your clinic informed</h3>
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
              disabled={mode === 'pilot' || busy}
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
          <Field label="Delivery audience">
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => chooseMode(e.target.value as typeof mode)}
            >
              <option value="roles">Selected roles</option>
              <option value="individuals" disabled={!capability?.individualTargeting}>
                Individual recipients
              </option>
              <option value="pilot">Single approved device</option>
            </select>
          </Field>
          <Field label="Clinic branch">
            <select
              value={branch}
              disabled={busy}
              onChange={(e) => {
                setBranch(e.target.value);
                setHistory(null);setHistoryError('');setCapability(null);setSetupError('');setRecipients([]);setRecipientError('');setSelected([]);
                invalidate();
              }}
            >
              {mode !== 'pilot' && <option value="">All authorized branches</option>}
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
                readOnly={mode === 'pilot'}
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
                readOnly={mode === 'pilot'}
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
                    disabled={mode === 'pilot' || busy}
                    onChange={() => {
                      setSelected([]);
                      setRecipients([]);setRecipientError('');
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
          {mode === 'individuals' && (
            <div className={styles.wide}>
              <Field label="Find authorized recipients">
                <input
                  type="search"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="Search by name"
                />
              </Field>
              {recipientError ? (
                <p role="alert" className={styles.error}>
                  {recipientError}
                </p>
              ) : (
                <fieldset className={styles.recipientList}>
                  <legend>{selected.length} selected</legend>
                  {recipients
                    .filter((p) => p.name.toLowerCase().includes(recipientSearch.toLowerCase()))
                    .map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => {
                            setSelected(
                              selected.includes(p.id)
                                ? selected.filter((id) => id !== p.id)
                                : [...selected, p.id],
                            );
                            invalidate();
                          }}
                        />
                        {p.name}
                      </label>
                    ))}
                  {!recipients.length && (
                    <p>No authorized recipients available for this selection.</p>
                  )}
                </fieldset>
              )}
            </div>
          )}
          {mode === 'pilot' && (
            <div className={`${styles.privacy} ${styles.wide}`}>
              <ShieldCheck size={20} />
              <p>
                Only the approved Administrator and their single registered device can receive this
                controlled message. Doctor and Patient devices are not included.{' '}
                {canPublish
                  ? 'Review the exact recipient before confirming.'
                  : 'No message can be sent until account, device and delivery window are approved.'}
              </p>
            </div>
          )}
          {mode === 'roles' && !capability?.individualTargeting && (
            <p className={`${styles.wide} muted`}>
              Individual recipient targeting is not active yet. Role-based previews remain
              available.
            </p>
          )}
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
            <Button
              variant="outline"
              type="submit"
              disabled={
                busy ||
                !roles.length ||
                (mode === 'individuals' && !selected.length) ||
                (mode === 'pilot' && (!capability?.pilotEligible || !capability?.pilotOwnDevice))
              }
            >
              <Users size={16} />
              {busy ? 'Checking…' : 'Preview recipients'}
            </Button>
            <Button
              type="button"
              disabled={busy || !preview}
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
        ) : !history ? (
          <p role="status" className="info-note">
            Loading notification history…
          </p>
        ) : (
          <div className={styles.historyTable}>
            <table>
              <thead>
                <tr>
                  <th>Announcement</th>
                  <th>Recipients</th>
                  <th>Pending</th>
                  <th>Provider accepted</th>
                  <th>Failed</th>
                  <th>Inbox read</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const d = deliveryCounts(h);
                  return (
                    <tr key={h.id}>
                      <td>
                        <strong>{h.title}</strong>
                        <p>{h.message}</p>
                        <small>
                          {new Intl.DateTimeFormat('en-GB', {
                            timeZone: 'Asia/Karachi',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(h.created_at))}
                        </small>
                        {(d.uncertain > 0 || d.cancelled > 0) && (
                          <p>
                            {d.uncertain} need review · {d.cancelled} cancelled
                          </p>
                        )}
                      </td>
                      <td>{h.recipient_count}</td>
                      <td>{d.pending}</td>
                      <td>{d.accepted}</td>
                      <td>{d.failed}</td>
                      <td>{d.read ?? 'Not reported'}</td>
                    </tr>
                  );
                })}
                {!history.length && (
                  <tr>
                    <td colSpan={6}>
                      <p>No announcements have been created.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.receipts}>
          <RefreshCw size={14} /> Accepted tickets are not delivery receipts. Delivery status
          updates when the approved worker checks Expo receipts. Inbox read status is separate from
          mobile delivery.
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
          <h3 className={styles.reviewText}>{title}</h3>
          <p className={styles.reviewText}>{message}</p>
          <p>
            <strong>{preview?.count ?? 0} authorized recipients</strong> · {roles.join(', ')}
          </p>
          <p className={styles.reviewText}><strong>Clinic branch:</strong> {state.branches.find(b=>b.id===branch)?.name??'All authorized branches'}</p>
          {mode==='individuals'&&<p className={styles.reviewText}><strong>Selected recipients:</strong> {recipients.filter(p=>selected.includes(p.id)).map(p=>p.name).join(', ')}</p>}
          {mode==='pilot'&&preview?.publishing?.scope&&<div className="info-note">
            <p><strong>Authorized recipient:</strong> {preview.publishing.scope.recipientName}</p>
            <p style={{overflowWrap:'anywhere'}}><strong>Approved installation:</strong> {preview.publishing.scope.installationId}</p>
            <p><strong>Window ends:</strong> {new Date(preview.publishing.scope.expiresAt).toISOString()} · One message only</p>
          </div>}
          <p className="info-note" role="status">{canPublish?'Confirming creates one inbox notification and queues an alert for the approved installation. Delivery is not yet confirmed.':preview?.publishing?.reason??'Publishing is paused. You can review this notification; no notification will be created.'}</p>
          {!!error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !preview?.count || !canPublish}
              onClick={() => void submit('send')}
            >
              <Send size={16} />
              {busy ? 'Sending…' : 'Confirm & send'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
