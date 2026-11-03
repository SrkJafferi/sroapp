'use client';
import { useEffect, useState } from 'react';
import type { createMockRepository } from '@sro/data-access';
import type { Appointment, BookingInput, DemoRole, UserProfile } from '@sro/types';
import type { AvailableSlot } from './clinical-contracts';
import { consultationFeeSchema, paisaToPkr, departmentSchema } from '@sro/validation';

type Mock = ReturnType<typeof createMockRepository>;
type Methods = Exclude<keyof Mock, 'getSnapshot' | 'subscribe' | 'book' | 'requestReschedule'>;
type AsyncMethods = {
  [K in Methods]: Mock[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : never;
};
export type WebClinicRepository = Omit<AsyncMethods, 'addPatient' | 'saveFee'> & {
  markNotificationRead: (actor: UserProfile, notificationId: string) => Promise<void>;
  updateSpecialization: (
    actor: UserProfile,
    id: string,
    name: string,
    description: string,
  ) => Promise<void>;
  saveFee: (actor: UserProfile, doctorId: string, branchId: string, fee: string) => Promise<void>;
  book: (
    actor: UserProfile,
    input: BookingInput & { slotId: string },
  ) => Promise<Pick<Appointment, 'id' | 'status'>>;
  requestReschedule: (
    actor: UserProfile,
    id: string,
    date: string,
    time: string,
    reason: string,
    slotId: string,
  ) => Promise<void>;
  addPatient: (
    actor: UserProfile,
    input: {
      name: string;
      email: string;
      phone: string;
      ageYears: number;
      bloodGroup: string;
      gender: string;
      branchId: string;
      address: string;
      requestId: string;
    },
  ) => Promise<{ id: string; patientCode: string }>;
};
export function clinicalQuery(role: DemoRole, organizationId: string) {
  return new URLSearchParams({ role, organizationId });
}
export class ClinicalRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function readClinical(url: string) {
  const r = await fetch(url, { cache: 'no-store' });
  const data = await r.json();
  if (!r.ok)
    throw new ClinicalRequestError(data.error ?? 'Unable to load clinic records.', r.status);
  return data;
}
export function createClinicalRepository(
  role: DemoRole,
  organizationId: string,
  activeBranch: string,
): WebClinicRepository {
  async function command(command: string, input: unknown): Promise<unknown> {
    const r = await fetch('/api/clinic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, organizationId, command, input }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'The change could not be saved.');
    return command === 'book' ? { id: data.id, status: data.status } : data.id;
  }
  const configure = (action: string, data: unknown, branch = activeBranch) =>
    command('configure', { branchId: branch, action, data });
  const unavailable = (message: string): never => {
    throw new Error(message);
  };
  return {
    book: async (_actor, input) =>
      (await command('book', input)) as Pick<Appointment, 'id' | 'status'>,
    transition: async (_actor, id, status) => {
      await command('transition', { id, status });
    },
    requestReschedule: async (_actor, id, _date, _time, reason, slotId) => {
      await command('reschedule', { id, reason, slotId });
    },
    saveBranch: async (_actor, input, id) => {
      await configure('branch', { ...input, id });
    },
    grant: async (_actor, patientId, userId, reason) => {
      await command('grant', { branchId: activeBranch, patientId, userId, reason });
    },
    addLeave: async (_actor, doctorId, branchId, startDate, endDate, reason) => {
      await command('leave', { doctorId, branchId, startDate, endDate, reason });
    },
    saveSchedule: async (_actor, input) => {
      await configure('schedule', input, input.branchId);
    },
    saveConsultation: async (_actor, input, items) => {
      await command('consultation', { ...input, items });
    },
    saveHistory: async (_actor, patientId, history) => {
      await command('history', { branchId: activeBranch, patientId, history });
    },
    saveFee: async (_actor, doctorId, branchId, fee) => {
      await configure(
        'fee',
        { doctorId, fee: paisaToPkr(consultationFeeSchema.parse(fee)) },
        branchId,
      );
    },
    addSpecialization: async (_actor, name, description) => {
      await configure('department', departmentSchema.parse({ name, description }));
    },
    updateSpecialization: async (_actor, id, name, description) => {
      await configure('department_update', {
        id,
        ...departmentSchema.parse({ name, description }),
      });
    },
    saveDoctor: async (_actor, doctorId, input) => {
      await configure('doctor', { ...input, doctorId });
    },
    assignDoctor: async (_actor, doctorId, branchId) => {
      await configure('assignment', { doctorId }, branchId);
    },
    markRead: async () => {
      await command('mark-read', {});
    },
    markNotificationRead: async (_actor, notificationId) => {
      await command('mark-read', { notificationId });
    },
    addDocument: async () =>
      unavailable(
        'Private document uploads are not enabled yet. Digital prescriptions are available.',
      ),
    addPatient: async (_actor, input) =>
      (await command('register-walk-in', input)) as { id: string; patientCode: string },
    invite: async () => unavailable('Use the secure Doctor invitation form.'),
    setPayment: async () => unavailable('Payment recording is not available.'),
    setTwoFactor: async () => unavailable('Manage your authenticator from Account & security.'),
    saveProfile: async () => unavailable('Use the verified Account profile form.'),
    reset: async () =>
      unavailable('Persisted clinical records cannot be reset from this workspace.'),
  };
}
export function useAvailability(
  role: DemoRole,
  organizationId: string,
  branchId: string,
  doctorId: string,
  date: string,
) {
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!branchId || !doctorId || !date) return;
    const controller = new AbortController();
    let active = true;
    const query = clinicalQuery(role, organizationId);
    query.set('operation', 'availability');
    query.set('branchId', branchId);
    query.set('doctorId', doctorId);
    query.set('date', date);
    // A new selection immediately stops presenting stale slot choices.
    Promise.resolve().then(() => {
      if (active) {
        setLoading(true);
        setSlots([]);
        setError('');
      }
    });
    fetch(`/api/clinic?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) setSlots(d.slots);
      })
      .catch((e) => {
        if (active && e.name !== 'AbortError')
          setError(e instanceof Error ? e.message : 'Availability unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [role, organizationId, branchId, doctorId, date]);
  return { slots, error, loading };
}
