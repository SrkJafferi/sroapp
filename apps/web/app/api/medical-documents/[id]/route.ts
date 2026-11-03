import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clinicalContext, ClinicalError } from '@/lib/clinical-server';
import { DOCUMENT_BUCKET } from '@/lib/document-rules';
export const runtime = 'nodejs';
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = z.uuid().parse((await params).id);
    const role = z
      .enum(['admin', 'doctor', 'patient'])
      .parse(request.nextUrl.searchParams.get('role'));
    const org = z.uuid().parse(request.nextUrl.searchParams.get('organizationId'));
    const { client, membership } = await clinicalContext(role, org);
    const record = await client
      .from('medical_documents')
      .select('storage_object_key,name')
      .eq('id', id)
      .eq('organization_id', membership.organizationId)
      .maybeSingle();
    if (record.error)
      return NextResponse.json(
        { error: 'The document could not be loaded. Please retry.' },
        { status: 503, headers },
      );
    if (!record.data?.storage_object_key)
      return NextResponse.json({ error: 'Document unavailable.' }, { status: 404, headers });
    const signed = await client.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(
        record.data.storage_object_key,
        60,
        request.nextUrl.searchParams.get('download') === '1'
          ? { download: record.data.name }
          : undefined,
      );
    if (signed.error || !signed.data)
      return NextResponse.json(
        { error: 'The private file is unavailable. Please contact the clinic.' },
        { status: 503, headers },
      );
    return new NextResponse(null, {
      status: 302,
      headers: { ...headers, Location: signed.data.signedUrl },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ClinicalError ? error.message : 'Document unavailable.' },
      { status: error instanceof ClinicalError ? error.status : 400, headers },
    );
  }
}
