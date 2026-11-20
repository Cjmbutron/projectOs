import { UUID_RE } from '@/lib/http';

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export type DepParse =
  | { ok: true; predecessorId: string; successorId: string; type: DepType; lag: number }
  | { ok: false; error: 'invalid_dependency' };

/** Valida el formulario de dependencia antes de tocar la base (la base vuelve a validar todo). */
export function parseDependencyForm(f: { get(name: string): unknown }): DepParse {
  const pred = String(f.get('predecessor') ?? '');
  const succ = String(f.get('successor') ?? '');
  const type = String(f.get('type') ?? 'FS').toUpperCase();
  const lagRaw = String(f.get('lag') ?? '0').trim() || '0';
  const bad = { ok: false, error: 'invalid_dependency' } as const;
  if (!UUID_RE.test(pred) || !UUID_RE.test(succ) || pred === succ) return bad;
  if (!['FS', 'SS', 'FF', 'SF'].includes(type)) return bad;
  if (!/^-?\d{1,5}$/.test(lagRaw) || Math.abs(Number(lagRaw)) > 36500) return bad;
  return { ok: true, predecessorId: pred, successorId: succ, type: type as DepType, lag: Number(lagRaw) };
}
