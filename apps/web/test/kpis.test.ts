import { describe, expect, it } from 'vitest';
import { averageProgress, countOverdue, projectKpis } from '@/lib/kpis';

describe('averageProgress', () => {
  it('promedio redondeado, acotado a 0–100 y tolerante a nulos y textos', () => {
    expect(averageProgress([{ progress_percent: 10 }, { progress_percent: 25 }])).toBe(18); // 17,5 → 18
    expect(averageProgress([{ progress_percent: '50' }, { progress_percent: null }])).toBe(25);
    expect(averageProgress([{ progress_percent: 250 }, { progress_percent: -40 }])).toBe(50);
    expect(averageProgress([{ progress_percent: 'x' }])).toBe(0);
  });
  it('sin proyectos → null', () => { expect(averageProgress([])).toBeNull(); });
});

describe('countOverdue', () => {
  it('cuenta las no terminadas con fin anterior a hoy', () => {
    const rows = [
      { early_finish: '2026-03-01', status: 'in_progress' }, // vencida
      { early_finish: '2026-03-01', status: 'done' },        // terminada
      { early_finish: '2026-03-05', status: 'pending' },     // vence hoy: no está vencida
      { early_finish: '2026-04-01', status: 'pending' },
      { early_finish: null, status: 'pending' },             // sin fechas
    ];
    expect(countOverdue(rows, '2026-03-05')).toBe(1);
  });
});

describe('projectKpis', () => {
  const p = (health: string, pr: number) => ({ health, progress_percent: pr });
  it('totales, riesgo y tono según el peor estado', () => {
    const k = projectKpis([p('green', 100), p('amber', 50), p('red', 0), p('unknown', 10)], null);
    expect(k.map((x) => x.key)).toEqual(['projects', 'risk', 'progress']);
    expect(k[0]).toMatchObject({ value: '4', hint: '1 en verde' });
    expect(k[1]).toMatchObject({ value: '2', tone: 'danger', hint: '1 en ámbar · 1 en rojo' });
    expect(k[2]).toMatchObject({ value: '40 %' });
  });
  it('solo ámbar → tono de advertencia; ninguno → ok', () => {
    expect(projectKpis([p('amber', 0)], null)[1]).toMatchObject({ tone: 'warn', value: '1' });
    expect(projectKpis([p('green', 0)], null)[1]).toMatchObject({ tone: 'ok', value: '0', hint: 'Ninguno en ámbar ni rojo' });
  });
  it('sin proyectos: avance «—»', () => { expect(projectKpis([], null)[2]).toMatchObject({ value: '—', hint: 'Sin proyectos' }); });
  it('tarjeta de actividades vencidas solo si se conoce el número', () => {
    expect(projectKpis([p('green', 0)], null)).toHaveLength(3);
    const k = projectKpis([p('green', 0)], 3);
    expect(k[3]).toMatchObject({ key: 'overdue', value: '3', tone: 'danger', hint: 'Revisa «Mis actividades»' });
    expect(projectKpis([p('green', 0)], 0)[3]).toMatchObject({ tone: 'ok', hint: 'Estás al día' });
  });
});
