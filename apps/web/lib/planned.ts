/** Avance planificado: cuánto debería llevarse a hoy según las fechas del plan (línea base o cronograma actual). */
import { addDays, weekdayOf } from '@/lib/calendar';

const MAX_SPAN = 3700; // ~10 años: tope de seguridad de los recorridos día a día

export type IsWorking = (iso: string) => boolean;

/** Día laborable del proyecto: semana laboral, menos feriados, más días trabajados excepcionales. */
export function makeCalendar(weekdays: readonly number[], days: readonly { day: string; kind: string }[]): IsWorking {
  const wd = new Set(weekdays.length ? weekdays : [1, 2, 3, 4, 5]);
  const holidays = new Set(days.filter((d) => d.kind === 'holiday').map((d) => d.day));
  const extra = new Set(days.filter((d) => d.kind === 'working').map((d) => d.day));
  return (iso) => (extra.has(iso) ? true : holidays.has(iso) ? false : wd.has(weekdayOf(iso)));
}

/** Días laborables de from a to, ambos incluidos (0 si to < from). */
export function countWorking(from: string, to: string, isWorking: IsWorking): number {
  let n = 0;
  let d = from;
  for (let i = 0; d <= to && i < MAX_SPAN; i++, d = addDays(d, 1)) if (isWorking(d)) n++;
  return n;
}

export interface PlanDates { start: string | null; finish: string | null; duration: number }

/** % que ya debería estar hecho al cierre de `today`, repartido por días laborables; null si no hay fechas. */
export function plannedPercent(a: PlanDates, today: string, isWorking: IsWorking): number | null {
  if (!a.start || !a.finish) return null;
  if (a.duration === 0) return today >= a.start ? 100 : 0; // hito: cumplido o no
  if (today < a.start) return 0;
  if (today >= a.finish) return 100;
  const total = countWorking(a.start, a.finish, isWorking);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((countWorking(a.start, today, isWorking) / total) * 100)));
}

export interface Weighted { value: number | null; weight: number }
/** Promedio ponderado por duración (como el avance del proyecto). Los hitos (peso 0) no pesan; null si no hay peso. */
export function weightedAverage(items: readonly Weighted[]): number | null {
  let sum = 0, w = 0;
  for (const it of items) if (it.value !== null && it.weight > 0) { sum += it.value * it.weight; w += it.weight; }
  return w > 0 ? Math.round(sum / w) : null;
}

export interface Deviation { points: number; label: string; cls: 'badge-ok' | 'badge-warn' | 'badge-danger' | 'badge-neutral' }
export const DEVIATION_WARN = 10; // puntos de atraso a partir de los cuales pasa de ámbar a rojo
/** Ejecutado menos planificado, en puntos porcentuales. */
export function deviation(planned: number | null, actual: number | null): Deviation {
  if (planned === null || actual === null) return { points: 0, label: 'Sin datos', cls: 'badge-neutral' };
  const points = actual - planned;
  if (points >= 0) return { points, label: points === 0 ? 'Al día' : `Adelantado ${points} pts`, cls: 'badge-ok' };
  return { points, label: `Atrasado ${-points} pts`, cls: -points >= DEVIATION_WARN ? 'badge-danger' : 'badge-warn' };
}
