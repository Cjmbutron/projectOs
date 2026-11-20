import { describe, expect, it } from 'vitest';
import { ScheduleConflictError, ScheduleDbError, SupabaseScheduleRepository, parseSnapshot, type RpcClient } from '../src';

const snap = { projectId: 'p', version: 3, startDate: '2026-03-02', workingWeekdays: [1, 2, 3, 4, 5], calendarDays: [], activities: [], constraints: [], dependencies: [] };
const payload = { projectId: 'p', expectedVersion: 3, actorId: 'u', results: [], summary: { project_start: null, project_finish: null, duration_days: 0, warnings: [] } };

function fake(handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = { rpc: (fn, args) => { calls.push({ fn, args }); return Promise.resolve(handler(fn, args)); } };
  return { repo: new SupabaseScheduleRepository(client), calls };
}

describe('SupabaseScheduleRepository', () => {
  it('lee la instantánea con get_schedule_snapshot', async () => {
    const { repo, calls } = fake(() => ({ data: snap, error: null }));
    expect(await repo.readSnapshot('p')).toEqual(snap);
    expect(calls).toEqual([{ fn: 'get_schedule_snapshot', args: { p_project: 'p' } }]);
  });
  it('proyecto inexistente → project_not_found', async () => {
    const { repo } = fake(() => ({ data: null, error: null }));
    await expect(repo.readSnapshot('p')).rejects.toMatchObject({ code: 'project_not_found' });
  });
  it('error de la base → ScheduleDbError con el código', async () => {
    const { repo } = fake(() => ({ data: null, error: { code: '42501', message: 'forbidden' } }));
    await expect(repo.readSnapshot('p')).rejects.toMatchObject({ name: 'ScheduleDbError', code: 'forbidden', sqlState: '42501' });
  });
  it('apply_schedule recibe los nombres de parámetros de la función SQL', async () => {
    const { repo, calls } = fake(() => ({ data: 5, error: null }));
    expect(await repo.applySchedule(payload)).toBe(5);
    expect(calls[0]).toEqual({ fn: 'apply_schedule', args: { p_project: 'p', p_expected_version: 3, p_actor: 'u', p_results: [], p_summary: payload.summary } });
  });
  it('SQLSTATE 40001 → ScheduleConflictError', async () => {
    const { repo } = fake(() => ({ data: null, error: { code: '40001', message: 'schedule_conflict' } }));
    await expect(repo.applySchedule(payload)).rejects.toBeInstanceOf(ScheduleConflictError);
  });
  it('respuesta inesperada de apply_schedule', async () => {
    const { repo } = fake(() => ({ data: 'x', error: null }));
    await expect(repo.applySchedule(payload)).rejects.toBeInstanceOf(ScheduleDbError);
  });
});

describe('parseSnapshot', () => {
  it('rechaza formas inválidas', () => {
    for (const bad of [{}, { ...snap, version: '3' }, { ...snap, activities: null }, { ...snap, startDate: 5 }, 'x', 3]) {
      expect(() => parseSnapshot(bad)).toThrow(ScheduleDbError);
    }
  });
  it('acepta una instantánea válida con fecha de inicio nula', () => {
    expect(parseSnapshot({ ...snap, startDate: null }).startDate).toBeNull();
  });
});
