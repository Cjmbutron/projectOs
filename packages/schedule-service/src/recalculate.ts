import { computeSchedule, type ScheduleResult, type ScheduleWarning } from '@project-os/schedule-engine';
import { toApplyPayload, toEngineInput } from './map';
import { ScheduleConflictError, type ScheduleRepository } from './types';

export interface RecalculateOptions {
  readonly projectId: string;
  /** Persona que provocó el recálculo (ya autenticada por el servidor; con su MFA verificado). */
  readonly actorId: string;
  /** Intentos ante conflictos de versión (por defecto 3). */
  readonly maxAttempts?: number;
}

export interface RecalculateOutcome {
  readonly version: number;
  readonly attempts: number;
  readonly activityCount: number;
  readonly projectStart: string | null;
  readonly projectFinish: string | null;
  readonly warnings: readonly ScheduleWarning[];
}

/**
 * Lee → calcula → guarda. Si alguien edita mientras se calcula, `apply_schedule` rechaza
 * con conflicto y se vuelve a empezar con los datos nuevos. Errores del motor (ciclos,
 * datos inválidos) y de permisos se propagan SIN llamar a `apply_schedule` con basura.
 */
export async function recalculateProject(
  repo: ScheduleRepository,
  options: RecalculateOptions,
): Promise<RecalculateOutcome> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts debe ser un entero ≥ 1');

  for (let attempt = 1; ; attempt++) {
    const snapshot = await repo.readSnapshot(options.projectId);
    const result: ScheduleResult | null =
      snapshot.activities.length === 0 && snapshot.startDate === null ? null : computeOrNull(snapshot);
    const payload = toApplyPayload(snapshot, result, options.actorId);
    try {
      const activityCount = await repo.applySchedule(payload);
      return {
        version: snapshot.version,
        attempts: attempt,
        activityCount,
        projectStart: payload.summary.project_start,
        projectFinish: payload.summary.project_finish,
        warnings: result?.warnings ?? [],
      };
    } catch (error) {
      if (error instanceof ScheduleConflictError && attempt < maxAttempts) continue;
      throw error;
    }
  }
}

function computeOrNull(snapshot: Parameters<typeof toEngineInput>[0]): ScheduleResult | null {
  const input = toEngineInput(snapshot); // exige fecha de inicio
  return input.activities.length === 0 ? null : computeSchedule(input);
}
