import { createCalendar, toDayNumber, type CalendarInput } from '@project-os/schedule-engine';

export interface BaselineRow { activity_id: string; name: string; start_date: string; finish_date: string; duration: number }
export interface CurrentRow { id: string; name: string; early_start: string | null; early_finish: string | null; duration: number }

export type Status = 'unchanged' | 'changed' | 'added' | 'removed' | 'unscheduled';
export interface VarianceRow {
  id: string;
  name: string;
  status: Status;
  /** Actual − línea base, en días laborables del calendario del proyecto (positivo = más tarde). */
  startVariance: number | null;
  finishVariance: number | null;
  durationVariance: number | null;
  baseline: { start: string; finish: string; duration: number } | null;
  current: { start: string; finish: string; duration: number } | null;
}
export interface Comparison {
  rows: VarianceRow[];
  counts: Record<Status, number>;
  /** Variación del fin del proyecto (días laborables); null si no hay fin calculado. */
  projectFinishVariance: number | null;
}

/**
 * Planificado vs. actual por actividad (US-024). Mismas reglas que `compareToBaseline` del motor,
 * pero sobre filas de la base de datos: las actividades borradas aparecen como `removed` usando el
 * nombre guardado en la línea base, y las que aún no tienen fechas calculadas como `unscheduled`.
 */
export function compareBaseline(
  baseline: { project_finish: string; activities: BaselineRow[] },
  current: { project_finish: string | null; activities: CurrentRow[] },
  calendar: CalendarInput,
): Comparison {
  const cal = createCalendar(calendar);
  const wd = (iso: string) => cal.workingDaysBefore(toDayNumber(iso));
  const byId = new Map(baseline.activities.map((a) => [a.activity_id, a]));
  const seen = new Set<string>();
  const rows: VarianceRow[] = [];

  for (const a of current.activities) {
    seen.add(a.id);
    const base = byId.get(a.id);
    const b = base ? { start: base.start_date, finish: base.finish_date, duration: base.duration } : null;
    if (!a.early_start || !a.early_finish) {
      rows.push({ id: a.id, name: a.name, status: 'unscheduled', startVariance: null, finishVariance: null, durationVariance: null, baseline: b, current: null });
      continue;
    }
    const now = { start: a.early_start, finish: a.early_finish, duration: a.duration };
    if (!b) {
      rows.push({ id: a.id, name: a.name, status: 'added', startVariance: null, finishVariance: null, durationVariance: null, baseline: null, current: now });
      continue;
    }
    const startVariance = wd(now.start) - wd(b.start);
    const finishVariance = wd(now.finish) - wd(b.finish);
    const durationVariance = now.duration - b.duration;
    rows.push({
      id: a.id, name: a.name,
      status: startVariance === 0 && finishVariance === 0 && durationVariance === 0 ? 'unchanged' : 'changed',
      startVariance, finishVariance, durationVariance, baseline: b, current: now,
    });
  }
  for (const base of baseline.activities) {
    if (!seen.has(base.activity_id)) {
      rows.push({
        id: base.activity_id, name: base.name, status: 'removed', startVariance: null, finishVariance: null, durationVariance: null,
        baseline: { start: base.start_date, finish: base.finish_date, duration: base.duration }, current: null,
      });
    }
  }
  const counts: Record<Status, number> = { unchanged: 0, changed: 0, added: 0, removed: 0, unscheduled: 0 };
  for (const r of rows) counts[r.status]++;
  return {
    rows, counts,
    projectFinishVariance: current.project_finish ? wd(current.project_finish) - wd(baseline.project_finish) : null,
  };
}

/** "+3 d" / "−2 d" / "0 d" / "—" */
export function formatVariance(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '0 d';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} d`;
}
