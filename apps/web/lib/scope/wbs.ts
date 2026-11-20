export interface WbsNode { id: string; parent_id: string | null; position: number; code: string; name: string }

const segs = (code: string) => code.split('.').map(Number);

/** Orden de lectura del árbol: por código numérico (1, 1.1, 1.2, 2, 10). */
export function orderNodes<T extends { code: string }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const x = segs(a.code), y = segs(b.code);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return 0;
  });
}

export const depthOf = (code: string) => code.split('.').length - 1;

export interface MoveTarget { parent: string | null; position: number }

/** Subir/bajar entre hermanos. Devuelve null si ya está en el extremo. */
export function reorderTarget(nodes: WbsNode[], id: string, dir: 'up' | 'down'): MoveTarget | null {
  const n = nodes.find((x) => x.id === id);
  if (!n) return null;
  const siblings = nodes.filter((x) => x.parent_id === n.parent_id).sort((a, b) => a.position - b.position);
  const i = siblings.findIndex((x) => x.id === id);
  if (dir === 'up') return i <= 0 ? null : { parent: n.parent_id, position: i };
  // wbs_move_node inserta ANTES del hermano que hoy ocupa `position`: para quedar después del
  // siguiente (posición i+2, base 1) hay que pedir la posición i+3.
  return i >= siblings.length - 1 ? null : { parent: n.parent_id, position: i + 3 };
}

/** Sangrar: pasa a ser hijo de su hermano anterior (al final). */
export function indentTarget(nodes: WbsNode[], id: string): MoveTarget | null {
  const n = nodes.find((x) => x.id === id);
  if (!n) return null;
  const siblings = nodes.filter((x) => x.parent_id === n.parent_id).sort((a, b) => a.position - b.position);
  const i = siblings.findIndex((x) => x.id === id);
  return i <= 0 ? null : { parent: siblings[i - 1].id, position: 0 };
}

/** Quitar sangría: pasa a ser hermano de su padre, justo después. */
export function outdentTarget(nodes: WbsNode[], id: string): MoveTarget | null {
  const n = nodes.find((x) => x.id === id);
  if (!n || !n.parent_id) return null;
  const parent = nodes.find((x) => x.id === n.parent_id);
  if (!parent) return null;
  return { parent: parent.parent_id, position: parent.position + 1 };
}

/** Código de error estable a partir del error de PostgREST. */
export function scopeErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return '';
  const first = (error.message ?? '').split('\n')[0].trim();
  const known = ['wbs_has_children', 'wbs_cycle', 'wbs_too_deep', 'wbs_too_large', 'wbs_node_not_found', 'project_read_only', 'forbidden'];
  if (known.includes(first)) return first;
  if (error.code === '42501') return 'forbidden';
  if (error.code === '23514') return 'invalid_value';
  return 'unknown';
}
