import { describe, expect, it } from 'vitest';
import { layoutGantt, toPoints, type GanttActivity } from '@/lib/gantt/layout';

const act = (id: string, start: string | null, finish: string | null, duration: number, critical = false): GanttActivity =>
  ({ id, name: id.toUpperCase(), start, finish, duration, critical });
const PX = 10;
const opts = { pxPerDay: PX, rowHeight: 20, barHeight: 10, headerHeight: 30 };

describe('layoutGantt — barras', () => {
  const L = layoutGantt([act('a', '2026-03-02', '2026-03-04', 3), act('b', '2026-03-05', '2026-03-06', 2, true)], [], opts);
  it('la barra cubre desde el inicio hasta el final inclusivo', () => {
    const [a, b] = L.bars;
    expect(a.width).toBe(3 * PX);
    expect(b.width).toBe(2 * PX);
    expect(b.x - a.x).toBe(3 * PX);          // b empieza 3 días después
    expect(b.critical).toBe(true);
  });
  it('una fila por actividad, en el orden dado, dentro del alto', () => {
    expect(L.bars.map((b) => b.row)).toEqual([0, 1]);
    expect(L.bars[1].y - L.bars[0].y).toBe(20);
    expect(L.bars[0].y).toBe(30 + (20 - 10) / 2);
    expect(L.height).toBeGreaterThan(L.bars[1].y + 10);
  });
  it('deja un día de margen a cada lado', () => {
    expect(L.minDate).toBe('2026-03-01');
    expect(L.bars[0].x).toBe(PX);
    expect(L.width).toBeGreaterThanOrEqual((5 + 2) * PX); // 02..06 = 5 días + 2 de margen
  });
  it('una barra de un día tiene ancho de un día', () => {
    expect(layoutGantt([act('a', '2026-03-02', '2026-03-02', 1)], [], opts).bars[0].width).toBe(PX);
  });
});

describe('layoutGantt — ancho del lienzo', () => {
  it('cabe la etiqueta de la última barra (el texto va a su derecha)', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-02', 1)].map((a) => ({ ...a, name: 'Una actividad con nombre largo' })), [], opts);
    const b = L.bars[0];
    expect(L.width).toBeGreaterThanOrEqual(b.x + b.width + 6 + 'Una actividad con nombre largo'.length * 6.5);
  });
  it('el ancho es exactamente el de la etiqueta que más lejos llega', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-20', 13)].map((a) => ({ ...a, name: 'x' })), [], opts);
    const b = L.bars[0];
    expect(L.width).toBe(b.x + b.width + 6 + 1 * 6.5 + 8);
  });
  it('si la etiqueta cabe en la rejilla, manda la rejilla', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-20', 13), { ...act('m', '2026-03-02', '2026-03-02', 0), name: 'x' }], [], opts);
    expect(L.width).toBeGreaterThanOrEqual(21 * PX);
  });
});

describe('layoutGantt — hitos y sin fechas', () => {
  it('el hito va al FINAL de su día', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-04', 3), act('m', '2026-03-04', '2026-03-04', 0)], [], opts);
    const [a, m] = L.bars;
    expect(m.milestone).toBe(true);
    expect(m.x + m.width / 2).toBe(a.x + a.width);   // centro del rombo = borde derecho de la barra
  });
  it('las actividades sin fechas no se dibujan y se reportan', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-02', 1), act('x', null, null, 1)], [], opts);
    expect(L.bars).toHaveLength(1);
    expect(L.unscheduled).toEqual(['x']);
  });
  it('sin ninguna fecha: lienzo vacío sin romperse', () => {
    const L = layoutGantt([act('x', null, null, 1)], [], opts);
    expect(L).toMatchObject({ width: 0, bars: [], links: [], minDate: null, unscheduled: ['x'] });
    expect(layoutGantt([], []).bars).toEqual([]);
  });
});

describe('layoutGantt — dependencias', () => {
  const acts = [act('a', '2026-03-02', '2026-03-04', 3, true), act('b', '2026-03-05', '2026-03-06', 2, true)];
  const A = (t: 'FS' | 'SS' | 'FF' | 'SF') => {
    const L = layoutGantt(acts, [{ predecessorId: 'a', successorId: 'b', type: t }], opts);
    const [a, b] = L.bars;
    return { pts: L.links[0].points, a, b, L };
  };
  it('FS: sale del borde derecho de la predecesora y entra por el borde izquierdo de la sucesora', () => {
    const { pts, a, b } = A('FS');
    expect(pts[0]).toEqual([a.x + a.width, a.y + 5]);
    expect(pts.at(-1)).toEqual([b.x, b.y + 5]);
  });
  it('SS: izquierda → izquierda', () => {
    const { pts, a, b } = A('SS');
    expect(pts[0]).toEqual([a.x, a.y + 5]);
    expect(pts.at(-1)).toEqual([b.x, b.y + 5]);
  });
  it('FF: derecha → derecha', () => {
    const { pts, a, b } = A('FF');
    expect(pts[0]).toEqual([a.x + a.width, a.y + 5]);
    expect(pts.at(-1)).toEqual([b.x + b.width, b.y + 5]);
  });
  it('SF: izquierda → derecha', () => {
    const { pts, a, b } = A('SF');
    expect(pts[0]).toEqual([a.x, a.y + 5]);
    expect(pts.at(-1)).toEqual([b.x + b.width, b.y + 5]);
  });
  it('la ruta es ortogonal (cada tramo es horizontal o vertical)', () => {
    for (const t of ['FS', 'SS', 'FF', 'SF'] as const) {
      const { pts } = A(t);
      for (let i = 1; i < pts.length; i++) expect(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1]).toBe(true);
    }
  });
  it('una dependencia hacia arriba pasa por el hueco superior', () => {
    const L = layoutGantt(acts, [{ predecessorId: 'b', successorId: 'a', type: 'FS' }], opts);
    const ys = L.links[0].points.map((p) => p[1]);
    expect(Math.min(...ys)).toBeLessThan(L.bars[1].y + 5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(L.bars[1].y + 5);   // nunca baja por debajo de la fila de origen
    expect(ys).toContain(L.bars[1].y + 5 - 10);                      // pasa por el hueco entre filas (media fila arriba)
  });
  it('resalta como crítica solo si ambas extremos lo son', () => {
    expect(A('FS').L.links[0].critical).toBe(true);
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-04', 3, true), act('b', '2026-03-05', '2026-03-06', 2, false)], [{ predecessorId: 'a', successorId: 'b', type: 'FS' }], opts);
    expect(L.links[0].critical).toBe(false);
  });
  it('ignora dependencias con una actividad sin fechas o inexistente', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-02', 1), act('x', null, null, 1)], [{ predecessorId: 'a', successorId: 'x', type: 'FS' }, { predecessorId: 'a', successorId: 'zzz', type: 'FS' }], opts);
    expect(L.links).toEqual([]);
  });
  it('el hito engancha por su centro', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-04', 3), act('m', '2026-03-04', '2026-03-04', 0)], [{ predecessorId: 'a', successorId: 'm', type: 'FS' }], opts);
    expect(L.links[0].points.at(-1)![0]).toBe(L.bars[1].x + L.bars[1].width / 2);
  });
});

describe('layoutGantt — escala', () => {
  it('marca fines de semana y lunes', () => {
    const L = layoutGantt([act('a', '2026-03-02', '2026-03-10', 7)], [], opts); // lun 2 → mar 10
    expect(L.weekends.map((w) => w.x)).toEqual([0, 6 * PX, 7 * PX]); // dom 1, sáb 7, dom 8
    expect(L.ticks.filter((t) => !t.major).map((t) => t.label)).toEqual(['2', '9']);
  });
  it('el primer día del mes lleva etiqueta de mes', () => {
    const L = layoutGantt([act('a', '2026-03-30', '2026-04-02', 4)], [], opts);
    expect(L.ticks.find((t) => t.major)?.label).toBe('abr 2026');
  });
  it('cruza el fin de año sin errores de fecha', () => {
    const L = layoutGantt([act('a', '2026-12-30', '2027-01-04', 4)], [], opts);
    expect(L.ticks.find((t) => t.major)?.label).toBe('ene 2027');
    expect(L.width).toBeGreaterThanOrEqual((6 + 2) * PX);
  });
});

describe('toPoints', () => {
  it('formatea y redondea', () => { expect(toPoints([[1, 2], [3.14159, 4]])).toBe('1,2 3.1,4'); });
});
