import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { clinicalContext, ClinicalError } from '@/lib/clinical-server';
import { appOrigin } from '@/lib/auth/mail';
import { limit } from '@/lib/auth/rate-limit';
import { provisioningClient } from '@/lib/supabase/admin';
import { DocumentError, validateMedicalFile } from '@/lib/document-validation';
import { resumableDocumentUpload } from '@/lib/document-transfer';
import { MAX_DOCUMENT_BYTES, DOCUMENT_BUCKET } from '@/lib/document-rules';
export const runtime = 'nodejs';
export const maxDuration = 120;
const active = new Set<string>();
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function databaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'PGRST202')
    throw new DocumentError(
      'Private document storage is awaiting activation. Please contact the clinic administrator.',
      503,
    );
  if (error.code === '42501')
    throw new DocumentError('You are not authorized to upload for this patient and branch.', 403);
  if (['23505', '23514', '54000'].includes(error.code ?? ''))
    throw new DocumentError(
      'This upload is already active, expired or needs recovery. Retry with the same selection, or contact the clinic.',
      409,
    );
  throw new DocumentError(
    'The document could not be registered. Retry the same file selection.',
    503,
  );
}
async function boundedForm(request: NextRequest) {
  const maximum = MAX_DOCUMENT_BYTES + 65536;
  if (Number(request.headers.get('content-length') ?? 0) > maximum)
    throw new DocumentError('The file exceeds 10 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentError('Choose a file.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new DocumentError('The file exceeds 10 MB.', 413);
    }
    chunks.push(item.value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  }).formData();
}
export async function POST(request: NextRequest) {
  let lock = '';
  try {
    if (request.headers.get('origin') !== appOrigin())
      throw new DocumentError('Request origin refused.', 403);
    const initial = await clinicalContext('doctor');
    try {
      limit('document-upload', initial.user.id, 15);
    } catch {
      throw new DocumentError('Too many upload attempts. Please try again later.', 429);
    }
    const form = await boundedForm(request);
    const metadata = z
      .object({
        organizationId: z.uuid(),
        patientId: z.uuid(),
        branchId: z.uuid(),
        requestId: z.uuid(),
        kind: z.enum(['report', 'handwritten']),
      })
      .parse(Object.fromEntries(form));
    const { client, user, membership } =
      initial.membership.organizationId === metadata.organizationId
        ? initial
        : await clinicalContext('doctor', metadata.organizationId);
    if (!membership.branchIds.includes(metadata.branchId))
      throw new DocumentError('Branch access denied.', 403);
    const activeKey = `${user.id}:${metadata.requestId}`;
    if (active.has(activeKey)) throw new DocumentError('This upload is already in progress.', 409);
    lock = activeKey;
    active.add(lock);
    const input = form.get('file');
    if (!(input instanceof File)) throw new DocumentError('Choose a file.');
    const file = await validateMedicalFile({
      name: input.name,
      type: input.type,
      bytes: new Uint8Array(await input.arrayBuffer()),
    });
    const prepared = await client.rpc('begin_medical_document_upload', {
      p_patient_id: metadata.patientId,
      p_branch_id: metadata.branchId,
      p_request_id: metadata.requestId,
      p_kind: metadata.kind,
      p_name: file.name,
      p_mime_type: file.mimeType,
      p_size_bytes: file.size,
    });
    databaseError(prepared.error);
    const ticket = z
      .object({
        id: z.uuid(),
        documentId: z.uuid(),
        objectKey: z.string(),
        state: z.enum(['pending', 'validated', 'completed']),
        sha256: z.string().nullable().optional(),
      })
      .parse(prepared.data);
    if (ticket.sha256 && ticket.sha256 !== file.sha256)
      throw new DocumentError(
        'This request belongs to a different file. Select the file again.',
        409,
      );
    const bucket = client.storage.from(DOCUMENT_BUCKET);
    let uploaded = false,
      validated = ticket.state !== 'pending';
    try {
      if (ticket.state === 'pending') {
        let info = await bucket.info(ticket.objectKey);
        if (info.error) {
          const raw = await client.auth.getSession();
          const token = raw.data.session?.access_token;
          if (!token) throw new DocumentError('Please sign in again.', 401);
          if (file.size > 6 * 1024 * 1024)
            await resumableDocumentUpload(file.bytes, ticket.objectKey, file.mimeType, token);
          else {
            const transfer = await bucket.upload(ticket.objectKey, file.bytes, {
              contentType: file.mimeType,
              cacheControl: '0',
              upsert: false,
            });
            if (transfer.error)
              throw new DocumentError(
                'Secure transfer failed. Retry the same file selection.',
                503,
              );
          }
          uploaded = true;
          info = await bucket.info(ticket.objectKey);
        }
        if (info.error || !info.data || info.data.size !== file.size)
          throw new DocumentError('Stored file size could not be verified.', 503);
        const stored = await bucket.download(ticket.objectKey);
        if (stored.error || !stored.data)
          throw new DocumentError('Stored file bytes could not be verified.', 503);
        const bytes = new Uint8Array(await stored.data.arrayBuffer());
        if (
          bytes.byteLength !== file.size ||
          createHash('sha256').update(bytes).digest('hex') !== file.sha256
        )
          throw new DocumentError(
            'Stored bytes differ from the selected file. Select the file again.',
            409,
          );
        const after = await bucket.info(ticket.objectKey);
        if (
          after.error ||
          after.data.id !== info.data.id ||
          after.data.version !== info.data.version
        )
          throw new DocumentError('Stored file changed during verification. Retry.', 409);
        // Sole privileged operation: attest an exact already-uploaded object version.
        // No privileged clinical table reads/writes or Storage operations are performed.
        const attested = await provisioningClient().rpc(
          'attest_medical_document_upload' as never,
          {
            p_upload_id: ticket.id,
            p_author_id: user.id,
            p_object_id: info.data.id,
            p_object_version: info.data.version,
            p_sha256: file.sha256,
          } as never,
        );
        databaseError(attested.error);
        validated = true;
      }
      const completed = await client.rpc('complete_medical_document_upload', {
        p_upload_id: ticket.id,
      });
      databaseError(completed.error);
      return reply({ saved: true, id: completed.data });
    } catch (error) {
      if (uploaded && !validated) {
        const abandoned = await client.rpc('abandon_medical_document_upload', {
          p_upload_id: ticket.id,
        });
        if (!abandoned.error) {
          const removed = await bucket.remove([ticket.objectKey]);
          if (removed.error)
            return reply(
              {
                error:
                  'The upload was not registered. Private file cleanup is pending; please contact the clinic.',
                recoveryId: ticket.id,
              },
              503,
            );
        }
      }
      // Validated blobs are frozen. A retry with this request ID completes registration
      // without replacing/deleting the bytes. Unresolved intents remain an operator recovery record.
      if (validated && !(error instanceof DocumentError && [401, 403].includes(error.status)))
        return reply(
          {
            error:
              'The file is stored privately, but registration was not confirmed. Retry with the same file selection.',
            recoveryId: ticket.id,
          },
          503,
        );
      throw error;
    }
  } catch (error) {
    if (error instanceof DocumentError || error instanceof ClinicalError)
      return reply({ error: error.message }, error.status);
    return reply(
      {
        error:
          error instanceof z.ZodError
            ? 'Please choose a valid patient, branch, document type and file.'
            : 'Unable to save this medical document. Retry the same selection.',
      },
      400,
    );
  } finally {
    if (lock) active.delete(lock);
  }
}
