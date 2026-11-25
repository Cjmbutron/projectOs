/** Fechas para mostrar: «Mié-25/11/26» (día de la semana, día/mes/año de dos cifras). Entrada: «AAAA-MM-DD» o una marca de tiempo ISO. */
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Solo la parte de fecha de un valor ISO válido; null si no lo es (no existe el 30 de febrero). */
export function isoDatePart(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** «Mié-25/11/26»; «—» si no hay fecha válida. */
export function formatDay(v: unknown): string {
  const iso = isoDatePart(v);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${WEEKDAY_SHORT[new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()]}-${d}/${m}/${y.slice(2)}`;
}

/** «Lun-23/11/26 → Vie-27/11/26»; «Sin fechas» si falta alguna. */
export function formatRange(start: unknown, finish: unknown): string {
  return isoDatePart(start) && isoDatePart(finish) ? `${formatDay(start)} → ${formatDay(finish)}` : 'Sin fechas';
}

/** Hoy en la zona horaria dada, como «AAAA-MM-DD». */
export function todayIso(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
