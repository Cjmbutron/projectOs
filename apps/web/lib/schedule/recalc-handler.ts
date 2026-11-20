import { ScheduleError } from '@project-os/schedule-engine';
import {
  ScheduleConflictError,
  ScheduleDbError,
  StartDateRequiredError,
  type RecalculateOutcome,
} from '@project-os/schedule-service';
import { UUID_RE, type HandlerResult } from '@/lib/http';

export interface RecalcDeps {
  /** Id de la persona autenticada (claim `sub` del JWT ya validado) o null. */
  getUserId(): Promise<string | null>;
  /** `can_edit_schedule` evaluada CON LA SESIÓN de la persona (membresía, MFA, permiso, proyecto abierto). */
  canEdit(projectId: string): Promise<boolean>;
  /** recalculateProject con el repositorio service_role. */
  recalculate(projectId: string, actorId: string): Promise<RecalculateOutcome>;
}

/** POST /api/projects/:id/recalculate */
export async function handleRecalculate(deps: RecalcDeps, projectId: string): Promise<HandlerResult> {
  if (!UUID_RE.test(projectId)) return { status: 400, body: { error: 'invalid_request' } };

  const userId = await deps.getUserId();
  if (!userId) return { status: 401, body: { error: 'not_authenticated' } };

  // La autorización la decide la base de datos con la sesión de la persona. Si no puede
  // (o el proyecto no existe / no lo ve) la respuesta es la misma: no se revela existencia.
  if (!(await deps.canEdit(projectId))) return { status: 403, body: { error: 'forbidden' } };

  try {
    const out = await deps.recalculate(projectId, userId);
    return {
      status: 200,
      body: {
        version: out.version,
        attempts: out.attempts,
        activityCount: out.activityCount,
        projectStart: out.projectStart,
        projectFinish: out.projectFinish,
        warnings: out.warnings,
      },
    };
  } catch (error) {
    if (error instanceof StartDateRequiredError) return { status: 422, body: { error: 'start_date_required' } };
    if (error instanceof ScheduleConflictError) return { status: 409, body: { error: 'schedule_conflict' } };
    if (error instanceof ScheduleError) return { status: 422, body: { error: error.code, message: error.message } };
    if (error instanceof ScheduleDbError) {
      if (error.code === 'forbidden') return { status: 403, body: { error: 'forbidden' } };
      if (error.code === 'project_read_only') return { status: 409, body: { error: 'project_read_only' } };
      if (error.code === 'project_not_found') return { status: 404, body: { error: 'project_not_found' } };
    }
    return { status: 500, body: { error: 'internal_error' } };
  }
}
