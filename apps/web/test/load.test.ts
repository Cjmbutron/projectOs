import { describe, expect, it } from 'vitest';
import { buildGrid, cellLabel, mondayOf, parseLoadParams, shortDate, weekStarts } from '@/lib/load';

describe('mondayOf', () => {
  it('cada día de la semana vuelve al lunes', () => {
    expect(mondayOf('2026-03-02')).toBe('2026-03-02'); // lunes
    expect(mondayOf('2026-03-04')).toBe('2026-03-02'); // miércoles
    expect(mondayOf('2026-03-08')).toBe('2026-03-02'); // domingo
    expect(mondayOf('2026-03-09')).toBe('2026-03-09');
    expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // cruza de año
  });
  it('rechaza fechas inválidas', () => { expect(() => mondayOf('x')).toThrow(); });
});

describe('parseLoadParams', () => {
  const today = '2026-03-05';
  it('por defecto: semana actual y 8 semanas', () => {
    expect(parseLoadParams({}, today)).toEqual({ from: '2026-03-02', weeks: 8, to: '2026-04-26' });
  });
  it('usa from válido (ajustado al lunes) y weeks entre 1 y 26', () => {
    expect(parseLoadParams({ from: '2026-06-10', weeks: '4' }, today)).toEqual({ from: '2026-06-08', weeks: 4, to: '2026-07-05' });
    expect(parseLoadParams({ weeks: '1' }, today).weeks).toBe(1);
    expect(parseLoadParams({ weeks: '26' }, today).weeks).toBe(26);
  });
  it('valores inválidos vuelven a los predeterminados', () => {
    expect(parseLoadParams({ from: '2026-02-30' }, today).from).toBe('2026-03-02');
    for (const w of ['0', '27', '-3', 'x', '3.5', '']) expect(parseLoadParams({ weeks: w }, today).weeks, w).toBe(8);
  });
});

describe('weekStarts', () => {
  it('lunes consecutivos', () => {
    expect(weekStarts('2026-03-02', 3)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });
});

describe('buildGrid', () => {
  const res = [
    { id: 'b', name: 'Beto', active: true }, { id: 'a', name: 'Ana', active: true },
    { id: 'z', name: 'Zeta inactivo sin carga', active: false }, { id: 'y', name: 'Yara inactiva con carga', active: false },
  ];
  const weeks = ['2026-03-02', '2026-03-09'];
  const rows = [
    { resource_id: 'a', week_start: '2026-03-02', hours: 60, capacity_hours: 40, overallocated: true },
    { resource_id: 'a', week_start: '2026-03-09', hours: 20, capacity_hours: 40, overallocated: false },
    { resource_id: 'y', week_start: '2026-03-09', hours: 8, capacity_hours: 40, overallocated: false },
  ];
  it('ordena por nombre, oculta inactivos sin carga y mantiene a los inactivos con carga', () => {
    const g = buildGrid(res, rows, weeks);
    expect(g.rows.map((r) => r.resource.id)).toEqual(['a', 'b', 'y']);
  });
  it('celdas por semana, nulas sin carga, con porcentaje redondeado', () => {
    const g = buildGrid(res, rows, weeks);
    expect(g.rows[0].cells).toEqual([{ hours: 60, capacity: 40, over: true, pct: 150 }, { hours: 20, capacity: 40, over: false, pct: 50 }]);
    expect(g.rows[1].cells).toEqual([null, null]);
    expect(g.rows[2].cells[0]).toBeNull();
  });
  it('cuenta semanas sobreasignadas por recurso y en total', () => {
    const g = buildGrid(res, rows, weeks);
    expect(g.rows[0].overWeeks).toBe(1);
    expect(g.overCells).toBe(1);
  });
  it('ignora semanas fuera de la rejilla y acepta números como texto', () => {
    const g = buildGrid(res, [{ resource_id: 'a', week_start: '2026-03-16', hours: 99, capacity_hours: 40, overallocated: true }, { resource_id: 'a', week_start: '2026-03-02', hours: '12.5' as unknown as number, capacity_hours: '40' as unknown as number, overallocated: false }], weeks);
    expect(g.rows[0].cells[0]).toEqual({ hours: 12.5, capacity: 40, over: false, pct: 31 });
    expect(g.overCells).toBe(0);
  });
  it('redondea al entero más cercano y respeta la bandera de la base de datos', () => {
    const g = buildGrid([res[1]], [{ resource_id: 'a', week_start: '2026-03-02', hours: 27, capacity_hours: 40, overallocated: false }, { resource_id: 'a', week_start: '2026-03-09', hours: 41, capacity_hours: 40, overallocated: false }], weeks);
    expect(g.rows[0].cells[0]!.pct).toBe(68); // 67,5 → 68
    expect(g.rows[0].cells[1]!.over).toBe(false); // la decisión es de la BD, no se recalcula
  });
  it('capacidad 0 no divide por cero', () => {
    const g = buildGrid([res[1]], [{ resource_id: 'a', week_start: '2026-03-02', hours: 5, capacity_hours: 0, overallocated: true }], weeks);
    expect(g.rows[0].cells[0]!.pct).toBe(0);
  });
});

describe('cellLabel / shortDate', () => {
  it('texto con el estado en palabras', () => {
    expect(cellLabel(null)).toBe('—');
    expect(cellLabel({ hours: 20, capacity: 40, over: false, pct: 50 })).toBe('20 / 40 h · 50 %');
    expect(cellLabel({ hours: 52.5, capacity: 40, over: true, pct: 131 })).toBe('52,5 / 40 h · 131 % · Sobreasignado');
  });
  it('fecha corta en español', () => {
    expect(shortDate('2026-03-02')).toBe('2 mar');
    expect(shortDate('2026-12-31')).toBe('31 dic');
    expect(shortDate('x')).toBe('x');
  });
});
