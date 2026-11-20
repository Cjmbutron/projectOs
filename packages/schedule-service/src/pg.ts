// Repositorio sobre `pg` para PRUEBAS DE INTEGRACIÓN y scripts. La aplicación usará Supabase.
import pg from 'pg';
import {
  ScheduleConflictError,
  ScheduleDbError,
  type ApplyPayload,
  type ScheduleRepository,
  type ScheduleSnapshot,
} from './types';

// Las fechas (DATE) se leen como texto 'AAAA-MM-DD': sin zonas horarias ni desplazamientos.
pg.types.setTypeParser(1082, (v: string) => v);

export class PgScheduleRepository implements ScheduleRepository {
  constructor(private readonly client: pg.Client) {}

  async readSnapshot(projectId: string): Promise<ScheduleSnapshot> {
    const q = <T extends pg.QueryResultRow>(sql: string) => this.client.query<T>(sql, [projectId]);
    // Una sola transacción de lectura repetible: versión y datos son coherentes entre sí.
    await this.client.query('begin isolation level repeatable read read only');
    try {
      const s = await q<{ schedule_version: number; start_date: string | null; working_weekdays: number[] }>(
        'select schedule_version, start_date, working_weekdays from public.project_schedules where project_id = $1');
      if (s.rowCount === 0) throw new ScheduleDbError('project_not_found');
      const days = await q<{ day: string; kind: 'holiday' | 'working' }>(
        'select day, kind from public.project_calendar_days where project_id = $1 order by day');
      const acts = await q<{ id: string; duration: number }>(
        'select id, duration from public.activities where project_id = $1 order by sort_order, created_at, id');
      const cons = await q<{ activity_id: string; type: never; date: string }>(
        'select activity_id, type, date from public.activity_constraints where project_id = $1 order by id');
      const deps = await q<{ predecessor_id: string; successor_id: string; type: never; lag: number }>(
        'select predecessor_id, successor_id, type, lag from public.activity_dependencies where project_id = $1 order by id');
      const row = s.rows[0]!;
      return {
        projectId,
        version: row.schedule_version,
        startDate: row.start_date,
        workingWeekdays: row.working_weekdays,
        calendarDays: days.rows,
        activities: acts.rows,
        constraints: cons.rows.map((c) => ({ activityId: c.activity_id, type: c.type, date: c.date })),
        dependencies: deps.rows.map((d) => ({
          predecessorId: d.predecessor_id, successorId: d.successor_id, type: d.type, lag: d.lag })),
      };
    } finally {
      await this.client.query('commit');
    }
  }

  async applySchedule(p: ApplyPayload): Promise<number> {
    await this.client.query('begin');
    try {
      await this.client.query('set local role service_role');
      const r = await this.client.query<{ n: number }>(
        'select public.apply_schedule($1, $2, $3, $4::jsonb, $5::jsonb) as n',
        [p.projectId, p.expectedVersion, p.actorId, JSON.stringify(p.results), JSON.stringify(p.summary)]);
      await this.client.query('commit');
      return r.rows[0]!.n;
    } catch (error) {
      await this.client.query('rollback');
      const e = error as { code?: string; message?: string };
      if (e.code === '40001') throw new ScheduleConflictError();
      throw new ScheduleDbError(e.message ?? 'db_error', e.code);
    }
  }
}
