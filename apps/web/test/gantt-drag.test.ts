import { describe, expect, it } from 'vitest';
import { parseIso, shiftIso, snapDays, validateMoveDate } from '@/lib/gantt/drag';

describe('snapDays', () => {
  it('redondea al día más cercano, en ambos sentidos', () => {
    expect(snapDays(24, 24)).toBe(1);
    expect(snapDays(35, 24)).toBe(1);
    expect(snapDays(37, 24)).toBe(2);
    expect(snapDays(-35, 24)).toBe(-1);
    expect(snapDays(-37, 24)).toBe(-2);
    expect(snapDays(11, 24)).toBe(0);
  });
  it('nunca devuelve -0 y tolera entradas inválidas', () => {
    expect(Object.is(snapDays(-3, 24), 0)).toBe(true);
    expect(snapDays(NaN, 24)).toBe(0);
    expect(snapDays(10, 0)).toBe(0);
    expect(snapDays(Infinity, 24)).toBe(0);
  });
});

describe('shiftIso / parseIso', () => {
  it('suma y resta días cruzando mes, año y bisiesto', () => {
    expect(shiftIso('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftIso('2026-03-10', 0)).toBe('2026-03-10');
    expect(shiftIso('2026-03-10', 30)).toBe('2026-04-09');
  });
  it('rechaza fechas inexistentes', () => {
    expect(parseIso('2026-02-30')).toBeNull();
    expect(parseIso('2026-13-01')).toBeNull();
    expect(parseIso('26-1-1')).toBeNull();
    expect(parseIso(20260101)).toBeNull();
    expect(() => shiftIso('basura', 1)).toThrow();
  });
});

describe('validateMoveDate', () => {
  it('acepta el rango de la base de datos incluidos los extremos', () => {
    expect(validateMoveDate('2026-05-04')).toEqual({ ok: true, date: '2026-05-04' });
    expect(validateMoveDate('1900-01-01').ok).toBe(true);
    expect(validateMoveDate('2200-12-31').ok).toBe(true);
  });
  it('rechaza fuera de rango y formatos raros', () => {
    expect(validateMoveDate('1899-12-31').ok).toBe(false);
    expect(validateMoveDate('2201-01-01').ok).toBe(false);
    expect(validateMoveDate('2026-02-30').ok).toBe(false);
    expect(validateMoveDate(undefined).ok).toBe(false);
    expect(validateMoveDate('2026-05-04T00:00').ok).toBe(false);
  });
});

import { DEFAULT_CAL, durationForFinish, validateDuration, workingDaysInclusive } from '@/lib/gantt/drag';

describe('workingDaysInclusive', () => {
  it('lunes a viernes = 5; cruzar fin de semana no cuenta sábado ni domingo', () => {
    expect(workingDaysInclusive('2026-03-02', '2026-03-06', DEFAULT_CAL)).toBe(5);
    expect(workingDaysInclusive('2026-03-05', '2026-03-10', DEFAULT_CAL)).toBe(4); // jue vie lun mar
    expect(workingDaysInclusive('2026-03-07', '2026-03-08', DEFAULT_CAL)).toBe(0); // sáb dom
    expect(workingDaysInclusive('2026-03-02', '2026-03-02', DEFAULT_CAL)).toBe(1); // mismo día, inclusivo
    expect(workingDaysInclusive('2026-03-06', '2026-03-02', DEFAULT_CAL)).toBe(0); // fin antes que inicio
  });
  it('feriados restan y días extra de trabajo suman; los extra ganan al feriado', () => {
    const hol = { ...DEFAULT_CAL, holidays: new Set(['2026-03-04']) };
    expect(workingDaysInclusive('2026-03-02', '2026-03-06', hol)).toBe(4);
    const sat = { ...DEFAULT_CAL, extraWorking: new Set(['2026-03-07']) };
    expect(workingDaysInclusive('2026-03-02', '2026-03-08', sat)).toBe(6);
    const both = { ...DEFAULT_CAL, holidays: new Set(['2026-03-04']), extraWorking: new Set(['2026-03-04']) };
    expect(workingDaysInclusive('2026-03-02', '2026-03-06', both)).toBe(5);
  });
  it('respeta otra semana laboral (lunes a sábado)', () => {
    expect(workingDaysInclusive('2026-03-02', '2026-03-08', { ...DEFAULT_CAL, weekdays: [1, 2, 3, 4, 5, 6] })).toBe(6);
  });
  it('rechaza fechas inválidas y rangos desmesurados', () => {
    expect(() => workingDaysInclusive('x', '2026-01-01', DEFAULT_CAL)).toThrow();
    expect(() => workingDaysInclusive('1900-01-01', '2100-01-01', DEFAULT_CAL)).toThrow();
    // el límite exacto: 36 600 días de diferencia se aceptan, 36 601 no
    expect(() => workingDaysInclusive('1950-01-01', shiftIso('1950-01-01', 36_600), DEFAULT_CAL)).not.toThrow();
    expect(() => workingDaysInclusive('1950-01-01', shiftIso('1950-01-01', 36_601), DEFAULT_CAL)).toThrow();
  });
});

describe('durationForFinish / validateDuration', () => {
  it('nunca baja de 1 y cuenta días laborables', () => {
    expect(durationForFinish('2026-03-02', '2026-03-10', DEFAULT_CAL)).toBe(7);
    expect(durationForFinish('2026-03-06', '2026-03-08', DEFAULT_CAL)).toBe(1);
    expect(durationForFinish('2026-03-06', '2026-03-01', DEFAULT_CAL)).toBe(1);
  });
  it('valida duraciones enteras entre 1 y 36500', () => {
    expect(validateDuration(1)).toEqual({ ok: true, duration: 1 });
    expect(validateDuration(36500).ok).toBe(true);
    for (const bad of [0, -1, 36501, 1.5, '3', NaN, null]) expect(validateDuration(bad).ok, String(bad)).toBe(false);
  });
});
