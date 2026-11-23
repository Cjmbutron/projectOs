import { describe, expect, it } from 'vitest';
import { HEALTH_LABEL, isHealth, parseThresholds, summarizeHealth } from '@/lib/health';

const form = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

describe('summarizeHealth', () => {
  it('cuenta por color y trata valores raros como sin datos', () => {
    const s = summarizeHealth([{ health: 'green' }, { health: 'green' }, { health: 'red' }, { health: 'amber' }, { health: 'unknown' }, { health: 'azul' }]);
    expect(s).toEqual({ total: 6, counts: { green: 2, amber: 1, red: 1, unknown: 2 } });
  });
  it('lista vacía', () => { expect(summarizeHealth([])).toEqual({ total: 0, counts: { green: 0, amber: 0, red: 0, unknown: 0 } }); });
});

describe('isHealth / etiquetas', () => {
  it('reconoce los cuatro valores', () => {
    for (const v of ['green', 'amber', 'red', 'unknown']) expect(isHealth(v)).toBe(true);
    expect(isHealth('blue')).toBe(false);
    expect(Object.values(HEALTH_LABEL).every((l) => l.length > 0)).toBe(true);
  });
});

describe('parseThresholds', () => {
  it('válidos, incluido el límite inferior y superior', () => {
    expect(parseThresholds(form({ amber: '2', red: '10' }))).toEqual({ ok: true, amber: 2, red: 10 });
    expect(parseThresholds(form({ amber: '0', red: '0' }))).toEqual({ ok: true, amber: 0, red: 0 });
    expect(parseThresholds(form({ amber: ' 5 ', red: '3650' }))).toEqual({ ok: true, amber: 5, red: 3650 });
  });
  it('rechaza rojo menor que ámbar, negativos, decimales, texto, vacíos y fuera de rango', () => {
    for (const bad of [{ amber: '10', red: '5' }, { amber: '-1', red: '5' }, { amber: '1.5', red: '5' }, { amber: 'a', red: '5' }, { amber: '', red: '5' }, {}, { amber: '0', red: '3651' }, { amber: '1e3', red: '5000' }]) {
      expect(parseThresholds(form(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
