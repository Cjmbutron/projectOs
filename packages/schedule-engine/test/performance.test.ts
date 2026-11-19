import { describe, expect, it } from 'vitest';
import { computeSchedule, formatDay, toDayNumber, type ActivityInput, type DependencyInput } from '../src';
import { randInt, rng } from './helpers';

/** RNF-03: recalcular un cronograma de 5 000 actividades en menos de 1 s. */
describe('rendimiento', () => {
  it('5 000 actividades, ~10 000 dependencias de los cuatro tipos, calendario con feriados', () => {
    const random = rng(5000);
    const n = 5000;
    const activities: ActivityInput[] = [];
    const dependencies: DependencyInput[] = [];
    const types = ['FS', 'SS', 'FF', 'SF'] as const;

    for (let i = 0; i < n; i++) {
      activities.push({
        id: `A${i}`,
        duration: randInt(random, 0, 10),
        constraints: random() < 0.02 ? [{ type: 'SNET', date: formatDay(toDayNumber('2026-11-02') + randInt(random, 0, 400)) }] : [],
      });
    }
    // Cada actividad depende de hasta dos anteriores cercanas (red acíclica con ruta larga).
    for (let i = 1; i < n; i++) {
      const seen = new Set<number>();
      for (let k = 0; k < 2; k++) {
        const p = Math.max(0, i - randInt(random, 1, 40));
        if (seen.has(p)) continue;
        seen.add(p);
        dependencies.push({
          predecessorId: `A${p}`,
          successorId: `A${i}`,
          type: types[randInt(random, 0, 3)]!,
          lag: randInt(random, -1, 3),
        });
      }
    }
    const holidays: string[] = [];
    for (let k = 0; k < 40; k++) holidays.push(formatDay(toDayNumber('2026-11-02') + k * 23));

    const input = {
      projectStart: '2026-11-02',
      calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays },
      activities,
      dependencies,
    };

    computeSchedule(input); // calentamiento del JIT
    const t0 = performance.now();
    const result = computeSchedule(input);
    const elapsed = performance.now() - t0;
    console.log(
      `[rendimiento] ${n} actividades, ${dependencies.length} dependencias: ${elapsed.toFixed(0)} ms; ` +
        `duración ${result.durationWorkingDays} días laborables, ${result.criticalActivityIds.length} críticas`,
    );

    expect(result.activities).toHaveLength(n);
    expect(result.criticalActivityIds.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});
