import { describe, expect, it } from 'vitest';
import { depthOf, indentTarget, orderNodes, outdentTarget, reorderTarget, scopeErrorCode, type WbsNode } from '@/lib/scope/wbs';

const n = (id: string, parent: string | null, position: number, code: string): WbsNode => ({ id, parent_id: parent, position, code, name: id });
const tree = [n('a', null, 1, '1'), n('b', null, 2, '2'), n('b1', 'b', 1, '2.1'), n('b2', 'b', 2, '2.2'), n('c', null, 3, '3')];

describe('orderNodes / depthOf', () => {
  it('orden numérico, no alfabético', () => {
    const codes = orderNodes([{ code: '10' }, { code: '2' }, { code: '1.10' }, { code: '1.2' }, { code: '1' }]).map((x) => x.code);
    expect(codes).toEqual(['1', '1.2', '1.10', '2', '10']);
  });
  it('profundidad', () => { expect(depthOf('1')).toBe(0); expect(depthOf('2.1.3')).toBe(2); });
});

describe('reorderTarget', () => {
  it('subir', () => expect(reorderTarget(tree, 'b', 'up')).toEqual({ parent: null, position: 1 }));
  it('bajar deja el nodo después de su hermano siguiente', () => expect(reorderTarget(tree, 'a', 'down')).toEqual({ parent: null, position: 3 }));
  it('extremos → null', () => {
    expect(reorderTarget(tree, 'a', 'up')).toBeNull();
    expect(reorderTarget(tree, 'c', 'down')).toBeNull();
    expect(reorderTarget(tree, 'zzz', 'up')).toBeNull();
  });
  it('dentro de un padre', () => expect(reorderTarget(tree, 'b2', 'up')).toEqual({ parent: 'b', position: 1 }));
});

describe('indent / outdent', () => {
  it('sangrar bajo el hermano anterior', () => expect(indentTarget(tree, 'b')).toEqual({ parent: 'a', position: 0 }));
  it('el primero no se sangra', () => expect(indentTarget(tree, 'a')).toBeNull());
  it('quitar sangría: hermano siguiente del padre', () => expect(outdentTarget(tree, 'b1')).toEqual({ parent: null, position: 3 }));
  it('la raíz no se desangra', () => expect(outdentTarget(tree, 'a')).toBeNull());
});

describe('scopeErrorCode', () => {
  it('reconoce los códigos de la base de datos', () => {
    expect(scopeErrorCode({ message: 'wbs_has_children' })).toBe('wbs_has_children');
    expect(scopeErrorCode({ message: 'forbidden\nDETAIL' })).toBe('forbidden');
    expect(scopeErrorCode({ message: 'x', code: '42501' })).toBe('forbidden');
    expect(scopeErrorCode({ message: 'x', code: '23514' })).toBe('invalid_value');
    expect(scopeErrorCode({ message: 'requirement_needs_deliverable' })).toBe('requirement_needs_deliverable');
    expect(scopeErrorCode({ message: 'x', code: '23505' })).toBe('duplicate_link');
    expect(scopeErrorCode({ message: 'password=secreto' })).toBe('unknown');
    expect(scopeErrorCode(null)).toBe('');
  });
});
