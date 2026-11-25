'use server';
import { redirect } from 'next/navigation';
import { parseNoteForm, type NoteAction } from '@/lib/notes';
import { UUID_RE } from '@/lib/http';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

const back = (project: string, activity: string | null, extra: Record<string, string> = {}) =>
  `/projects/${project}/board?${new URLSearchParams({ ...(activity ? { notes: activity } : {}), ...extra })}${activity ? `#card-${activity}` : ''}`;

async function activityOf(supabase: Awaited<ReturnType<typeof createClient>>, note: string): Promise<string | null> {
  const { data } = await supabase.from('activity_notes').select('activity_id').eq('id', note).maybeSingle();
  return (data?.activity_id as string | undefined) ?? null;
}

async function run(kind: NoteAction['kind'], formData: FormData) {
  const raw = String(formData.get('project') ?? '');
  if (!UUID_RE.test(raw)) redirect('/projects');
  const p = parseNoteForm(kind, (k) => formData.get(k));
  const rawActivity = String(formData.get('activity') ?? '');
  const hint = UUID_RE.test(rawActivity) ? rawActivity : null;
  if (!p) redirect(back(raw, hint, { error: 'invalid_note' }));
  const supabase = await createClient();
  if (p.kind === 'add') {
    const { data: proj } = await supabase.from('projects').select('organization_id').eq('id', p.project).maybeSingle();
    if (!proj) redirect('/projects');
    const { error } = await supabase.from('activity_notes').insert({ organization_id: proj.organization_id, project_id: p.project, activity_id: p.activity, body: p.body });
    redirect(back(p.project, p.activity, error ? { error: scopeErrorCode(error) } : {}));
  }
  const activity = await activityOf(supabase, p.note);
  if (p.kind === 'edit') {
    const { data, error } = await supabase.from('activity_notes').update({ body: p.body }).eq('id', p.note).eq('project_id', p.project).select('id');
    redirect(back(p.project, activity, error ? { error: scopeErrorCode(error) } : !data?.length ? { error: 'forbidden' } : {}));
  }
  const { data, error } = await supabase.from('activity_notes').delete().eq('id', p.note).eq('project_id', p.project).select('id');
  redirect(back(p.project, activity, error ? { error: scopeErrorCode(error) } : !data?.length ? { error: 'forbidden' } : {}));
}

export async function addNote(formData: FormData) { return run('add', formData); }
export async function editNote(formData: FormData) { return run('edit', formData); }
export async function deleteNote(formData: FormData) { return run('delete', formData); }
