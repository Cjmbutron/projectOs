import { describe, expect, it } from 'vitest';
import { parseAbsenceForm, rangeLabel, upcoming, weekdaysInRange } from '@/lib/absences';

const R = '123e4567-e89b-42d3-a456-426614174000';
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] });

describe('parseAbsenceForm', () => {
  it('acepta un rango válido y limpia el motivo', () => {
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-04', end: '2026-03-05', reason: ' Vacaciones ' })))
      .toEqual({ ok: true, resourceId: R, start: '2026-03-04', end: '2026-03-05', reason: 'Vacaciones' });
  });
  it('motivo vacío → null; un solo día es válido', () => {
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-04', end: '2026-03-04', reason: '  ' }))).toMatchObject({ ok: true, reason: null });
  });
  it('rechaza recurso inválido, fechas imposibles y fin anterior al inicio', () => {
    const bad = { ok: false, error: 'invalid_absence' };
    expect(parseAbsenceForm(form({ resource: 'x', start: '2026-03-04', end: '2026-03-05' }))).toEqual(bad);
    expect(parseAbsenceForm(form({ resource: R, start: '2026-02-30', end: '2026-03-05' }))).toEqual(bad);
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-04', end: '' }))).toEqual(bad);
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-05', end: '2026-03-04' }))).toEqual(bad);
  });
  it('límite de 365 días de diferencia y de 200 caracteres', () => {
    expect(parseAbsenceForm(form({ resource: R, start: '2027-01-01', end: '2027-12-31' })).ok).toBe(true);
    expect(parseAbsenceForm(form({ resource: R, start: '2027-01-01', end: '2028-01-02' })).ok).toBe(false);
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-04', end: '2026-03-05', reason: 'x'.repeat(200) })).ok).toBe(true);
    expect(parseAbsenceForm(form({ resource: R, start: '2026-03-04', end: '2026-03-05', reason: 'x'.repeat(201) })).ok).toBe(false);
  });
});

describe('weekdaysInRange', () => {
  it('cuenta solo lunes a viernes', () => {
    expect(weekdaysInRange('2026-03-02', '2026-03-06')).toBe(5);
    expect(weekdaysInRange('2026-03-02', '2026-03-08')).toBe(5);
    expect(weekdaysInRange('2026-03-07', '2026-03-08')).toBe(0);
    expect(weekdaysInRange('2026-03-06', '2026-03-09')).toBe(2);
    expect(weekdaysInRange('2026-03-04', '2026-03-04')).toBe(1);
  });
  it('rango o fechas inválidos → 0', () => {
    expect(weekdaysInRange('2026-03-05', '2026-03-04')).toBe(0);
    expect(weekdaysInRange('x', '2026-03-04')).toBe(0);
  });
});

describe('rangeLabel / upcoming', () => {
  const f = (s: string) => s.slice(5);
  it('etiqueta de uno o varios días', () => {
    expect(rangeLabel('2026-03-04', '2026-03-04', f)).toBe('03-04');
    expect(rangeLabel('2026-03-04', '2026-03-05', f)).toBe('03-04 – 03-05');
  });
  it('solo vigentes, ordenadas por inicio y luego por fin', () => {
    const rows = [
      { start_date: '2026-05-01', end_date: '2026-05-03' }, { start_date: '2026-01-01', end_date: '2026-02-01' },
      { start_date: '2026-03-01', end_date: '2026-03-10' }, { start_date: '2026-03-01', end_date: '2026-03-05' },
      { start_date: '2026-02-20', end_date: '2026-03-05' },
    ];
    expect(upcoming(rows, '2026-03-05')).toEqual([
      { start_date: '2026-02-20', end_date: '2026-03-05' }, { start_date: '2026-03-01', end_date: '2026-03-05' },
      { start_date: '2026-03-01', end_date: '2026-03-10' }, { start_date: '2026-05-01', end_date: '2026-05-03' },
    ]);
  });
});
