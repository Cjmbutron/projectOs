import type { HandlerResult } from '@/lib/http';

export type SignInOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'email_not_confirmed' | 'other' };

export interface LoginDeps {
  /** login_lock_until (service_role). Debe lanzar si la base de datos no responde. */
  lockUntil(email: string): Promise<Date | null>;
  /** record_login_attempt (service_role). Devuelve el bloqueo vigente tras el intento. */
  record(email: string, succeeded: boolean): Promise<Date | null>;
  /** supabase.auth.signInWithPassword con el cliente de sesión (fija las cookies). */
  signIn(email: string, password: string): Promise<SignInOutcome>;
  now(): Date;
}

const locked = (until: Date, now: Date): HandlerResult => {
  const seconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
  return {
    status: 429,
    body: { error: 'account_locked', retryAfterSeconds: seconds },
    headers: { 'Retry-After': String(seconds) },
  };
};

/**
 * Inicio de sesión con bloqueo por cuenta (RNF-01, ADR-005).
 *  - Con la cuenta bloqueada NO se valida la contraseña (acertar no revela nada ni levanta el bloqueo).
 *  - Solo los fallos de credenciales cuentan; errores de red u otros no bloquean a nadie.
 *  - Si no se puede consultar el bloqueo, se falla CERRADO (503).
 *  - Mismo mensaje para "correo inexistente" y "contraseña incorrecta".
 */
export async function handleLogin(deps: LoginDeps, input: unknown): Promise<HandlerResult> {
  const body = (input ?? {}) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !email.includes('@') || !password || password.length > 256) {
    return { status: 400, body: { error: 'invalid_request' } };
  }

  let lock: Date | null;
  try {
    lock = await deps.lockUntil(email);
  } catch {
    return { status: 503, body: { error: 'service_unavailable' } };
  }
  if (lock) return locked(lock, deps.now());

  const outcome = await deps.signIn(email, password);
  if (outcome.ok) {
    try {
      await deps.record(email, true);
    } catch {
      /* el registro del acierto no debe impedir entrar */
    }
    return { status: 200, body: { ok: true } };
  }
  if (outcome.reason === 'email_not_confirmed') return { status: 403, body: { error: 'email_not_confirmed' } };
  if (outcome.reason === 'other') return { status: 502, body: { error: 'login_failed' } };

  let after: Date | null = null;
  try {
    after = await deps.record(email, false);
  } catch {
    return { status: 503, body: { error: 'service_unavailable' } };
  }
  if (after) return locked(after, deps.now());
  return { status: 401, body: { error: 'invalid_credentials' } };
}
