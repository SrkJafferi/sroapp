'use client';
import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  HeartPulse,
  ShieldCheck,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  UserRound,
} from 'lucide-react';
import { LoginExperience } from './login-experience';
import { Button, Field } from './ui';
import { clearClinicalCache } from '@/lib/clinical-cache';

export async function authRequest(action: string, data: unknown = {}) {
  const response = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (response.status === 403 && result.next === '/auth/two-factor')
    window.location.assign(result.next);
  if (!response.ok) throw new Error(result.error ?? 'Unable to complete this request.');
  if (['login', 'logout', 'verify', 'accept-invitation', 'reset', 'mfa-verify'].includes(action))
    clearClinicalCache();
  return result;
}
export function AuthScreen({
  mode,
  patientIdLogin = true,
}: {
  mode: string;
  patientIdLogin?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const fragment = useRef(new URLSearchParams());
  useEffect(() => {
    if (mode === 'login') {
      const intent = new URLSearchParams(window.location.search).get('intent');
      if (['book', 'appointments', 'profile'].includes(intent ?? '')) {
        window.location.replace(`/auth/continue?intent=${intent}`);
        return;
      }
    }
    if (window.location.hash) {
      fragment.current = new URLSearchParams(window.location.hash.slice(1));
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [mode]);
  useEffect(() => {
    if (mode !== 'invitation') return;
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (active && result?.identity?.email) setVerifiedEmail(result.identity.email);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mode]);
  const titles: Record<string, [string, string]> = {
    welcome: ['Welcome to SRO Clinic', 'Sign in to your own clinic workspace.'],
    'account-ready': [
      'Your email is verified',
      'Admin access awaits clinic activation. Invited Doctors should reopen their invitation email. Patients can complete their own profile below.',
    ],
    login: ['Welcome back', 'Sign in to continue your care journey.'],
    register: [
      'Your care starts here',
      'Create a patient account. Verify your email, then complete your profile.',
    ],
    forgot: ['Let’s get you back in', 'Request an email to reset your password.'],
    reset: [
      'Choose a new password',
      'Open your recovery email first. Existing sessions will be signed out.',
    ],
    'verify-email': [
      'Verify your email',
      'Use the confirmation button after opening your email link.',
    ],
    invitation: [
      'Join your care team',
      'Doctor access requires an active invitation and a matching verified email.',
    ],
    'two-factor': ['One more step', 'Enter a code from your authenticator app.'],
    'complete-profile': [
      'Complete your patient profile',
      'Add your contact details. Invited Doctors should return to their original invitation email.',
    ],
    'access-denied': [
      'Workspace unavailable',
      'Your active clinic memberships do not permit access to this workspace.',
    ],
  };
  async function run(action: string, data: unknown) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await authRequest(action, data);
      if (result.next) window.location.assign(result.next);
      else setMessage(result.message ?? 'Done.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (mode === 'invitation') {
      if (!fragment.current.has('id') || !fragment.current.has('token')) {
        setError('Please reopen the original doctor invitation email link.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const login = await authRequest('login', { email: data.email, password: data.password });
        if (login.next === '/auth/two-factor') {
          window.location.assign(login.next);
          return;
        }
        const result = await authRequest('accept-invitation', Object.fromEntries(fragment.current));
        window.location.assign(result.next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invitation could not be accepted.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'verify-email') {
      if (!fragment.current.has('token_hash') || !fragment.current.has('type')) {
        setError('Please reopen the original verification email link.');
        return;
      }
      return run('verify', Object.fromEntries(fragment.current));
    }
    if (mode === 'two-factor') {
      setBusy(true);
      setError('');
      try {
        const list = await authRequest('mfa-list');
        const factor = list.factors.find((f: { status: string }) => f.status === 'verified');
        if (!factor) throw new Error('No verified authenticator found. Sign in again.');
        const result = await authRequest('mfa-verify', { factorId: factor.id, code: data.code });
        window.location.assign(result.next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Verification failed.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'reset' && data.password !== data.confirm) {
      setError('Passwords must match.');
      return;
    }
    return run(
      mode === 'register' ? 'signup' : mode === 'complete-profile' ? 'profile' : mode,
      data,
    );
  }
  const field = (
    name: string,
    label: string,
    type = 'text',
    required = true,
    min?: number,
    max?: number,
  ) => (
    <Field label={label}>
      <span className={mode === 'login' ? 'login-input-wrap' : 'auth-input-wrap'}>
        {mode === 'login' &&
          (name === 'email' ? (
            <Mail className="login-input-icon" size={21} />
          ) : (
            <LockKeyhole className="login-input-icon" size={21} />
          ))}
        <input
          name={name}
          aria-label={label}
          placeholder={
            mode === 'login'
              ? name === 'email'
                ? patientIdLogin
                  ? 'Enter your Patient ID or email'
                  : 'Enter your email address'
                : 'Enter your password'
              : undefined
          }
          type={type === 'password' && mode === 'login' && showPassword ? 'text' : type}
          required={required}
          inputMode={type === 'number' ? 'numeric' : undefined}
          step={type === 'number' ? 1 : undefined}
          min={min}
          max={max}
          autoComplete={
            name === 'password'
              ? mode === 'login' || mode === 'invitation'
                ? 'current-password'
                : 'new-password'
              : name === 'email'
                ? mode === 'login' && patientIdLogin
                  ? 'username'
                  : 'email'
                : undefined
          }
          minLength={
            name === 'password' && !['login', 'invitation'].includes(mode) ? 10 : undefined
          }
        />
        {mode === 'login' && type === 'password' && (
          <button
            type="button"
            className="login-password-toggle"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </span>
    </Field>
  );
  const card = (
    <div className={`auth-card auth-card-${mode}`}>
      <div className="auth-mobile-logo">
        <Image src="/sro-logo.png" alt="SRO" width={178} height={75} />
      </div>
      <span className="specialty-pill">SECURE CLINIC ACCESS</span>
      <h2>{titles[mode][0]}</h2>
      <p>{titles[mode][1]}</p>
      {message && (
        <p className="info-note" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {mode === 'welcome' || mode === 'access-denied' || mode === 'account-ready' ? (
        <div className="form-stack">
          <Link className="btn btn-primary" href="/auth/login">
            Sign in <ArrowRight size={16} />
          </Link>
          <Link
            className="text-link"
            href={mode === 'account-ready' ? '/auth/complete-profile' : '/auth/register'}
          >
            {mode === 'account-ready' ? 'Continue as a patient' : 'Register as a patient'}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {['register', 'complete-profile'].includes(mode) && field('name', 'Full name')}
          {['login', 'register', 'forgot', 'invitation'].includes(mode) &&
            field(
              'email',
              mode === 'login' && patientIdLogin ? 'Patient ID or Email' : 'Email address',
              mode === 'login' && patientIdLogin ? 'text' : 'email',
            )}
          {['login', 'register', 'reset', 'invitation'].includes(mode) &&
            field('password', 'Password', 'password')}
          {mode === 'reset' && field('confirm', 'Confirm password', 'password')}
          {mode === 'complete-profile' && (
            <>
              {field('phone', 'Phone number', 'tel')}
              {field('ageYears', 'Age (Years)', 'number', true, 0, 120)}
              <Field label="Gender">
                <select name="gender" required>
                  <option value="">Select</option>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                  <option>Prefer not to say</option>
                </select>
              </Field>
              {field('address', 'Address', 'text', false)}
            </>
          )}
          {mode === 'two-factor' && (
            <Field label="Six-digit verification code">
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
            </Field>
          )}
          {['register', 'complete-profile'].includes(mode) && (
            <label className="checkbox-label">
              <input type="checkbox" required />I confirm my account details are correct.
            </label>
          )}
          {mode === 'login' && (
            <div className="login-session-row">
              <span>
                <ShieldCheck size={14} />
                Secure session
              </span>
              <Link href="/auth/forgot">Forgot password?</Link>
            </div>
          )}
          <Button disabled={busy} type="submit">
            {busy
              ? 'Please wait…'
              : {
                  login: 'Sign in',
                  register: 'Create account and verify email',
                  forgot: 'Send recovery email',
                  reset: 'Update password',
                  'verify-email': 'Confirm email link',
                  invitation: 'Sign in and accept invitation',
                  'two-factor': 'Verify authenticator',
                  'complete-profile': 'Save patient profile',
                }[mode]}
            <ArrowRight size={15} />
          </Button>
          {mode === 'login' && (
            <div className="login-register-section">
              <div className="login-or">
                <span />
                or
                <span />
              </div>
              <p>New to SRO Clinic?</p>
              <Link className="btn btn-outline" href="/auth/register">
                <UserRound size={20} />
                Register as a Patient
              </Link>
            </div>
          )}
          {mode === 'invitation' &&
            (verifiedEmail ? (
              <div className="info-note">
                <p>Verified account: {verifiedEmail}</p>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => run('accept-invitation', Object.fromEntries(fragment.current))}
                >
                  Accept invitation for signed-in account
                </Button>
              </div>
            ) : (
              <p className="small muted">
                New Doctor?{' '}
                <Link href="/auth/register">Create your account and verify your email</Link>, then
                reopen the original invitation email. Do not complete a patient profile.
              </p>
            ))}
          {mode !== 'login' && (
            <Link className="text-link" href="/auth/login">
              Back to sign in
            </Link>
          )}
        </form>
      )}
      <div className="auth-disclaimer">
        <ShieldCheck size={14} />
        Secure access · Your care, connected
      </div>
    </div>
  );
  if (['login', 'register', 'forgot', 'two-factor'].includes(mode))
    return <LoginExperience>{card}</LoginExperience>;
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link href="/auth/welcome" className="auth-brand">
          <Image
            src="/sro-logo.png"
            alt="Social Responsibility Organization"
            width={236}
            height={99}
            priority
          />
        </Link>
        <div className="auth-story-content">
          <span className="eyebrow">HEALTHCARE FOR A BETTER TOMORROW</span>
          <h1>
            Care that connects.
            <br />
            <span>People who matter.</span>
          </h1>
          <p>
            One clinic community. A shared commitment to healthier lives, with care that stays
            connected.
          </p>
          <div className="auth-story-line" />
          <div className="auth-feature">
            <HeartPulse size={23} />
            <span>
              Thoughtful care.
              <br />
              <small>From the first visit to every follow-up.</small>
            </span>
          </div>
          <div className="auth-feature">
            <ShieldCheck size={23} />
            <span>
              Your health, organized.
              <br />
              <small>A connected view of your care journey.</small>
            </span>
          </div>
        </div>
        <span className="auth-copyright">Social Responsibility Organization · Pakistan</span>
      </section>
      <section className="auth-form-side">
        <Link className="text-link" href="/">
          SRO Clinic home
        </Link>
        {card}
      </section>
    </main>
  );
}
