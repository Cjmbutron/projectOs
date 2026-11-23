import { UUID_RE } from '@/lib/http';

export type ResourceKind = 'person' | 'equipment';
export const KIND_LABEL: Record<ResourceKind, string> = { person: 'Persona', equipment: 'Equipo' };

export type ResourceParse =
  | { ok: true; name: string; kind: ResourceKind; dailyHours: number }
  | { ok: false; error: 'invalid_resource' };

/** Horas por día: positivas, hasta 24, con a lo sumo dos decimales (acepta coma o punto). */
export function parseHours(raw: unknown): number | null {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 24 ? n : null;
}

export function parseResourceForm(f: { get(name: string): unknown }): ResourceParse {
  const name = String(f.get('name') ?? '').trim();
  const kind = String(f.get('kind') ?? 'person');
  const hours = parseHours(f.get('daily_hours') ?? '8');
  if (name.length < 1 || name.length > 120 || (kind !== 'person' && kind !== 'equipment') || hours === null) {
    return { ok: false, error: 'invalid_resource' };
  }
  return { ok: true, name, kind, dailyHours: hours };
}

export type AssignParse =
  | { ok: true; activityId: string; resourceId: string; percent: number }
  | { ok: false; error: 'invalid_percent' | 'invalid_assignment' };

export function parseAssignForm(f: { get(name: string): unknown }): AssignParse {
  const activityId = String(f.get('activity') ?? '');
  const resourceId = String(f.get('resource') ?? '');
  if (!UUID_RE.test(activityId) || !UUID_RE.test(resourceId)) return { ok: false, error: 'invalid_assignment' };
  const raw = String(f.get('percent') ?? '100').trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return { ok: false, error: 'invalid_percent' };
  return { ok: true, activityId, resourceId, percent: Number(raw) };
}

/** Código estable a partir del error de la base de datos; `context` distingue qué se estaba haciendo. */
export function resourceErrorCode(
  error: { message?: string; code?: string } | null | undefined,
  context: 'resource' | 'assignment' | 'delete',
): string {
  if (!error) return '';
  const msg = error.message ?? '';
  if (msg.includes('equipment_cannot_have_user')) return 'resource_user_invalid';
  if (msg.includes('resource_user_must_be_active_internal_member')) return 'resource_user_invalid';
  if (msg.includes('resource_inactive')) return 'resource_inactive';
  switch (error.code) {
    case '42501': return 'forbidden';
    case '23505': return context === 'assignment' ? 'duplicate_assignment' : 'duplicate_resource';
    case '23503': return context === 'delete' ? 'resource_in_use' : 'invalid_assignment';
    case '23514': return context === 'assignment' ? 'invalid_percent' : 'invalid_resource';
    default: return 'unknown';
  }
}

/** 12,5 → «12,5 h»; 8 → «8 h». */
export const formatHours = (h: number): string => `${Number.isInteger(h) ? h : String(h).replace('.', ',')} h`;
