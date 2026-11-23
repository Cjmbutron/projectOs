import { describe, expect, it } from 'vitest';
import { actLabel, depLabel, parseDependencyUpdate, parseOpen, predecessorCandidates, reachable, successorCandidates, type Dep } from '@/lib/schedule/dep-candidates';

const A = (id: string) => ({ id, name: id.toUpperCase() });
const acts = ['a', 'b', 'c', 'd', 'e'].map(A);
const dep = (p: string, s: string, i = 0): Dep => ({ id: `d${p}${s}${i}`, predecessor_id: p, successor_id: s, type: 'FS', lag: 0 });
// a → b → c ;  d → c ;  e aislada
const deps = [dep('a', 'b'), dep('b', 'c'), dep('d', 'c')];

describe('reachable', () => {
  it('hacia adelante y hacia atrás, transitivo y sin incluirse', () => {
    expect([...reachable(deps, 'a', true)].sort()).toEqual(['b', 'c']);
    expect([...reachable(deps, 'c', false)].sort()).toEqual(['a', 'b', 'd']);
    expect([...reachable(deps, 'e', true)]).toEqual([]);
  });
  it('tolera ciclos en los datos sin colgarse ni incluir el origen', () => {
    const cyc = [dep('a', 'b'), dep('b', 'a')];
    expect([...reachable(cyc, 'a', true)]).toEqual(['b']);
  });
});

describe('predecessorCandidates', () => {
  it('excluye la propia, las ya predecesoras y las sucesoras (ciclo)', () => {
    expect(predecessorCandidates(acts, deps, 'b').map((x) => x.id)).toEqual(['d', 'e']); // a ya es predecesora; c es sucesora
    expect(predecessorCandidates(acts, deps, 'a').map((x) => x.id)).toEqual(['d', 'e']); // b y c son sucesoras
  });
  it('una actividad aislada puede tener a todas las demás', () => {
    expect(predecessorCandidates(acts, deps, 'e').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('successorCandidates', () => {
  it('excluye la propia, las ya sucesoras y las predecesoras (ciclo)', () => {
    expect(successorCandidates(acts, deps, 'b').map((x) => x.id)).toEqual(['d', 'e']); // a es predecesora; c ya es sucesora
    expect(successorCandidates(acts, deps, 'c').map((x) => x.id)).toEqual(['e']);       // a, b, d son predecesoras
  });
});

describe('depLabel / actLabel', () => {
  it('desfase con signo', () => {
    expect(depLabel('FS', 0)).toBe('FS');
    expect(depLabel('SS', 2)).toBe('SS +2 d');
    expect(depLabel('FF', -1)).toBe('FF −1 d');
  });
  it('numera desde 1', () => { expect(actLabel(0, 'Excavar')).toBe('1. Excavar'); expect(actLabel(9, 'X')).toBe('10. X'); });
});

describe('parseDependencyUpdate / parseOpen', () => {
  const U = '123e4567-e89b-42d3-a456-426614174000';
  const f = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  it('acepta tipo y desfase válidos (tipo en minúsculas, desfase vacío = 0)', () => {
    expect(parseDependencyUpdate(f({ id: U, type: 'ss', lag: '-3' }))).toEqual({ ok: true, id: U, type: 'SS', lag: -3 });
    expect(parseDependencyUpdate(f({ id: U, type: 'FS', lag: '' }))).toEqual({ ok: true, id: U, type: 'FS', lag: 0 });
  });
  it('rechaza id, tipo o desfase inválidos y el límite de 36 500', () => {
    const bad = { ok: false, error: 'invalid_dependency' };
    expect(parseDependencyUpdate(f({ id: 'x', type: 'FS', lag: '0' }))).toEqual(bad);
    expect(parseDependencyUpdate(f({ id: U, type: 'XX', lag: '0' }))).toEqual(bad);
    expect(parseDependencyUpdate(f({ id: U, type: 'FS', lag: '1.5' }))).toEqual(bad);
    expect(parseDependencyUpdate(f({ id: U, type: 'FS', lag: '36500' })).ok).toBe(true);
    expect(parseDependencyUpdate(f({ id: U, type: 'FS', lag: '36501' }))).toEqual(bad);
  });
  it('parseOpen solo acepta UUID', () => { expect(parseOpen(U)).toBe(U); expect(parseOpen('x')).toBeNull(); expect(parseOpen(undefined)).toBeNull(); });
});
