import { describe, expect, it } from 'vitest';
import {
  MON_FRI_CALENDAR,
  ScheduleError,
  computeSchedule,
  type ActivityInput,
  type CalendarInput,
  type DependencyInput,
  type ScheduleResult,
} from '../src';

// 2026-11-02 es lunes. Semana 1: 2–6 nov. Semana 2: 9–13 nov.
const MONDAY = '2026-11-02';

function run(
  activities: ActivityInput[],
  dependencies: DependencyInput[] = [],
  options: { start?: string; calendar?: CalendarInput } = {},
): ScheduleResult {
  return computeSchedule({
    projectStart: options.start ?? MONDAY,
    calendar: options.calendar ?? MON_FRI_CALENDAR,
    activities,
    dependencies,
  });
}

function get(result: ScheduleResult, id: string) {
  const found = result.activities.find((a) => a.id === id);
  if (!found) throw new Error(`no existe ${id} en el resultado`);
  return found;
}

const dates = (r: ScheduleResult, id: string) => [get(r, id).earlyStart, get(r, id).earlyFinish];

describe('dependencias', () => {
  it('FS en cadena: B empieza al día laborable siguiente al fin de A', () => {
    const r = run(
      [{ id: 'A', duration: 3 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS' }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-04']);
    expect(dates(r, 'B')).toEqual(['2026-11-05', '2026-11-06']);
    expect(r.projectStart).toBe('2026-11-02');
    expect(r.projectFinish).toBe('2026-11-06');
    expect(r.durationWorkingDays).toBe(5);
  });

  it('salta fines de semana', () => {
    const r = run(
      [{ id: 'A', duration: 5 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS' }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-06']);
    expect(dates(r, 'B')).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('FS con desfase positivo (lag +2 días laborables)', () => {
    const r = run(
      [{ id: 'A', duration: 1 }, { id: 'B', duration: 1 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 2 }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-02']);
    expect(dates(r, 'B')).toEqual(['2026-11-05', '2026-11-05']); // lun + 1 + 2 = jueves
  });

  it('FS con adelanto (lag −1) superpone el último día de A', () => {
    const r = run(
      [{ id: 'A', duration: 3 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: -1 }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-04']);
    expect(dates(r, 'B')).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('un adelanto grande no hace empezar antes del inicio del proyecto', () => {
    const r = run(
      [{ id: 'A', duration: 1 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: -5 }],
    );
    expect(dates(r, 'B')).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('SS: B empieza un día después de que empieza A', () => {
    const r = run(
      [{ id: 'A', duration: 4 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'SS', lag: 1 }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-05']);
    expect(dates(r, 'B')).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('FF: B termina el mismo día que A', () => {
    const r = run(
      [{ id: 'A', duration: 4 }, { id: 'B', duration: 2 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'FF' }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-05']);
    expect(dates(r, 'B')).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('SF: B termina justo antes de que empiece A', () => {
    const r = run(
      [
        { id: 'A', duration: 3, constraints: [{ type: 'SNET', date: '2026-11-09' }] },
        { id: 'B', duration: 2 },
      ],
      [{ predecessorId: 'A', successorId: 'B', type: 'SF' }],
    );
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-11']);
    expect(dates(r, 'B')).toEqual(['2026-11-05', '2026-11-06']); // termina el viernes, A empieza el lunes
  });

  it('con varias predecesoras manda la más tardía', () => {
    const r = run(
      [
        { id: 'A', duration: 2 },
        { id: 'B', duration: 4 },
        { id: 'C', duration: 1 },
      ],
      [
        { predecessorId: 'A', successorId: 'C', type: 'FS' },
        { predecessorId: 'B', successorId: 'C', type: 'FS' },
      ],
    );
    expect(dates(r, 'C')).toEqual(['2026-11-06', '2026-11-06']);
  });
});

describe('calendario en el cálculo', () => {
  it('un feriado desplaza la actividad', () => {
    const r = run([{ id: 'A', duration: 3 }], [], {
      calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-03'] },
    });
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-05']); // lun, mié, jue
  });

  it('un sábado laborable excepcional cuenta como día', () => {
    const r = run([{ id: 'A', duration: 6 }], [], {
      calendar: { workingWeekdays: [1, 2, 3, 4, 5], workingExceptions: ['2026-11-07'] },
    });
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-07']);
  });

  it('si el inicio cae en día no laborable, arranca el siguiente laborable', () => {
    const r = run([{ id: 'A', duration: 1 }], [], { start: '2026-11-07' });
    expect(r.projectStart).toBe('2026-11-09');
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-09']);
  });

  it('semana de seis días', () => {
    const r = run([{ id: 'A', duration: 7 }], [], {
      calendar: { workingWeekdays: [1, 2, 3, 4, 5, 6] },
    });
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-09']);
  });

  it('proyecto vacío', () => {
    const r = run([]);
    expect(r.projectStart).toBe('2026-11-02');
    expect(r.projectFinish).toBe('2026-11-02');
    expect(r.durationWorkingDays).toBe(0);
    expect(r.activities).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('hitos', () => {
  const chain: ActivityInput[] = [{ id: 'A', duration: 3 }];

  it('un hito tras A cae el último día de A', () => {
    const r = run([...chain, { id: 'M', duration: 0 }], [
      { predecessorId: 'A', successorId: 'M', type: 'FS' },
    ]);
    expect(get(r, 'M').isMilestone).toBe(true);
    expect(dates(r, 'M')).toEqual(['2026-11-04', '2026-11-04']);
    expect(r.projectFinish).toBe('2026-11-04');
  });

  it('un hito sin predecesoras cae en el inicio del proyecto', () => {
    const r = run([{ id: 'M', duration: 0 }]);
    expect(dates(r, 'M')).toEqual(['2026-11-02', '2026-11-02']);
    expect(r.projectFinish).toBe('2026-11-02');
  });

  it('las restricciones de un hito se leen como fin de día', () => {
    const lunes = run([{ id: 'M', duration: 0, constraints: [{ type: 'SNET', date: '2026-11-09' }] }]);
    expect(dates(lunes, 'M')).toEqual(['2026-11-09', '2026-11-09']);
    const sabado = run([{ id: 'M', duration: 0, constraints: [{ type: 'FNET', date: '2026-11-07' }] }]);
    expect(dates(sabado, 'M')).toEqual(['2026-11-09', '2026-11-09']); // no puede ser antes del sábado
  });

  it('las sucesoras de un hito empiezan al día laborable siguiente', () => {
    const r = run(
      [...chain, { id: 'M', duration: 0 }, { id: 'B', duration: 2 }],
      [
        { predecessorId: 'A', successorId: 'M', type: 'FS' },
        { predecessorId: 'M', successorId: 'B', type: 'FS' },
      ],
    );
    expect(dates(r, 'B')).toEqual(['2026-11-05', '2026-11-06']);
  });

  it('un hito puede depender del fin de dos tareas (como el fin de dos sprints)', () => {
    const r = run(
      [{ id: 'S1', duration: 5 }, { id: 'S2', duration: 7 }, { id: 'M', duration: 0 }],
      [
        { predecessorId: 'S1', successorId: 'M', type: 'FS' },
        { predecessorId: 'S2', successorId: 'M', type: 'FS' },
      ],
    );
    expect(dates(r, 'M')).toEqual(['2026-11-10', '2026-11-10']); // S2: 2 nov → 10 nov
  });
});

describe('ruta crítica y holguras', () => {
  // A(2) → B(3) → D(2) y A → C(1) → D, todo FS.
  const diamond = () =>
    run(
      [
        { id: 'A', duration: 2 },
        { id: 'B', duration: 3 },
        { id: 'C', duration: 1 },
        { id: 'D', duration: 2 },
      ],
      [
        { predecessorId: 'A', successorId: 'B', type: 'FS' },
        { predecessorId: 'A', successorId: 'C', type: 'FS' },
        { predecessorId: 'B', successorId: 'D', type: 'FS' },
        { predecessorId: 'C', successorId: 'D', type: 'FS' },
      ],
    );

  it('marca A, B y D como críticas y C con 2 días de holgura', () => {
    const r = diamond();
    expect(r.criticalActivityIds).toEqual(['A', 'B', 'D']);
    expect(get(r, 'C').critical).toBe(false);
    expect(get(r, 'C').totalFloat).toBe(2);
    expect(get(r, 'C').freeFloat).toBe(2);
    for (const id of ['A', 'B', 'D']) expect(get(r, id).totalFloat).toBe(0);
    expect(r.durationWorkingDays).toBe(7);
    expect(r.projectFinish).toBe('2026-11-10');
  });

  it('fechas tempranas y tardías', () => {
    const r = diamond();
    expect(dates(r, 'B')).toEqual(['2026-11-04', '2026-11-06']);
    expect(dates(r, 'C')).toEqual(['2026-11-04', '2026-11-04']);
    expect(get(r, 'C').lateStart).toBe('2026-11-06');
    expect(get(r, 'C').lateFinish).toBe('2026-11-06');
    expect(dates(r, 'D')).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('holgura libre menor que la total: S → M → E con E esperando a P', () => {
    const r = run(
      [
        { id: 'P', duration: 5 },
        { id: 'S', duration: 1 },
        { id: 'M', duration: 1 },
        { id: 'E', duration: 1 },
      ],
      [
        { predecessorId: 'P', successorId: 'E', type: 'FS' },
        { predecessorId: 'S', successorId: 'M', type: 'FS' },
        { predecessorId: 'M', successorId: 'E', type: 'FS' },
      ],
    );
    // S: días 0–1, M: 1–2, E empieza en 5 (espera a P). M puede correrse 3 días; S también, pero arrastrando a M.
    expect(get(r, 'S').totalFloat).toBe(3);
    expect(get(r, 'S').freeFloat).toBe(0); // si S se atrasa, M se atrasa
    expect(get(r, 'M').totalFloat).toBe(3);
    expect(get(r, 'M').freeFloat).toBe(3);
  });

  it('dos caminos de igual duración son ambos críticos', () => {
    const r = run(
      [{ id: 'A', duration: 3 }, { id: 'B', duration: 3 }],
    );
    expect(r.criticalActivityIds).toEqual(['A', 'B']);
  });

  it('una actividad independiente corta tiene holgura hasta el fin del proyecto', () => {
    const r = run([{ id: 'LARGA', duration: 10 }, { id: 'CORTA', duration: 2 }]);
    expect(get(r, 'CORTA').totalFloat).toBe(8);
    expect(get(r, 'CORTA').freeFloat).toBe(8);
    expect(get(r, 'CORTA').critical).toBe(false);
  });

  it('SS: la holgura de la predecesora no depende de su duración sino del inicio de la sucesora', () => {
    // A(5) SS+0 → B(1). B es lo único que no termina con A; el fin es el de A (5).
    const r = run(
      [{ id: 'A', duration: 5 }, { id: 'B', duration: 1 }],
      [{ predecessorId: 'A', successorId: 'B', type: 'SS' }],
    );
    expect(get(r, 'A').totalFloat).toBe(0);
    expect(get(r, 'B').totalFloat).toBe(4);
  });
});

describe('restricciones de fecha', () => {
  it('SNET: no empieza antes de la fecha', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'SNET', date: '2026-11-05' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-05', '2026-11-06']);
  });

  it('SNET en fin de semana empuja al lunes', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'SNET', date: '2026-11-07' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('FNET: no termina antes de la fecha', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'FNET', date: '2026-11-10' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('SNET anterior al inicio del proyecto no tiene efecto', () => {
    const r = run([{ id: 'A', duration: 1, constraints: [{ type: 'SNET', date: '2026-10-01' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-02', '2026-11-02']);
  });

  it('FNLT cumplida limita la holgura', () => {
    const r = run([
      { id: 'X', duration: 10 },
      { id: 'A', duration: 2, constraints: [{ type: 'FNLT', date: '2026-11-06' }] },
    ]);
    expect(get(r, 'A').totalFloat).toBe(3); // puede terminar hasta el fin del día 5 (viernes 6)
    expect(get(r, 'A').violatedConstraints).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('MSO cumplida: empieza justo ese día y no hay advertencias', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'MSO', date: '2026-11-04' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-04', '2026-11-05']);
    expect(get(r, 'A').totalFloat).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('MFO cumplida: termina justo ese día', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'MFO', date: '2026-11-04' }] }]);
    expect(dates(r, 'A')).toEqual(['2026-11-03', '2026-11-04']);
    expect(r.warnings).toEqual([]);
  });

  it('SNLT imposible: holgura negativa en la actividad y su predecesora, con advertencia', () => {
    const r = run(
      [
        { id: 'B', duration: 5 },
        { id: 'A', duration: 3, constraints: [{ type: 'SNLT', date: '2026-11-04' }] },
      ],
      [{ predecessorId: 'B', successorId: 'A', type: 'FS' }],
    );
    // Las dependencias mandan: A empieza el lunes 9, no el 4.
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-11']);
    expect(get(r, 'A').totalFloat).toBe(-3);
    expect(get(r, 'B').totalFloat).toBe(-3);
    expect(get(r, 'A').violatedConstraints).toEqual(['SNLT']);
    expect(r.warnings).toContainEqual({ code: 'CONSTRAINT_VIOLATED', activityId: 'A', constraint: 'SNLT' });
    expect(r.warnings).toContainEqual({ code: 'NEGATIVE_FLOAT', activityId: 'A', totalFloat: -3 });
    expect(r.warnings).toContainEqual({ code: 'NEGATIVE_FLOAT', activityId: 'B', totalFloat: -3 });
    expect(r.criticalActivityIds).toEqual(['B', 'A']);
  });

  it('MSO que una predecesora impide: se reporta como violada', () => {
    const r = run(
      [
        { id: 'B', duration: 5 },
        { id: 'A', duration: 2, constraints: [{ type: 'MSO', date: '2026-11-04' }] },
      ],
      [{ predecessorId: 'B', successorId: 'A', type: 'FS' }],
    );
    expect(get(r, 'A').violatedConstraints).toEqual(['MSO']);
    expect(get(r, 'A').totalFloat).toBeLessThan(0);
  });

  it('MSO en un día no laborable no se puede cumplir', () => {
    const r = run([{ id: 'A', duration: 2, constraints: [{ type: 'MSO', date: '2026-11-07' }] }]);
    expect(get(r, 'A').violatedConstraints).toEqual(['MSO']);
    expect(dates(r, 'A')).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('restricciones de un sprint: SNET + FNLT sobre la misma actividad', () => {
    const sprint = [
      { type: 'SNET', date: '2026-11-09' },
      { type: 'FNLT', date: '2026-11-13' },
    ] as const;
    const ok = run([{ id: 'HU', duration: 5, constraints: sprint }]);
    expect(dates(ok, 'HU')).toEqual(['2026-11-09', '2026-11-13']);
    expect(ok.warnings).toEqual([]);

    // Con una predecesora que ocupa la primera semana el sprint no alcanza: la fecha de fin se viola.
    const tight = run(
      [{ id: 'PRE', duration: 8 }, { id: 'HU', duration: 5, constraints: sprint }],
      [{ predecessorId: 'PRE', successorId: 'HU', type: 'FS' }],
    );
    expect(get(tight, 'HU').violatedConstraints).toEqual(['FNLT']);
    expect(get(tight, 'HU').totalFloat).toBeLessThan(0);
  });

  it('un hito con FNLT incumplida', () => {
    const r = run(
      [{ id: 'A', duration: 5 }, { id: 'M', duration: 0, constraints: [{ type: 'FNLT', date: '2026-11-04' }] }],
      [{ predecessorId: 'A', successorId: 'M', type: 'FS' }],
    );
    expect(dates(r, 'M')).toEqual(['2026-11-06', '2026-11-06']);
    expect(get(r, 'M').violatedConstraints).toEqual(['FNLT']);
    expect(get(r, 'M').totalFloat).toBe(-2);
  });
});

describe('validación', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ScheduleError) return error.code;
      throw error;
    }
    return 'NO_ERROR';
  };

  it('actividades inválidas', () => {
    expect(code(() => run([{ id: '', duration: 1 }]))).toBe('INVALID_ACTIVITY');
    expect(code(() => run([{ id: 'A', duration: 1 }, { id: 'A', duration: 2 }]))).toBe('DUPLICATE_ACTIVITY');
    expect(code(() => run([{ id: 'A', duration: -1 }]))).toBe('INVALID_DURATION');
    expect(code(() => run([{ id: 'A', duration: 1.5 }]))).toBe('INVALID_DURATION');
    expect(code(() => run([{ id: 'A', duration: Number.NaN }]))).toBe('INVALID_DURATION');
    expect(code(() => run([{ id: 'A', duration: 999_999 }]))).toBe('INVALID_DURATION');
  });

  it('dependencias inválidas', () => {
    const acts = [{ id: 'A', duration: 1 }, { id: 'B', duration: 1 }];
    expect(code(() => run(acts, [{ predecessorId: 'A', successorId: 'Z', type: 'FS' }]))).toBe('UNKNOWN_ACTIVITY');
    expect(code(() => run(acts, [{ predecessorId: 'Z', successorId: 'A', type: 'FS' }]))).toBe('UNKNOWN_ACTIVITY');
    expect(code(() => run(acts, [{ predecessorId: 'A', successorId: 'B', type: 'XX' as never }]))).toBe(
      'INVALID_DEPENDENCY_TYPE',
    );
    expect(code(() => run(acts, [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 1.5 }]))).toBe('INVALID_LAG');
    expect(code(() => run(acts, [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 99_999 }]))).toBe('INVALID_LAG');
  });

  it('rechaza dependencias duplicadas aunque cambie el tipo', () => {
    const acts = [{ id: 'A', duration: 1 }, { id: 'B', duration: 1 }];
    expect(
      code(() =>
        run(acts, [
          { predecessorId: 'A', successorId: 'B', type: 'FS' },
          { predecessorId: 'A', successorId: 'B', type: 'SS' },
        ]),
      ),
    ).toBe('DUPLICATE_DEPENDENCY');
  });

  it('restricciones inválidas', () => {
    expect(code(() => run([{ id: 'A', duration: 1, constraints: [{ type: 'XX' as never, date: MONDAY }] }]))).toBe(
      'INVALID_CONSTRAINT',
    );
    expect(
      code(() =>
        run([
          {
            id: 'A',
            duration: 1,
            constraints: [
              { type: 'SNET', date: MONDAY },
              { type: 'SNET', date: '2026-11-09' },
            ],
          },
        ]),
      ),
    ).toBe('INVALID_CONSTRAINT');
    expect(code(() => run([{ id: 'A', duration: 1, constraints: [{ type: 'SNET', date: '2026-02-30' }] }]))).toBe(
      'INVALID_DATE',
    );
  });

  it('inicio de proyecto o calendario inválidos', () => {
    expect(code(() => run([], [], { start: 'mañana' }))).toBe('INVALID_DATE');
    expect(code(() => run([], [], { calendar: { workingWeekdays: [] } }))).toBe('INVALID_CALENDAR');
  });

  it('no modifica la entrada', () => {
    const input = Object.freeze({
      projectStart: MONDAY,
      calendar: MON_FRI_CALENDAR,
      activities: Object.freeze([Object.freeze({ id: 'A', duration: 2 }), Object.freeze({ id: 'B', duration: 1 })]),
      dependencies: Object.freeze([Object.freeze({ predecessorId: 'A', successorId: 'B', type: 'FS' as const })]),
    });
    expect(() => computeSchedule(input)).not.toThrow();
  });
});
