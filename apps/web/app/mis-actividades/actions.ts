'use server';
import { redirect } from 'next/navigation';
import { parseProgress, progressErrorCode } from '@/lib/progress';
import { createClient } from '@/lib/supabase/server';

export async function reportMyProgress(formData: FormData) {
  const parsed = parseProgress(formData);
  const show = String(formData.get('all')) === '1' ? '&all=1' : '';
  if (!parsed.ok) redirect(`/mis-actividades?error=${parsed.error}${show}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_activity_progress', {
    p_activity: (parsed as { activityId: string }).activityId, p_percent: (parsed as { percent: number }).percent,
  });
  const code = progressErrorCode(error);
  redirect(code ? `/mis-actividades?error=${code}${show}` : `/mis-actividades${show ? '?all=1' : ''}`);
}
