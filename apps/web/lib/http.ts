export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Defensa CSRF para rutas que usan cookies: una petición que modifica estado debe venir
 * del mismo origen. Los navegadores envían `Origin` en todo POST; sin él se rechaza.
 */
export function isSameOrigin(requestUrl: string, originHeader: string | null, siteUrl?: string): boolean {
  if (!originHeader) return false;
  try {
    const origin = new URL(originHeader).origin;
    const allowed = new Set([new URL(requestUrl).origin]);
    if (siteUrl) allowed.add(new URL(siteUrl).origin);
    return allowed.has(origin);
  } catch {
    return false;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
