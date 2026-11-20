import type { ConstraintType, DependencyType, IsoDate } from '@project-os/schedule-engine';

/** Lo que el servidor lee de la base de datos para calcular (una sola versión coherente). */
export interface ScheduleSnapshot {
  readonly projectId: string;
  /** `project_schedules.schedule_version` al momento de leer. */
  readonly version: number;
  readonly startDate: IsoDate | null;
  readonly workingWeekdays: readonly number[];
  readonly calendarDays: readonly { readonly day: IsoDate; readonly kind: 'holiday' | 'working' }[];
  readonly activities: readonly { readonly id: string; readonly duration: number }[];
  readonly constraints: readonly { readonly activityId: string; readonly type: ConstraintType; readonly date: IsoDate }[];
  readonly dependencies: readonly {
    readonly predecessorId: string;
    readonly successorId: string;
    readonly type: DependencyType;
    readonly lag: number;
  }[];
}

/** Fila que `apply_schedule` espera por actividad. */
export interface ApplyResultRow {
  readonly id: string;
  readonly early_start: IsoDate;
  readonly early_finish: IsoDate;
  readonly late_start: IsoDate;
  readonly late_finish: IsoDate;
  readonly total_float: number;
  readonly free_float: number;
  readonly critical: boolean;
  readonly violated: readonly ConstraintType[];
}

export interface ApplySummary {
  readonly project_start: IsoDate | null;
  readonly project_finish: IsoDate | null;
  readonly duration_days: number;
  readonly warnings: readonly unknown[];
}

export interface ApplyPayload {
  readonly projectId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly results: readonly ApplyResultRow[];
  readonly summary: ApplySummary;
}

/** Acceso a la base de datos. En producción lo implementa el cliente de Supabase (service_role). */
export interface ScheduleRepository {
  readSnapshot(projectId: string): Promise<ScheduleSnapshot>;
  /** Debe lanzar `ScheduleConflictError` si la versión cambió (SQLSTATE 40001). */
  applySchedule(payload: ApplyPayload): Promise<number>;
}

export class ScheduleConflictError extends Error {
  constructor(message = 'schedule_conflict') {
    super(message);
    this.name = 'ScheduleConflictError';
  }
}

export class StartDateRequiredError extends Error {
  constructor() {
    super('El proyecto no tiene fecha de inicio: defínela antes de calcular el cronograma');
    this.name = 'StartDateRequiredError';
  }
}

/** Error de la base de datos con su código estable (p. ej. `forbidden`, `project_read_only`). */
export class ScheduleDbError extends Error {
  constructor(
    readonly code: string,
    readonly sqlState?: string,
  ) {
    super(code);
    this.name = 'ScheduleDbError';
  }
}
