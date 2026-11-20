/** Destino posterior al login/confirmación: solo rutas internas (evita redirecciones abiertas). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.includes('\n') || next.includes('\r')) {
    return fallback;
  }
  return next;
}
