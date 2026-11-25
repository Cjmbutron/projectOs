/** Notas de las actividades (tarjetas del tablero). Lógica pura: validación, agrupado, permisos de la interfaz y fecha. */
import { UUID_RE } from '@/lib/http';

export const MAX_NOTE = 2000;

/** Texto de una nota listo para guardar (sin espacios en los extremos); null si está vacío o pasa de 2 000 caracteres. */
export function parseNoteBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\r\n/g, '\n').trim();
  if (s === '' || [...s].length > MAX_NOTE) return null;
  return s;
}

export interface NoteRow { id: string; activity_id: string; author_id: string | null; body: string; created_at: string; updated_at: string }
export interface NoteView { id: string; authorId: string | null; author: string; body: string; when: string; edited: boolean }

/** Agrupa por actividad, de la más antigua a la más reciente (como una conversación). */
export function groupNotes(rows: readonly NoteRow[]): Map<string, NoteRow[]> {
  const out = new Map<string, NoteRow[]>();
  for (const r of [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))) {
    out.set(r.activity_id, [...(out.get(r.activity_id) ?? []), r]);
  }
  return out;
}

/** «Editada» si se cambió más de un segundo después de crearla. */
export function wasEdited(createdAt: string, updatedAt: string): boolean {
  return new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 1000;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «25 nov, 14:30» en la zona horaria dada; vacío si la fecha no es válida. */
export function formatNoteDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]}, ${get('hour')}:${get('minute')}`;
}

export interface NoteContext { me: string | null; canWrite: boolean; canModerate: boolean; writable: boolean }
/** Lo que la interfaz ofrece (la base de datos decide de verdad): editar solo lo propio; borrar lo propio o, con permiso de cronograma, lo ajeno. */
export function noteRights(authorId: string | null, c: NoteContext): { canEdit: boolean; canDelete: boolean } {
  const mine = c.me !== null && authorId === c.me;
  return { canEdit: c.writable && c.canWrite && mine, canDelete: c.writable && ((c.canWrite && mine) || c.canModerate) };
}
export const canAddNote = (c: NoteContext) => c.writable && c.canWrite;

export type NoteAction = { kind: 'add'; project: string; activity: string; body: string } | { kind: 'edit'; project: string; note: string; body: string } | { kind: 'delete'; project: string; note: string };
export function parseNoteForm(kind: NoteAction['kind'], get: (k: string) => unknown): NoteAction | null {
  const project = String(get('project') ?? '');
  if (!UUID_RE.test(project)) return null;
  if (kind === 'add') {
    const activity = String(get('activity') ?? ''); const body = parseNoteBody(get('body'));
    return UUID_RE.test(activity) && body ? { kind, project, activity, body } : null;
  }
  const note = String(get('note') ?? '');
  if (!UUID_RE.test(note)) return null;
  if (kind === 'delete') return { kind, project, note };
  const body = parseNoteBody(get('body'));
  return body ? { kind, project, note, body } : null;
}
