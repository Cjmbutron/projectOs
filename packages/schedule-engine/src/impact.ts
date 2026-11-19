import { createCalendar, type CalendarInput, type WorkCalendar } from './calendar';
import { toDayNumber, type IsoDate } from './dates';
import { ScheduleError } from './errors';
import {
  computeSchedule,
  type ActivityInput,
  type DateConstraint,
  type DependencyInput,
  type DependencyType,
  type ScheduleInput,
  type ScheduleResult,
} from './schedule';

/** Cambio propuesto sobre un cronograma. Se aplican en orden sobre una copia; la entrada no se modifica. */
export type ScheduleChange =
  | { readonly type: 'setProjectStart'; readonly date: IsoDate }
  | { readonly type: 'setCalendar'; readonly calendar: CalendarInput }
  | { readonly type: 'addActivity'; readonly activity: ActivityInput }
  | { readonly type: 'removeActivity'; readonly id: string }
  | {
      readonly type: 'updateActivity';
      readonly id: string;
      readonly patch: { readonly duration?: number; readonly constraints?: readonly DateConstraint[] };
    }
  | { readonly type: 'addDependency'; readonly dependency: DependencyInput }
  | { readonly type: 'removeDependency'; readonly predecessorId: string; readonly successorId: string }
  | {
      readonly type: 'updateDependency';
      readonly predecessorId: string;
      readonly successorId: string;
      readonly patch: { readonly type?: DependencyType; readonly lag?: number };
    };

export function applyChanges(input: ScheduleInput, changes: readonly ScheduleChange[]): ScheduleInput {
  let projectStart = input.projectStart;
  let calendar = input.calendar;
  let activities = [...input.activities];
  let dependencies = [...input.dependencies];

  const requireActivity = (id: string): number => {
    const index = activities.findIndex((a) => a.id === id);
    if (index < 0) throw new ScheduleError('UNKNOWN_ACTIVITY', `No existe la actividad "${id}"`);
    return index;
  };
  const requireDependency = (predecessorId: string, successorId: string): number => {
    const index = dependencies.findIndex(
      (d) => d.predecessorId === predecessorId && d.successorId === successorId,
    );
    if (index < 0) {
      throw new ScheduleError('INVALID_CHANGE', `No existe la dependencia "${predecessorId}" → "${successorId}"`);
    }
    return index;
  };

  for (const change of changes) {
    switch (change.type) {
      case 'setProjectStart':
        projectStart = change.date;
        break;
      case 'setCalendar':
        calendar = change.calendar;
        break;
      case 'addActivity':
        activities.push(change.activity);
        break;
      case 'removeActivity': {
        const index = requireActivity(change.id);
        activities.splice(index, 1);
        dependencies = dependencies.filter(
          (d) => d.predecessorId !== change.id && d.successorId !== change.id,
        );
        break;
      }
      case 'updateActivity': {
        const index = requireActivity(change.id);
        activities[index] = { ...activities[index]!, ...change.patch };
        break;
      }
      case 'addDependency':
        dependencies.push(change.dependency);
        break;
      case 'removeDependency':
        dependencies.splice(requireDependency(change.predecessorId, change.successorId), 1);
        break;
      case 'updateDependency': {
        const index = requireDependency(change.predecessorId, change.successorId);
        dependencies[index] = { ...dependencies[index]!, ...change.patch };
        break;
      }
      default: {
        const unknown: never = change;
        throw new ScheduleError('INVALID_CHANGE', `Cambio desconocido: ${JSON.stringify(unknown)}`);
      }
    }
  }
  return { projectStart, calendar, activities, dependencies };
}

export interface ActivityImpact {
  readonly id: string;
  readonly before: { readonly start: IsoDate; readonly finish: IsoDate };
  readonly after: { readonly start: IsoDate; readonly finish: IsoDate };
  /** Diferencia en días de calendario (positivo = se atrasa). */
  readonly startShiftCalendarDays: number;
  readonly finishShiftCalendarDays: number;
  /** Diferencia en días laborables, medida con el calendario "después". */
  readonly startShiftWorkingDays: number;
  readonly finishShiftWorkingDays: number;
}

export interface ScheduleImpact {
  readonly projectFinishBefore: IsoDate;
  readonly projectFinishAfter: IsoDate;
  readonly projectFinishShiftCalendarDays: number;
  readonly projectFinishShiftWorkingDays: number;
  /** Actividades que existen antes y después y cuyas fechas tempranas cambian. */
  readonly affected: readonly ActivityImpact[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly becameCritical: readonly string[];
  readonly noLongerCritical: readonly string[];
}

/** Compara dos cronogramas calculados (US-066). `calendar` es el vigente después del cambio. */
export function diffSchedules(
  before: ScheduleResult,
  after: ScheduleResult,
  calendar: CalendarInput | WorkCalendar,
): ScheduleImpact {
  const cal = createCalendar(calendar);
  const day = toDayNumber;
  const wd = (date: IsoDate) => cal.workingDaysBefore(day(date));
  const beforeById = new Map(before.activities.map((a) => [a.id, a]));
  const afterIds = new Set(after.activities.map((a) => a.id));

  const affected: ActivityImpact[] = [];
  const added: string[] = [];
  const becameCritical: string[] = [];
  const noLongerCritical: string[] = [];

  for (const now of after.activities) {
    const was = beforeById.get(now.id);
    if (!was) {
      added.push(now.id);
      continue;
    }
    if (now.critical && !was.critical) becameCritical.push(now.id);
    if (!now.critical && was.critical) noLongerCritical.push(now.id);
    if (now.earlyStart !== was.earlyStart || now.earlyFinish !== was.earlyFinish) {
      affected.push({
        id: now.id,
        before: { start: was.earlyStart, finish: was.earlyFinish },
        after: { start: now.earlyStart, finish: now.earlyFinish },
        startShiftCalendarDays: day(now.earlyStart) - day(was.earlyStart),
        finishShiftCalendarDays: day(now.earlyFinish) - day(was.earlyFinish),
        startShiftWorkingDays: wd(now.earlyStart) - wd(was.earlyStart),
        finishShiftWorkingDays: wd(now.earlyFinish) - wd(was.earlyFinish),
      });
    }
  }
  const removed = before.activities.filter((a) => !afterIds.has(a.id)).map((a) => a.id);
  affected.sort((a, b) => (a.after.start < b.after.start ? -1 : a.after.start > b.after.start ? 1 : a.id < b.id ? -1 : 1));

  return {
    projectFinishBefore: before.projectFinish,
    projectFinishAfter: after.projectFinish,
    projectFinishShiftCalendarDays: day(after.projectFinish) - day(before.projectFinish),
    projectFinishShiftWorkingDays: wd(after.projectFinish) - wd(before.projectFinish),
    affected,
    added,
    removed,
    becameCritical,
    noLongerCritical,
  };
}

export interface ImpactPreview {
  readonly before: ScheduleResult;
  readonly after: ScheduleResult;
  readonly impact: ScheduleImpact;
}

/**
 * Antes de confirmar un cambio: calcula el cronograma actual y el resultante y lista lo afectado.
 * Si el cambio crea un ciclo o es inválido, lanza el error correspondiente (no guarda nada).
 */
export function previewImpact(input: ScheduleInput, changes: readonly ScheduleChange[]): ImpactPreview {
  const before = computeSchedule(input);
  const changed = applyChanges(input, changes);
  const after = computeSchedule(changed);
  return { before, after, impact: diffSchedules(before, after, changed.calendar) };
}
