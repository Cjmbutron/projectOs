import { UUID_RE } from '@/lib/http';

export type ProgressParse =
  | { ok: true; activityId: string; percent: number }
  | { ok: false; error: 'invalid_percent' };

/** Porcentaje entero de 0 a 100 (la base de datos lo vuelve a validar, incluido el caso de los hitos). */
export function parseProgress(f: { get(name: string): unknown }): ProgressParse {
  const id = String(f.get('activity') ?? '');
  const raw = String(f.get('percent') ?? '').trim();
  if (!UUID_RE.test(id) || !/^\d{1,3}$/.test(raw)) return { ok: false, error: 'invalid_percent' };
  const percent = Number(raw);
  return percent <= 100 ? { ok: true, activityId: id, percent } : { ok: false, error: 'invalid_percent' };
}

const KNOWN = ['invalid_percent', 'milestone_progress_invalid', 'activity_not_found', 'forbidden', 'project_read_only'];
/** Código estable a partir del error de la base de datos. */
export function progressErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return '';
  const first = (error.message ?? '').split('\n')[0].trim();
  if (KNOWN.includes(first)) return first;
  return error.code === '42501' ? 'forbidden' : 'unknown';
}

export const STATUS_LABEL: Record<string, string> = { not_started: 'Sin iniciar', in_progress: 'En curso', done: 'Terminada' };

/** ¿Debe mostrarse el formulario de avance para esta actividad? (la base de datos decide de verdad) */
export function canReportProgress(opts: { canEditSchedule: boolean; userId: string | null; assigneeId: string | null }): boolean {
  return opts.canEditSchedule || (opts.userId !== null && opts.assigneeId === opts.userId);
}
