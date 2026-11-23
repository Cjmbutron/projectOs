import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ImportCsv, RecalcButton } from '@/components';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { parseDependencyForm } from '@/lib/schedule/dependency-form';
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
    wbs_node_id: UUID_RE.test(String(formData.get('node') ?? '')) ? String(formData.get('node')) : null,
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

async function addDependency(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const d = parseDependencyForm(formData);
  if (!d.ok) redirect(`/projects/${project}?error=${d.error}`);
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('activity_dependencies').insert({
    organization_id: p.organization_id, project_id: project,
    predecessor_id: d.predecessorId, successor_id: d.successorId, type: d.type, lag: d.lag,
  });
  const code = !error ? '' : error.message.includes('dependency_cycle') ? 'dependency_cycle' : error.code === '42501' ? 'forbidden' : error.code === '23505' ? 'duplicate_dependency' : 'invalid_dependency';
  redirect(`/projects/${project}${code ? `?error=${code}` : ''}`);
}

async function removeDependency(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('activity_dependencies').delete().eq('id', id).eq('project_id', project).select('id');
  // RLS no da error cuando no deja borrar: simplemente no afecta filas.
  redirect(`/projects/${project}${error || !data?.length ? '?error=forbidden' : ''}`);
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: sched }, { data: acts }, { data: deps }, { data: nodes }] = await Promise.all([
    supabase.from('project_schedules').select('start_date,schedule_version,computed_version,computed_start,computed_finish').eq('project_id', id).maybeSingle(),
    supabase.from('activities').select('id,name,duration,early_start,early_finish,total_float,is_critical,wbs_node_id').eq('project_id', id).order('sort_order').order('created_at'),
    supabase.from('activity_dependencies').select('id,predecessor_id,successor_id,type,lag').eq('project_id', id).order('created_at'),
    supabase.from('wbs_nodes').select('id,code,name').eq('project_id', id),
  ]);
  const nodeCode = new Map((nodes ?? []).map((n) => [n.id, n.code]));
  const nameOf = new Map((acts ?? []).map((a) => [a.id, a.name]));
  const stale = sched && sched.computed_version !== sched.schedule_version;
  return (
    <main>
      <p><Link href="/projects">← Proyectos</Link></p>
      <h1>{project.code} · {project.name}</h1>
      <p><Link href={`/projects/${id}/charter`}>Charter →</Link> · <Link href={`/projects/${id}/gantt`}>Gantt →</Link> · <Link href={`/projects/${id}/wbs`}>WBS y entregables →</Link> · <Link href={`/projects/${id}/requirements`}>Requisitos y trazabilidad →</Link></p>
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
        <table><thead><tr><th>Actividad</th><th>Días</th><th>Inicio</th><th>Fin</th><th>Holgura</th><th>WBS</th></tr></thead>
          <tbody>{(acts ?? []).map((a) => (
            <tr key={a.id}><td className={a.is_critical ? 'crit' : undefined}>{a.name}</td><td>{a.duration}</td>
              <td>{a.early_start ?? '—'}</td><td>{a.early_finish ?? '—'}</td><td>{a.total_float ?? '—'}</td><td>{a.wbs_node_id ? nodeCode.get(a.wbs_node_id) : '—'}</td></tr>
          ))}</tbody></table>
        {(acts ?? []).length === 0 && <p>Sin actividades.</p>}
      </div>
      <div className="card">
        <h2>Dependencias</h2>
        {(deps ?? []).length === 0 ? <p>Sin dependencias.</p> : (
          <table><thead><tr><th>Predecesora</th><th>Sucesora</th><th>Tipo</th><th>Desfase</th><th></th></tr></thead>
            <tbody>{(deps ?? []).map((d) => (
              <tr key={d.id}><td>{nameOf.get(d.predecessor_id)}</td><td>{nameOf.get(d.successor_id)}</td><td>{d.type}</td><td>{d.lag}</td>
                <td><form action={removeDependency}><input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={d.id} />
                  <button className="secondary" style={{ marginTop: 0 }}>Quitar</button></form></td></tr>
            ))}</tbody></table>
        )}
        {(acts ?? []).length >= 2 && (
          <form action={addDependency}>
            <input type="hidden" name="project" value={id} />
            <label htmlFor="predecessor">Predecesora</label>
            <select id="predecessor" name="predecessor" required>{(acts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <label htmlFor="successor">Sucesora</label>
            <select id="successor" name="successor" required>{(acts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <label htmlFor="type">Tipo</label>
            <select id="type" name="type" defaultValue="FS"><option value="FS">Fin a inicio (FS)</option><option value="SS">Inicio a inicio (SS)</option><option value="FF">Fin a fin (FF)</option><option value="SF">Inicio a fin (SF)</option></select>
            <label htmlFor="lag">Desfase (días hábiles, puede ser negativo)</label>
            <input id="lag" name="lag" type="number" min={-36500} max={36500} defaultValue={0} />
            <button>Agregar dependencia</button>
          </form>
        )}
      </div>
      <div className="card"><ImportCsv projectId={id} /></div>
      <form action={addActivity} className="card">
        <h2>Nueva actividad</h2>
        <input type="hidden" name="project" value={id} />
        <label htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={200} />
        <label htmlFor="duration">Duración (días hábiles)</label><input id="duration" name="duration" type="number" min={0} max={36500} defaultValue={1} />
        <label htmlFor="node">Nodo de la WBS (opcional)</label>
        <select id="node" name="node" defaultValue=""><option value="">(ninguno)</option>
          {[...(nodes ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select>
        <button>Agregar</button>
      </form>
    </main>
  );
}
