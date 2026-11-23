import { describe, expect, it } from 'vitest';
import { compareToBaseline, computeSchedule, createBaseline, MON_FRI_CALENDAR } from '@project-os/schedule-engine';
import { compareBaseline, formatVariance, type BaselineRow, type CurrentRow } from '@/lib/baseline/compare';

const cal = MON_FRI_CALENDAR;
const b = (id: string, start: string, finish: string, duration: number, name = id): BaselineRow => ({ activity_id: id, name, start_date: start, finish_date: finish, duration });
const c = (id: string, start: string | null, finish: string | null, duration: number, name = id): CurrentRow => ({ id, name, early_start: start, early_finish: finish, duration });

describe('compareBaseline', () => {
  const base = { project_finish: '2026-03-06', activities: [b('A', '2026-03-02', '2026-03-04', 3), b('B', '2026-03-05', '2026-03-06', 2)] };

  it('sin cambios', () => {
    const r = compareBaseline(base, { project_finish: '2026-03-06', activities: [c('A', '2026-03-02', '2026-03-04', 3), c('B', '2026-03-05', '2026-03-06', 2)] }, cal);
    expect(r.counts).toMatchObject({ unchanged: 2, changed: 0 });
    expect(r.projectFinishVariance).toBe(0);
  });
  it('la variación se mide en días LABORABLES (fin de semana de por medio)', () => {
    // B se atrasa 1 día laborable: de jue-vie pasa a vie-lun (cruza el fin de semana)
    const r = compareBaseline(base, { project_finish: '2026-03-09', activities: [c('A', '2026-03-02', '2026-03-04', 3), c('B', '2026-03-06', '2026-03-09', 2)] }, cal);
    const row = r.rows.find((x) => x.id === 'B')!;
    expect(row).toMatchObject({ status: 'changed', startVariance: 1, finishVariance: 1, durationVariance: 0 });
    expect(r.projectFinishVariance).toBe(1);   // 3 días corridos, 1 laborable
  });
  it('adelanto → variación negativa; cambio de duración', () => {
    const r = compareBaseline(base, { project_finish: '2026-03-05', activities: [c('A', '2026-03-02', '2026-03-03', 2), c('B', '2026-03-04', '2026-03-05', 2)] }, cal);
    expect(r.rows[0]).toMatchObject({ startVariance: 0, finishVariance: -1, durationVariance: -1 });
    expect(r.rows[1]).toMatchObject({ startVariance: -1, finishVariance: -1 });
    expect(r.projectFinishVariance).toBe(-1);
  });
  it('actividades nuevas, borradas y sin calcular', () => {
    const r = compareBaseline(base, { project_finish: null, activities: [c('A', '2026-03-02', '2026-03-04', 3), c('N', '2026-03-05', '2026-03-05', 1), c('U', null, null, 2)] }, cal);
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(by.N.status).toBe('added');
    expect(by.B.status).toBe('removed');
    expect(by.B.name).toBe('B');                // el nombre sale de la línea base
    expect(by.U.status).toBe('unscheduled');
    expect(r.counts).toEqual({ unchanged: 1, changed: 0, added: 1, removed: 1, unscheduled: 1 });
    expect(r.projectFinishVariance).toBeNull();
  });
  it('una actividad con solo una de las dos fechas calculadas cuenta como sin calcular', () => {
    const r = compareBaseline(base, { project_finish: '2026-03-06', activities: [c('A', '2026-03-02', null, 3), c('B', null, '2026-03-06', 2)] }, cal);
    expect(r.counts.unscheduled).toBe(2);
  });
  it('mismas fechas pero distinta duración: cambió', () => {
    const r = compareBaseline(base, { project_finish: '2026-03-06', activities: [c('A', '2026-03-02', '2026-03-04', 4), c('B', '2026-03-05', '2026-03-06', 2)] }, cal);
    expect(r.rows[0]).toMatchObject({ status: 'changed', startVariance: 0, finishVariance: 0, durationVariance: 1 });
  });
  it('respeta feriados del proyecto', () => {
    const withHoliday = { ...cal, holidays: ['2026-03-03'] };
    // Con el martes 3 feriado, correr A de lun 2 a mié 4 → jue 5 son 1 día laborable más
    const r = compareBaseline({ project_finish: '2026-03-04', activities: [b('A', '2026-03-02', '2026-03-04', 3)] },
      { project_finish: '2026-03-05', activities: [c('A', '2026-03-02', '2026-03-05', 3)] }, withHoliday);
    expect(r.rows[0].finishVariance).toBe(1);
  });
  it('un actividad con fechas pero sin línea base y sin duración igual → added, sin variaciones', () => {
    const r = compareBaseline({ project_finish: '2026-03-06', activities: [] }, { project_finish: '2026-03-06', activities: [c('X', '2026-03-02', '2026-03-02', 1)] }, cal);
    expect(r.rows[0]).toMatchObject({ status: 'added', startVariance: null, baseline: null });
  });

  it('coincide con compareToBaseline del motor sobre un cronograma real', () => {
    const input = (extra: number) => ({
      projectStart: '2026-03-02', calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-03-10'] },
      activities: [{ id: 'A', duration: 3 }, { id: 'B', duration: 4 + extra }, { id: 'C', duration: 2 }, { id: 'M', duration: 0 }],
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'FS' as const }, { predecessorId: 'B', successorId: 'C', type: 'FS' as const, lag: 1 }, { predecessorId: 'C', successorId: 'M', type: 'FS' as const }],
    });
    const planned = computeSchedule(input(0));
    const now = computeSchedule(input(3));
    const engine = compareToBaseline(createBaseline(planned, { name: 'LB', capturedAt: '2026-03-01T00:00:00Z' }), now, input(0).calendar);
    const mine = compareBaseline(
      { project_finish: planned.projectFinish, activities: planned.activities.map((a) => b(a.id, a.earlyStart, a.earlyFinish, a.duration)) },
      { project_finish: now.projectFinish, activities: now.activities.map((a) => c(a.id, a.earlyStart, a.earlyFinish, a.duration)) },
      input(0).calendar,
    );
    expect(mine.projectFinishVariance).toBe(engine.projectFinishVariance);
    for (const e of engine.activities) {
      const m = mine.rows.find((x) => x.id === e.id)!;
      expect([m.status, m.startVariance, m.finishVariance, m.durationVariance]).toEqual([e.status, e.startVariance, e.finishVariance, e.durationVariance]);
    }
    expect(engine.projectFinishVariance).toBeGreaterThan(0);
  });
});

describe('formatVariance', () => {
  it('formatos', () => {
    expect(formatVariance(null)).toBe('—');
    expect(formatVariance(0)).toBe('0 d');
    expect(formatVariance(3)).toBe('+3 d');
    expect(formatVariance(-2)).toBe('−2 d');
  });
});
