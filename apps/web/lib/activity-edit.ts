import { UUID_RE } from '@/lib/http';

export type ActivityEdit =
  | { ok: true; activityId: string; name: string; duration: number; nodeId: string | null }
  | { ok: false; error: string };

/** Valida el formulario de edición de una actividad: nombre, duración (días hábiles) y nodo de la WBS (opcional). */
export function parseActivityEdit(f: { get(k: string): FormDataEntryValue | null }): ActivityEdit {
  const activityId = String(f.get('activity') ?? '');
  if (!UUID_RE.test(activityId)) return { ok: false, error: 'invalid_value' };
  const name = String(f.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 200) return { ok: false, error: 'invalid_value' };
  const raw = String(f.get('duration') ?? '').trim();
  const duration = Number(raw);
  if (raw === '' || !Number.isInteger(duration) || duration < 0 || duration > 36500) return { ok: false, error: 'invalid_value' };
  const node = String(f.get('node') ?? '');
  if (node !== '' && !UUID_RE.test(node)) return { ok: false, error: 'invalid_value' };
  return { ok: true, activityId, name, duration, nodeId: node === '' ? null : node };
}
