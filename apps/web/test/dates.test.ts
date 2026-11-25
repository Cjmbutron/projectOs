import { describe, expect, it } from 'vitest';
import { formatDay, formatRange, isoDatePart, todayIso } from '@/lib/dates';

describe('formatDay', () => {
  it('día-DD/MM/AA', () => {
    expect(formatDay('2026-11-25')).toBe('Mié-25/11/26');
    expect(formatDay('2026-11-22')).toBe('Dom-22/11/26');
    expect(formatDay('2026-11-28')).toBe('Sáb-28/11/26');
    expect(formatDay('2027-01-01')).toBe('Vie-01/01/27');
    expect(formatDay('2026-02-16')).toBe('Lun-16/02/26');
    expect(formatDay('2026-12-01')).toBe('Mar-01/12/26');
    expect(formatDay('2026-12-03')).toBe('Jue-03/12/26');
  });
  it('acepta una marca de tiempo y usa solo su fecha', () => expect(formatDay('2026-11-25T23:59:00Z')).toBe('Mié-25/11/26'));
  it('sin fecha válida: raya', () => {
    for (const v of [null, undefined, '', 'hola', '2026-02-30', 20261125, '2026-13-01']) expect(formatDay(v)).toBe('—');
  });
  it('año de dos cifras con ceros', () => expect(formatDay('2005-03-07')).toBe('Lun-07/03/05'));
});
describe('formatRange e isoDatePart', () => {
  it('rango', () => expect(formatRange('2026-11-23', '2026-11-27')).toBe('Lun-23/11/26 → Vie-27/11/26'));
  it('si falta alguna fecha', () => {
    expect(formatRange(null, '2026-11-27')).toBe('Sin fechas');
    expect(formatRange('2026-11-23', 'x')).toBe('Sin fechas');
  });
  it('parte de fecha', () => {
    expect(isoDatePart('2026-11-25T10:00:00Z')).toBe('2026-11-25');
    expect(isoDatePart('2026-02-29')).toBeNull();
    expect(isoDatePart('2028-02-29')).toBe('2028-02-29');
  });
});
describe('todayIso', () => {
  it('respeta la zona horaria', () => {
    const t = new Date('2026-11-26T02:00:00Z');
    expect(todayIso('America/La_Paz', t)).toBe('2026-11-25');
    expect(todayIso('UTC', t)).toBe('2026-11-26');
  });
});
