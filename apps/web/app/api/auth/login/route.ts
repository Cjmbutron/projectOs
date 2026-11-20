import { NextResponse } from 'next/server';
import { handleLogin } from '@/lib/auth/login';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { csrfOk, readJson, toResponse } from '@/lib/route-utils';

export async function POST(request: Request) {
  if (!csrfOk(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const admin = createAdminClient();
  const supabase = await createClient();
  const asDate = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);
  const result = await handleLogin(
    {
      lockUntil: async (email) => {
        const { data, error } = await admin.rpc('login_lock_until', {
  p_email: email,
});

if (error) {
  console.error('[LOGIN_LOCK_UNTIL_ERROR]', {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  throw new Error(error.code);
}

console.log('[LOGIN_LOCK_UNTIL_SUCCESS]', { data });

return asDate(data);
      },


      
      record: async (email, ok) => {
        const { data, error } = await admin.rpc('record_login_attempt', { p_email: email, p_succeeded: ok });
        if (error) throw new Error(error.code);
        return asDate(data);
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) return { ok: true };
        if (error.code === 'email_not_confirmed') return { ok: false, reason: 'email_not_confirmed' };
        if (error.code === 'invalid_credentials') return { ok: false, reason: 'invalid_credentials' };
        return { ok: false, reason: 'other' };
      },
      now: () => new Date(),
    },
    await readJson(request),
  );
  return toResponse(result);
}
