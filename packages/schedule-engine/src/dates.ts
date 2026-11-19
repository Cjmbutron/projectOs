import { ScheduleError } from './errors';

/** Fecha de calendario en formato ISO `AAAA-MM-DD` (sin hora ni zona: el motor trabaja en días). */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;
/** Número de día (días desde 1970-01-01) de 1900-01-01. */
export const MIN_DAY = Date.UTC(MIN_YEAR, 0, 1) / MS_PER_DAY;
/** Número de día de 2200-12-31. */
export const MAX_DAY = Date.UTC(MAX_YEAR, 11, 31) / MS_PER_DAY;

/** Convierte `AAAA-MM-DD` en número de día (días desde 1970-01-01). Valida que la fecha exista. */
export function toDayNumber(iso: string): number {
  if (typeof iso !== 'string') {
    throw new ScheduleError('INVALID_DATE', 'La fecha debe ser un texto AAAA-MM-DD');
  }
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new ScheduleError('INVALID_DATE', `Fecha inválida: "${iso}" (se espera AAAA-MM-DD)`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new ScheduleError(
      'OUT_OF_RANGE',
      `Fecha fuera de rango: "${iso}" (años ${MIN_YEAR}–${MAX_YEAR})`,
    );
  }
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new ScheduleError('INVALID_DATE', `La fecha no existe: "${iso}"`);
  }
  return ms / MS_PER_DAY;
}

/** Convierte un número de día en `AAAA-MM-DD`. */
export function formatDay(day: number): IsoDate {
  if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
    throw new ScheduleError(
      'OUT_OF_RANGE',
      `El cronograma produce una fecha fuera del rango ${MIN_YEAR}–${MAX_YEAR}`,
    );
  }
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Día de la semana de un número de día: 0 = domingo … 6 = sábado. */
export function weekdayOf(day: number): number {
  // 1970-01-01 fue jueves (4).
  return (((day % 7) + 7) + 4) % 7;
}
