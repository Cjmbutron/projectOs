import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GanttChart } from '@/components/GanttChart';
import { UUID_RE } from '@/lib/http';
import { layoutGantt, type DepType } from '@/lib/gantt/layout';
import { createClient } from '@/lib/supabase/server';

export default async function GanttPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: sched }, { data: acts }, { data: deps }] = await Promise.all([
    supabase.from('project_schedules').select('schedule_version,computed_version,computed_start,computed_finish').eq('project_id', id).maybeSingle(),
    supabase.from('activities').select('id,name,duration,early_start,early_finish,is_critical').eq('project_id', id).order('sort_order').order('created_at'),
    supabase.from('activity_dependencies').select('predecessor_id,successor_id,type').eq('project_id', id),
  ]);
  const layout = layoutGantt(
    (acts ?? []).map((a) => ({ id: a.id, name: a.name, start: a.early_start, finish: a.early_finish, duration: a.duration, critical: a.is_critical === true })),
    (deps ?? []).map((d) => ({ predecessorId: d.predecessor_id, successorId: d.successor_id, type: d.type as DepType })),
  );
  const stale = sched && sched.computed_version !== sched.schedule_version;
  return (
    <main style={{ maxWidth: 'none' }}>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>Gantt</h1>
      {stale && <p className="err" role="status">El cronograma cambió desde el último cálculo: las fechas pueden estar desactualizadas. Recalcula desde el proyecto.</p>}
      {layout.bars.length === 0 ? (
        <p>{(acts ?? []).length === 0 ? 'Aún no hay actividades.' : 'Aún no hay fechas calculadas. Define la fecha de inicio y recalcula el cronograma.'}</p>
      ) : (
        <>
          <p className="legend">
            <span><i style={{ background: 'var(--accent)' }} />Actividad</span>
            <span><i style={{ background: 'var(--danger)' }} />Ruta crítica</span>
            <span>◆ Hito</span>
            {sched?.computed_start && <span>Plan: {sched.computed_start} → {sched.computed_finish}</span>}
          </p>
          <GanttChart layout={layout} />
          {layout.unscheduled.length > 0 && <p>{layout.unscheduled.length} actividad(es) sin fechas no se dibujan: recalcula el cronograma.</p>}
          <h2>Tabla</h2>
          <div className="card">
            <table><thead><tr><th>Actividad</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Crítica</th></tr></thead>
              <tbody>{(acts ?? []).map((a) => (
                <tr key={a.id}><td>{a.name}</td><td>{a.early_start ?? '—'}</td><td>{a.early_finish ?? '—'}</td><td>{a.duration}</td><td>{a.is_critical ? 'Sí' : 'No'}</td></tr>
              ))}</tbody></table>
          </div>
        </>
      )}
    </main>
  );
}
