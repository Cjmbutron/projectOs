import { parseIso } from '@/lib/gantt/drag';

export type Deadline = 'done' | 'overdue' | 'due_soon' | 'ok' | 'unscheduled';
export const DEADLINE_LABEL: Record<Deadline, string> = {
  done: 'Terminada', overdue: 'Vencida', due_soon: 'Vence pronto', ok: 'En plazo', unscheduled: 'Sin fechas',
};
const DAY = 86_400_000;

/** Estado de plazo según el fin calculado: vence pronto = hoy o dentro de los próximos `soonDays` días corridos. */
export function deadlineState(finish: string | null, status: string, today: string, soonDays = 3): Deadline {
  if (status === 'done') return 'done';
  const f = finish ? parseIso(finish) : null, t = parseIso(today);
  if (f === null || t === null) return 'unscheduled';
  if (f < t) return 'overdue';
  return (f - t) / DAY <= soonDays ? 'due_soon' : 'ok';
}

export interface MyActivity { id: string; project_id: string; name: string; status: string; early_start: string | null; early_finish: string | null }

/** Orden: fin más próximo primero; sin fechas al final; empate por nombre. */
export function sortByDue<T extends { early_finish: string | null; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.early_finish === b.early_finish) return a.name.localeCompare(b.name, 'es');
    if (a.early_finish === null) return 1;
    if (b.early_finish === null) return -1;
    return a.early_finish < b.early_finish ? -1 : 1;
  });
}

export function groupByProject<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.project_id, [...(m.get(r.project_id) ?? []), r]);
  return m;
}
