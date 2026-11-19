import { describe, expect, it } from 'vitest';
import {
  EVERY_DAY_CALENDAR,
  MON_FRI_CALENDAR,
  computeSchedule,
  formatDay,
  toDayNumber,
  weekdayOf,
  type ActivityInput,
  type CalendarInput,
  type ConstraintType,
  type DependencyInput,
  type DependencyType,
  type ScheduleInput,
  type ScheduleResult,
} from '../src';
import { randInt, rng } from './helpers';

/**
 * Oráculo independiente: resuelve las mismas restricciones por relajación iterativa
 * (estilo Bellman-Ford), sin orden topológico, sobre el eje de días laborables.
 */
interface OracleBounds {
  lowerES: number[]; // cota inferior del inicio por actividad (≥ 0)
  capLF: number[]; // tope del fin por actividad (Infinity si no hay)
}

function oracle(
  durations: number[],
  deps: { p: number; s: number; type: DependencyType; lag: number }[],
  bounds: OracleBounds,
) {
  const n = durations.length;
  const es = bounds.lowerES.map((v) => Math.max(0, v));
  for (let changed = true; changed; ) {
    changed = false;
    for (const { p, s, type, lag } of deps) {
      const efP = es[p]! + durations[p]!;
      const bound =
        type === 'FS' ? efP + lag
        : type === 'SS' ? es[p]! + lag
        : type === 'FF' ? efP + lag - durations[s]!
        : es[p]! + lag - durations[s]!;
      if (bound > es[s]!) {
        es[s] = bound;
        changed = true;
      }
    }
  }
  const ef = es.map((v, i) => v + durations[i]!);
  const end = Math.max(0, ...ef);
  const lf = bounds.capLF.map((cap) => Math.min(end, cap));
  for (let changed = true; changed; ) {
    changed = false;
    for (const { p, s, type, lag } of deps) {
      const lsS = lf[s]! - durations[s]!;
      const bound =
        type === 'FS' ? lsS - lag
        : type === 'SS' ? lsS - lag + durations[p]!
        : type === 'FF' ? lf[s]! - lag
        : lf[s]! - lag + durations[p]!;
      if (bound < lf[p]!) {
        lf[p] = bound;
        changed = true;
      }
    }
  }
  const ls = lf.map((v, i) => v - durations[i]!);
  return { es, ef, ls, lf, end, n };
}

const TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const CONSTRAINTS: ConstraintType[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];

interface Network {
  activities: ActivityInput[];
  dependencies: DependencyInput[];
}

/** Red aleatoria acíclica: las aristas solo van de un índice menor a uno mayor; luego se baraja el orden. */
function randomNetwork(random: () => number, withConstraints: boolean, startIso: string): Network {
  const n = randInt(random, 1, 14);
  const activities: ActivityInput[] = [];
  for (let i = 0; i < n; i++) {
    const constraints: { type: ConstraintType; date: string }[] = [];
    if (withConstraints && random() < 0.3) {
      const used = new Set<ConstraintType>();
      for (let k = randInt(random, 1, 2); k > 0; k--) {
        const type = CONSTRAINTS[randInt(random, 0, 5)]!;
        if (used.has(type)) continue;
        used.add(type);
        constraints.push({ type, date: formatDay(toDayNumber(startIso) + randInt(random, -2, 18)) });
      }
    }
    activities.push({ id: `T${i}`, duration: random() < 0.2 ? 0 : randInt(random, 1, 6), constraints });
  }
  const dependencies: DependencyInput[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (random() < 0.25) {
        dependencies.push({
          predecessorId: `T${i}`,
          successorId: `T${j}`,
          type: TYPES[randInt(random, 0, 3)]!,
          lag: randInt(random, -2, 4),
        });
      }
    }
  }
  const shuffle = <T,>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = randInt(random, 0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  return { activities: shuffle(activities), dependencies: shuffle(dependencies) };
}

function schedule(network: Network, calendar: CalendarInput, start: string): ScheduleResult {
  const input: ScheduleInput = { projectStart: start, calendar, ...network };
  return computeSchedule(input);
}

describe('contra un oráculo independiente (calendario de 7 días, con restricciones)', () => {
  it('600 redes aleatorias: ES/EF/LS/LF coinciden', () => {
    const random = rng(7);
    const start = '2026-11-02';
    const s0 = toDayNumber(start);

    for (let trial = 0; trial < 600; trial++) {
      const network = randomNetwork(random, true, start);
      const result = schedule(network, EVERY_DAY_CALENDAR, start);

      const index = new Map(network.activities.map((a, i) => [a.id, i]));
      const durations = network.activities.map((a) => a.duration);
      const lowerES = network.activities.map(() => Number.NEGATIVE_INFINITY);
      const capLF = network.activities.map(() => Number.POSITIVE_INFINITY);

      // Con los 7 días laborables, el eje es simplemente "días desde el inicio".
      network.activities.forEach((a, i) => {
        const d = a.duration;
        for (const c of a.constraints ?? []) {
          const x = toDayNumber(c.date) - s0;
          if (d === 0) {
            if (c.type === 'SNET' || c.type === 'FNET' || c.type === 'MSO' || c.type === 'MFO') lowerES[i] = Math.max(lowerES[i]!, x + 1);
            if (c.type === 'SNLT' || c.type === 'FNLT' || c.type === 'MSO' || c.type === 'MFO') capLF[i] = Math.min(capLF[i]!, x + 1);
          } else {
            if (c.type === 'SNET' || c.type === 'MSO') lowerES[i] = Math.max(lowerES[i]!, x);
            if (c.type === 'FNET' || c.type === 'MFO') lowerES[i] = Math.max(lowerES[i]!, x + 1 - d);
            if (c.type === 'SNLT' || c.type === 'MSO') capLF[i] = Math.min(capLF[i]!, x + d);
            if (c.type === 'FNLT' || c.type === 'MFO') capLF[i] = Math.min(capLF[i]!, x + 1);
          }
        }
      });
      const deps = network.dependencies.map((d) => ({
        p: index.get(d.predecessorId)!,
        s: index.get(d.successorId)!,
        type: d.type,
        lag: d.lag ?? 0,
      }));
      const expected = oracle(durations, deps, { lowerES, capLF });

      network.activities.forEach((a, i) => {
        const got = result.activities.find((r) => r.id === a.id)!;
        const where = `intento ${trial}, actividad ${a.id}`;
        expect(got.axis, where).toEqual({ es: expected.es[i], ef: expected.ef[i], ls: expected.ls[i], lf: expected.lf[i] });
        expect(got.totalFloat, where).toBe(expected.lf[i]! - expected.ef[i]!);
        expect(got.critical, where).toBe(expected.lf[i]! - expected.ef[i]! <= 0);
        // Fechas: en un calendario de 7 días, la posición es la fecha.
        const dateOf = (k: number) => formatDay(s0 + k);
        if (a.duration === 0) {
          const k = (b: number) => (b >= 1 ? b - 1 : b);
          expect(got.earlyStart, where).toBe(dateOf(k(expected.es[i]!)));
          expect(got.earlyFinish, where).toBe(dateOf(k(expected.ef[i]!)));
        } else {
          expect(got.earlyStart, where).toBe(dateOf(expected.es[i]!));
          expect(got.earlyFinish, where).toBe(dateOf(expected.ef[i]! - 1));
          expect(got.lateFinish, where).toBe(dateOf(expected.lf[i]! - 1));
        }
        // Violación de restricciones ⇔ el fin temprano supera el tope.
        const violated = expected.ef[i]! > capLF[i]!;
        expect(got.violatedConstraints.length > 0, where).toBe(violated);
      });
      expect(result.durationWorkingDays).toBe(expected.end);
    }
  });
});

describe('contra un oráculo independiente (lunes a viernes con feriados, sin restricciones)', () => {
  it('600 redes aleatorias: ejes, fechas y propiedades', () => {
    const random = rng(99);
    const start = '2026-11-04'; // miércoles
    const calendar: CalendarInput = {
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: ['2026-11-09', '2026-11-17', '2026-11-26'],
      workingExceptions: ['2026-11-14'],
    };
    // Recorrido ingenuo: la lista de días laborables desde el inicio.
    const naiveWorkingDays: string[] = [];
    for (let day = toDayNumber(start); naiveWorkingDays.length < 400; day++) {
      const iso = formatDay(day);
      const base = [1, 2, 3, 4, 5].includes(weekdayOf(day));
      const working = calendar.holidays!.includes(iso) ? false : calendar.workingExceptions!.includes(iso) ? true : base;
      if (working) naiveWorkingDays.push(iso);
    }
    const dateOfAxis = (k: number) => naiveWorkingDays[k < 0 ? 0 : k]!;

    for (let trial = 0; trial < 600; trial++) {
      const network = randomNetwork(random, false, start);
      const result = schedule(network, calendar, start);

      const index = new Map(network.activities.map((a, i) => [a.id, i]));
      const durations = network.activities.map((a) => a.duration);
      const deps = network.dependencies.map((d) => ({
        p: index.get(d.predecessorId)!,
        s: index.get(d.successorId)!,
        type: d.type,
        lag: d.lag ?? 0,
      }));
      const expected = oracle(durations, deps, {
        lowerES: durations.map(() => 0),
        capLF: durations.map(() => Number.POSITIVE_INFINITY),
      });

      let hasCritical = false;
      network.activities.forEach((a, i) => {
        const got = result.activities.find((r) => r.id === a.id)!;
        const where = `intento ${trial}, actividad ${a.id}`;
        expect(got.axis, where).toEqual({ es: expected.es[i], ef: expected.ef[i], ls: expected.ls[i], lf: expected.lf[i] });
        if (a.duration === 0) {
          const k = (b: number) => (b >= 1 ? b - 1 : b);
          expect(got.earlyStart, where).toBe(dateOfAxis(k(expected.es[i]!)));
          expect(got.earlyFinish, where).toBe(dateOfAxis(k(expected.ef[i]!)));
        } else {
          expect(got.earlyStart, where).toBe(dateOfAxis(expected.es[i]!));
          expect(got.earlyFinish, where).toBe(dateOfAxis(expected.ef[i]! - 1));
        }
        // Propiedades sin restricciones: holguras no negativas y libre ≤ total.
        expect(got.totalFloat, where).toBeGreaterThanOrEqual(0);
        expect(got.freeFloat, where).toBeGreaterThanOrEqual(0);
        expect(got.freeFloat, where).toBeLessThanOrEqual(got.totalFloat);
        expect(got.violatedConstraints, where).toEqual([]);
        if (got.critical) hasCritical = true;
      });
      expect(result.warnings).toEqual([]);
      expect(hasCritical).toBe(true);
      expect(result.durationWorkingDays).toBe(expected.end);
    }
  });

  it('el resultado no depende del orden de las actividades ni de las dependencias en la entrada', () => {
    const random = rng(2026);
    const start = '2026-11-02';
    for (let trial = 0; trial < 200; trial++) {
      const network = randomNetwork(random, true, start);
      const reordered: Network = {
        activities: [...network.activities].reverse(),
        dependencies: [...network.dependencies].reverse(),
      };
      const a = schedule(network, MON_FRI_CALENDAR, start);
      const b = schedule(reordered, MON_FRI_CALENDAR, start);
      const byId = (r: ScheduleResult) => new Map(r.activities.map((x) => [x.id, x]));
      const bMap = byId(b);
      for (const [id, row] of byId(a)) expect(bMap.get(id), `intento ${trial}, ${id}`).toEqual(row);
      expect(a.projectFinish).toBe(b.projectFinish);
    }
  });
});

describe('contra un oráculo independiente (lunes a viernes con feriados, CON restricciones)', () => {
  it('600 redes aleatorias con fechas de restricción en días laborables y no laborables', () => {
    const random = rng(31337);
    const start = '2026-11-04'; // miércoles
    const calendar: CalendarInput = {
      workingWeekdays: [1, 2, 3, 4, 5],
      holidays: ['2026-11-09', '2026-11-17', '2026-11-26'],
      workingExceptions: ['2026-11-14'],
    };

    // Todo se resuelve recorriendo días, con el significado de cada restricción (sin fórmulas de conteo).
    const isWorking = (day: number) => {
      const iso = formatDay(day);
      if (calendar.holidays!.includes(iso)) return false;
      if (calendar.workingExceptions!.includes(iso)) return true;
      return [1, 2, 3, 4, 5].includes(weekdayOf(day));
    };
    let start0 = toDayNumber(start);
    while (!isWorking(start0)) start0++;
    /** Posición en el eje de un día laborable (0 = primer día del proyecto; negativa antes del inicio). */
    const axisOf = (workingDay: number) => {
      let count = 0;
      if (workingDay >= start0) {
        for (let d = start0; d < workingDay; d++) if (isWorking(d)) count++;
        return count;
      }
      for (let d = workingDay; d < start0; d++) if (isWorking(d)) count++;
      return -count;
    };
    const firstWorkingOnOrAfter = (day: number) => {
      while (!isWorking(day)) day++;
      return day;
    };
    const lastWorkingOnOrBefore = (day: number) => {
      while (!isWorking(day)) day--;
      return day;
    };

    let violations = 0;
    let weekendConstraints = 0;
    for (let trial = 0; trial < 600; trial++) {
      const network = randomNetwork(random, true, start);
      const result = schedule(network, calendar, start);

      const index = new Map(network.activities.map((a, i) => [a.id, i]));
      const durations = network.activities.map((a) => a.duration);
      const lowerES = durations.map(() => Number.NEGATIVE_INFINITY);
      const capLF = durations.map(() => Number.POSITIVE_INFINITY);
      network.activities.forEach((a, i) => {
        const d = a.duration;
        for (const c of a.constraints ?? []) {
          const day = toDayNumber(c.date);
          if (!isWorking(day)) weekendConstraints++;
          const firstIdx = axisOf(firstWorkingOnOrAfter(day)); // primer laborable en o después de la fecha
          const lastIdx = axisOf(lastWorkingOnOrBefore(day)); // último laborable en o antes de la fecha
          if (d === 0) {
            // Hito: toda restricción se lee como fin de día.
            if (c.type === 'SNET' || c.type === 'FNET' || c.type === 'MSO' || c.type === 'MFO') lowerES[i] = Math.max(lowerES[i]!, firstIdx + 1);
            if (c.type === 'SNLT' || c.type === 'FNLT' || c.type === 'MSO' || c.type === 'MFO') capLF[i] = Math.min(capLF[i]!, lastIdx + 1);
          } else {
            if (c.type === 'SNET' || c.type === 'MSO') lowerES[i] = Math.max(lowerES[i]!, firstIdx);
            if (c.type === 'FNET' || c.type === 'MFO') lowerES[i] = Math.max(lowerES[i]!, firstIdx + 1 - d);
            if (c.type === 'SNLT' || c.type === 'MSO') capLF[i] = Math.min(capLF[i]!, lastIdx + d);
            if (c.type === 'FNLT' || c.type === 'MFO') capLF[i] = Math.min(capLF[i]!, lastIdx + 1);
          }
        }
      });
      const deps = network.dependencies.map((d) => ({
        p: index.get(d.predecessorId)!,
        s: index.get(d.successorId)!,
        type: d.type,
        lag: d.lag ?? 0,
      }));
      const expected = oracle(durations, deps, { lowerES, capLF });

      network.activities.forEach((a, i) => {
        const got = result.activities.find((r) => r.id === a.id)!;
        const where = `intento ${trial}, actividad ${a.id}`;
        expect(got.axis, where).toEqual({ es: expected.es[i], ef: expected.ef[i], ls: expected.ls[i], lf: expected.lf[i] });
        const violated = expected.ef[i]! > capLF[i]!;
        expect(got.violatedConstraints.length > 0, where).toBe(violated);
        if (violated) violations++;
      });
    }
    // Garantiza que la prueba realmente ejercita los casos difíciles.
    expect(weekendConstraints).toBeGreaterThan(300);
    expect(violations).toBeGreaterThan(50);
  });
});
