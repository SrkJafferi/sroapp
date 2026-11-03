'use client';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ArrowUpRight, Search, Inbox, type LucideIcon } from 'lucide-react';
import type { AppointmentStatus } from '@sro/types';
import { statusLabels } from '@sro/clinic-core';
import { useAvatar } from '../profile-assets';
import type { ProfileKind } from '@/lib/profile-contracts';
import { Button } from './button';
export { Button };
export function Badge({
  status,
  children,
}: {
  status?: AppointmentStatus | 'paid' | 'unpaid' | 'waived';
  children?: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${status ?? 'neutral'}`}>
      <span className="status-dot" />
      {children ??
        (status && status in statusLabels ? statusLabels[status as AppointmentStatus] : status)}
    </span>
  );
}
export function Avatar({
  initials,
  color = 'purple',
  size = '',
  kind,
  entityId,
  organizationId,
}: {
  initials: string;
  color?: string;
  size?: string;
  kind?: ProfileKind;
  entityId?: string;
  organizationId?: string;
}) {
  const avatarId = useAvatar(kind, entityId, organizationId);
  return (
    <span aria-hidden="true" className={`avatar avatar-${color} ${size}`}>
      {avatarId ? (
        <PrivateAvatarImage key={avatarId} id={avatarId} initials={initials} />
      ) : (
        initials
      )}
    </span>
  );
}
function PrivateAvatarImage({ id, initials }: { id: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return initials;
  // Authenticated, no-store endpoint authorizes each request; no public URL or shared image optimizer.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/profiles/avatar/${id}`}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
export function Panel({
  id,
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  id?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = id && title ? `${id}-heading` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      tabIndex={id ? -1 : undefined}
      className={`panel ${className}`}
    >
      {title && (
        <div className="panel-heading">
          <div>
            <h2 id={headingId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title = 'Nothing here yet',
  text = 'Updates will appear here as you use your clinic workspace.',
  action,
}: {
  title?: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog-content ${wide ? 'dialog-wide' : ''}`}>
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ?? 'Review the details and save your changes securely.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close dialog">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Stat({
  label,
  value,
  icon: Icon,
  color,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  color: string;
  detail: string;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon avatar-${color}`}>
          <Icon size={19} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>
        {detail.startsWith('+') && <ArrowUpRight size={13} />}
        {detail}
      </p>
    </div>
  );
}
