import { describe, expect, it } from 'vitest';
import {
  CycleError,
  MON_FRI_CALENDAR,
  ScheduleError,
  applyChanges,
  previewImpact,
  type ScheduleInput,
} from '../src';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const input: ScheduleInput = deepFreeze({
  projectStart: '2026-11-02',
  calendar: MON_FRI_CALENDAR,
  activities: [
    { id: 'A', duration: 3 },
    { id: 'B', duration: 2 },
    { id: 'C', duration: 1 },
    { id: 'LATERAL', duration: 1 },
  ],
  dependencies: [
    { predecessorId: 'A', successorId: 'B', type: 'FS' as const },
    { predecessorId: 'B', successorId: 'C', type: 'FS' as const },
  ],
});

describe('impacto de reprogramación (US-066)', () => {
  it('alargar A afecta a sus sucesoras y mueve el fin del proyecto', () => {
    const { impact, before, after } = previewImpact(input, [
      { type: 'updateActivity', id: 'A', patch: { duration: 5 } },
    ]);
    expect(before.projectFinish).toBe('2026-11-09');
    expect(after.projectFinish).toBe('2026-11-11');
    expect(impact.projectFinishBefore).toBe('2026-11-09');
    expect(impact.projectFinishAfter).toBe('2026-11-11');
    expect(impact.projectFinishShiftWorkingDays).toBe(2);
    expect(impact.projectFinishShiftCalendarDays).toBe(2);
    expect(impact.affected.map((a) => a.id)).toEqual(['A', 'B', 'C']);
    expect(impact.affected.find((a) => a.id === 'LATERAL')).toBeUndefined();
    const b = impact.affected.find((a) => a.id === 'B')!;
    expect(b.before).toEqual({ start: '2026-11-05', finish: '2026-11-06' });
    expect(b.after).toEqual({ start: '2026-11-09', finish: '2026-11-10' });
    expect(b.startShiftWorkingDays).toBe(2);
    expect(b.startShiftCalendarDays).toBe(4); // cruza un fin de semana
    expect(impact.becameCritical).toEqual([]);
  });

  it('alargar una actividad aislada solo la afecta a ella y no mueve el fin del proyecto', () => {
    const { impact } = previewImpact(input, [{ type: 'updateActivity', id: 'LATERAL', patch: { duration: 2 } }]);
    expect(impact.affected.map((a) => a.id)).toEqual(['LATERAL']);
    expect(impact.projectFinishShiftWorkingDays).toBe(0);
    expect(impact.projectFinishShiftCalendarDays).toBe(0);
  });

  it('una lista de cambios vacía no afecta a nadie', () => {
    const { impact } = previewImpact(input, []);
    expect(impact.affected).toEqual([]);
    expect(impact.added).toEqual([]);
    expect(impact.removed).toEqual([]);
    expect(impact.projectFinishShiftWorkingDays).toBe(0);
  });

  it('alargar la actividad lateral por encima de la ruta crítica la vuelve crítica', () => {
    const { impact } = previewImpact(input, [{ type: 'updateActivity', id: 'LATERAL', patch: { duration: 9 } }]);
    expect(impact.becameCritical).toEqual(['LATERAL']);
    expect(impact.noLongerCritical).toEqual(['A', 'B', 'C']);
    expect(impact.projectFinishShiftWorkingDays).toBe(3); // de 6 a 9 días laborables
  });

  it('quitar una dependencia adelanta a la sucesora (variación negativa)', () => {
    const { impact } = previewImpact(input, [{ type: 'removeDependency', predecessorId: 'A', successorId: 'B' }]);
    expect(impact.affected.map((a) => a.id)).toEqual(['B', 'C']);
    expect(impact.projectFinishShiftWorkingDays).toBe(-3);
  });

  it('un feriado nuevo cambia las fechas y se muestra en el impacto', () => {
    const { impact } = previewImpact(input, [
      { type: 'setCalendar', calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-03'] } },
    ]);
    expect(impact.projectFinishAfter).toBe('2026-11-10');
    expect(impact.projectFinishShiftWorkingDays).toBe(1);
    expect(impact.affected.map((a) => a.id)).toEqual(['A', 'B', 'C']);
  });

  it('mover el inicio del proyecto desplaza todo', () => {
    const { impact } = previewImpact(input, [{ type: 'setProjectStart', date: '2026-11-09' }]);
    expect(impact.projectFinishAfter).toBe('2026-11-16');
    expect(impact.projectFinishShiftCalendarDays).toBe(7);
    expect(impact.affected).toHaveLength(4);
  });

  it('informa actividades agregadas y eliminadas', () => {
    const { impact } = previewImpact(input, [
      { type: 'addActivity', activity: { id: 'D', duration: 1 } },
      { type: 'addDependency', dependency: { predecessorId: 'C', successorId: 'D', type: 'FS' } },
      { type: 'removeActivity', id: 'LATERAL' },
    ]);
    expect(impact.added).toEqual(['D']);
    expect(impact.removed).toEqual(['LATERAL']);
    expect(impact.projectFinishShiftWorkingDays).toBe(1);
  });

  it('un cambio que crea un ciclo se rechaza con la ruta', () => {
    try {
      previewImpact(input, [{ type: 'addDependency', dependency: { predecessorId: 'C', successorId: 'A', type: 'FS' } }]);
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).cycle).toEqual(['A', 'B', 'C', 'A']);
    }
  });

  it('cambios sobre elementos inexistentes lanzan error', () => {
    expect(() => previewImpact(input, [{ type: 'updateActivity', id: 'Z', patch: { duration: 1 } }])).toThrowError(
      ScheduleError,
    );
    expect(() => previewImpact(input, [{ type: 'removeActivity', id: 'Z' }])).toThrow(/Z/);
    expect(() => previewImpact(input, [{ type: 'removeDependency', predecessorId: 'A', successorId: 'C' }])).toThrow(
      /dependencia/,
    );
  });
});

describe('applyChanges', () => {
  it('no modifica la entrada (que aquí está congelada)', () => {
    expect(() => applyChanges(input, [{ type: 'updateActivity', id: 'A', patch: { duration: 9 } }])).not.toThrow();
    expect(input.activities[0]!.duration).toBe(3);
  });

  it('quitar una actividad elimina sus dependencias', () => {
    const changed = applyChanges(input, [{ type: 'removeActivity', id: 'B' }]);
    expect(changed.activities.map((a) => a.id)).toEqual(['A', 'C', 'LATERAL']);
    expect(changed.dependencies).toEqual([]);
  });

  it('actualiza tipo y desfase de una dependencia', () => {
    const changed = applyChanges(input, [
      { type: 'updateDependency', predecessorId: 'A', successorId: 'B', patch: { type: 'SS', lag: 1 } },
    ]);
    expect(changed.dependencies[0]).toEqual({ predecessorId: 'A', successorId: 'B', type: 'SS', lag: 1 });
  });
});
