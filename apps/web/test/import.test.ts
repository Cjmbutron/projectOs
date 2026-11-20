import { describe, expect, it } from 'vitest';
import { parseActivitiesCsv, parseCsvText, parsePredecessors } from '@/lib/import/csv';
import { handleImport, type ImportDeps } from '@/lib/import/import-handler';

const ok = (csv: string) => { const r = parseActivitiesCsv(csv); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.rows; };
const bad = (csv: string) => { const r = parseActivitiesCsv(csv); if (r.ok) throw new Error('debía fallar'); return r.errors; };

describe('parseCsvText', () => {
  it('comillas, comillas escapadas, saltos dentro de celda y CRLF', () => {
    expect(parseCsvText('a,b\r\n"x, y","di ""hola""\nlínea"\r\n')).toEqual([['a', 'b'], ['x, y', 'di "hola"\nlínea']]);
  });
  it('detecta ; como delimitador y quita BOM', () => {
    expect(parseCsvText('﻿id;nombre\n1;Uno')).toEqual([['id', 'nombre'], ['1', 'Uno']]);
  });
  it('comillas sin cerrar → error', () => {
    expect(parseCsvText('a,b\n"x,y')).toEqual({ error: 'Hay unas comillas sin cerrar.' });
  });
  it('ignora líneas vacías', () => {
    expect(parseCsvText('a,b\n\n1,2\n,\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('separadores', () => {
  it('archivo con ; y predecesoras separadas por |', () => {
    expect(ok('id;nombre;duracion;predecesoras\n1;A;1;\n2;B;1;1\n3;C;1;1|2SS+1')[2].predecessors).toHaveLength(2);
  });
  it('predecesoras con ; dentro de un archivo con ; → error claro, no pérdida silenciosa', () => {
    const e = bad('id;nombre;duracion;predecesoras\n1;A;1;\n2;B;1;\n3;C;1;1;2');
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/más columnas/);
  });
});

describe('parsePredecessors', () => {
  it('tipos y desfases estilo MS Project', () => {
    expect(parsePredecessors('1;3SS+2;4ff-1')).toEqual({ ok: true, value: [
      { ref: '1', type: 'FS', lag: 0 }, { ref: '3', type: 'SS', lag: 2 }, { ref: '4', type: 'FF', lag: -1 }] });
    expect(parsePredecessors('')).toEqual({ ok: true, value: [] });
  });
});

describe('parseActivitiesCsv', () => {
  it('archivo válido con encabezados en español y tildes', () => {
    const rows = ok('ID,Nombre,Duración,Predecesoras\n1,Análisis,3,\n2,Desarrollo,5,1\n3,Hito,0,2FS+1;1SS');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ ref: '3', name: 'Hito', duration: 0, predecessors: [{ ref: '2', type: 'FS', lag: 1 }, { ref: '1', type: 'SS', lag: 0 }] });
  });
  it('la columna de predecesoras es opcional', () => {
    expect(ok('id;nombre;dias\n1;A;2')).toHaveLength(1);
  });
  it('faltan columnas obligatorias', () => {
    expect(bad('id,nombre\n1,A')[0].message).toMatch(/duracion/);
  });
  it('reporta todos los errores con su línea', () => {
    const e = bad('id,nombre,duracion,predecesoras\n1,A,x,\n1,B,2,\n3,,1,9\n4,D,-2,');
    expect(e.map((x) => x.line)).toEqual(expect.arrayContaining([2, 3, 4, 5]));
    expect(e.some((x) => /repetido/.test(x.message))).toBe(true);
    expect(e.some((x) => /no existe/.test(x.message))).toBe(true);
  });
  it('rechaza duración decimal, texto o excesiva', () => {
    for (const d of ['1.5', '3d', '36501', '-1', '']) expect(bad(`id,nombre,duracion\n1,A,${d}`)).toHaveLength(1);
  });
  it('autodependencia', () => {
    expect(bad('id,nombre,duracion,predecesoras\n1,A,1,1')[0].message).toMatch(/sí misma/);
  });
  it('límites: sin filas, más de 1000, más de 1 MB', () => {
    expect(bad('id,nombre,duracion')[0].message).toMatch(/al menos una/);
    const many = 'id,nombre,duracion\n' + Array.from({ length: 1001 }, (_, i) => `${i},N,1`).join('\n');
    expect(bad(many)[0].message).toMatch(/1000/);
    expect(bad('x'.repeat(1_000_001))[0].message).toMatch(/1 MB/);
  });
  it('exactamente 1000 filas es válido', () => {
    expect(ok('id,nombre,duracion\n' + Array.from({ length: 1000 }, (_, i) => `${i},N,1`).join('\n'))).toHaveLength(1000);
  });
  it('limita el número de errores devueltos', () => {
    expect(bad('id,nombre,duracion\n' + Array.from({ length: 200 }, () => ',,x').join('\n')).length).toBeLessThanOrEqual(50);
  });
  it('un nombre que parece fórmula se conserva como texto (no se interpreta)', () => {
    expect(ok('id,nombre,duracion\n1,=HYPERLINK("x"),1')[0].name).toBe('=HYPERLINK("x")');
  });
});

describe('handleImport', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const CSV = 'id,nombre,duracion\n1,A,2';
  const mk = (over: Partial<ImportDeps> = {}) => {
    const calls: string[] = [];
    const deps: ImportDeps = {
      getUserId: async () => 'u',
      importRows: async () => { calls.push('import'); return { ok: true, activities: 1, dependencies: 0 }; },
      ...over,
    };
    return { deps, calls };
  };
  it('éxito', async () => {
    expect(await handleImport(mk().deps, P, { csv: CSV })).toEqual({ status: 200, body: { activities: 1, dependencies: 0 } });
  });
  it('id o cuerpo inválidos → 400 sin tocar la base', async () => {
    const { deps, calls } = mk();
    expect((await handleImport(deps, 'x', { csv: CSV })).status).toBe(400);
    expect((await handleImport(deps, P, { csv: 5 })).status).toBe(400);
    expect((await handleImport(deps, P, null)).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('sin sesión → 401', async () => {
    const { deps, calls } = mk({ getUserId: async () => null });
    expect((await handleImport(deps, P, { csv: CSV })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it('archivo inválido → 422 con errores y SIN llamar a la base', async () => {
    const { deps, calls } = mk();
    const r = await handleImport(deps, P, { csv: 'id,nombre,duracion\n1,A,x' });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('invalid_file');
    expect(calls).toEqual([]);
  });
  it('traduce errores de la base', async () => {
    const cases: [string, number, string][] = [['forbidden', 403, 'forbidden'], ['dependency_cycle', 422, 'dependency_cycle'], ['import_invalid', 422, 'invalid_file'], ['otro', 500, 'internal_error']];
    for (const [code, status, err] of cases) {
      const r = await handleImport(mk({ importRows: async () => ({ ok: false, code }) }).deps, P, { csv: CSV });
      expect([r.status, r.body.error]).toEqual([status, err]);
    }
  });
});
