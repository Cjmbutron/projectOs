export type Health = 'green' | 'amber' | 'red' | 'unknown';

/** Texto siempre presente: el color nunca es la única señal. */
export const HEALTH_LABEL: Record<Health, string> = { green: 'Verde', amber: 'Ámbar', red: 'Rojo', unknown: 'Sin datos' };
export const HEALTH_ICON: Record<Health, string> = { green: '●', amber: '▲', red: '■', unknown: '○' };

export const isHealth = (v: unknown): v is Health => v === 'green' || v === 'amber' || v === 'red' || v === 'unknown';

export interface HealthSummary { total: number; counts: Record<Health, number> }

export function summarizeHealth(rows: { health: string }[]): HealthSummary {
  const counts: Record<Health, number> = { green: 0, amber: 0, red: 0, unknown: 0 };
  for (const r of rows) counts[isHealth(r.health) ? r.health : 'unknown']++;
  return { total: rows.length, counts };
}

export type ThresholdParse = { ok: true; amber: number; red: number } | { ok: false; error: 'invalid_thresholds' };

/** Umbrales en días laborables: enteros 0–3650 y rojo ≥ ámbar (la base de datos lo vuelve a exigir). */
export function parseThresholds(f: { get(name: string): unknown }): ThresholdParse {
  const num = (k: string) => {
    const raw = String(f.get(k) ?? '').trim();
    return /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  };
  const amber = num('amber');
  const red = num('red');
  if (!Number.isInteger(amber) || !Number.isInteger(red) || amber > 3650 || red > 3650 || red < amber) {
    return { ok: false, error: 'invalid_thresholds' };
  }
  return { ok: true, amber, red };
}

/** Clase de insignia por salud (el texto del estado siempre se muestra al lado). */
export const HEALTH_BADGE: Record<Health, string> = { green: 'badge badge-ok', amber: 'badge badge-warn', red: 'badge badge-danger', unknown: 'badge badge-neutral' };
