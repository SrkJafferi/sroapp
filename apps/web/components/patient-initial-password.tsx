'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LoginExperience } from './login-experience';
import { Button, Field } from './ui';
import { patientAccessRequest } from './patient-access-client';
import { clearClinicalCache } from '@/lib/clinical-cache';
export function PatientInitialPassword() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <LoginExperience>
      <div className="auth-card">
        <div className="auth-mobile-logo">
          <Image src="/sro-logo.png" alt="SRO" width={265} height={111} />
        </div>
        <h2>Choose your private password</h2>
        <p>Replace the temporary password provided by your clinic before accessing your account.</p>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const data = new FormData(e.currentTarget);
            if (data.get('password') !== data.get('confirm')) {
              setError('Passwords must match.');
              return;
            }
            setBusy(true);
            try {
              await patientAccessRequest({
                action: 'change-password',
                password: data.get('password'),
              });
              clearClinicalCache();
              router.replace('/auth/continue');
              router.refresh();
            } catch {
              setError(
                'Password change was not confirmed. Use a different strong password or contact your clinic.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password">
            <input
              name="password"
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              name="confirm"
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save private password'}
          </Button>
        </form>
      </div>
    </LoginExperience>
  );
}
