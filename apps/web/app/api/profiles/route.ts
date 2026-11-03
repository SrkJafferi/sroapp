import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appOrigin } from '@/lib/auth/mail';
import { limit } from '@/lib/auth/rate-limit';
import { ClinicalError } from '@/lib/clinical-server';
import {
  profileSession,
  readProfile,
  targetFromUrl,
  profileDatabaseError,
} from '@/lib/profile-server';
import {
  profileTarget,
  profileFields,
  AVATAR_BUCKET,
  MAX_AVATAR_BYTES,
} from '@/lib/profile-contracts';
import { processAvatar } from '@/lib/avatar-validation';
import { provisioningClient } from '@/lib/supabase/admin';
import { createHash } from 'node:crypto';
import { DocumentError } from '@/lib/document-validation';
export const runtime = 'nodejs';
export const maxDuration = 120;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const active = new Set<string>();
const ticketSchema = z.object({
  id: z.uuid(),
  objectKey: z.string(),
  state: z.enum(['pending', 'validated', 'current', 'retired']),
  sha256: z.string().nullable(),
});
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('assets') === '1') {
      const org = z.uuid().parse(request.nextUrl.searchParams.get('organizationId'));
      const { client } = await profileSession(org);
      const r = await client.rpc('get_profile_assets', { p_organization_id: org });
      if (r.error?.code === 'PGRST202') return reply({ assets: [], activationPending: true });
      profileDatabaseError(r.error);
      return reply({ assets: r.data });
    }
    return reply({ profile: await readProfile(targetFromUrl(request.nextUrl)) });
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  if (e instanceof ClinicalError || e instanceof DocumentError)
    return reply({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return reply({ error: 'Check the profile fields and try again.' }, 400);
  if (e instanceof SyntaxError) return reply({ error: 'The profile form is invalid.' }, 400);
  return reply({ error: 'Unable to update the profile. Please retry.' }, 503);
}
async function formBody(request: NextRequest) {
  const maximum = MAX_AVATAR_BYTES + 65536;
  if (Number(request.headers.get('content-length') ?? 0) > maximum)
    throw new ClinicalError('Image exceeds 2 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ClinicalError('Profile form is missing.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new ClinicalError('Image exceeds 2 MB.', 413);
    }
    chunks.push(r.value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  }).formData();
}
export async function POST(request: NextRequest) {
  let lock = '';
  let context: Awaited<ReturnType<typeof profileSession>> | undefined;
  let ticket: z.infer<typeof ticketSchema> | undefined;
  let validated = false,
    committed = false;
  try {
    if (request.headers.get('origin') !== appOrigin())
      throw new ClinicalError('Request origin refused.', 403);
    const initial = await profileSession();
    try {
      limit('profile-save', initial.user.id, 30);
    } catch {
      throw new ClinicalError('Too many profile updates. Please try later.', 429);
    }
    const form = await formBody(request);
    const target = profileTarget.parse({
      organizationId: form.get('organizationId'),
      kind: form.get('kind'),
      id: form.get('id'),
    });
    context =
      initial.membership.organizationId === target.organizationId
        ? initial
        : await profileSession(target.organizationId);
    const { client, user } = context;
    const requestId = z.uuid().parse(form.get('requestId'));
    const fields = profileFields.parse(JSON.parse(String(form.get('fields'))));
    const action = z.enum(['keep', 'replace', 'remove']).parse(form.get('photo'));
    if (fields.specializationId !== undefined) {
      if (target.kind !== 'doctor' || !context.membership.roles.includes('admin'))
        throw new ClinicalError('Only authorized Admins may change Doctor departments.', 403);
      const permission = await client.rpc('get_clinic_profile', {
        p_organization_id: target.organizationId,
        p_kind: target.kind,
        p_target_id: target.id,
      });
      profileDatabaseError(permission.error);
      const current = permission.data as unknown as {
        canEdit?: boolean;
        canEditDepartment?: boolean;
      };
      if (!current?.canEdit)
        throw new ClinicalError('This Doctor department change is not authorized.', 403);
      if (current.canEditDepartment === undefined)
        throw new ClinicalError('Department editing is awaiting clinic activation.', 503);
      if (!current.canEditDepartment)
        throw new ClinicalError('This Doctor department change is not authorized.', 403);
    }
    const key = user.id;
    if (active.has(key)) throw new ClinicalError('This profile is already being saved.', 409);
    lock = key;
    active.add(lock);
    if (action === 'replace') {
      const input = form.get('file');
      if (!(input instanceof File)) throw new ClinicalError('Choose a photo.');
      const image = await processAvatar(
        { name: input.name, type: input.type, bytes: new Uint8Array(await input.arrayBuffer()) },
        {
          x: Number(form.get('cropX') ?? 0.5),
          y: Number(form.get('cropY') ?? 0.5),
          zoom: Number(form.get('cropZoom') ?? 1),
        },
      );
      const r = await client.rpc('begin_profile_avatar', {
        p_organization_id: target.organizationId,
        p_kind: target.kind,
        p_target_id: target.id,
        p_request_id: requestId,
        p_size: image.size,
      });
      profileDatabaseError(r.error);
      ticket = ticketSchema.parse(r.data);
      if (ticket.state === 'retired')
        throw new ClinicalError('Select the photo again to start a new upload.', 409);
      validated = ticket.state === 'validated' || ticket.state === 'current';
      if (!validated) {
        const bucket = client.storage.from(AVATAR_BUCKET);
        const existing = await bucket.info(ticket.objectKey);
        if (existing.error) {
          const sent = await bucket.upload(ticket.objectKey, image.bytes, {
            contentType: image.mimeType,
            cacheControl: '0',
            upsert: false,
          });
          if (sent.error) throw new ClinicalError('Photo upload failed. Please retry.', 503);
        }
        const before = await bucket.info(ticket.objectKey);
        const stored = await bucket.download(ticket.objectKey);
        if (before.error || stored.error || !stored.data)
          throw new ClinicalError('Unable to verify the private photo. Please retry.', 503);
        const hash = createHash('sha256')
          .update(Buffer.from(await stored.data.arrayBuffer()))
          .digest('hex');
        const after = await bucket.info(ticket.objectKey);
        if (
          after.error ||
          !before.data?.id ||
          before.data.id !== after.data?.id ||
          before.data.version !== after.data.version ||
          hash !== image.sha256
        )
          throw new ClinicalError('Stored photo verification failed. Select the image again.', 409);
        const verified = await provisioningClient().rpc('attest_profile_avatar', {
          p_upload_id: ticket.id,
          p_author_id: user.id,
          p_object_id: after.data.id,
          p_version: after.data.version,
          p_sha256: hash,
        });
        profileDatabaseError(verified.error);
        validated = true;
      } else if (ticket.sha256 !== image.sha256)
        throw new ClinicalError('This retry uses a different photo. Select it again.', 409);
    }
    const previous = await client.rpc('get_profile_assets', {
      p_organization_id: target.organizationId,
    });
    profileDatabaseError(previous.error);
    const old = (previous.data as unknown as { kind: string; id: string; avatarId: string }[]).find(
      (a) => a.kind === target.kind && a.id === target.id,
    );
    const saved = await client.rpc('save_clinic_profile', {
      p_organization_id: target.organizationId,
      p_kind: target.kind,
      p_target_id: target.id,
      p_fields: fields,
      p_photo: action,
      p_upload_id: ticket?.id ?? null,
    });
    profileDatabaseError(saved.error);
    committed = true;
    let cleanupPending = false;
    if (old && action !== 'keep' && old.avatarId !== ticket?.id) {
      // Cleanup only retired bytes after the authenticated profile transaction commits.
      const retired = await client.rpc('discard_profile_avatar', { p_upload_id: old.avatarId });
      if (!retired.error && retired.data) {
        const removed = await client.storage.from(AVATAR_BUCKET).remove([retired.data]);
        cleanupPending = !!removed.error;
      } else cleanupPending = true;
    }
    return reply({ profile: saved.data, saved: true, cleanupPending });
  } catch (e) {
    if (context && ticket && !committed && !validated) {
      const retired = await context.client.rpc('discard_profile_avatar', {
        p_upload_id: ticket.id,
      });
      if (!retired.error && retired.data)
        await context.client.storage.from(AVATAR_BUCKET).remove([retired.data]);
    }
    return failure(e);
  } finally {
    if (lock) active.delete(lock);
  }
}
