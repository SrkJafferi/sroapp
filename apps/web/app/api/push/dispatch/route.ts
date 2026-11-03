import { NextResponse } from 'next/server';
// Supabase Cron + Edge Functions exclusively. No worker capability belongs here.
export async function POST() {
  return NextResponse.json(
    { error: 'Push dispatch is not hosted on this application.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
