import { describe, expect, it } from 'vitest';
import { formatHours, parseAssignForm, parseHours, parseResourceForm, resourceErrorCode } from '@/lib/resources';

const A = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const form = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

describe('parseHours', () => {
  it('acepta positivos hasta 24 con dos decimales, con coma o punto', () => {
    expect(parseHours('8')).toBe(8);
    expect(parseHours(' 7,5 ')).toBe(7.5);
    expect(parseHours('0.25')).toBe(0.25);
    expect(parseHours('24')).toBe(24);
    expect(parseHours('0.01')).toBe(0.01);
  });
  it('rechaza cero, negativos, más de 24, tres decimales, texto y vacío', () => {
    for (const bad of ['0', '0.00', '-1', '24.01', '25', '1.234', 'x', '', '1e1', '100', null, undefined]) {
      expect(parseHours(bad), String(bad)).toBeNull();
    }
  });
});

describe('parseResourceForm', () => {
  it('válido, con valores por defecto', () => {
    expect(parseResourceForm(form({ name: '  Ana  ' }))).toEqual({ ok: true, name: 'Ana', kind: 'person', dailyHours: 8 });
    expect(parseResourceForm(form({ name: 'Servidor', kind: 'equipment', daily_hours: '4' }))).toEqual({ ok: true, name: 'Servidor', kind: 'equipment', dailyHours: 4 });
  });
  it('nombre de 120 caracteres sí, de 121 no; vacío no', () => {
    expect(parseResourceForm(form({ name: 'a'.repeat(120) })).ok).toBe(true);
    expect(parseResourceForm(form({ name: 'a'.repeat(121) })).ok).toBe(false);
    expect(parseResourceForm(form({ name: '   ' })).ok).toBe(false);
  });
  it('tipo u horas inválidos', () => {
    expect(parseResourceForm(form({ name: 'X', kind: 'robot' })).ok).toBe(false);
    expect(parseResourceForm(form({ name: 'X', daily_hours: '0' })).ok).toBe(false);
  });
});

describe('parseAssignForm', () => {
  it('válido y con 100 % por defecto', () => {
    expect(parseAssignForm(form({ activity: A, resource: R }))).toEqual({ ok: true, activityId: A, resourceId: R, percent: 100 });
    expect(parseAssignForm(form({ activity: A, resource: R, percent: '1' }))).toEqual({ ok: true, activityId: A, resourceId: R, percent: 1 });
    expect(parseAssignForm(form({ activity: A, resource: R, percent: '100' })).ok).toBe(true);
  });
  it('porcentaje fuera de 1–100 o no entero', () => {
    for (const p of ['0', '101', '-5', '2.5', 'x', '']) expect(parseAssignForm(form({ activity: A, resource: R, percent: p })), p).toEqual({ ok: false, error: 'invalid_percent' });
  });
  it('identificadores inválidos', () => {
    expect(parseAssignForm(form({ activity: 'x', resource: R }))).toEqual({ ok: false, error: 'invalid_assignment' });
    expect(parseAssignForm(form({ activity: A, resource: '' }))).toEqual({ ok: false, error: 'invalid_assignment' });
  });
});

describe('resourceErrorCode', () => {
  it('mensajes de la base de datos', () => {
    expect(resourceErrorCode({ message: 'equipment_cannot_have_user' }, 'resource')).toBe('resource_user_invalid');
    expect(resourceErrorCode({ message: 'resource_user_must_be_active_internal_member' }, 'resource')).toBe('resource_user_invalid');
    expect(resourceErrorCode({ message: 'resource_inactive' }, 'assignment')).toBe('resource_inactive');
  });
  it('códigos SQL según el contexto', () => {
    expect(resourceErrorCode({ code: '42501' }, 'resource')).toBe('forbidden');
    expect(resourceErrorCode({ code: '23505' }, 'resource')).toBe('duplicate_resource');
    expect(resourceErrorCode({ code: '23505' }, 'assignment')).toBe('duplicate_assignment');
    expect(resourceErrorCode({ code: '23503' }, 'delete')).toBe('resource_in_use');
    expect(resourceErrorCode({ code: '23503' }, 'assignment')).toBe('invalid_assignment');
    expect(resourceErrorCode({ code: '23514' }, 'assignment')).toBe('invalid_percent');
    expect(resourceErrorCode({ code: '23514' }, 'resource')).toBe('invalid_resource');
    expect(resourceErrorCode({ code: 'XX' }, 'resource')).toBe('unknown');
    expect(resourceErrorCode(null, 'resource')).toBe('');
  });
});

describe('formatHours', () => {
  it('enteros sin decimales y coma decimal', () => {
    expect(formatHours(8)).toBe('8 h');
    expect(formatHours(7.5)).toBe('7,5 h');
  });
});
