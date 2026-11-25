import { describe, expect, it } from 'vitest';
import { canAddNote, formatNoteDate, groupNotes, MAX_NOTE, noteRights, parseNoteBody, parseNoteForm, wasEdited, type NoteContext } from '@/lib/notes';

const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const N = '33333333-3333-4333-8333-333333333333';

describe('parseNoteBody', () => {
  it('recorta y normaliza saltos de línea', () => expect(parseNoteBody('  hola\r\nmundo  ')).toBe('hola\nmundo'));
  it('vacío, en blanco o no texto → null', () => {
    for (const v of ['', '   ', '\n\t ', null, undefined, 5]) expect(parseNoteBody(v)).toBeNull();
  });
  it('hasta 2000 caracteres (cuenta caracteres, no unidades UTF-16)', () => {
    expect(parseNoteBody('x'.repeat(MAX_NOTE))).not.toBeNull();
    expect(parseNoteBody('x'.repeat(MAX_NOTE + 1))).toBeNull();
    expect(parseNoteBody('😀'.repeat(MAX_NOTE))).not.toBeNull();
    expect(parseNoteBody('😀'.repeat(MAX_NOTE + 1))).toBeNull();
  });
});

describe('groupNotes y wasEdited', () => {
  const r = (id: string, act: string, at: string) => ({ id, activity_id: act, author_id: null, body: id, created_at: at, updated_at: at });
  it('agrupa por actividad, la más antigua primero', () => {
    const g = groupNotes([r('b', 'x', '2026-11-25T12:00:00Z'), r('a', 'x', '2026-11-25T10:00:00Z'), r('c', 'y', '2026-11-25T09:00:00Z')]);
    expect(g.get('x')?.map((n) => n.id)).toEqual(['a', 'b']);
    expect(g.get('y')?.map((n) => n.id)).toEqual(['c']);
  });
  it('desempata por id y no repite el arreglo original', () => {
    const rows = [r('b', 'x', '2026-11-25T10:00:00Z'), r('a', 'x', '2026-11-25T10:00:00Z')];
    expect(groupNotes(rows).get('x')?.map((n) => n.id)).toEqual(['a', 'b']);
    expect(rows[0].id).toBe('b');
  });
  it('editada: más de un segundo después', () => {
    expect(wasEdited('2026-11-25T10:00:00Z', '2026-11-25T10:00:00Z')).toBe(false);
    expect(wasEdited('2026-11-25T10:00:00Z', '2026-11-25T10:00:01Z')).toBe(false);
    expect(wasEdited('2026-11-25T10:00:00Z', '2026-11-25T10:00:02Z')).toBe(true);
  });
});

describe('formatNoteDate', () => {
  it('en la zona horaria pedida', () => {
    expect(formatNoteDate('2026-11-25T18:30:00Z', 'America/La_Paz')).toBe('25 nov, 14:30');
    expect(formatNoteDate('2026-12-01T02:05:00Z', 'America/La_Paz')).toBe('30 nov, 22:05');
    expect(formatNoteDate('2026-01-05T04:00:00Z', 'America/La_Paz')).toBe('5 ene, 00:00');
  });
  it('fecha inválida → vacío', () => expect(formatNoteDate('no', 'America/La_Paz')).toBe(''));
});

describe('permisos de la interfaz', () => {
  const base: NoteContext = { me: 'u1', canWrite: true, canModerate: false, writable: true };
  it('el autor edita y borra la suya', () => expect(noteRights('u1', base)).toEqual({ canEdit: true, canDelete: true }));
  it('no edita ni borra la de otro', () => expect(noteRights('u2', base)).toEqual({ canEdit: false, canDelete: false }));
  it('quien modera borra la ajena pero no la edita', () => expect(noteRights('u2', { ...base, canModerate: true })).toEqual({ canEdit: false, canDelete: true }));
  it('sin permiso de escritura no hay nada, ni lo propio', () => expect(noteRights('u1', { ...base, canWrite: false })).toEqual({ canEdit: false, canDelete: false }));
  it('proyecto cerrado: nada, ni moderando', () => expect(noteRights('u1', { ...base, writable: false, canModerate: true })).toEqual({ canEdit: false, canDelete: false }));
  it('sin sesión ni autor: no es mío', () => expect(noteRights(null, { ...base, me: null })).toEqual({ canEdit: false, canDelete: false }));
  it('agregar exige permiso y proyecto abierto', () => {
    expect(canAddNote(base)).toBe(true);
    expect(canAddNote({ ...base, canWrite: false })).toBe(false);
    expect(canAddNote({ ...base, writable: false })).toBe(false);
  });
});

describe('parseNoteForm', () => {
  const f = (o: Record<string, string>) => (k: string) => o[k];
  it('agregar', () => expect(parseNoteForm('add', f({ project: P, activity: A, body: ' hola ' }))).toEqual({ kind: 'add', project: P, activity: A, body: 'hola' }));
  it('editar', () => expect(parseNoteForm('edit', f({ project: P, note: N, body: 'x' }))).toEqual({ kind: 'edit', project: P, note: N, body: 'x' }));
  it('borrar no necesita texto', () => expect(parseNoteForm('delete', f({ project: P, note: N }))).toEqual({ kind: 'delete', project: P, note: N }));
  it('rechaza ids inválidos y textos vacíos', () => {
    expect(parseNoteForm('add', f({ project: 'x', activity: A, body: 'a' }))).toBeNull();
    expect(parseNoteForm('add', f({ project: P, activity: '../', body: 'a' }))).toBeNull();
    expect(parseNoteForm('add', f({ project: P, activity: A, body: '  ' }))).toBeNull();
    expect(parseNoteForm('edit', f({ project: P, note: N, body: '' }))).toBeNull();
    expect(parseNoteForm('edit', f({ project: P, note: 'x', body: 'a' }))).toBeNull();
    expect(parseNoteForm('delete', f({ project: P, note: 'x' }))).toBeNull();
  });
});
