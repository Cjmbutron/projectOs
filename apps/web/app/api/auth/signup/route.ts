import { NextResponse } from 'next/server';
import { handleSignup } from '@/lib/auth/signup';
import { createClient } from '@/lib/supabase/server';
import { csrfOk, readJson, toResponse } from '@/lib/route-utils';

export async function POST(request: Request) {
  if (!csrfOk(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const result = await handleSignup(
    {
      signUp: async ({ email, password, displayName, metadata }) => {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${origin}/auth/confirm`, data: { display_name: displayName, ...metadata } },
        });
        if (!error) return { ok: true };
        return { ok: false, reason: error.code === 'weak_password' ? 'weak_password' : 'other' };
      },
    },
    await readJson(request),
  );
  return toResponse(result);
}
