import Link from 'next/link';
import { formatDay } from '@/lib/dates';
import { notFound } from 'next/navigation';
import { KanbanBoard, type Card } from '@/components/KanbanBoard';
import { allowedMoves, COLUMNS, isStatus, type BoardActivity } from '@/lib/board';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { deadlineState } from '@/lib/my-activities';
import { canReportProgress } from '@/lib/progress';
import { createClient } from '@/lib/supabase/server';
import { moveCard } from './actions';
import { addNote, deleteNote, editNote } from './notes-actions';
import { canAddNote, formatNoteDate, groupNotes, noteRights, wasEdited, type NoteContext, type NoteRow } from '@/lib/notes';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/La_Paz' }).format(new Date());
const LABEL = Object.fromEntries(COLUMNS.map((c) => [c.status, c.label]));

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notes?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const { data: acts } = await supabase.from('activities')
    .select('id,name,duration,status,percent_complete,early_start,early_finish,assignee_id')
    .eq('project_id', id).order('sort_order').order('created_at').limit(2000);
  const [{ data: canEditData }, { data: canWriteData }, { data: noteRows }] = await Promise.all([
    supabase.rpc('can_edit_schedule', { p_project: id }),
    supabase.rpc('can_write_notes', { p_project: id }),
    supabase.from('activity_notes').select('id,activity_id,author_id,body,created_at,updated_at').eq('project_id', id).order('created_at').limit(5000),
  ]);
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id ?? null;
  const notesBy = groupNotes((noteRows ?? []) as NoteRow[]);
  const assigneeIds = [...new Set([...(acts ?? []).map((a) => a.assignee_id), ...(noteRows ?? []).map((n) => n.author_id)].filter((x): x is string => !!x))];
  const { data: profs } = assigneeIds.length ? await supabase.from('profiles').select('id,display_name').in('id', assigneeIds) : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
  const writable = !['closed', 'cancelled'].includes(project.status);
  const tz = process.env.APP_TIMEZONE || 'America/La_Paz';
  const nctx: NoteContext = { me, canWrite: canWriteData === true, canModerate: canEditData === true, writable };
  const now = today();
  const cards: Card[] = ((acts ?? []) as BoardActivity[]).map((a) => {
    const d = deadlineState(a.early_finish, a.status, now);
    const status = isStatus(a.status) ? a.status : 'not_started';
    const canMove = writable && canReportProgress({ canEditSchedule: canEditData === true, userId: me, assigneeId: a.assignee_id });
    return {
      id: a.id, name: a.name, percent: a.percent_complete ?? 0, status, duration: a.duration,
      dates: a.early_start && a.early_finish ? `${formatDay(a.early_start)} → ${formatDay(a.early_finish)}` : 'Sin fechas',
      assignee: a.assignee_id ? (names.get(a.assignee_id) ?? null) : null,
      badge: d === 'overdue' ? { text: 'Vencida', cls: 'badge-danger' } : d === 'due_soon' ? { text: 'Vence pronto', cls: 'badge-warn' } : null,
      moves: allowedMoves(a).map((to) => ({ to, label: LABEL[to] })), canMove,
      canAddNote: canAddNote(nctx),
      notes: (notesBy.get(a.id) ?? []).map((n) => ({
        id: n.id, authorId: n.author_id, author: n.author_id ? (names.get(n.author_id) ?? 'Sin nombre') : 'Persona eliminada', body: n.body,
        when: formatNoteDate(n.created_at, tz), edited: wasEdited(n.created_at, n.updated_at), ...noteRights(n.author_id, nctx),
      })),
    };
  });
  return (
    <main style={{ maxWidth: 'none' }}>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>Tablero</h1>
      <p className="legend">Cada actividad está en la columna de su estado. Arrastra una tarjeta o usa «Mover» para cambiarla. Cada tarjeta tiene sus notas para el equipo. «En curso» registra 1 % (o 99 % si venía de Terminada): ajusta el porcentaje real en la pantalla del proyecto.</p>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      {cards.length === 0 ? <p className="empty">Aún no hay actividades.</p> : <KanbanBoard projectId={id} cards={cards} action={moveCard} noteActions={{ add: addNote, edit: editNote, remove: deleteNote }} openNotes={sp.notes && UUID_RE.test(sp.notes) ? sp.notes : null} />}
    </main>
  );
}
