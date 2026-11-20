import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfOk } from '@/lib/route-utils';

export async function POST(request: Request) {
  if (!csrfOk(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
