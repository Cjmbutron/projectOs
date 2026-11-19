import { describe, expect, it } from 'vitest';
import {
  MON_FRI_CALENDAR,
  ScheduleError,
  WorkCalendar,
  formatDay,
  toDayNumber,
  weekdayOf,
} from '../src';
import { randInt, rng } from './helpers';

describe('fechas', () => {
  it('convierte ida y vuelta y conoce el día de la semana', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(formatDay(0)).toBe('1970-01-01');
    expect(weekdayOf(toDayNumber('2026-11-18'))).toBe(3); // miércoles
    expect(weekdayOf(toDayNumber('2026-11-15'))).toBe(0); // domingo
    expect(weekdayOf(toDayNumber('1969-12-31'))).toBe(3); // miércoles
    for (const iso of ['1900-01-01', '2000-02-29', '2026-12-31', '2200-12-31']) {
      expect(formatDay(toDayNumber(iso))).toBe(iso);
    }
  });

  it('rechaza fechas mal formadas, inexistentes o fuera de rango', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '18/11/2026', '', 'hoy']) {
      expect(() => toDayNumber(bad)).toThrowError(ScheduleError);
    }
    expect(() => toDayNumber('2025-02-29')).toThrow(/no existe/);
    expect(() => toDayNumber('1899-12-31')).toThrow(/fuera de rango/);
    expect(() => toDayNumber('2201-01-01')).toThrow(/fuera de rango/);
    expect(() => toDayNumber(20261118 as unknown as string)).toThrowError(ScheduleError);
  });
});

describe('calendario laboral', () => {
  it('lunes a viernes: cuenta y ubica días laborables', () => {
    const cal = new WorkCalendar(MON_FRI_CALENDAR);
    expect(cal.isWorkingDate('2026-11-06')).toBe(true); // viernes
    expect(cal.isWorkingDate('2026-11-07')).toBe(false); // sábado
    expect(cal.isWorkingDate('2026-11-08')).toBe(false); // domingo
    expect(cal.nextWorkingDate('2026-11-07')).toBe('2026-11-09');
    expect(cal.nextWorkingDate('2026-11-09')).toBe('2026-11-09');
    expect(cal.workingDaysBetween('2026-11-02', '2026-11-09')).toBe(5);
    expect(cal.workingDaysBetween('2026-11-09', '2026-11-02')).toBe(-5);
    expect(cal.workingDaysBetween('2026-11-07', '2026-11-09')).toBe(0);
  });

  it('feriados y excepciones laborables', () => {
    const cal = new WorkCalendar({
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: ['2026-11-03', '2026-11-08'], // martes; el domingo no cambia nada
      workingExceptions: ['2026-11-07', '2026-11-04'], // sábado cuenta; el miércoles ya era laborable
    });
    expect(cal.isWorkingDate('2026-11-03')).toBe(false);
    expect(cal.isWorkingDate('2026-11-04')).toBe(true);
    expect(cal.isWorkingDate('2026-11-07')).toBe(true);
    expect(cal.isWorkingDate('2026-11-08')).toBe(false);
    // Lun 2, (mar 3 feriado), mié 4, jue 5, vie 6, sáb 7 → 5 laborables entre el 2 y el 9.
    expect(cal.workingDaysBetween('2026-11-02', '2026-11-09')).toBe(5);
  });

  it('semana de seis días (lunes a sábado)', () => {
    const cal = new WorkCalendar({ workingWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(cal.workingDaysBetween('2026-11-02', '2026-11-09')).toBe(6);
    expect(cal.nextWorkingDate('2026-11-08')).toBe('2026-11-09');
  });

  it('rechaza definiciones inválidas', () => {
    expect(() => new WorkCalendar({ workingWeekdays: [] })).toThrow(/al menos un día/);
    expect(() => new WorkCalendar({ workingWeekdays: [7] })).toThrowError(ScheduleError);
    expect(() => new WorkCalendar({ workingWeekdays: [1.5] })).toThrowError(ScheduleError);
    expect(
      () =>
        new WorkCalendar({
          workingWeekdays: [1],
          holidays: ['2026-11-02'],
          workingExceptions: ['2026-11-02'],
        }),
    ).toThrow(/feriado y como excepción/);
    expect(() => new WorkCalendar({ workingWeekdays: [1], holidays: ['2026-02-31'] })).toThrowError(ScheduleError);
  });

  it('coincide con un recorrido día por día en 300 calendarios aleatorios', () => {
    const random = rng(20261118);
    const base = toDayNumber('2026-01-01');

    for (let trial = 0; trial < 300; trial++) {
      const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(() => random() < 0.55);
      if (weekdays.length === 0) weekdays.push(randInt(random, 0, 6));
      const holidays = new Set<string>();
      const exceptions = new Set<string>();
      for (let i = randInt(random, 0, 12); i > 0; i--) {
        const iso = formatDay(base + randInt(random, -30, 150));
        if (random() < 0.5) holidays.add(iso);
        else exceptions.add(iso);
      }
      for (const iso of holidays) exceptions.delete(iso);
      const cal = new WorkCalendar({
        workingWeekdays: weekdays,
        holidays: [...holidays],
        workingExceptions: [...exceptions],
      });

      // Oráculo: se decide laborable día por día con las reglas del enunciado.
      const naiveWorking = (day: number) => {
        const iso = formatDay(day);
        if (holidays.has(iso)) return false;
        if (exceptions.has(iso)) return true;
        return weekdays.includes(weekdayOf(day));
      };

      const from = base - 60;
      const to = base + 220;
      let counted = 0;
      const workingDays: number[] = [];
      for (let day = from; day <= to; day++) {
        expect(cal.isWorkingDay(day)).toBe(naiveWorking(day));
        expect(cal.workingDaysBefore(day) - cal.workingDaysBefore(from)).toBe(counted);
        if (naiveWorking(day)) {
          // El ordinal de un día laborable es el conteo de laborables anteriores.
          expect(cal.dayOfOrdinal(cal.workingDaysBefore(from) + counted)).toBe(day);
          workingDays.push(day);
          counted++;
        }
      }
      // nextWorkingDay / previousWorkingDay
      for (let day = from + 1; day < to - 14; day += 3) {
        const next = workingDays.find((d) => d >= day)!;
        // Si en la ventana recorrida no hay un laborable previo, el oráculo no tiene respuesta.
        const prev = [...workingDays].reverse().find((d) => d <= day);
        expect(cal.nextWorkingDay(day)).toBe(next);
        if (prev !== undefined) expect(cal.previousWorkingDay(day)).toBe(prev);
        expect(cal.isWorkingDay(cal.previousWorkingDay(day))).toBe(true);
        expect(cal.previousWorkingDay(day)).toBeLessThanOrEqual(day);
      }
    }
  });

  it('funciona con ordinales muy lejanos y negativos', () => {
    const cal = new WorkCalendar({
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: ['2026-12-25', '2027-01-01'],
    });
    const c = cal.workingDaysBefore(toDayNumber('2026-11-02'));
    for (const k of [-5000, -1, 0, 1, 7, 2600, 20000]) {
      const day = cal.dayOfOrdinal(c + k);
      expect(cal.isWorkingDay(day)).toBe(true);
      expect(cal.workingDaysBefore(day)).toBe(c + k);
    }
  });
});
