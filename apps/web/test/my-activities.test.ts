import { describe, expect, it } from 'vitest';
import { deadlineState, groupByProject, sortByDue } from '@/lib/my-activities';

describe('deadlineState', () => {
  const today = '2026-03-10';
  it('terminada gana a cualquier fecha', () => { expect(deadlineState('2026-01-01', 'done', today)).toBe('done'); });
  it('vencida si el fin es anterior a hoy; hoy no está vencida', () => {
    expect(deadlineState('2026-03-09', 'in_progress', today)).toBe('overdue');
    expect(deadlineState('2026-03-10', 'not_started', today)).toBe('due_soon');
  });
  it('vence pronto hasta 3 días corridos inclusive; después, en plazo', () => {
    expect(deadlineState('2026-03-13', 'not_started', today)).toBe('due_soon');
    expect(deadlineState('2026-03-14', 'not_started', today)).toBe('ok');
    expect(deadlineState('2026-03-14', 'not_started', today, 4)).toBe('due_soon');
  });
  it('sin fecha o fecha inválida: sin fechas', () => {
    expect(deadlineState(null, 'not_started', today)).toBe('unscheduled');
    expect(deadlineState('2026-02-30', 'not_started', today)).toBe('unscheduled');
    expect(deadlineState('2026-03-10', 'not_started', 'hoy')).toBe('unscheduled');
  });
});

describe('sortByDue / groupByProject', () => {
  it('ordena por fin, sin fechas al final y por nombre en empate', () => {
    const rows = [
      { name: 'C', early_finish: null }, { name: 'B', early_finish: '2026-03-05' },
      { name: 'A', early_finish: '2026-03-05' }, { name: 'Z', early_finish: '2026-03-01' }, { name: 'D', early_finish: null },
    ];
    expect(sortByDue(rows).map((r) => r.name)).toEqual(['Z', 'A', 'B', 'C', 'D']);
    expect(rows[0].name).toBe('C'); // no muta la entrada
  });
  it('agrupa conservando el orden dentro de cada proyecto', () => {
    const g = groupByProject([{ project_id: 'p1', n: 1 }, { project_id: 'p2', n: 2 }, { project_id: 'p1', n: 3 }]);
    expect([...g.keys()]).toEqual(['p1', 'p2']);
    expect(g.get('p1')!.map((r) => r.n)).toEqual([1, 3]);
  });
});
