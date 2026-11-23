import { UUID_RE } from '@/lib/http';

export type Status = 'not_started' | 'in_progress' | 'done';
export const COLUMNS: { status: Status; label: string }[] = [
  { status: 'not_started', label: 'Sin iniciar' },
  { status: 'in_progress', label: 'En curso' },
  { status: 'done', label: 'Terminada' },
];
export const isStatus = (v: unknown): v is Status => v === 'not_started' || v === 'in_progress' || v === 'done';

export interface BoardActivity {
  id: string; name: string; duration: number; status: string; percent_complete: number;
  early_start: string | null; early_finish: string | null; assignee_id: string | null;
}

/** Una columna por estado; un estado desconocido cae en «Sin iniciar». Dentro: inicio más próximo primero, sin fecha al final, luego nombre. */
export function groupByStatus<T extends BoardActivity>(acts: T[]): Record<Status, T[]> {
  const out: Record<Status, T[]> = { not_started: [], in_progress: [], done: [] };
  for (const a of acts) out[isStatus(a.status) ? a.status : 'not_started'].push(a);
  for (const k of Object.keys(out) as Status[]) {
    out[k].sort((x, y) => {
      if (x.early_start === y.early_start) return x.name.localeCompare(y.name, 'es');
      if (x.early_start === null) return 1;
      if (y.early_start === null) return -1;
      return x.early_start < y.early_start ? -1 : 1;
    });
  }
  return out;
}

/**
 * Porcentaje que se registra al mover una actividad a otra columna; `null` si el movimiento no es posible.
 * El estado de una actividad lo deduce la base de datos del porcentaje (0 = sin iniciar, 1–99 = en curso, 100 = terminada).
 * - A «Sin iniciar» → 0 %; a «Terminada» → 100 %.
 * - A «En curso» → 1 % si venía de «Sin iniciar» y 99 % si venía de «Terminada» (luego se ajusta el porcentaje real).
 * - Un hito (duración 0) solo puede estar en 0 % o 100 %: no tiene «En curso».
 */
export function targetPercent(a: { status: string; duration: number }, to: Status): number | null {
  const from: Status = isStatus(a.status) ? a.status : 'not_started';
  if (from === to) return null;
  if (to === 'not_started') return 0;
  if (to === 'done') return 100;
  if (a.duration === 0) return null;
  return from === 'done' ? 99 : 1;
}

/** Columnas a las que se puede mover esa actividad. */
export function allowedMoves(a: { status: string; duration: number }): Status[] {
  return COLUMNS.map((c) => c.status).filter((s) => targetPercent(a, s) !== null);
}

export type MoveParse = { ok: true; activityId: string; to: Status } | { ok: false; error: 'invalid_move' };
export function parseMove(f: { get(name: string): unknown }): MoveParse {
  const id = String(f.get('activity') ?? '');
  const to = f.get('to');
  return UUID_RE.test(id) && isStatus(to) ? { ok: true, activityId: id, to } : { ok: false, error: 'invalid_move' };
}
