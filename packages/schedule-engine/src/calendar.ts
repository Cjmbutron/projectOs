import { ScheduleError } from './errors';
import { formatDay, toDayNumber, weekdayOf, type IsoDate } from './dates';

/**
 * Definición de un calendario laboral.
 * - `workingWeekdays`: días laborables de la semana base (0 = domingo … 6 = sábado).
 * - `holidays`: fechas no laborables (feriados, cierres).
 * - `workingExceptions`: fechas laborables que normalmente no lo serían (p. ej. un sábado de recuperación).
 */
export interface CalendarInput {
  readonly workingWeekdays: readonly number[];
  readonly holidays?: readonly IsoDate[];
  readonly workingExceptions?: readonly IsoDate[];
}

/** Lunes a viernes, sin feriados. */
export const MON_FRI_CALENDAR: CalendarInput = Object.freeze({
  workingWeekdays: Object.freeze([1, 2, 3, 4, 5]),
});

/** Los siete días de la semana laborables, sin feriados. Útil para pruebas y plazos corridos. */
export const EVERY_DAY_CALENDAR: CalendarInput = Object.freeze({
  workingWeekdays: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
});

/** Cantidad de elementos estrictamente menores que `value` en un arreglo ordenado. */
function countLess(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Menor `n` para el que `pred(n)` es verdadero, con `pred` monótona (falso…falso, verdadero…verdadero). */
function firstTrue(pred: (n: number) => boolean, guess: number): number {
  const LIMIT = 4_000_000;
  let lo: number;
  let hi: number;
  if (pred(guess)) {
    hi = guess;
    let step = 1;
    lo = guess - step;
    while (pred(lo)) {
      hi = lo;
      step *= 2;
      if (step > LIMIT) throw new ScheduleError('OUT_OF_RANGE', 'Fecha fuera del rango soportado');
      lo = guess - step;
    }
  } else {
    lo = guess;
    let step = 1;
    hi = guess + step;
    while (!pred(hi)) {
      lo = hi;
      step *= 2;
      if (step > LIMIT) throw new ScheduleError('OUT_OF_RANGE', 'Fecha fuera del rango soportado');
      hi = guess + step;
    }
  }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Calendario laboral. Trabaja con números de día (días desde 1970-01-01).
 *
 * Idea central: `workingDaysBefore(d)` cuenta los días laborables estrictamente anteriores a `d`
 * (con signo, respecto del origen de la época). Con esa función monótona se resuelve todo:
 * ordinal de un día laborable, siguiente día laborable, diferencia en días laborables.
 * El costo es O(log h) con h = feriados + excepciones, sin recorrer días uno a uno.
 */
export class WorkCalendar {
  private readonly pattern: readonly boolean[];
  private readonly perWeek: number;
  private readonly prefix: readonly number[];
  private readonly removals: readonly number[];
  private readonly additions: readonly number[];
  private readonly removalSet: ReadonlySet<number>;
  private readonly additionSet: ReadonlySet<number>;

  constructor(input: CalendarInput) {
    if (!input || !Array.isArray(input.workingWeekdays)) {
      throw new ScheduleError('INVALID_CALENDAR', 'El calendario requiere "workingWeekdays"');
    }
    const pattern: boolean[] = new Array<boolean>(7).fill(false);
    for (const weekday of input.workingWeekdays) {
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new ScheduleError(
          'INVALID_CALENDAR',
          `Día de la semana inválido: ${String(weekday)} (use 0 = domingo … 6 = sábado)`,
        );
      }
      pattern[weekday] = true;
    }
    const perWeek = pattern.filter(Boolean).length;
    if (perWeek === 0) {
      throw new ScheduleError('INVALID_CALENDAR', 'El calendario debe tener al menos un día laborable por semana');
    }
    const prefix: number[] = [0];
    for (let r = 0; r < 7; r++) prefix.push(prefix[r]! + (pattern[r] ? 1 : 0));

    const holidays = new Set((input.holidays ?? []).map(toDayNumber));
    const exceptions = new Set((input.workingExceptions ?? []).map(toDayNumber));
    for (const day of holidays) {
      if (exceptions.has(day)) {
        throw new ScheduleError(
          'INVALID_CALENDAR',
          `La fecha ${formatDay(day)} figura a la vez como feriado y como excepción laborable`,
        );
      }
    }

    // Solo cuentan los feriados que caen en día laborable base y las excepciones que caen en día no laborable base.
    const removals = [...holidays].filter((d) => pattern[weekdayOf(d)]).sort((a, b) => a - b);
    const additions = [...exceptions].filter((d) => !pattern[weekdayOf(d)]).sort((a, b) => a - b);

    this.pattern = pattern;
    this.perWeek = perWeek;
    this.prefix = prefix;
    this.removals = removals;
    this.additions = additions;
    this.removalSet = new Set(removals);
    this.additionSet = new Set(additions);
  }

  isWorkingDay(day: number): boolean {
    return this.pattern[weekdayOf(day)] ? !this.removalSet.has(day) : this.additionSet.has(day);
  }

  /** Cantidad de días laborables estrictamente anteriores a `day` (con signo; origen en la época). */
  workingDaysBefore(day: number): number {
    // Los días ...-4 (domingo), -3, … forman semanas completas: weekday(-4) = 0.
    const m = day + 4;
    const full = Math.floor(m / 7);
    const rem = m - full * 7;
    return (
      full * this.perWeek +
      this.prefix[rem]! -
      countLess(this.removals, day) +
      countLess(this.additions, day)
    );
  }

  /** Día laborable cuyo ordinal (cantidad de laborables anteriores) es `ordinal`. */
  dayOfOrdinal(ordinal: number): number {
    const guess = Math.floor((ordinal * 7) / this.perWeek) - 4;
    // m = primer día con (laborables anteriores) ≥ ordinal + 1  →  el laborable buscado es m - 1.
    const m = firstTrue((n) => this.workingDaysBefore(n) >= ordinal + 1, guess);
    return m - 1;
  }

  /** Primer día laborable en `day` o después. */
  nextWorkingDay(day: number): number {
    return this.dayOfOrdinal(this.workingDaysBefore(day));
  }

  /** Último día laborable en `day` o antes. */
  previousWorkingDay(day: number): number {
    return this.dayOfOrdinal(this.workingDaysBefore(day + 1) - 1);
  }

  // ---- Conveniencias con fechas ISO ----

  isWorkingDate(date: IsoDate): boolean {
    return this.isWorkingDay(toDayNumber(date));
  }

  /** Primer día laborable en `date` o después. */
  nextWorkingDate(date: IsoDate): IsoDate {
    return formatDay(this.nextWorkingDay(toDayNumber(date)));
  }

  /** Días laborables en el intervalo [from, to): positivo si `to` es posterior. */
  workingDaysBetween(from: IsoDate, to: IsoDate): number {
    return this.workingDaysBefore(toDayNumber(to)) - this.workingDaysBefore(toDayNumber(from));
  }
}

/** Crea el calendario a partir de su definición (o devuelve el mismo si ya es un `WorkCalendar`). */
export function createCalendar(input: CalendarInput | WorkCalendar): WorkCalendar {
  return input instanceof WorkCalendar ? input : new WorkCalendar(input);
}
