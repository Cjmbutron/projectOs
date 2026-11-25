import { describe, expect, it } from 'vitest';
import { countWorking, deviation, makeCalendar, plannedPercent, weightedAverage } from '@/lib/planned';

const cal = makeCalendar([1, 2, 3, 4, 5], []);

describe('calendario y conteo', () => {
  it('lunes a viernes', () => {
    expect(countWorking('2026-11-23', '2026-11-29', cal)).toBe(5);
    expect(countWorking('2026-11-23', '2026-11-23', cal)).toBe(1);
    expect(countWorking('2026-11-28', '2026-11-29', cal)).toBe(0);
    expect(countWorking('2026-11-24', '2026-11-23', cal)).toBe(0);
  });
  it('un feriado resta y un día trabajado excepcional suma', () => {
    const c = makeCalendar([1, 2, 3, 4, 5], [{ day: '2026-11-25', kind: 'holiday' }, { day: '2026-11-28', kind: 'working' }]);
    expect(countWorking('2026-11-23', '2026-11-29', c)).toBe(5);
    expect(c('2026-11-25')).toBe(false);
    expect(c('2026-11-28')).toBe(true);
  });
  it('sin semana definida usa lunes a viernes', () => expect(makeCalendar([], [])('2026-11-23')).toBe(true));
});

describe('plannedPercent', () => {
  const a = { start: '2026-11-23', finish: '2026-11-27', duration: 5 }; // lun–vie
  it('antes del inicio 0, después del fin 100', () => {
    expect(plannedPercent(a, '2026-11-22', cal)).toBe(0);
    expect(plannedPercent(a, '2026-11-28', cal)).toBe(100);
    expect(plannedPercent(a, '2026-11-27', cal)).toBe(100);
  });
  it('reparte por días laborables transcurridos (incluido hoy)', () => {
    expect(plannedPercent(a, '2026-11-23', cal)).toBe(20);
    expect(plannedPercent(a, '2026-11-24', cal)).toBe(40);
    expect(plannedPercent(a, '2026-11-25', cal)).toBe(60);
    expect(plannedPercent(a, '2026-11-26', cal)).toBe(80);
  });
  it('un fin de semana en medio no suma días', () => {
    const b = { start: '2026-11-26', finish: '2026-12-01', duration: 4 }; // jue, vie, lun, mar
    expect(plannedPercent(b, '2026-11-28', cal)).toBe(50);
    expect(plannedPercent(b, '2026-11-30', cal)).toBe(75);
  });
  it('un feriado en medio tampoco', () => {
    const c = makeCalendar([1, 2, 3, 4, 5], [{ day: '2026-11-24', kind: 'holiday' }]);
    expect(plannedPercent(a, '2026-11-24', c)).toBe(25); // 1 de 4 laborables
  });
  it('hito: 0 antes de su fecha, 100 desde ella', () => {
    const h = { start: '2026-11-25', finish: '2026-11-25', duration: 0 };
    expect(plannedPercent(h, '2026-11-24', cal)).toBe(0);
    expect(plannedPercent(h, '2026-11-25', cal)).toBe(100);
  });
  it('sin fechas: null', () => {
    expect(plannedPercent({ start: null, finish: '2026-11-27', duration: 3 }, '2026-11-25', cal)).toBeNull();
    expect(plannedPercent({ start: '2026-11-23', finish: null, duration: 3 }, '2026-11-25', cal)).toBeNull();
  });
  it('rango sin días laborables: 0 hasta el fin', () => expect(plannedPercent({ start: '2026-11-28', finish: '2026-11-29', duration: 1 }, '2026-11-28', cal)).toBe(0));
});

describe('weightedAverage', () => {
  it('pondera por duración y redondea', () => expect(weightedAverage([{ value: 100, weight: 1 }, { value: 0, weight: 2 }])).toBe(33));
  it('ignora hitos (peso 0) y valores nulos', () => expect(weightedAverage([{ value: 100, weight: 0 }, { value: null, weight: 5 }, { value: 50, weight: 4 }])).toBe(50));
  it('sin peso: null', () => {
    expect(weightedAverage([])).toBeNull();
    expect(weightedAverage([{ value: 100, weight: 0 }])).toBeNull();
  });
});

describe('deviation', () => {
  it('al día y adelantado', () => {
    expect(deviation(50, 50)).toEqual({ points: 0, label: 'Al día', cls: 'badge-ok' });
    expect(deviation(50, 58)).toEqual({ points: 8, label: 'Adelantado 8 pts', cls: 'badge-ok' });
  });
  it('atrasado: ámbar hasta 9 pts, rojo desde 10', () => {
    expect(deviation(50, 41)).toEqual({ points: -9, label: 'Atrasado 9 pts', cls: 'badge-warn' });
    expect(deviation(50, 40)).toEqual({ points: -10, label: 'Atrasado 10 pts', cls: 'badge-danger' });
  });
  it('sin datos', () => {
    expect(deviation(null, 10).cls).toBe('badge-neutral');
    expect(deviation(10, null).label).toBe('Sin datos');
  });
});
