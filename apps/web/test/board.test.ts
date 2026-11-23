import { describe, expect, it } from 'vitest';
import { allowedMoves, COLUMNS, groupByStatus, isStatus, parseMove, targetPercent, type BoardActivity } from '@/lib/board';

const act = (o: Partial<BoardActivity> & { id: string }): BoardActivity => ({ name: o.id, duration: 3, status: 'not_started', percent_complete: 0, early_start: null, early_finish: null, assignee_id: null, ...o });

describe('groupByStatus', () => {
  it('una columna por estado; un estado desconocido va a «Sin iniciar»', () => {
    const g = groupByStatus([act({ id: 'a', status: 'done' }), act({ id: 'b', status: 'in_progress' }), act({ id: 'c', status: 'raro' }), act({ id: 'd' })]);
    expect(g.done.map((x) => x.id)).toEqual(['a']);
    expect(g.in_progress.map((x) => x.id)).toEqual(['b']);
    expect(g.not_started.map((x) => x.id)).toEqual(['c', 'd']);
  });
  it('orden: inicio más próximo, sin fecha al final, empate por nombre', () => {
    const g = groupByStatus([
      act({ id: 'x', name: 'Zeta', early_start: null }), act({ id: 'y', name: 'Beta', early_start: '2026-03-10' }),
      act({ id: 'z', name: 'Alfa', early_start: '2026-03-02' }), act({ id: 'w', name: 'Ana', early_start: '2026-03-10' }),
      act({ id: 'v', name: 'Abel', early_start: null }),
    ]);
    expect(g.not_started.map((x) => x.id)).toEqual(['z', 'w', 'y', 'v', 'x']);
  });
  it('no modifica el arreglo original', () => {
    const src = [act({ id: 'b', name: 'B' }), act({ id: 'a', name: 'A' })];
    groupByStatus(src);
    expect(src.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('targetPercent', () => {
  it('a «Sin iniciar» → 0 y a «Terminada» → 100', () => {
    expect(targetPercent({ status: 'in_progress', duration: 3 }, 'not_started')).toBe(0);
    expect(targetPercent({ status: 'done', duration: 3 }, 'not_started')).toBe(0);
    expect(targetPercent({ status: 'not_started', duration: 3 }, 'done')).toBe(100);
    expect(targetPercent({ status: 'in_progress', duration: 3 }, 'done')).toBe(100);
  });
  it('a «En curso» → 1 desde «Sin iniciar» y 99 desde «Terminada»', () => {
    expect(targetPercent({ status: 'not_started', duration: 3 }, 'in_progress')).toBe(1);
    expect(targetPercent({ status: 'done', duration: 3 }, 'in_progress')).toBe(99);
  });
  it('mover a la misma columna no hace nada', () => {
    for (const s of ['not_started', 'in_progress', 'done']) expect(targetPercent({ status: s, duration: 3 }, s as never)).toBeNull();
  });
  it('un hito no tiene «En curso» pero sí 0 y 100', () => {
    expect(targetPercent({ status: 'not_started', duration: 0 }, 'in_progress')).toBeNull();
    expect(targetPercent({ status: 'done', duration: 0 }, 'in_progress')).toBeNull();
    expect(targetPercent({ status: 'not_started', duration: 0 }, 'done')).toBe(100);
    expect(targetPercent({ status: 'done', duration: 0 }, 'not_started')).toBe(0);
  });
  it('un estado desconocido se trata como «Sin iniciar»', () => {
    expect(targetPercent({ status: 'raro', duration: 3 }, 'in_progress')).toBe(1);
    expect(targetPercent({ status: 'raro', duration: 3 }, 'not_started')).toBeNull();
  });
});

describe('allowedMoves / parseMove / isStatus', () => {
  it('destinos posibles', () => {
    expect(allowedMoves({ status: 'not_started', duration: 3 })).toEqual(['in_progress', 'done']);
    expect(allowedMoves({ status: 'in_progress', duration: 3 })).toEqual(['not_started', 'done']);
    expect(allowedMoves({ status: 'done', duration: 3 })).toEqual(['not_started', 'in_progress']);
    expect(allowedMoves({ status: 'not_started', duration: 0 })).toEqual(['done']);
  });
  const U = '123e4567-e89b-42d3-a456-426614174000';
  const f = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  it('valida actividad y destino', () => {
    expect(parseMove(f({ activity: U, to: 'done' }))).toEqual({ ok: true, activityId: U, to: 'done' });
    expect(parseMove(f({ activity: 'x', to: 'done' }))).toEqual({ ok: false, error: 'invalid_move' });
    expect(parseMove(f({ activity: U, to: 'archivada' }))).toEqual({ ok: false, error: 'invalid_move' });
    expect(parseMove(f({ activity: U }))).toEqual({ ok: false, error: 'invalid_move' });
  });
  it('columnas y tipo', () => {
    expect(COLUMNS.map((c) => c.status)).toEqual(['not_started', 'in_progress', 'done']);
    expect(isStatus('done')).toBe(true); expect(isStatus('x')).toBe(false);
  });
});
