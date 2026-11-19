export type ScheduleErrorCode =
  | 'INVALID_DATE'
  | 'OUT_OF_RANGE'
  | 'INVALID_CALENDAR'
  | 'INVALID_ACTIVITY'
  | 'DUPLICATE_ACTIVITY'
  | 'INVALID_DURATION'
  | 'INVALID_LAG'
  | 'UNKNOWN_ACTIVITY'
  | 'INVALID_DEPENDENCY_TYPE'
  | 'DUPLICATE_DEPENDENCY'
  | 'CYCLE'
  | 'INVALID_CONSTRAINT'
  | 'INVALID_BASELINE'
  | 'INVALID_CHANGE';

/** Error de validación o de cálculo del motor. `code` es estable y apto para la interfaz. */
export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;

  constructor(code: ScheduleErrorCode, message: string) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
  }
}

/** Dependencias circulares. `cycle` lista los ids en orden de dependencia y repite el primero al final. */
export class CycleError extends ScheduleError {
  readonly cycle: readonly string[];

  constructor(cycle: readonly string[]) {
    super('CYCLE', `Dependencia circular: ${cycle.join(' → ')}`);
    this.name = 'CycleError';
    this.cycle = cycle;
  }
}
