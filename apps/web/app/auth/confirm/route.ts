import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const tokenHash = p.get('token_hash');
  const type = p.get('type') as EmailOtpType | null;
  const next = safeNext(p.get('next'), '/');
  const fail = new URL('/login?error=confirm', request.url);
  if (!tokenHash || !type) return NextResponse.redirect(fail);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return NextResponse.redirect(error ? fail : new URL(next, request.url));
}
