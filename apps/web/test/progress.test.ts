import { describe, expect, it } from 'vitest';
import { canReportProgress, parseProgress, progressErrorCode } from '@/lib/progress';

const A = '11111111-1111-4111-8111-111111111111';
const form = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

describe('parseProgress', () => {
  it('acepta enteros de 0 a 100, con espacios', () => {
    expect(parseProgress(form({ activity: A, percent: '0' }))).toEqual({ ok: true, activityId: A, percent: 0 });
    expect(parseProgress(form({ activity: A, percent: ' 45 ' }))).toEqual({ ok: true, activityId: A, percent: 45 });
    expect(parseProgress(form({ activity: A, percent: '100' }))).toEqual({ ok: true, activityId: A, percent: 100 });
  });
  it('rechaza fuera de rango, decimales, texto, vacío y actividad inválida', () => {
    for (const bad of [{ percent: '101' }, { percent: '-1' }, { percent: '50.5' }, { percent: 'x' }, { percent: '' }, { percent: '1000' }, {}]) {
      expect(parseProgress(form({ activity: A, ...bad })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseProgress(form({ activity: 'no-uuid', percent: '5' })).ok).toBe(false);
  });
});

describe('progressErrorCode', () => {
  it('reconoce los códigos de la función y el 42501', () => {
    expect(progressErrorCode({ message: 'milestone_progress_invalid' })).toBe('milestone_progress_invalid');
    expect(progressErrorCode({ message: 'invalid_percent\ndetalle' })).toBe('invalid_percent');
    expect(progressErrorCode({ message: 'activity_not_found', code: 'P0002' })).toBe('activity_not_found');
    expect(progressErrorCode({ message: 'x', code: '42501' })).toBe('forbidden');
    expect(progressErrorCode({ message: 'raro' })).toBe('unknown');
    expect(progressErrorCode(null)).toBe('');
  });
});

describe('canReportProgress', () => {
  it('quien edita el cronograma, o la persona asignada', () => {
    expect(canReportProgress({ canEditSchedule: true, userId: null, assigneeId: null })).toBe(true);
    expect(canReportProgress({ canEditSchedule: false, userId: 'u1', assigneeId: 'u1' })).toBe(true);
    expect(canReportProgress({ canEditSchedule: false, userId: 'u1', assigneeId: 'u2' })).toBe(false);
    expect(canReportProgress({ canEditSchedule: false, userId: 'u1', assigneeId: null })).toBe(false);
    expect(canReportProgress({ canEditSchedule: false, userId: null, assigneeId: null })).toBe(false);
  });
});
