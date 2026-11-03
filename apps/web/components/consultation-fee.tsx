'use client';
import { useRef, useState } from 'react';
import { consultationFeeSchema } from '@sro/validation';
import { money } from '@sro/clinic-core';
import { useClinic } from './clinic-context';
import { Button, Field, Modal } from './ui';

export function ConsultationFeeForm({
  doctorId,
  onClose,
}: {
  doctorId?: string;
  onClose: () => void;
}) {
  const { state, actor, role, branchId, clinic, act, pending } = useClinic();
  const options = state.assignments.filter(
    (a) =>
      a.active &&
      a.doctorId === doctorId &&
      actor.branchIds.includes(a.branchId) &&
      state.branches.some((b) => b.id === a.branchId && b.active),
  );
  const initial = options.find((a) => a.branchId === branchId) ?? options[0];
  const [selectedBranch, setSelectedBranch] = useState(initial?.branchId ?? '');
  const [type, setType] = useState(initial?.fee ? 'paid' : 'free');
  const [amount, setAmount] = useState(initial?.fee ? String(initial.fee) : '');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const assignment = options.find((a) => a.branchId === selectedBranch);
  if (role !== 'admin') return null;
  return (
    <Modal
      title="Edit Consultation Fee"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || lock.current) return;
          const fee = type === 'free' ? '0' : amount;
          const parsed = consultationFeeSchema.safeParse(fee);
          if (!parsed.success || (type === 'paid' && parsed.data === 0)) {
            setError(
              parsed.success
                ? 'Enter a positive consultation fee.'
                : parsed.error.issues[0].message,
            );
            return;
          }
          if (!assignment || !doctorId) {
            setError('No authorized active branch assignment is available.');
            return;
          }
          setError('');
          lock.current = true;
          try {
            const success = await act(
              () => clinic.saveFee(actor, doctorId, selectedBranch, fee),
              'Consultation fee updated.',
            );
            if (success) onClose();
          } finally {
            lock.current = false;
          }
        }}
      >
        <p>
          <strong>{state.doctors.find((d) => d.id === doctorId)?.name}</strong>
        </p>
        <fieldset className="profile-form-fields form-stack" disabled={pending}>
          <Field label="Clinic Branch">
            <select
              aria-label="Clinic Branch"
              required
              value={selectedBranch}
              onChange={(e) => {
                const next = options.find((a) => a.branchId === e.target.value);
                setSelectedBranch(e.target.value);
                setType(next?.fee ? 'paid' : 'free');
                setAmount(next?.fee ? String(next.fee) : '');
                setError('');
              }}
            >
              {!options.length && <option value="">No authorized branch assignment</option>}
              {options.map((a) => (
                <option key={a.branchId} value={a.branchId}>
                  {state.branches.find((b) => b.id === a.branchId)?.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Consultation Type">
            <select
              aria-label="Consultation Type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setError('');
              }}
            >
              <option value="free">Free Consultation</option>
              <option value="paid">Paid Consultation</option>
            </select>
          </Field>
          {type === 'paid' && (
            <Field label="Consultation Fee (PKR)">
              <input
                aria-label="Consultation Fee (PKR)"
                type="text"
                inputMode="decimal"
                required
                maxLength={16}
                placeholder="1500.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError('');
                }}
              />
              <small>Up to Rs. 1,000,000 · maximum two decimal places.</small>
            </Field>
          )}
          <div className="info-note">
            Current fee: {assignment ? money(assignment.fee) : 'Unavailable'}. Changes apply to
            future bookings. Existing appointments keep their agreed fee.
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !assignment}>
            {pending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
