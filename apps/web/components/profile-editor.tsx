'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, UserRound, Check } from 'lucide-react';
import { Avatar, Button, Field, Modal, Panel } from './ui';
import { useIdentity } from './auth-workspace';
import { useClinic } from './clinic-context';
import { useProfileAssets } from './profile-assets';
import {
  avatarSelectionError,
  profileFields,
  type EditableProfile,
  type ProfileTarget,
} from '@/lib/profile-contracts';
import { clearClinicalCache } from '@/lib/clinical-cache';
import { ACCOUNT_PROFILE_SECTION_ID } from '@/lib/account-sections';
import { displayName } from '@/lib/clinical-clock';
import { DepartmentSelect } from './department-select';
import type { Doctor } from '@sro/types';
import {
  ageYearsLabel,
  bloodGroupLabel,
  bloodGroupOptionLabel,
  bloodGroupOptions,
  patientAgeLabel,
  patientIdLabel,
  money,
} from '@sro/clinic-core';
const query = (target: ProfileTarget) => new URLSearchParams(target).toString();
async function responseData(response: Response) {
  const result = await response.json();
  if (response.status === 401 || response.status === 403) clearClinicalCache();
  if (!response.ok) throw new Error(result.error ?? 'Unable to load the profile.');
  return result;
}
function useProfile(target: ProfileTarget, enabled = true) {
  const [profile, setProfile] = useState<EditableProfile | null>(null),
    [error, setError] = useState('');
  const url = `/api/profiles?${query(target)}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch(url, { cache: 'no-store' })
      .then(responseData)
      .then((r) => {
        if (active) setProfile(r.profile);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [url, enabled]);
  return { profile, error, setProfile };
}
export function ProfileInformation() {
  const { actor, organizationId, role, state } = useClinic();
  const identity = useIdentity();
  const target: ProfileTarget = {
    organizationId,
    kind: role === 'doctor' ? 'doctor' : role === 'patient' ? 'patient' : 'profile',
    id: role === 'doctor' ? actor.doctorId! : role === 'patient' ? actor.patientId! : actor.id,
  };
  const { profile, error, setProfile } = useProfile(target),
    [edit, setEdit] = useState(false);
  const patientRecord =
    role === 'patient' ? state.patients.find((p) => p.id === actor.patientId) : undefined;
  return (
    <Panel
      id={ACCOUNT_PROFILE_SECTION_ID}
      title="Professional profile"
      subtitle="Your personal details and profile photo"
      className="profile-information-card"
    >
      <div className="panel-form">
        <div className="profile-summary">
          <div className="profile-photo-wrap">
            <Avatar
              organizationId={target.organizationId}
              kind={target.kind}
              entityId={target.id}
              initials={(profile?.name ?? actor.name)
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
              size="avatar-profile"
            />
            <button
              className="profile-camera"
              aria-label="Change profile photo"
              disabled={!profile?.canEdit}
              onClick={() => setEdit(true)}
            >
              <Camera size={17} />
            </button>
          </div>
          <div>
            <h3>{displayName(profile?.name ?? actor.name)}</h3>
            <span className="specialty-pill">
              {role === 'doctor' ? 'Doctor' : role === 'patient' ? 'Patient' : 'Administrator'}
            </span>
          </div>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <dl className="profile-details">
          {role === 'patient' && (
            <div>
              <dt>Patient identification</dt>
              <dd>{patientIdLabel(state.patients.find((p) => p.id === actor.patientId))}</dd>
            </div>
          )}
          <div>
            <dt>Verified login email</dt>
            <dd>{identity?.email}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{state.organization.name}</dd>
          </div>
          {profile?.kind === 'doctor' && (
            <>
              {state.assignments
                .filter((a) => a.doctorId === actor.doctorId && a.active)
                .map((a) => (
                  <div key={a.branchId}>
                    <dt>
                      Consultation fee · {state.branches.find((b) => b.id === a.branchId)?.name}
                    </dt>
                    <dd>{money(a.fee)}</dd>
                  </div>
                ))}
              <div>
                <dt>Qualifications</dt>
                <dd>{profile.qualifications || 'Not added'}</dd>
              </div>
              <div>
                <dt>Professional experience</dt>
                <dd>{profile.experience} years</dd>
              </div>
            </>
          )}
          {profile?.kind === 'patient' && (
            <>
              <div>
                <dt>Age</dt>
                <dd>
                  {typeof profile.ageYears === 'number'
                    ? ageYearsLabel(profile.ageYears)
                    : patientAgeLabel(patientRecord ?? {})}
                </dd>
              </div>
              <div>
                <dt>Blood group</dt>
                <dd>{bloodGroupLabel(patientRecord?.history.bloodGroup)}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{profile.phone || 'Not added'}</dd>
              </div>
              <div>
                <dt>Contact email</dt>
                <dd>{profile.email || 'Not added'}</dd>
              </div>
            </>
          )}
        </dl>
        <Button variant="outline" disabled={!profile?.canEdit} onClick={() => setEdit(true)}>
          <UserRound size={16} />
          Edit Profile
        </Button>
      </div>
      {edit && profile && (
        <ProfileEditor
          profile={profile}
          onClose={() => setEdit(false)}
          onSaved={(p) => {
            setProfile(p);
            setEdit(false);
          }}
        />
      )}
    </Panel>
  );
}
export function EditProfileAction({ target }: { target: ProfileTarget }) {
  return (
    <ScopedEditProfileAction
      key={`${target.organizationId}:${target.kind}:${target.id}`}
      target={target}
    />
  );
}
function ScopedEditProfileAction({ target }: { target: ProfileTarget }) {
  const { profile, setProfile } = useProfile(target),
    [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!profile?.canEdit}
        onClick={() => setOpen(true)}
      >
        <Camera size={14} />
        Edit Profile / Photo
      </Button>
      {open && profile?.canEdit && (
        <ProfileEditor
          profile={profile}
          onClose={() => setOpen(false)}
          onSaved={(p) => {
            setProfile(p);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
/** One fresh scoped response supplies both the header account field and editor permission. */
export function DoctorProfileHeader({
  doctor,
  specialization,
}: {
  doctor: Doctor;
  specialization?: string;
}) {
  const { organizationId, actor, role } = useClinic();
  const eligible = role === 'admin' || (role === 'doctor' && actor.doctorId === doctor.id);
  const target: ProfileTarget = { organizationId, kind: 'doctor', id: doctor.id };
  const { profile, error, setProfile } = useProfile(target, eligible);
  const [open, setOpen] = useState(false);
  const email =
    profile?.loginEmail ??
    (profile?.loginEmailVisible ? 'Not activated' : 'Verification status unavailable');
  return (
    <div className="doctor-profile-intro">
      <Avatar
        kind="doctor"
        entityId={doctor.id}
        initials={doctor.initials}
        color={doctor.color}
        size="avatar-portrait"
      />
      <div className="doctor-profile-identity">
        <span className="eyebrow">YOUR CARE TEAM</span>
        <h2>{doctor.name}</h2>
        <p>{doctor.qualifications}</p>
        <span className="specialty-pill">{specialization}</span>
        {eligible && (
          <div className="doctor-login-email" aria-busy={!profile && !error}>
            <span>Verified Login Email</span>
            <strong title={profile?.loginEmail ?? undefined}>
              {error ? 'Unable to load account details' : profile ? email : 'Checking account…'}
            </strong>
          </div>
        )}
      </div>
      {eligible && (
        <div className="doctor-profile-action">
          <Button
            variant="outline"
            size="sm"
            disabled={!profile?.canEdit}
            title={
              error ||
              (profile && !profile.canEdit
                ? 'Profile editing is not authorized for your current access.'
                : undefined)
            }
            onClick={() => setOpen(true)}
          >
            <Camera size={14} />
            Edit Profile / Photo
          </Button>
        </div>
      )}
      {open && profile?.canEdit && (
        <ProfileEditor
          profile={profile}
          onClose={() => setOpen(false)}
          onSaved={(p) => {
            setProfile(p);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
/** Loaded on demand by the patient actions menu; database authorization remains authoritative. */
export function EditProfileDialog({
  target,
  onClose,
}: {
  target: ProfileTarget;
  onClose: () => void;
}) {
  const { profile, error } = useProfile(target);
  if (!profile || !profile.canEdit)
    return (
      <Modal title="Edit profile" onClose={onClose}>
        {error || (profile && !profile.canEdit) ? (
          <p className="form-error" role="alert">
            {error || 'This profile cannot be edited with your current access.'}
          </p>
        ) : (
          <p role="status">Loading patient profile…</p>
        )}
      </Modal>
    );
  return <ProfileEditor profile={profile} onClose={onClose} onSaved={onClose} />;
}
function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: EditableProfile;
  onClose: () => void;
  onSaved: (profile: EditableProfile) => void;
}) {
  const { state, actor, clinic, refresh } = useClinic();
  const patientRecord =
    profile.kind === 'patient' ? state.patients.find((p) => p.id === profile.id) : undefined;
  const currentHistory = patientRecord?.history;
  const currentDepartment =
    profile.specializationId ?? state.doctors.find((d) => d.id === profile.id)?.specializationId;
  const [departmentId, setDepartmentId] = useState(currentDepartment ?? '');
  const canChooseDepartment =
    profile.kind === 'doctor' &&
    actor.role === 'admin' &&
    profile.canEdit &&
    profile.canEditDepartment !== false;
  const canEditBloodGroup =
    profile.kind === 'patient' &&
    ['admin', 'doctor'].includes(actor.role) &&
    profile.canEdit &&
    (profile.canEditBloodGroup === true ||
      (profile.canEditBloodGroup === undefined && actor.role === 'doctor'));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(profile)
        .filter(([k]) =>
          [
            'name',
            'gender',
            'qualifications',
            'experience',
            'bio',
            'email',
            'phone',
            'address',
            'ageYears',
          ].includes(k),
        )
        .map(([k, v]) => [k, String(v ?? '')]),
    ),
  );
  const [bloodGroup, setBloodGroup] = useState(
    profile.bloodGroup ?? currentHistory?.bloodGroup ?? '',
  );
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [photo, setPhoto] = useState<'keep' | 'replace' | 'remove'>('keep');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const [x, setX] = useState(0.5),
    [y, setY] = useState(0.5),
    [zoom, setZoom] = useState(1);
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const assets = useProfileAssets();
  useEffect(() => {
    let active = true;
    let url = '';
    if (!file) return;
    const timer = window.setTimeout(async () => {
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Preview unavailable');
        const side = Math.max(1, Math.floor(Math.min(bitmap.width, bitmap.height) / zoom));
        context.drawImage(
          bitmap,
          Math.round((bitmap.width - side) * x),
          Math.round((bitmap.height - side) * y),
          side,
          side,
          0,
          0,
          512,
          512,
        );
        bitmap.close();
        canvas.toBlob(
          (blob) => {
            if (!blob || !active) return;
            url = URL.createObjectURL(blob);
            setPreview(url);
          },
          'image/webp',
          0.85,
        );
      } catch {
        if (active) {
          setError('Unable to preview this image. Choose another photo.');
          setPreview('');
        }
      }
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, x, y, zoom]);
  const field = (name: string, label: string, type = 'text', max = 120) => (
    <Field label={label} key={name}>
      <input
        name={name}
        type={type}
        maxLength={max}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 80 : undefined}
        required={name === 'name'}
        value={values[name] ?? ''}
        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
      />
    </Field>
  );
  const loginEmail = profile.loginEmail ? (
    <Field label="Verified login email">
      <input readOnly value={profile.loginEmail} />
    </Field>
  ) : null;
  return (
    <Modal
      title="Edit profile"
      description="Update profile information and photo. Your verified login email and clinic access remain managed separately."
      onClose={() => {
        if (!lock.current) onClose();
      }}
      wide
      onEscapeKeyDown={(event) => {
        if (document.activeElement?.matches('[role="combobox"][aria-expanded="true"]'))
          event.preventDefault();
      }}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          setError('');
          // Legacy unset gender is not an explicit demographic change.
          const parsed = profileFields.safeParse({ ...values, gender: values.gender || undefined });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Check your entries.');
            return;
          }
          if (profile.kind === 'patient' && parsed.data.ageYears === undefined) {
            setError('Enter an age from 0 to 120 years.');
            return;
          }
          const fields = { ...parsed.data };
          if (canChooseDepartment && departmentId !== currentDepartment) {
            if (!state.specializations.some((d) => d.id === departmentId)) {
              setError('Select an existing clinic department.');
              return;
            }
            if (profile.canEditDepartment !== true) {
              setError(
                'Department editing is awaiting clinic activation. Other profile fields can still be saved.',
              );
              return;
            }
            fields.specializationId = departmentId;
          }
          if (
            profile.canEditBloodGroup === true &&
            canEditBloodGroup &&
            bloodGroup !== (profile.bloodGroup ?? currentHistory?.bloodGroup ?? '')
          )
            fields.bloodGroup = profileFields.shape.bloodGroup.parse(bloodGroup);
          lock.current = true;
          setBusy(true);
          try {
            const form = new FormData();
            for (const key of ['organizationId', 'kind', 'id'] as const)
              form.set(key, profile[key]);
            form.set('fields', JSON.stringify(fields));
            form.set('photo', photo);
            form.set('requestId', requestId.current);
            form.set('cropX', String(x));
            form.set('cropY', String(y));
            form.set('cropZoom', String(zoom));
            if (file) form.set('file', file);
            const result = await responseData(
              await fetch('/api/profiles', { method: 'POST', body: form }),
            );
            assets.saved(result.profile);
            // Retain the existing Doctor workflow until the atomic profile candidate is approved.
            if (
              canEditBloodGroup &&
              profile.canEditBloodGroup === undefined &&
              bloodGroup !== (currentHistory?.bloodGroup ?? '')
            ) {
              if (!currentHistory)
                throw new Error(
                  'Profile details were saved, but the medical history could not be loaded. Reopen the patient record and retry the blood group.',
                );
              try {
                await clinic.saveHistory(actor, profile.id, { ...currentHistory, bloodGroup });
              } catch (e) {
                await refresh();
                throw new Error(
                  `Profile details were saved, but the blood group could not be updated. ${e instanceof Error ? e.message : 'Please retry.'}`,
                );
              }
              await refresh();
            }
            setSuccess('Profile details saved.');
            onSaved(result.profile);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to save. Please retry.');
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="profile-form-fields">
          <div className="avatar-editor">
            <div className="profile-crop-preview">
              {preview && photo === 'replace' ? (
                // Local canvas preview stays out of shared image optimization caches.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="crop-image"
                  src={preview}
                  alt="Selected profile photo crop preview"
                />
              ) : (
                <Avatar
                  organizationId={profile.organizationId}
                  kind={photo === 'remove' ? undefined : profile.kind}
                  entityId={profile.id}
                  initials={
                    values.name
                      ?.split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('') ?? ''
                  }
                  size="avatar-profile"
                />
              )}
            </div>
            <div>
              <strong>Profile photo</strong>
              <p className="small muted">JPEG, PNG or WebP · Up to 2 MB · Square 512 × 512</p>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="profile-file"
                aria-label="Choose profile photo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const err = avatarSelectionError(f);
                  setError(err);
                  if (err) {
                    e.target.value = '';
                    return;
                  }
                  setFile(f);
                  setPreview('');
                  setPhoto('replace');
                  setX(0.5);
                  setY(0.5);
                  setZoom(1);
                  requestId.current = crypto.randomUUID();
                }}
              />
              <div className="row-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => input.current?.click()}
                >
                  <Camera size={15} />
                  Upload / Change Photo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPhoto('remove');
                    setFile(null);
                    setPreview('');
                    requestId.current = crypto.randomUUID();
                  }}
                >
                  Remove Photo
                </Button>
              </div>
              {file && (
                <p className="small">
                  {file.name} · {Math.ceil(file.size / 1024)} KB
                </p>
              )}
            </div>
          </div>
          {photo === 'replace' && (
            <div className="profile-crop-controls">
              {[
                ['Horizontal position', x, setX],
                ['Vertical position', y, setY],
                ['Zoom', zoom, setZoom],
              ].map(([label, value, set], i) => (
                <label key={String(label)}>
                  {String(label)}
                  <input
                    type="range"
                    min={i === 2 ? 1 : 0}
                    max={i === 2 ? 3 : 1}
                    step="0.01"
                    value={value as number}
                    onChange={(e) => {
                      (set as (n: number) => void)(Number(e.target.value));
                      requestId.current = crypto.randomUUID();
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="form-grid">
            {field('name', 'Full name')}
            {profile.kind !== 'profile' && (
              <Field label="Gender">
                <select
                  value={values.gender || 'Not recorded'}
                  onChange={(e) => setValues((v) => ({ ...v, gender: e.target.value }))}
                >
                  {['Male', 'Female', 'Other', 'Not recorded'].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
            )}
            {profile.kind === 'patient' && (
              <>
                <Field label="Age (Years)">
                  <input
                    name="ageYears"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    step={1}
                    required
                    value={values.ageYears ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, ageYears: e.target.value }))}
                  />
                  <small className="muted">Stored as entered in whole years.</small>
                </Field>
                <Field label="Blood group">
                  <select
                    value={bloodGroup}
                    disabled={!canEditBloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                  >
                    {bloodGroupOptions.map((group) => (
                      <option key={group || 'unknown'} value={group}>
                        {bloodGroupOptionLabel(group)}
                      </option>
                    ))}
                  </select>
                  <small className="muted">
                    {canEditBloodGroup
                      ? 'Saved with the clinical medical history and audit trail.'
                      : 'Managed by authorized clinic staff.'}
                  </small>
                </Field>
                {field('phone', 'Phone number', 'tel', 40)}
                {field('email', 'Contact email', 'email', 254)}
              </>
            )}
            {profile.kind === 'doctor' && (
              <>
                {canChooseDepartment ? (
                  <DepartmentSelect
                    departments={state.specializations}
                    value={departmentId}
                    onChange={setDepartmentId}
                    disabled={busy}
                  />
                ) : (
                  <Field label="Department">
                    <input
                      readOnly
                      value={
                        state.specializations.find((d) => d.id === currentDepartment)?.name ??
                        'Not recorded'
                      }
                    />
                    <small className="muted">Managed by authorized clinic Administrators.</small>
                  </Field>
                )}
                {field('qualifications', 'Qualifications', 'text', 300)}
                {field('experience', 'Professional experience (years)', 'number')}
                {field('email', 'Public contact email', 'email', 254)}
                <Field label="Professional biography">
                  <textarea
                    maxLength={4000}
                    rows={4}
                    value={values.bio ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, bio: e.target.value }))}
                  />
                </Field>
              </>
            )}
          </div>
          {profile.kind === 'patient' && (
            <Field label="Residential address">
              <textarea
                maxLength={1000}
                rows={3}
                value={values.address ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
              />
            </Field>
          )}
          {loginEmail}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p role="status">
            <Check size={16} />
            {success}
          </p>
        )}
        {busy && (
          <p role="status">
            {photo === 'replace'
              ? 'Processing and securely saving photo…'
              : 'Saving profile changes…'}
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : error ? 'Retry Save Changes' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
