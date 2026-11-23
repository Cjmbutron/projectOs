import { describe, expect, it } from 'vitest';
import { describeMissing, parseCharterForm, parseStakeholderForm, statusActions } from '@/lib/scope/charter';
import { scopeErrorCode } from '@/lib/scope/wbs';

const form = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

describe('parseCharterForm', () => {
  it('recorta, vacío → null', () => {
    const r = parseCharterForm(form({ objectives: '  Implementar ventas  ', scope: '   ', assumptions: 'x' }));
    expect(r).toEqual({ ok: true, values: { objectives: 'Implementar ventas', scope: null, out_of_scope: null, success_criteria: null, assumptions: 'x', constraints: null } });
  });
  it('rechaza textos de más de 8000 caracteres, acepta exactamente 8000', () => {
    expect(parseCharterForm(form({ objectives: 'x'.repeat(8001) })).ok).toBe(false);
    expect(parseCharterForm(form({ objectives: 'x'.repeat(8000) })).ok).toBe(true);
  });
  it('valores que no son texto cuentan como vacíos', () => {
    expect(parseCharterForm(form({ objectives: 5, scope: null }))).toMatchObject({ ok: true, values: { objectives: null, scope: null } });
  });
});

describe('parseStakeholderForm', () => {
  it('valores por defecto', () => {
    expect(parseStakeholderForm(form({ name: ' Ana ' }))).toEqual({ ok: true, value: { name: 'Ana', role: null, influence: 'medium', interest: 'medium', notes: null } });
  });
  it('acepta niveles válidos', () => {
    expect(parseStakeholderForm(form({ name: 'A', role: 'Sponsor', influence: 'high', interest: 'low', notes: 'n' }))).toMatchObject({ ok: true, value: { influence: 'high', interest: 'low', role: 'Sponsor', notes: 'n' } });
  });
  it('rechaza nombre vacío o largo, niveles inválidos y textos largos', () => {
    for (const bad of [{ name: '  ' }, { name: 'x'.repeat(201) }, { name: 'A', influence: 'enorme' }, { name: 'A', interest: 'HIGH' }, { name: 'A', role: 'x'.repeat(201) }, { name: 'A', notes: 'x'.repeat(4001) }, {}]) {
      expect(parseStakeholderForm(form(bad)).ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });
});

describe('describeMissing', () => {
  it('lista en español', () => {
    expect(describeMissing([])).toBe('');
    expect(describeMissing(['objectives'])).toBe('objetivos');
    expect(describeMissing(['objectives', 'scope'])).toBe('objetivos y alcance');
    expect(describeMissing(['objectives', 'scope', 'stakeholders'])).toBe('objetivos, alcance y al menos un stakeholder');
  });
});

describe('statusActions', () => {
  it('acciones por estado', () => {
    expect(statusActions('draft')).toEqual([{ to: 'proposed', label: 'Someter a aprobación' }]);
    expect(statusActions('proposed').map((a) => a.to)).toEqual(['approved', 'draft']);
    expect(statusActions('approved')).toEqual([]);
    expect(statusActions('closed')).toEqual([]);
  });
});

describe('scopeErrorCode (charter)', () => {
  it('reconoce los códigos del charter', () => {
    for (const c of ['charter_incomplete', 'charter_locked', 'stakeholder_not_member', 'invalid_transition', 'project_not_found']) {
      expect(scopeErrorCode({ message: c })).toBe(c);
    }
  });
});
