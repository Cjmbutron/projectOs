import { UUID_RE } from '@/lib/http';
import { parseIso } from '@/lib/gantt/drag';

export type AbsenceParse =
  | { ok: true; resourceId: string; start: string; end: string; reason: string | null }
  | { ok: false; error: 'invalid_absence' };

/** Valida el formulario de ausencia: recurso, fechas ISO reales, fin ≥ inicio, a lo sumo 365 días y motivo ≤ 200. */
export function parseAbsenceForm(f: { get(name: string): unknown }): AbsenceParse {
  const resourceId = String(f.get('resource') ?? '');
  const start = String(f.get('start') ?? '').trim();
  const end = String(f.get('end') ?? '').trim();
  const reason = String(f.get('reason') ?? '').trim();
  const a = parseIso(start), b = parseIso(end);
  if (!UUID_RE.test(resourceId) || a === null || b === null || b < a || (b - a) / 86_400_000 > 365 || reason.length > 200) {
    return { ok: false, error: 'invalid_absence' };
  }
  return { ok: true, resourceId, start, end, reason: reason || null };
}

/** Días de lunes a viernes dentro del rango (los que restan capacidad). */
export function weekdaysInRange(start: string, end: string): number {
  const a = parseIso(start), b = parseIso(end);
  if (a === null || b === null || b < a) return 0;
  let n = 0;
  for (let t = a; t <= b; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d >= 1 && d <= 5) n++;
  }
  return n;
}

/** «4 mar – 5 mar» o «4 mar» si es un solo día. */
export function rangeLabel(start: string, end: string, fmt: (iso: string) => string): string {
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

/** Ausencias que aún no terminaron (fin ≥ hoy), ordenadas por inicio. */
export function upcoming<T extends { start_date: string; end_date: string }>(rows: T[], today: string): T[] {
  return rows.filter((r) => r.end_date >= today).sort((x, y) => x.start_date.localeCompare(y.start_date) || x.end_date.localeCompare(y.end_date));
}
