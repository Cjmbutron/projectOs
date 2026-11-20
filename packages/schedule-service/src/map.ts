import type { ScheduleInput, ScheduleResult } from '@project-os/schedule-engine';
import { StartDateRequiredError, type ApplyPayload, type ScheduleSnapshot } from './types';

/** Filas de la base de datos → entrada del motor. */
export function toEngineInput(snapshot: ScheduleSnapshot): ScheduleInput {
  if (!snapshot.startDate) throw new StartDateRequiredError();

  const constraintsByActivity = new Map<string, { type: (typeof snapshot.constraints)[number]['type']; date: string }[]>();
  for (const c of snapshot.constraints) {
    const list = constraintsByActivity.get(c.activityId) ?? [];
    list.push({ type: c.type, date: c.date });
    constraintsByActivity.set(c.activityId, list);
  }

  return {
    projectStart: snapshot.startDate,
    calendar: {
      workingWeekdays: [...snapshot.workingWeekdays],
      holidays: snapshot.calendarDays.filter((d) => d.kind === 'holiday').map((d) => d.day),
      workingExceptions: snapshot.calendarDays.filter((d) => d.kind === 'working').map((d) => d.day),
    },
    activities: snapshot.activities.map((a) => ({
      id: a.id,
      duration: a.duration,
      constraints: constraintsByActivity.get(a.id) ?? [],
    })),
    dependencies: snapshot.dependencies.map((d) => ({
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lag: d.lag,
    })),
  };
}

/** Resultado del motor → argumentos de `apply_schedule`. */
export function toApplyPayload(
  snapshot: ScheduleSnapshot,
  result: ScheduleResult | null,
  actorId: string,
): ApplyPayload {
  return {
    projectId: snapshot.projectId,
    expectedVersion: snapshot.version,
    actorId,
    results: (result?.activities ?? []).map((a) => ({
      id: a.id,
      early_start: a.earlyStart,
      early_finish: a.earlyFinish,
      late_start: a.lateStart,
      late_finish: a.lateFinish,
      total_float: a.totalFloat,
      free_float: a.freeFloat,
      critical: a.critical,
      violated: [...a.violatedConstraints],
    })),
    summary: {
      project_start: result?.projectStart ?? null,
      project_finish: result?.projectFinish ?? null,
      duration_days: result?.durationWorkingDays ?? 0,
      warnings: result?.warnings ?? [],
    },
  };
}
