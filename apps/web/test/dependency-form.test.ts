import { describe, expect, it } from 'vitest';
import { parseDependencyForm } from '@/lib/schedule/dependency-form';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] });

describe('parseDependencyForm', () => {
  it('válida con valores por defecto', () => {
    expect(parseDependencyForm(form({ predecessor: A, successor: B }))).toEqual({ ok: true, predecessorId: A, successorId: B, type: 'FS', lag: 0 });
  });
  it('tipo en minúsculas y desfase negativo', () => {
    expect(parseDependencyForm(form({ predecessor: A, successor: B, type: 'ss', lag: '-2' }))).toMatchObject({ ok: true, type: 'SS', lag: -2 });
  });
  it('rechaza lo inválido', () => {
    const cases: Record<string, string>[] = [
      { predecessor: A, successor: A },
      { predecessor: 'x', successor: B },
      { predecessor: A, successor: B, type: 'XX' },
      { predecessor: A, successor: B, lag: '1.5' },
      { predecessor: A, successor: B, lag: '99999' },
      { predecessor: A, successor: B, lag: 'abc' },
    ];
    for (const c of cases) expect(parseDependencyForm(form(c)).ok).toBe(false);
  });
});
