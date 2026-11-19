import { createCalendar, type CalendarInput, type WorkCalendar } from './calendar';
import { toDayNumber, type IsoDate } from './dates';
import { ScheduleError } from './errors';
import type { ScheduleResult } from './schedule';

export interface BaselineActivity {
  readonly id: string;
  readonly start: IsoDate;
  readonly finish: IsoDate;
  readonly duration: number;
}

/** Instantánea inmutable del cronograma (US-024). Nunca se modifica: un cambio produce otra versión. */
export interface Baseline {
  readonly version: number;
  readonly name: string;
  /** Marca de tiempo de captura (ISO 8601). La aporta quien llama: el motor no lee el reloj. */
  readonly capturedAt: string;
  readonly projectStart: IsoDate;
  readonly projectFinish: IsoDate;
  readonly activities: readonly BaselineActivity[];
}

export interface CreateBaselineOptions {
  readonly name: string;
  readonly capturedAt: string;
  /** Líneas base ya existentes; la nueva toma la versión siguiente a la mayor. */
  readonly existing?: readonly Baseline[];
}

export function nextBaselineVersion(existing: readonly Baseline[] = []): number {
  return existing.reduce((max, b) => Math.max(max, b.version), 0) + 1;
}

/** Captura una línea base a partir del cronograma calculado. Devuelve un objeto congelado (profundo). */
export function createBaseline(schedule: ScheduleResult, options: CreateBaselineOptions): Baseline {
  if (typeof options.name !== 'string' || options.name.trim().length === 0) {
    throw new ScheduleError('INVALID_BASELINE', 'La línea base necesita un nombre');
  }
  if (typeof options.capturedAt !== 'string' || Number.isNaN(Date.parse(options.capturedAt))) {
    throw new ScheduleError('INVALID_BASELINE', 'capturedAt debe ser una fecha y hora ISO 8601 válida');
  }
  const baseline: Baseline = {
    version: nextBaselineVersion(options.existing),
    name: options.name.trim(),
    capturedAt: options.capturedAt,
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    activities: schedule.activities.map((a) =>
      Object.freeze({ id: a.id, start: a.earlyStart, finish: a.earlyFinish, duration: a.duration }),
    ),
  };
  Object.freeze(baseline.activities);
  return Object.freeze(baseline);
}

export type VarianceStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface ActivityVariance {
  readonly id: string;
  readonly status: VarianceStatus;
  /** Inicio actual − inicio de la línea base, en días laborables (positivo = más tarde). Null si no aplica. */
  readonly startVariance: number | null;
  readonly finishVariance: number | null;
  /** Duración actual − duración de la línea base. */
  readonly durationVariance: number | null;
  readonly baseline: BaselineActivity | null;
  readonly current: { readonly start: IsoDate; readonly finish: IsoDate; readonly duration: number } | null;
}

export interface BaselineComparison {
  readonly baselineVersion: number;
  /** Variación del fin del proyecto en días laborables (positivo = termina más tarde que lo planificado). */
  readonly projectFinishVariance: number;
  readonly activities: readonly ActivityVariance[];
}

/** Compara el cronograma actual con una línea base: planificado vs. actual por actividad. */
export function compareToBaseline(
  baseline: Baseline,
  current: ScheduleResult,
  calendar: CalendarInput | WorkCalendar,
): BaselineComparison {
  const cal = createCalendar(calendar);
  const wd = (date: IsoDate) => cal.workingDaysBefore(toDayNumber(date));
  const baselineById = new Map(baseline.activities.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const rows: ActivityVariance[] = [];

  for (const activity of current.activities) {
    seen.add(activity.id);
    const base = baselineById.get(activity.id);
    const now = { start: activity.earlyStart, finish: activity.earlyFinish, duration: activity.duration };
    if (!base) {
      rows.push({ id: activity.id, status: 'added', startVariance: null, finishVariance: null, durationVariance: null, baseline: null, current: now });
      continue;
    }
    const startVariance = wd(now.start) - wd(base.start);
    const finishVariance = wd(now.finish) - wd(base.finish);
    const durationVariance = now.duration - base.duration;
    const unchanged = startVariance === 0 && finishVariance === 0 && durationVariance === 0;
    rows.push({
      id: activity.id,
      status: unchanged ? 'unchanged' : 'changed',
      startVariance,
      finishVariance,
      durationVariance,
      baseline: base,
      current: now,
    });
  }
  for (const base of baseline.activities) {
    if (!seen.has(base.id)) {
      rows.push({ id: base.id, status: 'removed', startVariance: null, finishVariance: null, durationVariance: null, baseline: base, current: null });
    }
  }

  return {
    baselineVersion: baseline.version,
    projectFinishVariance: wd(current.projectFinish) - wd(baseline.projectFinish),
    activities: rows,
  };
}
