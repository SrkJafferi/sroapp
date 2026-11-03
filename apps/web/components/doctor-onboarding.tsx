'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  HeartPulse,
  Mail,
  MapPin,
  ShieldCheck,
  Stethoscope,
  LoaderCircle,
} from 'lucide-react';
import { authRequest } from './auth-screen';
import { LoginExperience } from './login-experience';
import { avatarSelectionError } from '@/lib/profile-contracts';
import { passwordSchema } from '@sro/validation';
import { clearClinicalCache } from '@/lib/clinical-cache';
import {
  readDoctorDraft,
  saveDoctorDraft,
  clearDoctorDraft,
  type DoctorDraft,
} from '@/lib/onboarding-draft';
import './doctor-onboarding.css';
type Invitation = {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  branch: string;
  specialization: string;
  accepted: boolean;
  profileReady?: boolean;
  doctorId: string | null;
};
async function request(action: string, data: object = {}) {
  const response = await fetch('/api/doctor-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  const r = await response.json();
  if (r.next === '/auth/two-factor') window.location.assign(r.next);
  if (!response.ok) throw Error(r.error ?? 'Unable to continue.');
  return r;
}
function details(d: DoctorDraft) {
  return {
    name: d.name,
    gender: d.gender,
    ...(d.experience !== '' ? { experience: Number(d.experience) } : {}),
  };
}
async function activate(d: DoctorDraft) {
  const r = await request('activate', { details: details(d) });
  return r.invitation as Invitation;
}
async function savePhoto(i: Invitation, d: DoctorDraft) {
  if (d.photo && !d.photoSaved) {
    const file = d.photo;
    if (!d.avatarRequestId) {
      d = { ...d, avatarRequestId: crypto.randomUUID() };
      await saveDoctorDraft(d);
    }
    const f = new FormData();
    for (const [k, v] of Object.entries({
      organizationId: i.organizationId,
      kind: 'doctor',
      id: i.doctorId,
      fields: JSON.stringify(details(d)),
      photo: 'replace',
      requestId: d.avatarRequestId,
      cropX: '0.5',
      cropY: '0.5',
      cropZoom: '1',
    }))
      f.set(k, String(v));
    f.set('file', file);
    if (!(await fetch('/api/profiles', { method: 'POST', body: f })).ok)
      throw Error('Your account is active. Retry to finish saving your photo.');
    await saveDoctorDraft({ ...d, photoSaved: true });
  }
}
export function DoctorOnboarding() {
  const [invitation, setInvitation] = useState<Invitation | null>(null),
    [name, setName] = useState(''),
    [gender, setGender] = useState('Not recorded'),
    [experience, setExperience] = useState(''),
    [photo, setPhoto] = useState<File | undefined>(),
    [step, setStep] = useState(1),
    [verified, setVerified] = useState(false),
    [existing, setExisting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [qr, setQr] = useState<{ factorId: string; qr: string } | null>(null),
    [code, setCode] = useState(''),
    [photoUrl, setPhotoUrl] = useState('');
  const lock = useRef(false),
    input = useRef<HTMLInputElement>(null),
    initial = useRef<Promise<{
      invitation: Invitation;
      verified: boolean;
      securityVerified?: boolean;
      finished?: boolean;
      next?: string;
    }> | null>(null);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const enterDashboard = useCallback(async (target: Invitation) => {
    const r = await request('finish');
    const completed = r.invitation as Invitation;
    setInvitation(completed);
    const draft = await readDoctorDraft(target.id);
    if (draft) await savePhoto(completed, draft);
    const closed = await request('close');
    await clearDoctorDraft(target.id);
    sessionStorage.removeItem('sro-doctor-profile-draft:' + target.id);
    clearClinicalCache();
    window.location.assign(closed.next);
  }, []);
  useEffect(() => {
    let active = true;
    if (!initial.current) {
      let proof: object | undefined;
      if (location.hash) {
        const p = new URLSearchParams(location.hash.slice(1));
        proof = { id: p.get('id') ?? '', token: p.get('token') ?? '' };
        history.replaceState(null, '', location.pathname);
      }
      initial.current = request('preview', proof ? { proof } : {});
    }
    initial.current
      .then(async (r) => {
        if (!active) return;
        if (r.finished) {
          window.location.assign(r.next!);
          return;
        }
        const d = await readDoctorDraft(r.invitation.id);
        if (!active) return;
        setInvitation(r.invitation);
        setVerified(r.verified);
        setName(d?.name ?? r.invitation.name);
        setGender(d?.gender ?? 'Not recorded');
        setExperience(d?.experience ?? '');
        setPhoto(d?.photo);
        if (r.verified && (r.invitation.profileReady || r.invitation.accepted)) {
          setStep(2);
          if (r.securityVerified) await run(() => enterDashboard(r.invitation));
        } else if (r.verified && d) {
          await run(async () => {
            const ready = await activate(d);
            setInvitation(ready);
            setStep(2);
            if (r.securityVerified) await enterDashboard(ready);
          });
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [enterDashboard]);
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    queueMicrotask(() => setPhotoUrl(url));
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function finish() {
    await run(() => enterDashboard(invitation!));
  }
  const initials = (name || 'Doctor')
    .replace(/^Dr\.?\s*/i, '')
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      if (name.trim().length < 3)
        throw Error('Enter your full name using at least three characters.');
      if (experience !== '' && (!/^\d+$/.test(experience) || Number(experience) > 80))
        throw Error('Experience must be a whole number between 0 and 80.');
      if (!verified && !existing) {
        const parsed = passwordSchema.safeParse(form.get('password'));
        if (!parsed.success) throw Error(parsed.error.issues[0].message);
        if (form.get('password') !== form.get('confirm')) throw Error('Passwords do not match.');
      }
      const draft: DoctorDraft = {
        id: invitation!.id,
        name: name.trim(),
        gender,
        experience,
        photo,
        updatedAt: Date.now(),
        avatarRequestId: crypto.randomUUID(),
      };
      await saveDoctorDraft(draft);
      if (!verified && existing) {
        const login = await authRequest('login', {
          email: invitation!.email,
          password: form.get('password'),
        });
        if (login.next === '/auth/two-factor') {
          window.location.assign(login.next);
          return;
        }
        const r = await request('preview');
        if (!r.verified) throw Error('Sign in to the matching verified email.');
        setVerified(true);
        setInvitation(await activate(draft));
        setStep(2);
        return;
      }
      if (!verified) {
        const r = await request('start', {
          password: form.get('password'),
          details: details(draft),
        });
        clearClinicalCache();
        setVerified(true);
        setInvitation(r.invitation);
        setStep(2);
        return;
      }
      setInvitation(await activate(draft));
      setStep(2);
    });
  }
  const Shell = step === 2 ? 'div' : 'main';
  const page = (
    <Shell className={`doctor-onboarding ${step === 2 ? 'onboarding-shared-auth' : ''}`}>
      <aside className="doctor-onboarding-story">
        <Link className="doctor-onboarding-logo" href="/">
          <Image
            src="/sro-logo.png"
            alt="Social Responsibility Organization"
            width={236}
            height={99}
            priority
          />
        </Link>
        <div className="doctor-onboarding-story-copy">
          <span className="doctor-onboarding-eyebrow">A COMMUNITY OF CARE</span>
          <h1>
            Better care.
            <br />
            <em>Stronger connections.</em>
          </h1>
          <p>Join a team that puts people at the heart of healthcare.</p>
          <div className="doctor-onboarding-art" aria-hidden="true">
            <HeartPulse size={76} strokeWidth={1.2} />
            <span />
            <span />
          </div>
          <div className="doctor-onboarding-promise">
            <ShieldCheck size={20} />
            Secure access. Connected care.
          </div>
        </div>
        <small>Social Responsibility Organization · Pakistan</small>
      </aside>
      <section className="doctor-onboarding-main">
        <div className="doctor-onboarding-card">
          <div className="doctor-onboarding-step">
            <span className="doctor-onboarding-step-icon">
              {step === 1 ? <Stethoscope size={19} /> : <ShieldCheck size={19} />}
            </span>
            <span>
              Step {step} of 2 — {step === 1 ? 'Complete Profile' : 'Account Security'}
            </span>
            <div aria-hidden="true">
              <i className="active" />
              <i className={step === 2 ? 'active' : ''} />
            </div>
          </div>
          <header>
            <h2>{step === 1 ? 'Welcome to SRO Clinic' : 'Secure Your Account'}</h2>
            <p>
              {step === 1
                ? 'Complete your account to join your care team.'
                : 'Add an extra layer of security with an authenticator app. You can also enable it later from Settings.'}
            </p>
          </header>
          {error && (
            <div role="alert" className="doctor-onboarding-error">
              {error}
            </div>
          )}
          {!invitation && !error && (
            <p role="status">
              <LoaderCircle size={18} className="doctor-onboarding-spin" /> Checking your
              invitation…
            </p>
          )}
          {invitation && step === 1 && (
            <>
              <div className="doctor-onboarding-summary">
                <div>
                  <Mail size={16} />
                  <span>
                    <small>{verified ? 'Verified Login Email' : 'Invited Login Email'}</small>
                    <strong>{invitation.email}</strong>
                  </span>
                  {verified && <CheckCircle2 size={16} />}
                </div>
                <div className="doctor-onboarding-summary-row">
                  <div>
                    <Stethoscope size={16} />
                    <span>
                      <small>Department</small>
                      <strong>{invitation.specialization}</strong>
                    </span>
                  </div>
                  <div>
                    <MapPin size={16} />
                    <span>
                      <small>Clinic branch</small>
                      <strong>{invitation.branch}</strong>
                    </span>
                  </div>
                </div>
              </div>
              <form className="doctor-onboarding-form" onSubmit={submit} aria-busy={busy}>
                <fieldset disabled={busy}>
                  <div className="doctor-onboarding-avatar-row">
                    <div className="doctor-onboarding-avatar">
                      {photoUrl ? (
                        <Image
                          src={photoUrl}
                          alt="Selected profile photo, automatically center-cropped"
                          width={96}
                          height={96}
                          unoptimized
                        />
                      ) : (
                        <span>{initials}</span>
                      )}
                      <button
                        type="button"
                        aria-label="Choose profile photo"
                        onClick={() => input.current?.click()}
                      >
                        <Camera size={15} />
                      </button>
                    </div>
                    <div>
                      <strong>
                        Profile photo <small>(optional)</small>
                      </strong>
                      <button
                        type="button"
                        className="doctor-onboarding-text"
                        onClick={() => input.current?.click()}
                      >
                        {photo ? 'Change Photo' : 'Upload Photo'}
                      </button>
                      <small>JPG, PNG or WebP · Up to 2 MB</small>
                    </div>
                    <input
                      ref={input}
                      className="doctor-onboarding-file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Profile photo file"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const invalid = avatarSelectionError(f);
                        if (invalid) {
                          setError(invalid);
                          return;
                        }
                        setError('');
                        setPhoto(f);
                      }}
                    />
                  </div>
                  <label className="doctor-onboarding-field">
                    Full Name
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <div className="doctor-onboarding-grid">
                    <label className="doctor-onboarding-field">
                      Gender
                      <select value={gender} onChange={(e) => setGender(e.target.value)}>
                        {['Not recorded', 'Female', 'Male', 'Other'].map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </label>
                    <label className="doctor-onboarding-field">
                      Experience in Years
                      <input
                        type="number"
                        min={0}
                        max={80}
                        step={1}
                        placeholder="e.g. 5"
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                      />
                    </label>
                  </div>
                  {!verified && (
                    <>
                      <div className="doctor-onboarding-grid">
                        <label className="doctor-onboarding-field">
                          {existing ? 'Existing Password' : 'Create Password'}
                          <input
                            name="password"
                            type="password"
                            autoComplete={existing ? 'current-password' : 'new-password'}
                            required
                          />
                        </label>
                        {!existing && (
                          <label className="doctor-onboarding-field">
                            Confirm Password
                            <input
                              name="confirm"
                              type="password"
                              autoComplete="new-password"
                              required
                            />
                          </label>
                        )}
                      </div>
                      {!existing && (
                        <small className="doctor-onboarding-hint">
                          At least 10 characters, an uppercase letter and a number.
                        </small>
                      )}
                    </>
                  )}
                  <button className="doctor-onboarding-primary" type="submit" disabled={busy}>
                    {busy ? (
                      <>
                        <LoaderCircle size={18} className="doctor-onboarding-spin" />
                        <span>{existing ? 'Signing in…' : 'Saving your account…'}</span>
                      </>
                    ) : existing ? (
                      'Sign in & Continue'
                    ) : (
                      'Register Account'
                    )}
                    {!busy && <ArrowRight size={17} />}
                  </button>
                </fieldset>
                <p className="doctor-onboarding-existing">
                  {existing ? 'New to SRO Clinic?' : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    className="doctor-onboarding-text"
                    disabled={busy}
                    onClick={() => {
                      setExisting(!existing);
                      setError('');
                    }}
                  >
                    {existing ? 'Register instead' : 'Sign in'}
                  </button>
                </p>
              </form>
            </>
          )}
          {invitation && step === 2 && (
            <div className="doctor-onboarding-security">
              <div className="doctor-onboarding-security-icon">
                <ShieldCheck size={32} />
              </div>
              <div className="doctor-onboarding-security-note">
                <CheckCircle2 size={17} />
                Email verified · Profile saved
              </div>
              {!qr && (
                <>
                  <button
                    className="doctor-onboarding-primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await authRequest('mfa-list');
                        if (r.factors.some((f: { status: string }) => f.status === 'verified')) {
                          await enterDashboard(invitation);
                          return;
                        }
                        setQr(await authRequest('mfa-enroll'));
                      })
                    }
                  >
                    <ShieldCheck size={18} />
                    Set Up Authenticator App
                  </button>
                  <button className="doctor-onboarding-secondary" disabled={busy} onClick={finish}>
                    Skip & Continue
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
              {qr && (
                <form
                  className="doctor-onboarding-totp"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await authRequest('mfa-verify', { factorId: qr.factorId, code });
                      setQr(null);
                      await enterDashboard(invitation);
                    });
                  }}
                >
                  <p>Scan this code with your authenticator app, then enter its six-digit code.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      qr.qr.startsWith('data:')
                        ? qr.qr
                        : 'data:image/svg+xml;utf8,' + encodeURIComponent(qr.qr)
                    }
                    alt="Authenticator setup QR code"
                    width={190}
                    height={190}
                  />
                  <label className="doctor-onboarding-field">
                    Authenticator code
                    <input
                      value={code}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      required
                      maxLength={6}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <button className="doctor-onboarding-primary" disabled={busy}>
                    Verify & Continue
                    <CheckCircle2 size={17} />
                  </button>
                  <button
                    type="button"
                    className="doctor-onboarding-text"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await authRequest('mfa-remove', { factorId: qr.factorId });
                        setQr(null);
                        setCode('');
                      })
                    }
                  >
                    Cancel setup
                  </button>
                </form>
              )}
            </div>
          )}
          <footer>
            <ShieldCheck size={14} />
            Secure invitation. Protected account setup.
          </footer>
        </div>
      </section>
    </Shell>
  );
  return step === 2 ? <LoginExperience>{page}</LoginExperience> : page;
}
