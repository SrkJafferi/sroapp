'use client';
import { useRef, useState, useEffect } from 'react';
import { Hourglass, RefreshCw, CircleX } from 'lucide-react';
import type { DoctorInvitation } from '@sro/types';
import { useClinic } from './clinic-context';
import { Button, Empty, Modal, Panel } from './ui';

const timestamp = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(value))
    : 'Not recorded';

export function PendingInvitations() {
  const { state, role, actor, organizationId, act, pending } = useClinic();
  const [confirm, setConfirm] = useState<DoctorInvitation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scope, setScope] = useState('all');
  const lock = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (role !== 'admin') return null;
  const authorizedBranches = state.branches.filter(
    (b) => b.active && actor.branchIds.includes(b.id),
  );
  const authorizedBranchIds = new Set(authorizedBranches.map((b) => b.id));
  const allPending = state.invitations
    .filter(
      (i) => authorizedBranchIds.has(i.branchId) && ['draft', 'sent', 'expired'].includes(i.status),
    )
    .sort((a, b) => (b.sentAt ?? b.createdAt ?? '').localeCompare(a.sentAt ?? a.createdAt ?? ''));
  const selectedScope = scope === 'all' || authorizedBranchIds.has(scope) ? scope : 'all';
  const invitations =
    selectedScope === 'all' ? allPending : allPending.filter((i) => i.branchId === selectedScope);
  const scopeName = authorizedBranches.find((b) => b.id === selectedScope)?.name;
  const manage = async (invitation: DoctorInvitation, action: 'resend' | 'revoke') => {
    if (lock.current || pending) return;
    lock.current = true;
    setBusy(invitation.id);
    try {
      const saved = await act(
        async () => {
          const result = await fetch('/api/doctor-invitations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: invitation.id, organizationId, action }),
          });
          const body = await result.json();
          if (!result.ok) throw new Error(body.error ?? 'Unable to manage invitation.');
        },
        action === 'revoke'
          ? 'Invitation revoked successfully.'
          : 'Invitation resent. It expires in 24 hours.',
      );
      if (saved) setConfirm(null);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  return (
    <Panel
      title="Pending Invitations"
      subtitle="Manage Doctor invitations that are awaiting registration."
      className="invitation-panel"
      action={<Hourglass size={24} aria-hidden="true" />}
    >
      <div className="invitation-toolbar">
        <label className="invitation-scope">
          <span>Branch</span>
          <select
            aria-label="Filter pending invitations by branch"
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
        <span className="invitation-count" aria-live="polite">
          {allPending.length} pending
        </span>
      </div>
      <div className="table-scroll" aria-busy={Boolean(busy)}>
        <table className="data-table invitation-table">
          <thead>
            <tr>
              {[
                'DOCTOR NAME',
                'DOCTOR EMAIL',
                'BRANCH',
                'DEPARTMENT',
                'SENT',
                'EXPIRES',
                'STATUS',
                'ACTIONS',
              ].map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invitations.map((i) => {
              const expired =
                i.status === 'expired' || Boolean(i.expiresAt && Date.parse(i.expiresAt) <= now);
              return (
                <tr key={i.id}>
                  <td>
                    <strong>{i.name}</strong>
                  </td>
                  <td>{i.email}</td>
                  <td>{state.branches.find((b) => b.id === i.branchId)?.name ?? 'Unavailable'}</td>
                  <td>
                    {state.specializations.find((s) => s.id === i.specializationId)?.name ??
                      'Unavailable'}
                  </td>
                  <td>
                    <time dateTime={i.sentAt}>{timestamp(i.sentAt)}</time>
                  </td>
                  <td>
                    <time dateTime={i.expiresAt}>{timestamp(i.expiresAt)}</time>
                  </td>
                  <td>
                    <span className={`badge badge-${expired ? 'pending' : 'neutral'}`}>
                      {expired ? 'Expired' : 'Pending'}
                    </span>
                    {i.status === 'draft' && <small>Delivery not confirmed</small>}
                  </td>
                  <td>
                    <div className="invitation-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(busy) || pending}
                        onClick={() => void manage(i, 'resend')}
                        aria-label={`Resend invitation to ${i.name}`}
                      >
                        <RefreshCw size={15} />
                        {busy === i.id ? 'Working…' : 'Resend'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="invitation-revoke"
                        size="sm"
                        disabled={Boolean(busy) || pending}
                        onClick={() => setConfirm(i)}
                        aria-label={`Revoke invitation to ${i.name}`}
                      >
                        <CircleX size={15} />
                        Revoke
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!invitations.length && (
        <Empty
          title="No pending invitations"
          text={
            selectedScope === 'all'
              ? 'Invitations awaiting registration will appear here for all authorized clinic branches.'
              : `Invitations awaiting registration for ${scopeName ?? 'this branch'} will appear here.`
          }
        />
      )}
      {confirm && (
        <Modal
          title="Revoke Doctor invitation?"
          description={`The invitation for ${confirm.name} will become unusable immediately, including an already opened onboarding page. Activated Doctor accounts will not be removed.`}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="form-actions">
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={Boolean(busy) || pending}
              onClick={() => void manage(confirm, 'revoke')}
            >
              {busy ? 'Revoking…' : 'Confirm Revoke'}
            </Button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
