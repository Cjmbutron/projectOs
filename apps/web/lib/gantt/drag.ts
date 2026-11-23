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
