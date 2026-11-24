import { describe, expect, it } from 'vitest';
import { activityHref, flatten, likePattern, MAX_PROJECTS, MAX_QUERY, mergeProjects, moveActive, parseQuery, projectHref } from '@/lib/search';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

describe('parseQuery', () => {
  it('recorta y colapsa espacios', () => expect(parseQuery('  ERP   fase  1 ')).toBe('ERP fase 1'));
  it('exige al menos 2 caracteres', () => {
    expect(parseQuery('a')).toBeNull();
    expect(parseQuery(' a ')).toBeNull();
    expect(parseQuery('ab')).toBe('ab');
  });
  it('rechaza lo que no es texto', () => {
    expect(parseQuery(undefined)).toBeNull();
    expect(parseQuery(42)).toBeNull();
    expect(parseQuery(null)).toBeNull();
  });
  it('limita la longitud', () => expect(parseQuery('x'.repeat(500))!.length).toBe(MAX_QUERY));
  it('cambia caracteres de control por espacio', () => expect(parseQuery('ab\u0000\ncd')).toBe('ab cd'));
});

describe('likePattern', () => {
  it('envuelve en %', () => expect(likePattern('abc')).toBe('%abc%'));
  it('toma %, _ y \\ literalmente', () => expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%'));
});

describe('mergeProjects', () => {
  const p = (id: string, n = 'x') => ({ id, code: n, name: n });
  it('no repite y conserva el orden', () => expect(mergeProjects([p('a'), p('b')], [p('b'), p('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']));
  it('aplica el tope', () => {
    const many = Array.from({ length: 12 }, (_, i) => p(`id${i}`));
    expect(mergeProjects(many)).toHaveLength(MAX_PROJECTS);
  });
});

describe('destinos', () => {
  it('proyecto', () => expect(projectHref(U1)).toBe(`/projects/${U1}`));
  it('actividad abre su panel', () => expect(activityHref(U1, U2)).toBe(`/projects/${U1}?open=${U2}#dep-${U2}`));
  it('descarta ids que no son UUID (nada de inyectar rutas)', () => {
    expect(projectHref('../x')).toBeNull();
    expect(activityHref(U1, 'x?y')).toBeNull();
    expect(activityHref('a/b', U2)).toBeNull();
  });
});

describe('flatten y moveActive', () => {
  const r = { projects: [{ id: U1, code: 'P1', name: 'Proyecto' }, { id: 'malo', code: 'X', name: 'Roto' }], activities: [{ id: U2, name: 'Act', projectId: U1, projectName: 'Proyecto' }, { id: U3, name: 'Otra', projectId: 'malo', projectName: 'Roto' }] };
  it('proyectos primero, descarta destinos inválidos', () => {
    const f = flatten(r);
    expect(f.map((x) => x.key)).toEqual([`p-${U1}`, `a-${U2}`]);
    expect(f[0]).toMatchObject({ kind: 'project', label: 'Proyecto', detail: 'P1', href: `/projects/${U1}` });
    expect(f[1]).toMatchObject({ kind: 'activity', label: 'Act', detail: 'Proyecto', href: `/projects/${U1}?open=${U2}#dep-${U2}` });
  });
  it('flechas: desde ninguna, avanza o retrocede; da la vuelta', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(1, 1, 3)).toBe(2);
  });
  it('sin resultados no hay posición', () => expect(moveActive(0, 1, 0)).toBe(-1));
});
