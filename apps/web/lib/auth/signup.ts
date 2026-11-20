import { LEGAL_VERSIONS } from '@/lib/legal';
import type { HandlerResult } from '@/lib/http';

export const MIN_PASSWORD_LENGTH = 12;

export interface SignupDeps {
  signUp(args: {
    email: string;
    password: string;
    displayName: string;
    metadata: { terms_version: string; privacy_version: string };
  }): Promise<{ ok: true } | { ok: false; reason: 'weak_password' | 'other' }>;
}

/**
 * Alta de cuenta. El consentimiento legal es obligatorio y viaja con la versión vigente
 * (el disparador de la base de datos lo registra con fecha). Para no revelar qué correos
 * existen, la respuesta es siempre la misma ("revisa tu correo") salvo errores de formato.
 */
export async function handleSignup(deps: SignupDeps, input: unknown): Promise<HandlerResult> {
  const b = (input ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return { status: 400, body: { error: 'invalid_email' } };
  if (displayName.length < 1 || displayName.length > 120) return { status: 400, body: { error: 'invalid_name' } };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) return { status: 400, body: { error: 'weak_password' } };
  if (b.acceptedTerms !== true) return { status: 400, body: { error: 'terms_required' } };

  const r = await deps.signUp({
    email, password, displayName,
    metadata: { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy },
  });
  if (!r.ok && r.reason === 'weak_password') return { status: 400, body: { error: 'weak_password' } };
  if (!r.ok) return { status: 502, body: { error: 'signup_failed' } };
  return { status: 200, body: { ok: true, next: 'check_email' } };
}
