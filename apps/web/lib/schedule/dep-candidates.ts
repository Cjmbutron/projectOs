import { UUID_RE } from '@/lib/http';
import type { DepType } from '@/lib/schedule/dependency-form';

export interface Dep { id: string; predecessor_id: string; successor_id: string; type: string; lag: number }
export interface Act { id: string; name: string }

/** Todo lo alcanzable desde `from` siguiendo las dependencias hacia adelante (`forward`) o hacia atrás. Sin incluir `from`. */
export function reachable(deps: Dep[], from: string, forward: boolean): Set<string> {
  const next = new Map<string, string[]>();
  for (const d of deps) {
    const [a, b] = forward ? [d.predecessor_id, d.successor_id] : [d.successor_id, d.predecessor_id];
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
  }
  const seen = new Set<string>();
  const stack = [...(next.get(from) ?? [])];
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x) || x === from) continue;
    seen.add(x);
    stack.push(...(next.get(x) ?? []));
  }
  return seen;
}

/** Actividades que pueden ser predecesoras de `id`: ni ella, ni las que ya lo son, ni sus sucesoras (crearían un ciclo). */
export function predecessorCandidates(acts: Act[], deps: Dep[], id: string): Act[] {
  const already = new Set(deps.filter((d) => d.successor_id === id).map((d) => d.predecessor_id));
  const downstream = reachable(deps, id, true);
  return acts.filter((a) => a.id !== id && !already.has(a.id) && !downstream.has(a.id));
}

/** Actividades que pueden ser sucesoras de `id`: ni ella, ni las que ya lo son, ni sus predecesoras (crearían un ciclo). */
export function successorCandidates(acts: Act[], deps: Dep[], id: string): Act[] {
  const already = new Set(deps.filter((d) => d.predecessor_id === id).map((d) => d.successor_id));
  const upstream = reachable(deps, id, false);
  return acts.filter((a) => a.id !== id && !already.has(a.id) && !upstream.has(a.id));
}

/** «FS», «FS +2 d», «SS −1 d»: tipo y desfase en días hábiles. */
export function depLabel(type: string, lag: number): string {
  if (!lag) return type;
  return `${type} ${lag > 0 ? '+' : '−'}${Math.abs(lag)} d`;
}

export const DEP_TYPE_LABEL: Record<DepType, string> = {
  FS: 'Fin a inicio (FS)', SS: 'Inicio a inicio (SS)', FF: 'Fin a fin (FF)', SF: 'Inicio a fin (SF)',
};

/** «3. Nombre» con el número de orden, para distinguir actividades con el mismo nombre. */
export function actLabel(index: number, name: string): string { return `${index + 1}. ${name}`; }

export type DepUpdateParse =
  | { ok: true; id: string; type: DepType; lag: number }
  | { ok: false; error: 'invalid_dependency' };

/** Valida el formulario para cambiar tipo y desfase de una dependencia existente. */
export function parseDependencyUpdate(f: { get(name: string): unknown }): DepUpdateParse {
  const id = String(f.get('id') ?? '');
  const type = String(f.get('type') ?? '').toUpperCase();
  const lagRaw = String(f.get('lag') ?? '0').trim() || '0';
  if (!UUID_RE.test(id) || !['FS', 'SS', 'FF', 'SF'].includes(type) || !/^-?\d{1,5}$/.test(lagRaw) || Math.abs(Number(lagRaw)) > 36500) {
    return { ok: false, error: 'invalid_dependency' };
  }
  return { ok: true, id, type: type as DepType, lag: Number(lagRaw) };
}

/** Id de actividad válido para reabrir su panel tras una acción; si no, null. */
export function parseOpen(v: unknown): string | null {
  const s = String(v ?? '');
  return UUID_RE.test(s) ? s : null;
}
