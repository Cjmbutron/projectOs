import { describe, expect, it } from 'vitest';
import { compareCodes, groupActivities, sortByDate } from '@/lib/activity-groups';

const a = (id: string, node: string | null, s: string | null, f: string | null = s) => ({ id, wbs_node_id: node, early_start: s, early_finish: f });

describe('compareCodes', () => {
  it('compara segmento a segmento como número', () => {
    expect(['1.10', '1.2', '1', '2', '1.2.1', '1.9'].sort(compareCodes)).toEqual(['1', '1.2', '1.2.1', '1.9', '1.10', '2']);
  });
  it('códigos no numéricos al final', () => expect(['?', '1', '10'].sort(compareCodes)).toEqual(['1', '10', '?']));
  it('iguales → 0', () => expect(compareCodes('1.2', '1.2')).toBe(0));
});

describe('sortByDate', () => {
  it('por inicio, luego fin, luego orden original; sin fechas al final', () => {
    const r = sortByDate([a('sin', null, null), a('c', null, '2026-11-25', '2026-11-30'), a('a', null, '2026-11-23'), a('b', null, '2026-11-25', '2026-11-26'), a('d', null, '2026-11-25', '2026-11-26')]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'd', 'c', 'sin']);
  });
  it('no modifica el arreglo original', () => {
    const src = [a('x', null, '2026-12-01'), a('y', null, '2026-11-01')];
    sortByDate(src);
    expect(src[0].id).toBe('x');
  });
});

describe('groupActivities', () => {
  const nodes = [{ id: 'n10', code: '1.10', name: 'Diez' }, { id: 'n2', code: '1.2', name: 'Dos' }, { id: 'n1', code: '1', name: 'Uno' }];
  it('un grupo por nodo con actividades, en orden de código, y «sin grupo» al final', () => {
    const g = groupActivities([a('a1', 'n10', '2026-11-23'), a('a2', null, '2026-11-20'), a('a3', 'n2', '2026-11-25'), a('a4', 'n2', '2026-11-24'), a('a5', 'nX', '2026-11-22')], nodes);
    expect(g.map((x) => x.key)).toEqual(['n2', 'n10', 'none']);
    expect(g[0].items.map((x) => x.id)).toEqual(['a4', 'a3']);
    expect(g[2]).toMatchObject({ nodeId: null, code: null, name: 'Sin grupo de la WBS' });
    expect(g[2].items.map((x) => x.id)).toEqual(['a2', 'a5']); // un nodo desconocido cuenta como sin grupo
  });
  it('sin actividades sin grupo no hay grupo «sin grupo»', () => expect(groupActivities([a('a', 'n1', null)], nodes).map((x) => x.key)).toEqual(['n1']));
  it('sin actividades, sin grupos', () => expect(groupActivities([], nodes)).toEqual([]));
  it('mismo código: por nombre', () => {
    const g = groupActivities([a('p', 'b', null), a('q', 'a', null)], [{ id: 'a', code: '1', name: 'Zeta' }, { id: 'b', code: '1', name: 'Alfa' }]);
    expect(g.map((x) => x.name)).toEqual(['Alfa', 'Zeta']);
  });
});
