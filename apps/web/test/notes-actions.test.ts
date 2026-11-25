import { beforeEach, describe, expect, it, vi } from 'vitest';

const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const N = '33333333-3333-4333-8333-333333333333';
const state = { project: { organization_id: 'org-1' } as unknown, inserted: [] as unknown[], insertError: null as null | { code: string; message: string }, updateRows: [{ id: N }] as unknown[], updated: [] as unknown[], deleteRows: [{ id: N }] as unknown[], writeError: null as null | { code: string; message: string }, noteActivity: A as string | null };

vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      let mode = 'select';
      Object.assign(q, {
        select: (..._a: unknown[]) => (mode === 'select' ? q : Promise.resolve({ data: mode === 'update' ? state.updateRows : state.deleteRows, error: state.writeError })),
        eq: chain,
        maybeSingle: async () => ({ data: t === 'projects' ? state.project : state.noteActivity ? { activity_id: state.noteActivity } : null }),
        insert: async (row: unknown) => { state.inserted.push(row); return { error: state.insertError }; },
        update: (v: unknown) => { state.updated.push(v); mode = 'update'; return q; },
        delete: () => { mode = 'delete'; return q; },
      });
      return q;
    },
  }),
}));

import { addNote, deleteNote, editNote } from '@/app/projects/[id]/board/notes-actions';

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function run(fn: (f: FormData) => Promise<void>, o: Record<string, string>) {
  try { await fn(fd(o)); } catch (e) { return String((e as Error).message).replace('REDIRECT:', ''); }
  return 'no-redirect';
}

beforeEach(() => { state.project = { organization_id: 'org-1' }; state.inserted = []; state.insertError = null; state.updateRows = [{ id: N }]; state.updated = []; state.deleteRows = [{ id: N }]; state.writeError = null; state.noteActivity = A; });

describe('addNote', () => {
  it('guarda con la organización del proyecto y vuelve a la tarjeta con las notas abiertas', async () => {
    const url = await run(addNote, { project: P, activity: A, body: '  Revisar  ' });
    expect(state.inserted).toEqual([{ organization_id: 'org-1', project_id: P, activity_id: A, body: 'Revisar' }]);
    expect(url).toBe(`/projects/${P}/board?notes=${A}#card-${A}`);
  });
  it('texto vacío o demasiado largo: no escribe y avisa', async () => {
    expect(await run(addNote, { project: P, activity: A, body: '   ' })).toContain('error=invalid_note');
    expect(await run(addNote, { project: P, activity: A, body: 'x'.repeat(2001) })).toContain('error=invalid_note');
    expect(state.inserted).toEqual([]);
  });
  it('proyecto o actividad inválidos', async () => {
    expect(await run(addNote, { project: '../x', activity: A, body: 'a' })).toBe('/projects');
    expect(await run(addNote, { project: P, activity: 'zz', body: 'a' })).toContain('error=invalid_note');
    expect(state.inserted).toEqual([]);
  });
  it('sin permiso o proyecto cerrado → forbidden', async () => {
    state.insertError = { code: '42501', message: 'rls' };
    expect(await run(addNote, { project: P, activity: A, body: 'a' })).toContain('error=forbidden');
  });
  it('proyecto que no se ve → lista de proyectos', async () => {
    state.project = null;
    expect(await run(addNote, { project: P, activity: A, body: 'a' })).toBe('/projects');
  });
});

describe('editNote', () => {
  it('cambia solo el texto y vuelve a la actividad de la nota', async () => {
    const url = await run(editNote, { project: P, note: N, activity: A, body: ' nuevo ' });
    expect(state.updated).toEqual([{ body: 'nuevo' }]);
    expect(url).toBe(`/projects/${P}/board?notes=${A}#card-${A}`);
  });
  it('si no cambió ninguna fila (no es suya o proyecto cerrado) → forbidden', async () => {
    state.updateRows = [];
    expect(await run(editNote, { project: P, note: N, body: 'a' })).toContain('error=forbidden');
  });
  it('texto vacío no escribe', async () => {
    expect(await run(editNote, { project: P, note: N, body: '' })).toContain('error=invalid_note');
    expect(state.updated).toEqual([]);
  });
  it('error de base de datos se traduce', async () => {
    state.writeError = { code: '42501', message: 'x' };
    expect(await run(editNote, { project: P, note: N, body: 'a' })).toContain('error=forbidden');
  });
});

describe('deleteNote', () => {
  it('borra y avisa si no había nada', async () => {
    expect(await run(deleteNote, { project: P, note: N })).toBe(`/projects/${P}/board?notes=${A}#card-${A}`);
    state.deleteRows = [];
    expect(await run(deleteNote, { project: P, note: N })).toContain('error=forbidden');
  });
  it('id de nota inválido', async () => expect(await run(deleteNote, { project: P, note: 'x' })).toContain('error=invalid_note'));
});
