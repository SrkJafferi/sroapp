'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, FileHeart, Pencil, CalendarPlus } from 'lucide-react';
import { Button } from './ui';
import { EditProfileDialog } from './profile-editor';
import { useWorkspaceNavigate } from './workspace-route';
import type { ProfileTarget } from '@/lib/profile-contracts';

export function PatientActions({
  target,
  name,
  recordsHref,
  clinicalAccess,
  onFollowUp,
}: {
  target: ProfileTarget;
  name: string;
  recordsHref: string;
  clinicalAccess: boolean;
  onFollowUp: () => void;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const navigate = useWorkspaceNavigate();
  const close = (restore = true) => {
    setPosition(null);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    const list = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    list?.[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node))
        setPosition(null);
    };
    const reposition = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      setPosition(null);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [position]);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        className="patient-actions-trigger"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            trigger.current?.click();
          }
        }}
        onClick={() => {
          if (position) return close();
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(12, Math.min(rect.right - 228, window.innerWidth - 240)),
            top:
              rect.bottom + 170 > window.innerHeight
                ? Math.max(12, rect.top - 164)
                : rect.bottom + 6,
          });
        }}
      >
        <Ellipsis size={20} />
      </Button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={`Patient actions for ${name}`}
            className="patient-actions-menu"
            style={position}
            onBlur={(e) => {
              if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node))
                setPosition(null);
            }}
            onKeyDown={(e) => {
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
              );
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const index =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? items.length - 1
                      : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[index]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              disabled={!clinicalAccess}
              title={!clinicalAccess ? 'Clinical access required' : undefined}
              onClick={() => {
                close(false);
                navigate(recordsHref);
              }}
            >
              <FileHeart size={16} />
              View records
            </button>
            <button
              role="menuitem"
              disabled={!clinicalAccess}
              title={!clinicalAccess ? 'Clinical access required' : undefined}
              onClick={() => {
                close(false);
                setEditing(true);
              }}
            >
              <Pencil size={16} />
              Edit profile
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close(false);
                onFollowUp();
              }}
            >
              <CalendarPlus size={16} />
              Schedule a follow-up
            </button>
          </div>,
          document.body,
        )}
      {editing && (
        <EditProfileDialog
          key={`${target.organizationId}:${target.id}`}
          target={target}
          onClose={() => {
            setEditing(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
        />
      )}
    </>
  );
}
