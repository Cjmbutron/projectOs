import { describe, expect, it } from 'vitest';
import { buildCells, cellFromRoles, isCellValue, parseRowForm, rolesOfCell, rowStatus, summarize, type CellValue } from '@/lib/raci';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('valores de celda', () => {
  it('reconoce solo los seis valores', () => {
    for (const v of ['', 'R', 'A', 'AR', 'C', 'I']) expect(isCellValue(v)).toBe(true);
    for (const v of ['RA', 'r', 'X', 'CI', 'AC', null, undefined, 1]) expect(isCellValue(v)).toBe(false);
  });
  it('letras guardadas → valor, sin importar el orden', () => {
    expect(cellFromRoles([])).toBe('');
    expect(cellFromRoles(['R', 'A'])).toBe('AR');
    expect(cellFromRoles(['A', 'R'])).toBe('AR');
    expect(cellFromRoles(['C'])).toBe('C');
    expect(cellFromRoles(['R', 'R'])).toBe('R');
    expect(cellFromRoles(['C', 'I'])).toBeNull();
    expect(cellFromRoles(['X'])).toBeNull();
  });
  it('valor → letras que recibe la base de datos', () => {
    expect(rolesOfCell('')).toEqual([]);
    expect(rolesOfCell('AR')).toEqual(['A', 'R']);
    expect(rolesOfCell('I')).toEqual(['I']);
  });
});

describe('buildCells y rowStatus', () => {
  const cells = buildCells([
    { deliverable_id: D1, user_id: U1, role: 'R' }, { deliverable_id: D1, user_id: U1, role: 'A' },
    { deliverable_id: D1, user_id: U2, role: 'C' },
    { deliverable_id: D2, user_id: U2, role: 'R' },
    { deliverable_id: D2, user_id: U3, role: 'C' }, { deliverable_id: D2, user_id: U3, role: 'I' },
  ]);
  it('une las letras de una persona en una celda', () => expect(cells.get(D1)?.get(U1)).toBe('AR'));
  it('ignora combinaciones imposibles', () => expect(cells.get(D2)?.has(U3)).toBe(false));
  it('completa con R y A (también en una sola persona)', () => expect(rowStatus(cells.get(D1))).toEqual({ hasR: true, hasA: true, complete: true, label: 'Completa' }));
  it('indica qué falta', () => {
    expect(rowStatus(cells.get(D2))).toMatchObject({ hasR: true, hasA: false, complete: false, label: 'Falta A' });
    expect(rowStatus(new Map([[U1, 'A' as CellValue]]))).toMatchObject({ hasR: false, hasA: true, label: 'Falta R' });
    expect(rowStatus(new Map([[U1, 'C' as CellValue]]))).toMatchObject({ complete: false, label: 'Falta R y A' });
    expect(rowStatus(undefined)).toMatchObject({ complete: false, label: 'Falta R y A' });
  });
  it('resumen de entregables completos', () => expect(summarize([D1, D2, 'otro'], cells)).toEqual({ total: 3, complete: 1 }));
});

describe('parseRowForm', () => {
  const f = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  it('solo devuelve lo que cambió', () => {
    expect(parseRowForm(f({ [`cell_${U1}`]: 'R', [`orig_${U1}`]: 'R', [`cell_${U2}`]: 'C', [`orig_${U2}`]: '' }), [U1, U2])).toEqual([{ userId: U2, from: '', to: 'C' }]);
  });
  it('sin cambios, lista vacía', () => expect(parseRowForm(f({ [`cell_${U1}`]: '', [`orig_${U1}`]: '' }), [U1])).toEqual([]));
  it('pasar el A de una persona a otra: primero se le quita al que lo deja', () => {
    const r = parseRowForm(f({ [`cell_${U1}`]: 'C', [`orig_${U1}`]: 'A', [`cell_${U2}`]: 'A', [`orig_${U2}`]: '' }), [U2, U1]);
    expect(r?.map((c) => c.userId)).toEqual([U1, U2]);
  });
  it('de A a A/R no cuenta como quitar el A: conserva el orden del formulario', () => {
    const r = parseRowForm(f({ [`cell_${U2}`]: 'R', [`orig_${U2}`]: '', [`cell_${U1}`]: 'AR', [`orig_${U1}`]: 'A' }), [U2, U1]);
    expect(r?.map((c) => c.userId)).toEqual([U2, U1]);
  });
  it('valores inválidos o ids que no son UUID invalidan todo', () => {
    expect(parseRowForm(f({ [`cell_${U1}`]: 'RA', [`orig_${U1}`]: '' }), [U1])).toBeNull();
    expect(parseRowForm(f({ [`cell_${U1}`]: 'R', [`orig_${U1}`]: 'basura' }), [U1])).toBeNull();
    expect(parseRowForm(f({ cell_x: 'R', orig_x: '' }), ['x'])).toBeNull();
  });
  it('un miembro que no vino en el formulario se salta', () => expect(parseRowForm(f({}), [U1])).toEqual([]));
});
