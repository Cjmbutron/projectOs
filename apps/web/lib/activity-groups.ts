/** Agrupa las actividades por nodo de la WBS (en orden de código) y las ordena por fecha dentro de cada grupo. */
export interface GroupNode { id: string; code: string; name: string }
export interface GroupAct { id: string; wbs_node_id: string | null; early_start: string | null; early_finish: string | null }
export interface ActGroup<T> { key: string; nodeId: string | null; code: string | null; name: string; items: T[] }

/** «1.2.10» después de «1.2.9»: compara segmento a segmento como número. Códigos raros ('?') van al final. */
export function compareCodes(a: string, b: string): number {
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]) ? Number(x[i]) : Infinity, ny = /^\d+$/.test(y[i]) ? Number(y[i]) : Infinity;
    if (nx !== ny) return nx < ny ? -1 : 1;
    if (nx === Infinity && x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/** Por inicio, luego por fin; sin fechas al final; a igualdad se conserva el orden original (el de creación). */
export function sortByDate<T extends GroupAct>(items: readonly T[]): T[] {
  return items.map((it, i) => ({ it, i })).sort((p, q) => {
    const s = (p.it.early_start ?? '9999-12-31').localeCompare(q.it.early_start ?? '9999-12-31');
    if (s !== 0) return s;
    const f = (p.it.early_finish ?? '9999-12-31').localeCompare(q.it.early_finish ?? '9999-12-31');
    return f !== 0 ? f : p.i - q.i;
  }).map((x) => x.it);
}

export function groupActivities<T extends GroupAct>(acts: readonly T[], nodes: readonly GroupNode[]): ActGroup<T>[] {
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const buckets = new Map<string, T[]>();
  for (const a of acts) {
    const key = a.wbs_node_id && byNode.has(a.wbs_node_id) ? a.wbs_node_id : 'none';
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  const groups: ActGroup<T>[] = [];
  for (const [key, items] of buckets) {
    if (key === 'none') continue;
    const n = byNode.get(key)!;
    groups.push({ key, nodeId: n.id, code: n.code, name: n.name, items: sortByDate(items) });
  }
  groups.sort((a, b) => compareCodes(a.code!, b.code!) || a.name.localeCompare(b.name, 'es'));
  const none = buckets.get('none');
  if (none) groups.push({ key: 'none', nodeId: null, code: null, name: 'Sin grupo de la WBS', items: sortByDate(none) });
  return groups;
}
