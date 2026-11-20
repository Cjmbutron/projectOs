import { describe, expect, it } from 'vitest';
import { computeSchedule } from '@project-os/schedule-engine';
import {
  recalculateProject, ScheduleConflictError, StartDateRequiredError, toApplyPayload, toEngineInput,
  type ApplyPayload, type ScheduleRepository, type ScheduleSnapshot,
} from '../src';

const base: ScheduleSnapshot = {
  projectId: 'p1', version: 7, startDate: '2026-03-02', workingWeekdays: [1, 2, 3, 4, 5],
  calendarDays: [],
  activities: [{ id: 'A', duration: 2 }, { id: 'B', duration: 3 }, { id: 'M', duration: 0 }],
  constraints: [], dependencies: [
    { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
    { predecessorId: 'B', successorId: 'M', type: 'FS', lag: 0 }],
};

class FakeRepo implements ScheduleRepository {
  applied: ApplyPayload[] = [];
  reads = 0;
  constructor(private snapshots: ScheduleSnapshot[], private conflicts = 0, private failWith?: Error) {}
  async readSnapshot() { return this.snapshots[Math.min(this.reads++, this.snapshots.length - 1)]!; }
  async applySchedule(p: ApplyPayload) {
    this.applied.push(p);
    if (this.failWith) throw this.failWith;
    if (this.conflicts-- > 0) throw new ScheduleConflictError();
    return p.results.length;
  }
}

describe('toEngineInput', () => {
  it('separa feriados y días trabajados excepcionales y agrupa restricciones por actividad', () => {
    const input = toEngineInput({
      ...base,
      calendarDays: [{ day: '2026-03-04', kind: 'holiday' }, { day: '2026-03-07', kind: 'working' }],
      constraints: [{ activityId: 'A', type: 'SNET', date: '2026-03-03' }, { activityId: 'A', type: 'FNLT', date: '2026-03-20' }],
    });
    expect(input.calendar.holidays).toEqual(['2026-03-04']);
    expect(input.calendar.workingExceptions).toEqual(['2026-03-07']);
    expect(input.activities.find((a) => a.id === 'A')!.constraints).toHaveLength(2);
    expect(input.activities.find((a) => a.id === 'B')!.constraints).toEqual([]);
  });
  it('exige fecha de inicio', () => {
    expect(() => toEngineInput({ ...base, startDate: null })).toThrow(StartDateRequiredError);
  });
});

describe('toApplyPayload', () => {
  it('traduce el resultado del motor a las filas de apply_schedule', () => {
    const result = computeSchedule(toEngineInput(base));
    const p = toApplyPayload(base, result, 'actor-1');
    expect(p).toMatchObject({ projectId: 'p1', expectedVersion: 7, actorId: 'actor-1' });
    expect(p.results).toHaveLength(3);
    const a = p.results.find((r) => r.id === 'A')!;
    expect(a).toEqual({
      id: 'A', early_start: '2026-03-02', early_finish: '2026-03-03', late_start: '2026-03-02',
      late_finish: '2026-03-03', total_float: 0, free_float: 0, critical: true, violated: [] });
    expect(p.summary).toMatchObject({ project_start: '2026-03-02', project_finish: result.projectFinish, duration_days: result.durationWorkingDays });
  });
});

describe('recalculateProject', () => {
  it('calcula y guarda con la versión leída', async () => {
    const repo = new FakeRepo([base]);
    const out = await recalculateProject(repo, { projectId: 'p1', actorId: 'u' });
    expect(out).toMatchObject({ version: 7, attempts: 1, activityCount: 3 });
    expect(repo.applied[0]!.expectedVersion).toBe(7);
  });
  it('ante un conflicto relee y reintenta con la versión nueva', async () => {
    const repo = new FakeRepo([base, { ...base, version: 8, activities: [...base.activities, { id: 'C', duration: 1 }] }], 1);
    const out = await recalculateProject(repo, { projectId: 'p1', actorId: 'u' });
    expect(out).toMatchObject({ version: 8, attempts: 2, activityCount: 4 });
    expect(repo.reads).toBe(2);
    expect(repo.applied.map((p) => p.expectedVersion)).toEqual([7, 8]);
  });
  it('agotados los intentos, propaga el conflicto', async () => {
    const repo = new FakeRepo([base], 99);
    await expect(recalculateProject(repo, { projectId: 'p1', actorId: 'u', maxAttempts: 2 })).rejects.toBeInstanceOf(ScheduleConflictError);
    expect(repo.applied).toHaveLength(2);
  });
  it('un ciclo en los datos NO llega a apply_schedule', async () => {
    const cyc = { ...base, dependencies: [...base.dependencies, { predecessorId: 'M', successorId: 'A', type: 'FS' as const, lag: 0 }] };
    const repo = new FakeRepo([cyc]);
    await expect(recalculateProject(repo, { projectId: 'p1', actorId: 'u' })).rejects.toThrow();
    expect(repo.applied).toHaveLength(0);
  });
  it('sin fecha de inicio y con actividades: error claro, nada guardado', async () => {
    const repo = new FakeRepo([{ ...base, startDate: null }]);
    await expect(recalculateProject(repo, { projectId: 'p1', actorId: 'u' })).rejects.toBeInstanceOf(StartDateRequiredError);
    expect(repo.applied).toHaveLength(0);
  });
  it('proyecto vacío: se guarda un resultado vacío (con o sin fecha de inicio)', async () => {
    for (const startDate of [null, '2026-03-02']) {
      const repo = new FakeRepo([{ ...base, startDate, activities: [], dependencies: [], constraints: [] }]);
      const out = await recalculateProject(repo, { projectId: 'p1', actorId: 'u' });
      expect(out.activityCount).toBe(0);
      expect(repo.applied[0]!.results).toEqual([]);
      expect(repo.applied[0]!.summary.project_finish).toBeNull();
    }
  });
  it('otros errores (permisos, solo lectura) se propagan sin reintentar', async () => {
    const repo = new FakeRepo([base], 0, new Error('forbidden'));
    await expect(recalculateProject(repo, { projectId: 'p1', actorId: 'u' })).rejects.toThrow('forbidden');
    expect(repo.applied).toHaveLength(1);
  });
  it('maxAttempts inválido', async () => {
    await expect(recalculateProject(new FakeRepo([base]), { projectId: 'p', actorId: 'u', maxAttempts: 0 })).rejects.toThrow(RangeError);
  });
});
