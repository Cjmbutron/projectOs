import { describe, expect, it } from 'vitest';
import {
  MON_FRI_CALENDAR,
  ScheduleError,
  compareToBaseline,
  computeSchedule,
  createBaseline,
  nextBaselineVersion,
  type ScheduleInput,
} from '../src';

const base: ScheduleInput = {
  projectStart: '2026-11-02',
  calendar: MON_FRI_CALENDAR,
  activities: [
    { id: 'A', duration: 3 },
    { id: 'B', duration: 2 },
    { id: 'C', duration: 1 },
  ],
  dependencies: [
    { predecessorId: 'A', successorId: 'B', type: 'FS' },
    { predecessorId: 'B', successorId: 'C', type: 'FS' },
  ],
};
const CAPTURED = '2026-11-10T14:30:00.000Z';

describe('línea base', () => {
  it('captura fechas, nombre y versión', () => {
    const schedule = computeSchedule(base);
    const baseline = createBaseline(schedule, { name: 'Aprobada', capturedAt: CAPTURED });
    expect(baseline.version).toBe(1);
    expect(baseline.name).toBe('Aprobada');
    expect(baseline.capturedAt).toBe(CAPTURED);
    expect(baseline.projectFinish).toBe('2026-11-09');
    expect(baseline.activities).toEqual([
      { id: 'A', start: '2026-11-02', finish: '2026-11-04', duration: 3 },
      { id: 'B', start: '2026-11-05', finish: '2026-11-06', duration: 2 },
      { id: 'C', start: '2026-11-09', finish: '2026-11-09', duration: 1 },
    ]);
  });

  it('las versiones son consecutivas', () => {
    const schedule = computeSchedule(base);
    const v1 = createBaseline(schedule, { name: 'v1', capturedAt: CAPTURED });
    const v2 = createBaseline(schedule, { name: 'v2', capturedAt: CAPTURED, existing: [v1] });
    const v3 = createBaseline(schedule, { name: 'v3', capturedAt: CAPTURED, existing: [v1, v2] });
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    expect(nextBaselineVersion([])).toBe(1);
    expect(nextBaselineVersion([v2, v1])).toBe(3);
  });

  it('es inmutable (congelada en profundidad)', () => {
    const baseline = createBaseline(computeSchedule(base), { name: 'v1', capturedAt: CAPTURED });
    const writable = baseline as unknown as {
      name: string;
      activities: { start: string }[];
    };
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.activities)).toBe(true);
    expect(Object.isFrozen(baseline.activities[0])).toBe(true);
    expect(() => {
      writable.name = 'otra';
    }).toThrow(TypeError);
    expect(() => {
      writable.activities[0]!.start = '2030-01-01';
    }).toThrow(TypeError);
    expect(() => {
      writable.activities.push({ start: 'x' });
    }).toThrow(TypeError);
  });

  it('un cambio posterior del cronograma no altera la línea base', () => {
    const baseline = createBaseline(computeSchedule(base), { name: 'v1', capturedAt: CAPTURED });
    const snapshot = JSON.stringify(baseline);
    computeSchedule({ ...base, activities: [{ id: 'A', duration: 10 }, ...base.activities.slice(1)] });
    expect(JSON.stringify(baseline)).toBe(snapshot);
  });

  it('valida nombre y fecha de captura', () => {
    const schedule = computeSchedule(base);
    expect(() => createBaseline(schedule, { name: '  ', capturedAt: CAPTURED })).toThrowError(ScheduleError);
    expect(() => createBaseline(schedule, { name: 'x', capturedAt: 'ayer' })).toThrow(/ISO 8601/);
  });
});

describe('comparación contra la línea base', () => {
  const baseline = createBaseline(computeSchedule(base), { name: 'v1', capturedAt: CAPTURED });

  it('sin cambios: todo igual y variación cero', () => {
    const comparison = compareToBaseline(baseline, computeSchedule(base), MON_FRI_CALENDAR);
    expect(comparison.baselineVersion).toBe(1);
    expect(comparison.projectFinishVariance).toBe(0);
    expect(comparison.activities.every((a) => a.status === 'unchanged')).toBe(true);
  });

  it('mide la variación en días laborables, no de calendario', () => {
    // A pasa de 3 a 5 días: B arranca el lunes 9 en vez del jueves 5 (+2 laborables, 4 de calendario).
    const current = computeSchedule({
      ...base,
      activities: [{ id: 'A', duration: 5 }, base.activities[1]!, base.activities[2]!],
    });
    const comparison = compareToBaseline(baseline, current, MON_FRI_CALENDAR);
    const row = (id: string) => comparison.activities.find((a) => a.id === id)!;

    expect(row('A')).toMatchObject({ status: 'changed', startVariance: 0, finishVariance: 2, durationVariance: 2 });
    expect(row('B')).toMatchObject({ status: 'changed', startVariance: 2, finishVariance: 2, durationVariance: 0 });
    expect(row('C')).toMatchObject({ startVariance: 2, finishVariance: 2 });
    expect(comparison.projectFinishVariance).toBe(2);
    expect(row('B').baseline).toEqual({ id: 'B', start: '2026-11-05', finish: '2026-11-06', duration: 2 });
    expect(row('B').current).toEqual({ start: '2026-11-09', finish: '2026-11-10', duration: 2 });
  });

  it('adelantos dan variación negativa', () => {
    const current = computeSchedule({
      ...base,
      activities: [{ id: 'A', duration: 1 }, base.activities[1]!, base.activities[2]!],
    });
    const comparison = compareToBaseline(baseline, current, MON_FRI_CALENDAR);
    expect(comparison.projectFinishVariance).toBe(-2);
    expect(comparison.activities.find((a) => a.id === 'A')).toMatchObject({ finishVariance: -2 });
  });

  it('detecta actividades agregadas y eliminadas', () => {
    const current = computeSchedule({
      ...base,
      activities: [base.activities[0]!, base.activities[1]!, { id: 'D', duration: 1 }],
      dependencies: [base.dependencies[0]!],
    });
    const comparison = compareToBaseline(baseline, current, MON_FRI_CALENDAR);
    const byId = new Map(comparison.activities.map((a) => [a.id, a]));
    expect(byId.get('D')).toMatchObject({ status: 'added', baseline: null, startVariance: null });
    expect(byId.get('C')).toMatchObject({ status: 'removed', current: null, finishVariance: null });
    expect(byId.get('A')?.status).toBe('unchanged');
  });
});
