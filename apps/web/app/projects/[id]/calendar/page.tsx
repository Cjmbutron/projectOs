import { notFound } from 'next/navigation';
import { CalendarView, type CalendarDay } from '@/components/CalendarView';
import { parseYear } from '@/lib/calendar';
import { UUID_RE } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

export default async function CalendarPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ y?: string; error?: string; added?: string; noeffect?: string; existing?: string; removed?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const year = parseYear(sp.y, new Date().getFullYear());
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: canEditData }, { data: sched }, { data: days }] = await Promise.all([
    supabase.rpc('can_edit_schedule', { p_project: id }),
    supabase.from('project_schedules').select('working_weekdays,computed_version,schedule_version').eq('project_id', id).maybeSingle(),
    supabase.from('project_calendar_days').select('id,day,kind,name').eq('project_id', id).gte('day', `${year}-01-01`).lte('day', `${year}-12-31`).order('day'),
  ]);
  const closed = project.status === 'closed' || project.status === 'cancelled';
  return (
    <CalendarView
      id={id} project={{ code: project.code, name: project.name }} year={year} days={(days ?? []) as CalendarDay[]}
      weekdays={sched?.working_weekdays ?? [1, 2, 3, 4, 5]} canEdit={canEditData === true && !closed} closed={closed}
      stale={!!sched && sched.computed_version !== sched.schedule_version}
      sp={{ error: sp.error, added: sp.added, noeffect: sp.noeffect, existing: sp.existing, removed: sp.removed }}
    />
  );
}
