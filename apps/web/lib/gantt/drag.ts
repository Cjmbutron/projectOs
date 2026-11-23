/** Lógica pura del arrastre del Gantt: píxeles → días → fecha de la restricción «no empezar antes de». */
const DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Días enteros más cercanos a un desplazamiento en píxeles (nunca -0). */
export function snapDays(dxPx: number, pxPerDay: number): number {
  if (!Number.isFinite(dxPx) || !(pxPerDay > 0)) return 0;
  return Math.round(dxPx / pxPerDay) || 0;
}

/** Fecha ISO real (rechaza 2026-02-30) o null. */
export function parseIso(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}

export function shiftIso(iso: string, days: number): string {
  const t = parseIso(iso);
  if (t === null) throw new RangeError('fecha inválida');
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

export type MoveCheck = { ok: true; date: string } | { ok: false; error: 'invalid_value' };

/** La base de datos acepta restricciones entre 1900-01-01 y 2200-12-31 (y lo vuelve a exigir). */
export function validateMoveDate(date: unknown): MoveCheck {
  const t = parseIso(date);
  if (t === null || t < Date.UTC(1900, 0, 1) || t > Date.UTC(2200, 11, 31)) return { ok: false, error: 'invalid_value' };
  return { ok: true, date: date as string };
}

export interface WorkCal { weekdays: number[]; holidays: ReadonlySet<string>; extraWorking: ReadonlySet<string> }
export const DEFAULT_CAL: WorkCal = { weekdays: [1, 2, 3, 4, 5], holidays: new Set(), extraWorking: new Set() };

/** Días laborables en [inicio, fin] ambos inclusive (mismo criterio que el motor y la base de datos). */
export function workingDaysInclusive(startIso: string, finishIso: string, cal: WorkCal): number {
  const s = parseIso(startIso), f = parseIso(finishIso);
  if (s === null || f === null) throw new RangeError('fecha inválida');
  if (f < s) return 0;
  if ((f - s) / DAY > 36_600) throw new RangeError('rango demasiado grande');
  let n = 0;
  for (let t = s; t <= f; t += DAY) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (cal.extraWorking.has(iso) || (cal.weekdays.includes(d.getUTCDay()) && !cal.holidays.has(iso))) n++;
  }
  return n;
}

/** Duración (≥ 1 día laborable) que tendría una actividad que empieza en `start` si termina en `newFinish`. */
export function durationForFinish(startIso: string, newFinishIso: string, cal: WorkCal): number {
  return Math.max(1, workingDaysInclusive(startIso, newFinishIso, cal));
}

export type ResizeCheck = { ok: true; duration: number } | { ok: false; error: 'invalid_value' };
export function validateDuration(v: unknown): ResizeCheck {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 36500 ? { ok: true, duration: v } : { ok: false, error: 'invalid_value' };
}
