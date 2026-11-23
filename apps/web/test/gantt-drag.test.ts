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
