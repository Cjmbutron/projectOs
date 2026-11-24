/** Calendario del proyecto: feriados y días trabajados excepcionales. Lógica pura (fechas ISO «AAAA-MM-DD»). */

export type DayKind = 'holiday' | 'working';
export const MAX_RANGE_DAYS = 366;
export const MAX_SUGGESTED = 40;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

/** Fecha ISO real (no 2026-02-30) entre los años 2000 y 2100; si no, null. */
export function parseIsoDay(raw: unknown): string | null {
  const m = ISO_RE.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const toIso = (t: Date) => t.toISOString().slice(0, 10);
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1, d + n)));
}
/** 0 = domingo … 6 = sábado (igual que `working_weekdays`). */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const WEEKDAY_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function weekdayLabel(iso: string): string { return WEEKDAY_ES[weekdayOf(iso)]; }

/** Todos los días de start a end (incluidos); null si el rango es inválido o pasa de 366 días. */
export function expandRange(start: string, end: string | null): string[] | null {
  const s = parseIsoDay(start);
  const e = end === null ? s : parseIsoDay(end);
  if (!s || !e || e < s) return null;
  const out: string[] = [];
  for (let d = s; d <= e; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > MAX_RANGE_DAYS) return null;
  }
  return out;
}

export interface DayFormInput { start: string; end: string | null; kind: DayKind; name: string }
export function parseDayForm(get: (k: string) => unknown): DayFormInput | null {
  const start = parseIsoDay(get('start'));
  if (!start) return null;
  const endRaw = String(get('end') ?? '').trim();
  const end = endRaw === '' ? null : parseIsoDay(endRaw);
  if (endRaw !== '' && !end) return null;
  const kind = get('kind');
  if (kind !== 'holiday' && kind !== 'working') return null;
  const name = String(get('name') ?? '').trim();
  if (name.length > 120) return null;
  if (kind === 'holiday' && name === '') return null;
  if (!expandRange(start, end)) return null;
  return { start, end, kind, name: name || 'Día trabajado' };
}

export interface Plan { toAdd: string[]; noEffect: number; existing: number }
/**
 * Qué días se guardan realmente. Un feriado solo importa en un día que sería laborable y un día trabajado
 * excepcional solo en uno que no lo sería; los días con registro previo no se repiten.
 */
export function planDays(days: string[], kind: DayKind, workingWeekdays: readonly number[], existing: ReadonlySet<string>): Plan {
  const wd = new Set(workingWeekdays.length ? workingWeekdays : DEFAULT_WEEKDAYS);
  const plan: Plan = { toAdd: [], noEffect: 0, existing: 0 };
  for (const d of days) {
    if (existing.has(d)) { plan.existing++; continue; }
    const isWorkingBase = wd.has(weekdayOf(d));
    if ((kind === 'holiday') !== isWorkingBase) { plan.noEffect++; continue; }
    plan.toAdd.push(d);
  }
  return plan;
}

/** Domingo de Pascua (calendario gregoriano, algoritmo anónimo). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface Suggested { day: string; name: string }
/**
 * Feriados nacionales de Bolivia SUGERIDOS para un año: fechas habituales más las móviles de Semana Santa.
 * El gobierno puede trasladar o agregar días por decreto cada año, así que la persona debe revisarlos y
 * corregir las fechas antes de guardar. 2026 incluye los cambios del DS 5521 (enero de 2026).
 */
export function suggestedHolidays(year: number): Suggested[] {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return [];
  const y = String(year);
  const easter = easterSunday(year);
  const list: Suggested[] = [
    { day: `${y}-01-01`, name: 'Año Nuevo' },
    { day: year === 2026 ? '2026-01-23' : `${y}-01-22`, name: 'Día del Estado Plurinacional' },
    { day: addDays(easter, -48), name: 'Lunes de Carnaval' },
    { day: addDays(easter, -47), name: 'Martes de Carnaval' },
    { day: addDays(easter, -2), name: 'Viernes Santo' },
    { day: `${y}-05-01`, name: 'Día del Trabajo' },
    { day: addDays(easter, 60), name: 'Corpus Christi' },
    { day: year === 2026 ? '2026-06-22' : `${y}-06-21`, name: 'Año Nuevo Andino Amazónico' },
    { day: `${y}-08-06`, name: 'Día de la Patria' },
    { day: `${y}-11-02`, name: 'Día de Todos Santos' },
    { day: `${y}-12-25`, name: 'Navidad' },
  ];
  if (year === 2026) {
    list.push({ day: '2026-06-05', name: 'Día no laborable adicional (DS 5521)' }, { day: '2026-08-07', name: 'Día no laborable adicional (DS 5521)' });
  }
  return list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Año pedido en la URL; si no es válido, el actual. */
export function parseYear(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : fallback;
}

/** Filas marcadas del formulario de sugeridos: campos `day_i`, `name_i` y `on_i`. */
export function parseSuggestedForm(get: (k: string) => unknown): Suggested[] | null {
  const out: Suggested[] = [];
  for (let i = 0; i < MAX_SUGGESTED; i++) {
    if (get(`on_${i}`) !== 'on') continue;
    const day = parseIsoDay(get(`day_${i}`));
    const name = String(get(`name_${i}`) ?? '').trim();
    if (!day || name === '' || name.length > 120) return null;
    out.push({ day, name });
  }
  if (new Set(out.map((s) => s.day)).size !== out.length) return null;
  return out.length ? out : null;
}
