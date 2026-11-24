import { beforeEach, describe, expect, it, vi } from 'vitest';

const P = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const state = { existing: [] as { day: string }[], inserted: [] as unknown[], insertError: null as null | { code: string; message: string }, deleted: [{ id: ROW }] as unknown[], deleteError: null as null | { code: string; message: string }, weekdays: [1, 2, 3, 4, 5] as number[] | null };

vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain,
        maybeSingle: async () => ({ data: t === 'projects' ? { organization_id: 'org-1' } : state.weekdays ? { working_weekdays: state.weekdays } : null }),
        insert: async (rows: unknown[]) => { state.inserted.push(...rows); return { error: state.insertError }; },
        delete: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: state.deleteError ? null : state.deleted, error: state.deleteError }) }) }) }),
        then: (res: (v: unknown) => void) => res({ data: state.existing, error: null }),
      });
      return q;
    },
  }),
}));

import { addDays, addSuggested, removeDay } from '@/app/projects/[id]/calendar/actions';

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function run(fn: (f: FormData) => Promise<void>, o: Record<string, string>) {
  try { await fn(fd(o)); } catch (e) { return String((e as Error).message).replace('REDIRECT:', ''); }
  return 'no-redirect';
}

beforeEach(() => { state.existing = []; state.inserted = []; state.insertError = null; state.deleted = [{ id: ROW }]; state.deleteError = null; state.weekdays = [1, 2, 3, 4, 5]; });

describe('addDays', () => {
  it('rango vie–lun: omite fin de semana y lo ya registrado, y guarda con la organización del proyecto', async () => {
    state.existing = [{ day: '2026-11-20' }];
    const url = await run(addDays, { project: P, start: '2026-11-20', end: '2026-11-23', kind: 'holiday', name: 'Feriado' });
    expect(state.inserted).toEqual([{ organization_id: 'org-1', project_id: P, day: '2026-11-23', kind: 'holiday', name: 'Feriado' }]);
    expect(url).toContain('added=1');
    expect(url).toContain('noeffect=2');
    expect(url).toContain('existing=1');
    expect(url).toContain('y=2026');
  });
  it('día trabajado excepcional: solo en días no laborables', async () => {
    await run(addDays, { project: P, start: '2026-11-21', end: '2026-11-23', kind: 'working', name: '' });
    expect(state.inserted).toEqual([
      { organization_id: 'org-1', project_id: P, day: '2026-11-21', kind: 'working', name: 'Día trabajado' },
      { organization_id: 'org-1', project_id: P, day: '2026-11-22', kind: 'working', name: 'Día trabajado' },
    ]);
  });
  it('sin semana definida usa lunes a viernes', async () => {
    state.weekdays = null;
    await run(addDays, { project: P, start: '2026-11-21', kind: 'holiday', name: 'x' });
    expect(state.inserted).toEqual([]);
  });
  it('datos inválidos no escriben y vuelven con error', async () => {
    for (const o of [{ start: '2026-02-30', kind: 'holiday', name: 'x' }, { start: '2026-03-02', kind: 'holiday', name: '' }, { start: '2026-03-02', kind: 'otro', name: 'x' }]) {
      expect(await run(addDays, { project: P, ...o })).toContain('error=invalid_day');
    }
    expect(state.inserted).toEqual([]);
  });
  it('proyecto con id inválido va a la lista y no escribe', async () => {
    expect(await run(addDays, { project: '../x', start: '2026-03-02', kind: 'holiday', name: 'x' })).toBe('/projects');
    expect(state.inserted).toEqual([]);
  });
  it('duplicado en carrera → duplicate_day; permiso → forbidden', async () => {
    state.insertError = { code: '23505', message: 'dup' };
    expect(await run(addDays, { project: P, start: '2026-03-02', kind: 'holiday', name: 'x' })).toContain('error=duplicate_day');
    state.insertError = { code: '42501', message: 'x' };
    expect(await run(addDays, { project: P, start: '2026-03-02', kind: 'holiday', name: 'x' })).toContain('error=forbidden');
    state.insertError = { code: 'P0001', message: 'project_read_only' };
    expect(await run(addDays, { project: P, start: '2026-03-02', kind: 'holiday', name: 'x' })).toContain('error=project_read_only');
  });
});

describe('addSuggested', () => {
  it('guarda las marcadas con la fecha y el nombre corregidos', async () => {
    const url = await run(addSuggested, { project: P, year: '2026', on_0: 'on', day_0: '2026-01-23', name_0: 'Estado Plurinacional', day_1: '2026-05-01', name_1: 'No marcado', on_2: 'on', day_2: '2026-05-01', name_2: 'Trabajo' });
    expect(state.inserted).toEqual([
      { organization_id: 'org-1', project_id: P, day: '2026-01-23', kind: 'holiday', name: 'Estado Plurinacional' },
      { organization_id: 'org-1', project_id: P, day: '2026-05-01', kind: 'holiday', name: 'Trabajo' },
    ]);
    expect(url).toContain('added=2');
  });
  it('nada marcado o fecha inválida → invalid_day', async () => {
    expect(await run(addSuggested, { project: P, year: '2026' })).toContain('error=invalid_day');
    expect(await run(addSuggested, { project: P, year: '2026', on_0: 'on', day_0: 'xx', name_0: 'a' })).toContain('error=invalid_day');
    expect(state.inserted).toEqual([]);
  });
});

describe('removeDay', () => {
  it('elimina y avisa', async () => expect(await run(removeDay, { project: P, id: ROW, year: '2026' })).toContain('removed=1'));
  it('si no se borró nada (sin permiso) → forbidden', async () => {
    state.deleted = [];
    expect(await run(removeDay, { project: P, id: ROW, year: '2026' })).toContain('error=forbidden');
  });
  it('ids inválidos no consultan', async () => expect(await run(removeDay, { project: P, id: 'x' })).toBe('/projects'));
});
