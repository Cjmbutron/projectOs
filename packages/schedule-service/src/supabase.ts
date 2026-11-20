import {
  ScheduleConflictError,
  ScheduleDbError,
  type ApplyPayload,
  type ScheduleRepository,
  type ScheduleSnapshot,
} from './types';

/** Lo mínimo que se usa de `supabase.rpc(...)`: así el paquete no depende de supabase-js. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/** Valida la forma de la instantánea que devuelve `get_schedule_snapshot`. */
export function parseSnapshot(data: unknown): ScheduleSnapshot {
  if (data === null || typeof data !== 'object') throw new ScheduleDbError('project_not_found');
  const d = data as Record<string, unknown>;
  const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
  if (
    typeof d.projectId !== 'string' || typeof d.version !== 'number' || !isArr(d.workingWeekdays) ||
    !isArr(d.calendarDays) || !isArr(d.activities) || !isArr(d.constraints) || !isArr(d.dependencies) ||
    (d.startDate !== null && typeof d.startDate !== 'string')
  ) {
    throw new ScheduleDbError('invalid_snapshot');
  }
  return data as ScheduleSnapshot;
}

/** Repositorio sobre Supabase. Debe construirse con el cliente **service_role** (solo servidor). */
export class SupabaseScheduleRepository implements ScheduleRepository {
  constructor(private readonly client: RpcClient) {}

  async readSnapshot(projectId: string): Promise<ScheduleSnapshot> {
    const { data, error } = await this.client.rpc('get_schedule_snapshot', { p_project: projectId });
    if (error) throw new ScheduleDbError(error.message ?? 'db_error', error.code);
    return parseSnapshot(data);
  }

  async applySchedule(p: ApplyPayload): Promise<number> {
    const { data, error } = await this.client.rpc('apply_schedule', {
      p_project: p.projectId,
      p_expected_version: p.expectedVersion,
      p_actor: p.actorId,
      p_results: p.results,
      p_summary: p.summary,
    });
    if (error) {
      if (error.code === '40001') throw new ScheduleConflictError();
      throw new ScheduleDbError(error.message ?? 'db_error', error.code);
    }
    if (typeof data !== 'number') throw new ScheduleDbError('invalid_response');
    return data;
  }
}
