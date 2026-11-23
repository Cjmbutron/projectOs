'use server';
import { redirect } from 'next/navigation';
import { parseMove, targetPercent } from '@/lib/board';
import { UUID_RE } from '@/lib/http';
import { progressErrorCode } from '@/lib/progress';
import { createClient } from '@/lib/supabase/server';

export async function moveCard(formData: FormData) {
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const back = (code: string) => redirect(`/projects/${project}/board${code ? `?error=${code}` : ''}`);
  const m = parseMove(formData);
  if (!m.ok) back(m.error);
  const mv = m as Extract<typeof m, { ok: true }>;
  const supabase = await createClient();
  const { data: a } = await supabase.from('activities').select('status,duration').eq('id', mv.activityId).eq('project_id', project).maybeSingle();
  if (!a) back('activity_not_found');
  const pct = targetPercent(a as { status: string; duration: number }, mv.to);
  if (pct === null) back('invalid_move');
  const { error } = await supabase.rpc('update_activity_progress', { p_activity: mv.activityId, p_percent: pct });
  back(progressErrorCode(error));
}
