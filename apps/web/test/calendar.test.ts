import { describe, expect, it } from 'vitest';
import { addDays, easterSunday, expandRange, parseDayForm, parseIsoDay, parseSuggestedForm, parseYear, planDays, suggestedHolidays, weekdayLabel, weekdayOf } from '@/lib/calendar';

const form = (o: Record<string, unknown>) => (k: string) => o[k];

describe('fechas', () => {
  it('valida fechas reales y el rango de años', () => {
    expect(parseIsoDay('2026-02-28')).toBe('2026-02-28');
    expect(parseIsoDay('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-1', '', null, undefined, '1999-12-31', '2101-01-01', '26-01-01']) expect(parseIsoDay(bad)).toBeNull();
  });
  it('suma días y cambia de mes y de año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('día de la semana: 0 domingo … 6 sábado', () => {
    expect(weekdayOf('2026-11-23')).toBe(1);
    expect(weekdayOf('2026-11-22')).toBe(0);
    expect(weekdayOf('2026-11-28')).toBe(6);
    expect(weekdayLabel('2026-11-23')).toBe('lunes');
  });
  it('rangos: incluye extremos, rechaza invertidos y de más de 366 días', () => {
    expect(expandRange('2026-03-01', '2026-03-03')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(expandRange('2026-03-01', null)).toEqual(['2026-03-01']);
    expect(expandRange('2026-03-03', '2026-03-01')).toBeNull();
    expect(expandRange('2026-01-01', '2026-12-31')).toHaveLength(365);
    expect(expandRange('2026-01-01', '2027-01-01')).toHaveLength(366);
    expect(expandRange('2026-01-01', '2027-01-02')).toBeNull();
    expect(expandRange('malo', null)).toBeNull();
  });
});

describe('parseDayForm', () => {
  const ok = { start: '2026-06-22', end: '', kind: 'holiday', name: ' Feriado ' };
  it('feriado válido, con nombre recortado y fin vacío = un solo día', () => expect(parseDayForm(form(ok))).toEqual({ start: '2026-06-22', end: null, kind: 'holiday', name: 'Feriado' }));
  it('un feriado exige nombre', () => expect(parseDayForm(form({ ...ok, name: '  ' }))).toBeNull());
  it('un día trabajado puede ir sin nombre', () => expect(parseDayForm(form({ ...ok, kind: 'working', name: '' }))?.name).toBe('Día trabajado'));
  it('rechaza tipo, fechas o nombre inválidos', () => {
    expect(parseDayForm(form({ ...ok, kind: 'otro' }))).toBeNull();
    expect(parseDayForm(form({ ...ok, start: '2026-02-30' }))).toBeNull();
    expect(parseDayForm(form({ ...ok, end: '2026-02-30' }))).toBeNull();
    expect(parseDayForm(form({ ...ok, end: '2026-06-01' }))).toBeNull();
    expect(parseDayForm(form({ ...ok, name: 'x'.repeat(121) }))).toBeNull();
    expect(parseDayForm(form({ ...ok, name: 'x'.repeat(120) }))).not.toBeNull();
  });
});

describe('planDays', () => {
  const wk = [1, 2, 3, 4, 5];
  const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']; // vie, sáb, dom, lun
  it('un feriado solo cuenta en días laborables', () => {
    const p = planDays(days, 'holiday', wk, new Set());
    expect(p).toEqual({ toAdd: ['2026-11-20', '2026-11-23'], noEffect: 2, existing: 0 });
  });
  it('un día trabajado solo cuenta en días no laborables', () => {
    expect(planDays(days, 'working', wk, new Set())).toEqual({ toAdd: ['2026-11-21', '2026-11-22'], noEffect: 2, existing: 0 });
  });
  it('no repite los ya registrados', () => expect(planDays(days, 'holiday', wk, new Set(['2026-11-20']))).toEqual({ toAdd: ['2026-11-23'], noEffect: 2, existing: 1 }));
  it('respeta una semana laboral distinta (sábado laborable)', () => expect(planDays(['2026-11-21'], 'holiday', [1, 2, 3, 4, 5, 6], new Set()).toAdd).toEqual(['2026-11-21']));
  it('sin semana definida usa lunes a viernes', () => expect(planDays(['2026-11-21'], 'holiday', [], new Set()).toAdd).toEqual([]));
});

describe('Pascua y feriados sugeridos', () => {
  it('Pascua de años conocidos', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
  it('2025: móviles de Semana Santa y fijos', () => {
    const m = new Map(suggestedHolidays(2025).map((s) => [s.name, s.day]));
    expect(m.get('Lunes de Carnaval')).toBe('2025-03-03');
    expect(m.get('Martes de Carnaval')).toBe('2025-03-04');
    expect(m.get('Viernes Santo')).toBe('2025-04-18');
    expect(m.get('Corpus Christi')).toBe('2025-06-19');
    expect(m.get('Día del Estado Plurinacional')).toBe('2025-01-22');
    expect(m.get('Año Nuevo Andino Amazónico')).toBe('2025-06-21');
    expect(m.get('Navidad')).toBe('2025-12-25');
  });
  it('2026 aplica el DS 5521: traslados y días adicionales', () => {
    const l = suggestedHolidays(2026);
    const m = new Map(l.map((s) => [s.name, s.day]));
    expect(m.get('Día del Estado Plurinacional')).toBe('2026-01-23');
    expect(m.get('Año Nuevo Andino Amazónico')).toBe('2026-06-22');
    expect(m.get('Corpus Christi')).toBe('2026-06-04');
    expect(m.get('Lunes de Carnaval')).toBe('2026-02-16');
    expect(m.get('Viernes Santo')).toBe('2026-04-03');
    expect(l.filter((s) => s.name.includes('DS 5521')).map((s) => s.day)).toEqual(['2026-06-05', '2026-08-07']);
    expect(l).toHaveLength(13);
  });
  it('sale ordenado, sin repetir y vacío fuera de rango', () => {
    for (const y of [2025, 2026, 2027]) {
      const l = suggestedHolidays(y);
      expect(l.map((s) => s.day)).toEqual([...l.map((s) => s.day)].sort());
      expect(new Set(l.map((s) => s.day)).size).toBe(l.length);
      expect(l.every((s) => parseIsoDay(s.day) !== null && s.day.startsWith(String(y)))).toBe(true);
    }
    expect(suggestedHolidays(1999)).toEqual([]);
    expect(suggestedHolidays(2026.5)).toEqual([]);
  });
});

describe('parseYear y parseSuggestedForm', () => {
  it('año válido o el de respaldo', () => {
    expect(parseYear('2027', 2026)).toBe(2027);
    expect(parseYear('abc', 2026)).toBe(2026);
    expect(parseYear('1999', 2026)).toBe(2026);
    expect(parseYear('2026.5', 2026)).toBe(2026);
    expect(parseYear(undefined, 2026)).toBe(2026);
  });
  const f = (o: Record<string, unknown>) => (k: string) => o[k];
  it('toma solo las filas marcadas', () => {
    expect(parseSuggestedForm(f({ on_0: 'on', day_0: '2026-01-01', name_0: 'Año Nuevo', day_1: '2026-05-01', name_1: 'Trabajo', on_2: 'on', day_2: '2026-12-25', name_2: ' Navidad ' })))
      .toEqual([{ day: '2026-01-01', name: 'Año Nuevo' }, { day: '2026-12-25', name: 'Navidad' }]);
  });
  it('rechaza nada marcado, fechas o nombres inválidos y fechas repetidas', () => {
    expect(parseSuggestedForm(f({}))).toBeNull();
    expect(parseSuggestedForm(f({ on_0: 'on', day_0: '2026-02-30', name_0: 'x' }))).toBeNull();
    expect(parseSuggestedForm(f({ on_0: 'on', day_0: '2026-01-01', name_0: '' }))).toBeNull();
    expect(parseSuggestedForm(f({ on_0: 'on', day_0: '2026-01-01', name_0: 'a', on_1: 'on', day_1: '2026-01-01', name_1: 'b' }))).toBeNull();
  });
  it('lee hasta 40 filas', () => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < 45; i++) { o[`on_${i}`] = 'on'; o[`day_${i}`] = addDays('2026-01-01', i); o[`name_${i}`] = 'f'; }
    expect(parseSuggestedForm(f(o))).toHaveLength(40);
  });
});
