import { describe, expect, it } from 'vitest';
import {
  CycleError,
  MON_FRI_CALENDAR,
  computeSchedule,
  findCycleForNewDependency,
  type ActivityInput,
  type DependencyInput,
} from '../src';

const acts = (...ids: string[]): ActivityInput[] => ids.map((id) => ({ id, duration: 1 }));
const fs = (p: string, s: string): DependencyInput => ({ predecessorId: p, successorId: s, type: 'FS' });

function cycleOf(activities: ActivityInput[], dependencies: DependencyInput[]): readonly string[] {
  try {
    computeSchedule({ projectStart: '2026-11-02', calendar: MON_FRI_CALENDAR, activities, dependencies });
  } catch (error) {
    if (error instanceof CycleError) return error.cycle;
    throw error;
  }
  throw new Error('se esperaba un CycleError');
}

describe('detección de ciclos al calcular', () => {
  it('ciclo de tres actividades, en orden de dependencia', () => {
    expect(cycleOf(acts('A', 'B', 'C'), [fs('A', 'B'), fs('B', 'C'), fs('C', 'A')])).toEqual(['A', 'B', 'C', 'A']);
  });

  it('el mensaje muestra la ruta', () => {
    try {
      computeSchedule({
        projectStart: '2026-11-02',
        calendar: MON_FRI_CALENDAR,
        activities: acts('A', 'B'),
        dependencies: [fs('A', 'B'), fs('B', 'A')],
      });
      throw new Error('no lanzó');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).code).toBe('CYCLE');
      expect((error as CycleError).message).toBe('Dependencia circular: A → B → A');
    }
  });

  it('dependencia de una actividad consigo misma', () => {
    expect(cycleOf(acts('A'), [fs('A', 'A')])).toEqual(['A', 'A']);
  });

  it('el ciclo no incluye actividades que solo cuelgan de él', () => {
    // X → A → B → A y B → D → E: D y E no forman parte del ciclo.
    const cycle = cycleOf(
      acts('X', 'A', 'B', 'D', 'E'),
      [fs('X', 'A'), fs('A', 'B'), fs('B', 'A'), fs('B', 'D'), fs('D', 'E')],
    );
    expect(cycle).toEqual(['A', 'B', 'A']);
  });

  it('un ciclo con dependencias de distintos tipos también se detecta', () => {
    const cycle = cycleOf(acts('A', 'B', 'C'), [
      { predecessorId: 'A', successorId: 'B', type: 'SS' },
      { predecessorId: 'B', successorId: 'C', type: 'FF', lag: 2 },
      { predecessorId: 'C', successorId: 'A', type: 'SF', lag: -1 },
    ]);
    expect(cycle).toEqual(['A', 'B', 'C', 'A']);
  });

  it('la ruta de cada ciclo reportado es realmente un ciclo del grafo', () => {
    const deps = [fs('A', 'B'), fs('B', 'C'), fs('C', 'D'), fs('D', 'B'), fs('A', 'E')];
    const cycle = cycleOf(acts('A', 'B', 'C', 'D', 'E'), deps);
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    for (let i = 0; i < cycle.length - 1; i++) {
      expect(deps.some((d) => d.predecessorId === cycle[i] && d.successorId === cycle[i + 1])).toBe(true);
    }
  });
});

describe('findCycleForNewDependency (US-020)', () => {
  const existing = [fs('A', 'B'), fs('B', 'C'), fs('C', 'D')];

  it('devuelve null si la dependencia nueva es válida', () => {
    expect(findCycleForNewDependency(existing, { predecessorId: 'A', successorId: 'D' })).toBeNull();
    expect(findCycleForNewDependency(existing, { predecessorId: 'X', successorId: 'A' })).toBeNull();
    expect(findCycleForNewDependency([], { predecessorId: 'A', successorId: 'B' })).toBeNull();
  });

  it('devuelve la ruta del ciclo que se crearía', () => {
    expect(findCycleForNewDependency(existing, { predecessorId: 'D', successorId: 'A' })).toEqual([
      'D',
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(findCycleForNewDependency(existing, { predecessorId: 'C', successorId: 'B' })).toEqual(['C', 'B', 'C']);
  });

  it('rechaza una actividad dependiente de sí misma', () => {
    expect(findCycleForNewDependency([], { predecessorId: 'A', successorId: 'A' })).toEqual(['A', 'A']);
  });

  it('elige un camino real aunque haya varios', () => {
    const graph = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')];
    const cycle = findCycleForNewDependency(graph, { predecessorId: 'D', successorId: 'A' })!;
    expect(cycle[0]).toBe('D');
    expect(cycle[1]).toBe('A');
    expect(cycle[cycle.length - 1]).toBe('D');
    expect(cycle).toHaveLength(4);
  });
});
