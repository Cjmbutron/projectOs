'use server';
import { UUID_RE } from '@/lib/http';
import { parseDependencyForm } from '@/lib/schedule/dependency-form';
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

/** Crea una dependencia entre dos actividades; la base de datos rechaza ciclos, duplicados y permisos. */
export async function addLink(projectId: string, predecessorId: string, successorId: string, type: string): Promise<MoveResult> {
  const d = parseDependencyForm({ get: (k: string) => ({ predecessor: predecessorId, successor: successorId, type, lag: '0' } as Record<string, string>)[k] });
  if (!UUID_RE.test(projectId) || !d.ok) return { ok: false, error: 'invalid_dependency' };
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', projectId).maybeSingle();
  if (!p) return { ok: false, error: 'project_not_found' };
  const { error } = await supabase.from('activity_dependencies').insert({
    organization_id: p.organization_id, project_id: projectId,
    predecessor_id: d.predecessorId, successor_id: d.successorId, type: d.type, lag: 0,
  });
  if (!error) return { ok: true };
  const code = error.message.includes('dependency_cycle') ? 'dependency_cycle' : error.code === '42501' ? 'forbidden' : error.code === '23505' ? 'duplicate_dependency' : scopeErrorCode(error) === 'project_read_only' ? 'project_read_only' : 'invalid_dependency';
  return { ok: false, error: code };
}
