/** Matriz RACI por entregable. Lógica pura: valores de celda, estado de cada fila y lectura del formulario. */
import { UUID_RE } from '@/lib/http';

export type CellValue = '' | 'R' | 'A' | 'AR' | 'C' | 'I';
export const CELL_VALUES: readonly CellValue[] = ['', 'R', 'A', 'AR', 'C', 'I'];
export const CELL_LABEL: Record<CellValue, string> = {
  '': '—',
  R: 'R · Responsable',
  A: 'A · Aprobador',
  AR: 'A/R · Aprobador y responsable',
  C: 'C · Consultado',
  I: 'I · Informado',
};
/** Texto corto para la celda en solo lectura. */
export const CELL_SHORT: Record<CellValue, string> = { '': '', R: 'R', A: 'A', AR: 'A/R', C: 'C', I: 'I' };

export function isCellValue(v: unknown): v is CellValue {
  return typeof v === 'string' && (CELL_VALUES as readonly string[]).includes(v);
}

/** Letras guardadas de una persona en un entregable → valor de celda (null si la combinación no existe). */
export function cellFromRoles(roles: readonly string[]): CellValue | null {
  const key = [...new Set(roles)].sort().join('');
  if (key === '') return '';
  if (key === 'AR') return 'AR';
  return key === 'R' || key === 'A' || key === 'C' || key === 'I' ? key : null;
}

/** Valor de celda → letras que se mandan a la base de datos. */
export function rolesOfCell(v: CellValue): string[] {
  return v === '' ? [] : v === 'AR' ? ['A', 'R'] : [v];
}

export interface RaciRow { user_id: string; deliverable_id: string; role: string }

/** deliverable → (persona → valor). Filas con combinaciones imposibles se ignoran. */
export function buildCells(rows: readonly RaciRow[]): Map<string, Map<string, CellValue>> {
  const letters = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const byUser = letters.get(r.deliverable_id) ?? new Map<string, string[]>();
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
    letters.set(r.deliverable_id, byUser);
  }
  const out = new Map<string, Map<string, CellValue>>();
  for (const [d, byUser] of letters) {
    const cells = new Map<string, CellValue>();
    for (const [u, roles] of byUser) {
      const v = cellFromRoles(roles);
      if (v !== null && v !== '') cells.set(u, v);
    }
    out.set(d, cells);
  }
  return out;
}

export type RowStatus = { hasR: boolean; hasA: boolean; complete: boolean; label: string };
/** Una fila está completa con al menos un responsable (R) y un aprobador (A). */
export function rowStatus(cells: ReadonlyMap<string, CellValue> | undefined): RowStatus {
  const values = [...(cells?.values() ?? [])];
  const hasR = values.some((v) => v === 'R' || v === 'AR');
  const hasA = values.some((v) => v === 'A' || v === 'AR');
  const label = hasR && hasA ? 'Completa' : !hasR && !hasA ? 'Falta R y A' : !hasR ? 'Falta R' : 'Falta A';
  return { hasR, hasA, complete: hasR && hasA, label };
}

export function summarize(deliverableIds: readonly string[], cells: ReadonlyMap<string, ReadonlyMap<string, CellValue>>): { total: number; complete: number } {
  return { total: deliverableIds.length, complete: deliverableIds.filter((d) => rowStatus(cells.get(d)).complete).length };
}

export interface CellChange { userId: string; from: CellValue; to: CellValue }
/**
 * Cambios de una fila: campos `cell_<id>` (nuevo valor) y `orig_<id>` (valor al abrir la pantalla).
 * Los cambios que dejan a alguien sin A van primero, para poder pasar el A de una persona a otra en un solo guardado.
 */
export function parseRowForm(get: (k: string) => unknown, memberIds: readonly string[]): CellChange[] | null {
  const changes: CellChange[] = [];
  for (const userId of memberIds) {
    if (!UUID_RE.test(userId)) return null;
    const to = get(`cell_${userId}`);
    const from = get(`orig_${userId}`);
    if (to === null || to === undefined) continue; // la persona no venía en el formulario
    if (!isCellValue(to) || !isCellValue(from)) return null;
    if (to !== from) changes.push({ userId, from, to });
  }
  const dropsA = (c: CellChange) => c.from.includes('A') && !c.to.includes('A');
  return [...changes.filter(dropsA), ...changes.filter((c) => !dropsA(c))];
}
