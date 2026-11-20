// Repositorio sobre `pg` para PRUEBAS DE INTEGRACIÓN y scripts. La aplicación usará Supabase.
import pg from 'pg';
import { parseSnapshot } from './supabase';
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
    // Misma función que usa Supabase: una sola instantánea coherente (solo service_role).
    await this.client.query('begin');
    try {
      await this.client.query('set local role service_role');
      const r = await this.client.query<{ s: unknown }>('select public.get_schedule_snapshot($1) as s', [projectId]);
      return parseSnapshot(r.rows[0]?.s ?? null);
    } finally {
      await this.client.query('rollback');
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
