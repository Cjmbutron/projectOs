import { parseIso, shiftIso } from '@/lib/gantt/drag';

export interface LoadRow { resource_id: string; week_start: string; hours: number; capacity_hours: number; overallocated: boolean }
export interface LoadResource { id: string; name: string; active: boolean }
export interface Cell { hours: number; capacity: number; over: boolean; pct: number }
export interface GridRow { resource: LoadResource; cells: (Cell | null)[]; overWeeks: number }

/** Lunes (semana ISO) de la fecha dada. */
export function mondayOf(iso: string): string {
  const t = parseIso(iso);
  if (t === null) throw new RangeError('fecha inválida');
  const dow = new Date(t).getUTCDay();            // 0 = domingo
  return shiftIso(iso, -((dow + 6) % 7));
}

export interface LoadParams { from: string; weeks: number; to: string }

/** `from` inválido → semana actual; `weeks` entre 1 y 26 (por defecto 8). */
export function parseLoadParams(sp: { from?: string; weeks?: string }, today: string): LoadParams {
  const from = mondayOf(sp.from && parseIso(sp.from) !== null ? sp.from : today);
  const n = /^\d{1,2}$/.test(sp.weeks ?? '') ? Number(sp.weeks) : 8;
  const weeks = n >= 1 && n <= 26 ? n : 8;
  return { from, weeks, to: shiftIso(from, weeks * 7 - 1) };
}

export function weekStarts(from: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => shiftIso(from, i * 7));
}

/** Una fila por recurso activo (o inactivo con carga) y una celda por semana; `null` = sin carga. */
export function buildGrid(resources: LoadResource[], rows: LoadRow[], weeks: string[]): { rows: GridRow[]; overCells: number } {
  const byKey = new Map(rows.map((r) => [`${r.resource_id}|${r.week_start}`, r]));
  const withLoad = new Set(rows.map((r) => r.resource_id));
  const out: GridRow[] = [];
  for (const res of [...resources].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    if (!res.active && !withLoad.has(res.id)) continue;
    const cells = weeks.map((w) => {
      const r = byKey.get(`${res.id}|${w}`);
      if (!r) return null;
      const hours = Number(r.hours), capacity = Number(r.capacity_hours);
      return { hours, capacity, over: r.overallocated === true, pct: capacity > 0 ? Math.round((hours / capacity) * 100) : 0 };
    });
    out.push({ resource: res, cells, overWeeks: cells.filter((c) => c?.over).length });
  }
  return { rows: out, overCells: out.reduce((n, r) => n + r.overWeeks, 0) };
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));
/** Texto de una celda; el estado va en palabras, no solo en color. */
export function cellLabel(c: Cell | null): string {
  if (!c) return '—';
  const pct = c.capacity > 0 ? `${c.pct} %` : 'sin capacidad';
  return `${num(c.hours)} / ${num(c.capacity)} h · ${pct}${c.over ? ' · Sobreasignado' : ''}`;
}

/** «2 mar» a partir de una fecha ISO. */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function shortDate(iso: string): string {
  const t = parseIso(iso);
  if (t === null) return iso;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface Overload { resourceId: string; weeks: string[] }

/** Recursos (entre `resourceIds`) con semanas sobreasignadas, por orden de aparición de `resourceIds`; semanas ordenadas. */
export function overloadedAmong(rows: LoadRow[], resourceIds: string[]): Overload[] {
  const wanted = new Set(resourceIds);
  const byRes = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.overallocated !== true || !wanted.has(r.resource_id)) continue;
    (byRes.get(r.resource_id) ?? byRes.set(r.resource_id, new Set()).get(r.resource_id)!).add(r.week_start);
  }
  return [...new Set(resourceIds)].filter((id) => byRes.has(id)).map((id) => ({ resourceId: id, weeks: [...byRes.get(id)!].sort() }));
}

/** Rango a consultar para el aviso: de la primera a la última fecha de actividades, a lo sumo 372 días desde el inicio. */
export function loadRange(starts: (string | null)[], finishes: (string | null)[]): { from: string; to: string } | null {
  const s = starts.filter((x): x is string => !!x && parseIso(x) !== null).sort();
  const f = finishes.filter((x): x is string => !!x && parseIso(x) !== null).sort();
  if (!s.length || !f.length) return null;
  const from = mondayOf(s[0]);
  const last = f[f.length - 1];
  const cap = shiftIso(from, 371);
  const to = last < from ? from : last > cap ? cap : last;
  return { from, to };
}
