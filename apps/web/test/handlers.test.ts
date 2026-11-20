import { describe, expect, it } from 'vitest';
import { CycleError, ScheduleError } from '@project-os/schedule-engine';
import { ScheduleConflictError, ScheduleDbError, StartDateRequiredError } from '@project-os/schedule-service';
import { handleLogin, type LoginDeps, type SignInOutcome } from '@/lib/auth/login';
import { handleSignup, type SignupDeps } from '@/lib/auth/signup';
import { safeNext } from '@/lib/auth/redirect';
import { isSameOrigin } from '@/lib/http';
import { handleRecalculate, type RecalcDeps } from '@/lib/schedule/recalc-handler';
import { messageFor } from '@/lib/errors';

const NOW = new Date('2026-11-19T12:00:00Z');

function loginDeps(over: Partial<LoginDeps> & { outcome?: SignInOutcome } = {}) {
  const calls: string[] = [];
  const deps: LoginDeps = {
    lockUntil: async () => { calls.push('lockUntil'); return null; },
    record: async (_e, ok) => { calls.push(ok ? 'record:ok' : 'record:fail'); return null; },
    signIn: async () => { calls.push('signIn'); return over.outcome ?? { ok: true }; },
    now: () => NOW,
    ...over,
  };
  return { deps, calls };
}

describe('handleLogin', () => {
  it('acepta credenciales válidas y registra el acierto', async () => {
    const { deps, calls } = loginDeps();
    expect(await handleLogin(deps, { email: ' Ana@Test.com ', password: 'x' })).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(['lockUntil', 'signIn', 'record:ok']);
  });
  it('cuenta bloqueada: responde 429 SIN validar la contraseña', async () => {
    const until = new Date(NOW.getTime() + 90_000);
    const { deps, calls } = loginDeps({ lockUntil: async () => until });
    const r = await handleLogin(deps, { email: 'a@b.co', password: 'correcta' });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'account_locked', retryAfterSeconds: 90 });
    expect(r.headers).toEqual({ 'Retry-After': '90' });
    expect(calls).not.toContain('signIn');
  });
  it('credenciales inválidas: 401 genérico y registra el fallo', async () => {
    const { deps, calls } = loginDeps({ outcome: { ok: false, reason: 'invalid_credentials' } });
    expect(await handleLogin(deps, { email: 'a@b.co', password: 'mala' })).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(calls).toEqual(['lockUntil', 'signIn', 'record:fail']);
  });
  it('el fallo que dispara el bloqueo responde 429', async () => {
    const until = new Date(NOW.getTime() + 900_000);
    const { deps } = loginDeps({ outcome: { ok: false, reason: 'invalid_credentials' }, record: async () => until });
    const r = await handleLogin(deps, { email: 'a@b.co', password: 'mala' });
    expect(r).toMatchObject({ status: 429, body: { error: 'account_locked', retryAfterSeconds: 900 } });
  });
  it('correo sin confirmar y errores ajenos NO cuentan como intento fallido', async () => {
    for (const [reason, status] of [['email_not_confirmed', 403], ['other', 502]] as const) {
      const { deps, calls } = loginDeps({ outcome: { ok: false, reason } });
      expect((await handleLogin(deps, { email: 'a@b.co', password: 'x' })).status).toBe(status);
      expect(calls).not.toContain('record:fail');
    }
  });
  it('si no se puede consultar el bloqueo, falla cerrado (503) sin intentar entrar', async () => {
    const { deps, calls } = loginDeps({ lockUntil: async () => { throw new Error('db'); } });
    expect((await handleLogin(deps, { email: 'a@b.co', password: 'x' })).status).toBe(503);
    expect(calls).not.toContain('signIn');
  });
  it('si no se puede registrar el fallo, 503 (no deja intentos sin contar)', async () => {
    const { deps } = loginDeps({ outcome: { ok: false, reason: 'invalid_credentials' }, record: async () => { throw new Error('db'); } });
    expect((await handleLogin(deps, { email: 'a@b.co', password: 'x' })).status).toBe(503);
  });
  it('un error al registrar un acierto no impide entrar', async () => {
    const { deps } = loginDeps({ record: async () => { throw new Error('db'); } });
    expect((await handleLogin(deps, { email: 'a@b.co', password: 'x' })).status).toBe(200);
  });
  it('entradas inválidas → 400 sin tocar nada', async () => {
    for (const bad of [null, {}, { email: 'a@b.co' }, { password: 'x' }, { email: 'sin-arroba', password: 'x' }, { email: 'a@b.co', password: 'x'.repeat(257) }, { email: 5, password: 'x' }]) {
      const { deps, calls } = loginDeps();
      expect((await handleLogin(deps, bad)).status).toBe(400);
      expect(calls).toEqual([]);
    }
  });
  it('normaliza el correo antes de consultar el bloqueo', async () => {
    const seen: string[] = [];
    const { deps } = loginDeps({ lockUntil: async (e) => { seen.push(e); return null; } });
    await handleLogin(deps, { email: '  MAYUS@Test.COM ', password: 'x' });
    expect(seen).toEqual(['mayus@test.com']);
  });
});

describe('handleSignup', () => {
  const ok = { email: 'Ana@Test.com', password: 'una-clave-larga-1', displayName: ' Ana ', acceptedTerms: true };
  const deps = (r: Awaited<ReturnType<SignupDeps['signUp']>> = { ok: true }) => {
    const calls: Parameters<SignupDeps['signUp']>[0][] = [];
    return { calls, deps: { signUp: async (a: Parameters<SignupDeps['signUp']>[0]) => { calls.push(a); return r; } } satisfies SignupDeps };
  };
  it('envía la versión vigente de los documentos legales', async () => {
    const { deps: d, calls } = deps();
    expect(await handleSignup(d, ok)).toEqual({ status: 200, body: { ok: true, next: 'check_email' } });
    expect(calls[0]).toMatchObject({ email: 'ana@test.com', displayName: 'Ana', metadata: { terms_version: '2026-11', privacy_version: '2026-11' } });
  });
  it('exige aceptar los términos (true estricto)', async () => {
    for (const v of [false, undefined, 'true', 1]) {
      const { deps: d, calls } = deps();
      expect(await handleSignup(d, { ...ok, acceptedTerms: v })).toEqual({ status: 400, body: { error: 'terms_required' } });
      expect(calls).toHaveLength(0);
    }
  });
  it('valida correo, nombre y contraseña (≥ 12)', async () => {
    const { deps: d } = deps();
    expect((await handleSignup(d, { ...ok, email: 'x' })).body).toEqual({ error: 'invalid_email' });
    expect((await handleSignup(d, { ...ok, displayName: '  ' })).body).toEqual({ error: 'invalid_name' });
    expect((await handleSignup(d, { ...ok, password: '12345678901' })).body).toEqual({ error: 'weak_password' });
    expect((await handleSignup(d, { ...ok, password: '123456789012' })).status).toBe(200);
  });
  it('propaga contraseña débil del proveedor y errores genéricos', async () => {
    expect((await handleSignup(deps({ ok: false, reason: 'weak_password' }).deps, ok)).body).toEqual({ error: 'weak_password' });
    expect((await handleSignup(deps({ ok: false, reason: 'other' }).deps, ok)).status).toBe(502);
  });
});

describe('safeNext', () => {
  it('solo rutas internas', () => {
    expect(safeNext('/projects/1')).toBe('/projects/1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/ok\nSet-Cookie: x']) {
      expect(safeNext(bad as string | null | undefined)).toBe('/');
    }
    expect(safeNext('//x', '/inicio')).toBe('/inicio');
  });
});

describe('isSameOrigin (CSRF)', () => {
  it('acepta el mismo origen y el sitio configurado; rechaza el resto', () => {
    expect(isSameOrigin('https://app.test/api/x', 'https://app.test', undefined)).toBe(true);
    expect(isSameOrigin('http://internal:3000/api/x', 'https://app.test', 'https://app.test')).toBe(true);
    expect(isSameOrigin('https://app.test/api/x', 'https://evil.test', 'https://app.test')).toBe(false);
    expect(isSameOrigin('https://app.test/api/x', null, undefined)).toBe(false);
    expect(isSameOrigin('https://app.test/api/x', 'no-es-url', undefined)).toBe(false);
  });
});

describe('handleRecalculate', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const outcome = { version: 4, attempts: 1, activityCount: 3, projectStart: '2026-03-02', projectFinish: '2026-03-12', warnings: [] };
  const mk = (over: Partial<RecalcDeps> = {}) => {
    const calls: string[] = [];
    const deps: RecalcDeps = {
      getUserId: async () => 'user-1',
      canEdit: async () => { calls.push('canEdit'); return true; },
      recalculate: async () => { calls.push('recalculate'); return outcome; },
      ...over,
    };
    return { deps, calls };
  };
  it('éxito: 200 con el resumen', async () => {
    const { deps } = mk();
    expect(await handleRecalculate(deps, P)).toEqual({ status: 200, body: outcome });
  });
  it('id inválido → 400 sin consultar nada', async () => {
    const { deps, calls } = mk();
    expect((await handleRecalculate(deps, "x'; drop table projects;--")).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('sin sesión → 401', async () => {
    const { deps, calls } = mk({ getUserId: async () => null });
    expect((await handleRecalculate(deps, P)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it('sin permiso → 403 y NO se calcula', async () => {
    const { deps, calls } = mk({ canEdit: async () => false });
    expect((await handleRecalculate(deps, P)).status).toBe(403);
    expect(calls).not.toContain('recalculate');
  });
  it('traduce los errores del dominio', async () => {
    const cases: [Error, number, string][] = [
      [new StartDateRequiredError(), 422, 'start_date_required'],
      [new ScheduleConflictError(), 409, 'schedule_conflict'],
      [new CycleError(['A', 'B', 'A']), 422, 'CYCLE'],
      [new ScheduleDbError('project_read_only'), 409, 'project_read_only'],
      [new ScheduleDbError('forbidden'), 403, 'forbidden'],
      [new ScheduleDbError('project_not_found'), 404, 'project_not_found'],
    ];
    for (const [error, status, code] of cases) {
      const { deps } = mk({ recalculate: async () => { throw error; } });
      const r = await handleRecalculate(deps, P);
      expect(r.status, error.name).toBe(status);
      expect(r.body.error).toBe(code);
    }
  });
  it('un error inesperado no filtra detalles internos', async () => {
    const { deps } = mk({ recalculate: async () => { throw new Error('password=secreto host=10.0.0.5'); } });
    const r = await handleRecalculate(deps, P);
    expect(r).toEqual({ status: 500, body: { error: 'internal_error' } });
  });
  it('el actor que se pasa a la base es la persona autenticada', async () => {
    let actor = '';
    const { deps } = mk({ recalculate: async (_p, a) => { actor = a; return outcome; } });
    await handleRecalculate(deps, P);
    expect(actor).toBe('user-1');
  });
});

describe('messageFor', () => {
  it('traduce códigos conocidos y no revela los desconocidos', () => {
    expect(messageFor('forbidden')).toMatch(/permiso/);
    expect(messageFor('algo_raro')).toBe('Ocurrió un error. Intenta de nuevo.');
    expect(messageFor(null)).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});
void ScheduleError;
