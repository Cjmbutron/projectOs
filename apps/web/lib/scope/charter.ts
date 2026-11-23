export const CHARTER_FIELDS = ['objectives', 'scope', 'out_of_scope', 'success_criteria', 'assumptions', 'constraints'] as const;
export type CharterField = (typeof CHARTER_FIELDS)[number];
export const MAX_CHARTER_TEXT = 8000;
export const MIN_REQUIRED_TEXT = 10;

export type CharterParse = { ok: true; values: Record<CharterField, string | null> } | { ok: false; error: 'invalid_value' };

/** Normaliza el formulario del charter: recorta, vacío → null, límite de longitud. */
export function parseCharterForm(f: { get(name: string): unknown }): CharterParse {
  const values = {} as Record<CharterField, string | null>;
  for (const k of CHARTER_FIELDS) {
    const raw = f.get(k);
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.length > MAX_CHARTER_TEXT) return { ok: false, error: 'invalid_value' };
    values[k] = v === '' ? null : v;
  }
  return { ok: true, values };
}

const LEVELS = ['low', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];
export type StakeholderParse =
  | { ok: true; value: { name: string; role: string | null; influence: Level; interest: Level; notes: string | null } }
  | { ok: false; error: 'invalid_value' };

export function parseStakeholderForm(f: { get(name: string): unknown }): StakeholderParse {
  const str = (k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string).trim() : '');
  const name = str('name');
  const role = str('role');
  const notes = str('notes');
  const influence = str('influence') || 'medium';
  const interest = str('interest') || 'medium';
  if (!name || name.length > 200 || role.length > 200 || notes.length > 4000) return { ok: false, error: 'invalid_value' };
  if (!LEVELS.includes(influence as Level) || !LEVELS.includes(interest as Level)) return { ok: false, error: 'invalid_value' };
  return { ok: true, value: { name, role: role || null, influence: influence as Level, interest: interest as Level, notes: notes || null } };
}

const LABELS: Record<string, string> = { objectives: 'objetivos', scope: 'alcance', stakeholders: 'al menos un stakeholder' };
/** ["objectives","stakeholders"] → "objetivos y al menos un stakeholder" */
export function describeMissing(missing: readonly string[]): string {
  const names = missing.map((m) => LABELS[m] ?? m);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
}

/** Siguiente acción de estado que ofrece la pantalla del charter. */
export function statusActions(status: string): { to: string; label: string }[] {
  if (status === 'draft') return [{ to: 'proposed', label: 'Someter a aprobación' }];
  if (status === 'proposed') return [{ to: 'approved', label: 'Aprobar' }, { to: 'draft', label: 'Devolver a borrador' }];
  return [];
}
