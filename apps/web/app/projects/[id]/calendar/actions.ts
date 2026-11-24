'use server';
import { redirect } from 'next/navigation';
import { parseDayForm, expandRange, parseSuggestedForm, planDays, type DayKind } from '@/lib/calendar';
import { UUID_RE } from '@/lib/http';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

type Row = { day: string; kind: DayKind; name: string };

/** Guarda días nuevos (la base de datos vuelve a comprobar permiso, proyecto abierto y duplicados). */
async function save(project: string, kind: DayKind, items: { day: string; name: string }[], year: string) {
  const supabase = await createClient();
  const [{ data: p }, { data: sched }] = await Promise.all([
    supabase.from('projects').select('organization_id').eq('id', project).maybeSingle(),
    supabase.from('project_schedules').select('working_weekdays').eq('project_id', project).maybeSingle(),
  ]);
  if (!p) redirect('/projects');
  const days = items.map((i) => i.day);
  const { data: existing } = await supabase.from('project_calendar_days').select('day').eq('project_id', project).in('day', days);
  const plan = planDays(days, kind, sched?.working_weekdays ?? [1, 2, 3, 4, 5], new Set((existing ?? []).map((e) => e.day as string)));
  const names = new Map(items.map((i) => [i.day, i.name]));
  const rows = plan.toAdd.map((d) => ({ organization_id: p.organization_id, project_id: project, day: d, kind, name: names.get(d) ?? null }));
  if (rows.length) {
    const { error } = await supabase.from('project_calendar_days').insert(rows);
    if (error) redirect(`/projects/${project}/calendar?y=${year}&error=${error.code === '23505' ? 'duplicate_day' : scopeErrorCode(error)}`);
  }
  redirect(`/projects/${project}/calendar?${new URLSearchParams({ y: year, added: String(rows.length), noeffect: String(plan.noEffect), existing: String(plan.existing) })}`);
}

/** Un día, o un rango, como feriado o como día trabajado excepcional. */
export async function addDays(formData: FormData) {
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const d = parseDayForm((k) => formData.get(k));
  if (!d) redirect(`/projects/${project}/calendar?error=invalid_day`);
  const days = expandRange(d.start, d.end) ?? [];
  await save(project, d.kind, days.map((day) => ({ day, name: d.name })), d.start.slice(0, 4));
}

/** Guarda los feriados sugeridos que la persona dejó marcados (con las fechas ya corregidas). */
export async function addSuggested(formData: FormData) {
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const year = String(formData.get('year') ?? '').slice(0, 4);
  const items = parseSuggestedForm((k) => formData.get(k));
  if (!items) redirect(`/projects/${project}/calendar?y=${/^\d{4}$/.test(year) ? year : ''}&error=invalid_day`);
  await save(project, 'holiday', items, /^\d{4}$/.test(year) ? year : items[0].day.slice(0, 4));
}

export async function removeDay(formData: FormData) {
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  const year = /^\d{4}$/.test(String(formData.get('year'))) ? String(formData.get('year')) : '';
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('project_calendar_days').delete().eq('id', id).eq('project_id', project).select('id');
  const code = error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '';
  redirect(`/projects/${project}/calendar?${new URLSearchParams({ y: year, ...(code ? { error: code } : { removed: '1' }) })}`);
}
export type { Row };
