import { describe, expect, it } from 'vitest';
import { parseActivityEdit } from '@/lib/activity-edit';

const A = '11111111-1111-4111-8111-111111111111', N = '22222222-2222-4222-8222-222222222222';
const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });

describe('parseActivityEdit', () => {
  it('válido con nodo', () => expect(parseActivityEdit(form({ activity: A, name: '  Análisis ', duration: '3', node: N }))).toEqual({ ok: true, activityId: A, name: 'Análisis', duration: 3, nodeId: N }));
  it('sin nodo → null (quitar de la WBS)', () => expect(parseActivityEdit(form({ activity: A, name: 'x', duration: '0', node: '' }))).toMatchObject({ ok: true, nodeId: null, duration: 0 }));
  it('rechaza id, nombre, duración y nodo inválidos', () => {
    for (const o of <Record<string, string>[]>[{ activity: 'x', name: 'a', duration: '1' }, { activity: A, name: '  ', duration: '1' }, { activity: A, name: 'a'.repeat(201), duration: '1' },
      { activity: A, name: 'a', duration: '' }, { activity: A, name: 'a', duration: '-1' }, { activity: A, name: 'a', duration: '1.5' }, { activity: A, name: 'a', duration: '36501' },
      { activity: A, name: 'a', duration: '1', node: 'zzz' }]) expect(parseActivityEdit(form(o))).toEqual({ ok: false, error: 'invalid_value' });
  });
});
