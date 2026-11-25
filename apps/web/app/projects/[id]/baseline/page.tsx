import Link from 'next/link';
import { formatDay } from '@/lib/dates';
import { notFound, redirect } from 'next/navigation';
import { compareBaseline, formatVariance, type Status } from '@/lib/baseline/compare';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

async function createBaseline(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const name = String(formData.get('name') ?? '').trim();
  if (!name || name.length > 120) redirect(`/projects/${project}/baseline?error=invalid_value`);
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_baseline', { p_project: project, p_name: name });
  redirect(`/projects/${project}/baseline${error ? `?error=${scopeErrorCode(error)}` : ''}`);
}

const STATUS_ES: Record<Status, string> = { unchanged: 'Sin cambios', changed: 'Cambió', added: 'Nueva', removed: 'Eliminada', unscheduled: 'Sin calcular' };

export default async function BaselinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; v?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name').eq('id', id).maybeSingle();
  if (!project) notFound();
  const { data: baselines } = await supabase.from('baselines').select('id,version,name,project_start,project_finish,captured_at').eq('project_id', id).order('version', { ascending: false });
  const wanted = Number(sp.v);
  const selected = (baselines ?? []).find((b) => b.version === wanted) ?? (baselines ?? [])[0];

  let comparison: ReturnType<typeof compareBaseline> | null = null;
  let stale = false;
  if (selected) {
    const [{ data: baseActs }, { data: acts }, { data: sched }, { data: days }] = await Promise.all([
      supabase.from('baseline_activities').select('activity_id,name,start_date,finish_date,duration').eq('baseline_id', selected.id),
      supabase.from('activities').select('id,name,duration,early_start,early_finish').eq('project_id', id).order('sort_order'),
      supabase.from('project_schedules').select('working_weekdays,computed_finish,schedule_version,computed_version').eq('project_id', id).maybeSingle(),
      supabase.from('project_calendar_days').select('day,kind').eq('project_id', id),
    ]);
    stale = !!sched && sched.computed_version !== sched.schedule_version;
    comparison = compareBaseline(
      { project_finish: selected.project_finish, activities: baseActs ?? [] },
      { project_finish: sched?.computed_finish ?? null, activities: acts ?? [] },
      {
        workingWeekdays: sched?.working_weekdays ?? [1, 2, 3, 4, 5],
        holidays: (days ?? []).filter((d) => d.kind === 'holiday').map((d) => d.day),
        workingExceptions: (days ?? []).filter((d) => d.kind === 'working').map((d) => d.day),
      },
    );
  }
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>Líneas base</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      <form action={createBaseline} className="card">
        <input type="hidden" name="project" value={id} />
        <label htmlFor="b-name">Nueva línea base (captura el cronograma calculado actual; no se puede modificar después)</label>
        <input id="b-name" name="name" required maxLength={120} placeholder="Ej.: Plan aprobado" />
        <button>Crear línea base</button>
      </form>
      {(baselines ?? []).length === 0 ? <p>Aún no hay líneas base.</p> : (
        <>
          <div className="card">
            <table><thead><tr><th>Versión</th><th>Nombre</th><th>Inicio</th><th>Fin</th><th>Capturada</th></tr></thead>
              <tbody>{(baselines ?? []).map((b) => (
                <tr key={b.id}><td><Link href={`/projects/${id}/baseline?v=${b.version}`}>v{b.version}{b.id === selected?.id ? ' ✓' : ''}</Link></td>
                  <td>{b.name}</td><td>{formatDay(b.project_start)}</td><td>{formatDay(b.project_finish)}</td><td>{formatDay(b.captured_at)}</td></tr>
              ))}</tbody></table>
          </div>
          {selected && comparison && (
            <div className="card">
              <h2>Planificado vs. actual · v{selected.version} «{selected.name}»</h2>
              {stale && <p className="err" role="status">El cronograma cambió desde el último cálculo: la comparación usa las últimas fechas calculadas. Recalcula para actualizarla.</p>}
              <p>
                Fin del proyecto: {formatVariance(comparison.projectFinishVariance)} · Sin cambios: {comparison.counts.unchanged} · Cambiaron: {comparison.counts.changed}
                · Nuevas: {comparison.counts.added} · Eliminadas: {comparison.counts.removed}
                {comparison.counts.unscheduled > 0 ? ` · Sin calcular: ${comparison.counts.unscheduled}` : ''}
              </p>
              <table><thead><tr><th>Actividad</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Duración</th></tr></thead>
                <tbody>{comparison.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td><td>{STATUS_ES[r.status]}</td>
                    <td>{formatVariance(r.startVariance)}</td>
                    <td className={r.finishVariance && r.finishVariance > 0 ? 'crit' : undefined}>{formatVariance(r.finishVariance)}</td>
                    <td>{formatVariance(r.durationVariance)}</td>
                  </tr>
                ))}</tbody></table>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Las variaciones se miden en días laborables del calendario del proyecto; positivo = más tarde que lo planificado.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
