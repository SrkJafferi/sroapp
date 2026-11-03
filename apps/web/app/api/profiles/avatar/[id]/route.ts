import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { profileSession, profileDatabaseError } from '@/lib/profile-server';
import { ClinicalError } from '@/lib/clinical-server';
import { AVATAR_BUCKET } from '@/lib/profile-contracts';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const { client } = await profileSession();
    const id = z.uuid().parse((await params).id);
    const path = await client.rpc('get_profile_avatar_object', { p_avatar_id: id });
    profileDatabaseError(path.error);
    if (!path.data)
      return NextResponse.json({ error: 'Photo unavailable.' }, { status: 404, headers });
    const signed = await client.storage.from(AVATAR_BUCKET).createSignedUrl(path.data, 60);
    if (signed.error) throw new ClinicalError('Unable to load this photo.', 503);
    return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof ClinicalError ? e.message : 'Photo unavailable.' },
      { status: e instanceof ClinicalError ? e.status : 404, headers },
    );
  }
}
