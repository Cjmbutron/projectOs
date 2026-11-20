import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RecalcButton } from '@/components';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

async function addActivity(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const project = String(formData.get('project'));
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('activities').insert({
    organization_id: p.organization_id,
    project_id: project,
    name: String(formData.get('name') ?? '').trim(),
    duration: Math.max(0, Math.min(36500, Number(formData.get('duration') ?? 1) || 0)),
  });
  redirect(`/projects/${project}${error ? `?error=${encodeURIComponent(error.code ?? 'forbidden')}` : ''}`);
}

async function setStart(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const project = String(formData.get('project'));
  const start = String(formData.get('start') ?? '');
  const { error } = await supabase.from('project_schedules').update({ start_date: start || null }).eq('project_id', project);
  redirect(`/projects/${project}${error ? '?error=forbidden' : ''}`);
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: sched }, { data: acts }] = await Promise.all([
    supabase.from('project_schedules').select('start_date,schedule_version,computed_version,computed_start,computed_finish').eq('project_id', id).maybeSingle(),
    supabase.from('activities').select('id,name,duration,early_start,early_finish,total_float,is_critical').eq('project_id', id).order('sort_order').order('created_at'),
  ]);
  const stale = sched && sched.computed_version !== sched.schedule_version;
  return (
    <main>
      <p><Link href="/projects">← Proyectos</Link></p>
      <h1>{project.code} · {project.name}</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error === '42501' ? 'forbidden' : sp.error)}</p>}
      <div className="card">
        <form action={setStart} className="row">
          <input type="hidden" name="project" value={id} />
          <div><label htmlFor="start">Fecha de inicio</label><input id="start" type="date" name="start" defaultValue={sched?.start_date ?? ''} /></div>
          <button className="secondary">Guardar</button>
        </form>
        <p>{sched?.computed_start ? `Plan: ${sched.computed_start} → ${sched.computed_finish}` : 'Sin calcular.'}{stale ? ' (desactualizado)' : ''}</p>
        <RecalcButton projectId={id} />
      </div>
      <div className="card">
        <table><thead><tr><th>Actividad</th><th>Días</th><th>Inicio</th><th>Fin</th><th>Holgura</th></tr></thead>
          <tbody>{(acts ?? []).map((a) => (
            <tr key={a.id}><td className={a.is_critical ? 'crit' : undefined}>{a.name}</td><td>{a.duration}</td>
              <td>{a.early_start ?? '—'}</td><td>{a.early_finish ?? '—'}</td><td>{a.total_float ?? '—'}</td></tr>
          ))}</tbody></table>
        {(acts ?? []).length === 0 && <p>Sin actividades.</p>}
      </div>
      <form action={addActivity} className="card">
        <h2>Nueva actividad</h2>
        <input type="hidden" name="project" value={id} />
        <label htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={200} />
        <label htmlFor="duration">Duración (días hábiles)</label><input id="duration" name="duration" type="number" min={0} max={36500} defaultValue={1} />
        <button>Agregar</button>
      </form>
    </main>
  );
}
