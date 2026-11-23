'use server';
import { UUID_RE } from '@/lib/http';
import { validateDuration, validateMoveDate } from '@/lib/gantt/drag';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

export type MoveResult = { ok: true } | { ok: false; error: string };

/**
 * Arrastrar una barra fija la restricción «no empezar antes de» (SNET) de la actividad.
 * Las fechas finales las sigue calculando el motor al recalcular; la autorización es de la base de datos (RLS).
 */
export async function moveActivity(projectId: string, activityId: string, date: string): Promise<MoveResult> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(activityId)) return { ok: false, error: 'invalid_value' };
  const v = validateMoveDate(date);
  if (!v.ok) return v;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('organization_id').eq('id', projectId).maybeSingle();
  if (!project) return { ok: false, error: 'project_not_found' };
  const upd = await supabase.from('activity_constraints').update({ date: v.date })
    .eq('project_id', projectId).eq('activity_id', activityId).eq('type', 'SNET').select('id');
  if (upd.error) return { ok: false, error: scopeErrorCode(upd.error) };
  if (upd.data && upd.data.length > 0) return { ok: true };
  const ins = await supabase.from('activity_constraints').insert({
    organization_id: project.organization_id, project_id: projectId, activity_id: activityId, type: 'SNET', date: v.date,
  });
  return ins.error ? { ok: false, error: scopeErrorCode(ins.error) } : { ok: true };
}

/** Redimensionar una barra cambia la duración (en días laborables); el motor recalcula las fechas. */
export async function resizeActivity(projectId: string, activityId: string, duration: number): Promise<MoveResult> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(activityId)) return { ok: false, error: 'invalid_value' };
  const v = validateDuration(duration);
  if (!v.ok) return v;
  const supabase = await createClient();
  const { data, error } = await supabase.from('activities').update({ duration: v.duration })
    .eq('project_id', projectId).eq('id', activityId).select('id');
  if (error) return { ok: false, error: scopeErrorCode(error) };
  return data && data.length > 0 ? { ok: true } : { ok: false, error: 'forbidden' };
}
