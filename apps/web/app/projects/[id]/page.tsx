import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ImportCsv, RecalcButton } from '@/components';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { loadRange, overloadedAmong, shortDate, type LoadRow } from '@/lib/load';
import { canReportProgress, parseProgress, progressErrorCode, STATUS_LABEL } from '@/lib/progress';
import { formatHours, parseAssignForm, resourceErrorCode } from '@/lib/resources';
import { parseDependencyForm } from '@/lib/schedule/dependency-form';
import { actLabel, DEP_TYPE_LABEL, depLabel, parseDependencyUpdate, parseOpen, predecessorCandidates, successorCandidates } from '@/lib/schedule/dep-candidates';
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

async function reportProgress(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const parsed = parseProgress(formData);
  if (!parsed.ok) redirect(`/projects/${project}?error=${parsed.error}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_activity_progress', { p_activity: (parsed as { activityId: string }).activityId, p_percent: (parsed as { percent: number }).percent });
  const code = progressErrorCode(error);
  redirect(`/projects/${project}${code ? `?error=${code}` : ''}`);
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
  const open = parseOpen(formData.get('open'));
  const back = (code: string) => redirect(`/projects/${project}?${new URLSearchParams({ ...(code ? { error: code } : {}), ...(open ? { open } : {}) })}${open ? `#dep-${open}` : ''}`);
  // Desde el panel de una actividad: «other» es la otra punta y «direction» dice si esa actividad es sucesora (pred) o predecesora (succ)
  const other = String(formData.get('other') ?? '');
  const dir = String(formData.get('direction') ?? '');
  const d = parseDependencyForm(open && other ? {
    get: (k: string) => k === 'predecessor' ? (dir === 'succ' ? open : other) : k === 'successor' ? (dir === 'succ' ? other : open) : formData.get(k),
  } : formData);
  if (!d.ok) back(d.error);
  const dd = d as Extract<typeof d, { ok: true }>;
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('activity_dependencies').insert({
    organization_id: p.organization_id, project_id: project,
    predecessor_id: dd.predecessorId, successor_id: dd.successorId, type: dd.type, lag: dd.lag,
  });
  back(!error ? '' : error.message.includes('dependency_cycle') ? 'dependency_cycle' : error.code === '42501' ? 'forbidden' : error.code === '23505' ? 'duplicate_dependency' : 'invalid_dependency');
}

async function updateDependency(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const open = parseOpen(formData.get('open'));
  const back = (code: string) => redirect(`/projects/${project}?${new URLSearchParams({ ...(code ? { error: code } : {}), ...(open ? { open } : {}) })}${open ? `#dep-${open}` : ''}`);
  const u = parseDependencyUpdate(formData);
  if (!u.ok) back(u.error);
  const uu = u as Extract<typeof u, { ok: true }>;
  const supabase = await createClient();
  const { data, error } = await supabase.from('activity_dependencies').update({ type: uu.type, lag: uu.lag }).eq('id', uu.id).eq('project_id', project).select('id');
  back(error ? 'invalid_dependency' : !data?.length ? 'forbidden' : '');
}

async function assignResource(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const a = parseAssignForm(formData);
  if (!a.ok) redirect(`/projects/${project}?error=${a.error}`);
  const v = a as Extract<typeof a, { ok: true }>;
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).maybeSingle();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('activity_resources').insert({
    organization_id: p.organization_id, project_id: project, activity_id: v.activityId, resource_id: v.resourceId, allocation_percent: v.percent,
  });
  const code = resourceErrorCode(error, 'assignment');
  redirect(`/projects/${project}${code ? `?error=${code}` : ''}`);
}

async function unassignResource(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('activity_resources').delete().eq('id', id).eq('project_id', project).select('id');
  redirect(`/projects/${project}${error || !data?.length ? '?error=forbidden' : ''}`);
}

async function removeDependency(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('activity_dependencies').delete().eq('id', id).eq('project_id', project).select('id');
  // RLS no da error cuando no deja borrar: simplemente no afecta filas.
  const open = parseOpen(formData.get('open'));
  redirect(`/projects/${project}?${new URLSearchParams({ ...(error || !data?.length ? { error: 'forbidden' } : {}), ...(open ? { open } : {}) })}${open ? `#dep-${open}` : ''}`);
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; open?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,organization_id,code,name,status,progress_percent').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: sched }, { data: acts }, { data: deps }, { data: nodes }] = await Promise.all([
    supabase.from('project_schedules').select('start_date,schedule_version,computed_version,computed_start,computed_finish').eq('project_id', id).maybeSingle(),
    supabase.from('activities').select('id,name,duration,early_start,early_finish,total_float,is_critical,wbs_node_id,status,percent_complete,assignee_id').eq('project_id', id).order('sort_order').order('created_at'),
    supabase.from('activity_dependencies').select('id,predecessor_id,successor_id,type,lag').eq('project_id', id).order('created_at'),
    supabase.from('wbs_nodes').select('id,code,name').eq('project_id', id),
  ]);
  const { data: canEditData } = await supabase.rpc('can_edit_schedule', { p_project: id });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData.user?.id ?? null;
  const nodeCode = new Map((nodes ?? []).map((n) => [n.id, n.code]));
  const nameOf = new Map((acts ?? []).map((a) => [a.id, a.name]));
  const [{ data: assigns }, { data: resList }] = await Promise.all([
    supabase.from('activity_resources').select('id,activity_id,resource_id,allocation_percent').eq('project_id', id).order('created_at'),
    supabase.from('resources').select('id,name,daily_hours,active').order('name'),
  ]);
  // Asignar recursos: quien edita el cronograma o cualquier miembro interno del proyecto con rol de escritura (la BD decide de verdad)
  const { data: canAssignData } = await supabase.rpc('can_assign_resources', { p_project: id });
  const canAssign = canAssignData === true;
  const resName = new Map((resList ?? []).map((r) => [r.id, r.name]));
  // Aviso de sobreasignación (todos los proyectos): solo para quien puede ver la carga; si falla, no se muestra
  const range = loadRange((acts ?? []).map((a) => a.early_start), (acts ?? []).map((a) => a.early_finish));
  const assignedIds = [...new Set((assigns ?? []).map((x) => x.resource_id))];
  const loadRes = range && assignedIds.length > 0
    ? await supabase.rpc('resource_load', { p_org: project.organization_id, p_from: range.from, p_to: range.to })
    : null;
  const overloads = loadRes && !loadRes.error ? overloadedAmong((loadRes.data ?? []) as LoadRow[], assignedIds) : [];
  const stale = sched && sched.computed_version !== sched.schedule_version;
  return (
    <main>
      <p><Link href="/projects">← Proyectos</Link></p>
      <h1>{project.code} · {project.name}</h1>
      <p><Link href={`/projects/${id}/charter`}>Charter →</Link> · <Link href={`/projects/${id}/gantt`}>Gantt →</Link> · <Link href={`/projects/${id}/board`}>Tablero →</Link> · <Link href={`/projects/${id}/calendar`}>Calendario →</Link> · <Link href={`/projects/${id}/baseline`}>Líneas base →</Link> · <Link href={`/projects/${id}/wbs`}>WBS y entregables →</Link> · <Link href={`/projects/${id}/requirements`}>Requisitos y trazabilidad →</Link></p>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error === '42501' ? 'forbidden' : sp.error)}</p>}
      <div className="card">
        <form action={setStart} className="row">
          <input type="hidden" name="project" value={id} />
          <div><label htmlFor="start">Fecha de inicio</label><input id="start" type="date" name="start" defaultValue={sched?.start_date ?? ''} /></div>
          <button className="secondary">Guardar</button>
        </form>
        <p>Avance del proyecto: <strong>{Number(project.progress_percent ?? 0)} %</strong> (ponderado por duración).</p>
        <p>{sched?.computed_start ? `Plan: ${sched.computed_start} → ${sched.computed_finish}` : 'Sin calcular.'}{stale ? ' (desactualizado)' : ''}</p>
        <RecalcButton projectId={id} />
      </div>
      <div className="card">
        <table><thead><tr><th>Actividad</th><th>Días</th><th>Inicio</th><th>Fin</th><th>Holgura</th><th>WBS</th><th>Avance</th></tr></thead>
          <tbody>{(acts ?? []).map((a) => (
            <tr key={a.id}><td className={a.is_critical ? 'crit' : undefined}>{a.name}</td><td>{a.duration}</td>
              <td>{a.early_start ?? '—'}</td><td>{a.early_finish ?? '—'}</td><td>{a.total_float ?? '—'}</td><td>{a.wbs_node_id ? nodeCode.get(a.wbs_node_id) : '—'}</td>
              <td>
                <span>{a.percent_complete ?? 0} % · {STATUS_LABEL[a.status as string] ?? a.status}</span>
                {canReportProgress({ canEditSchedule: canEditData === true, userId: me, assigneeId: a.assignee_id }) && (
                  <form action={reportProgress} className="row" style={{ flexWrap: 'nowrap' }}>
                    <input type="hidden" name="project" value={id} /><input type="hidden" name="activity" value={a.id} />
                    {a.duration === 0 ? (
                      <select name="percent" defaultValue={String(a.percent_complete ?? 0)} aria-label={`Estado del hito ${a.name}`}>
                        <option value="0">Pendiente</option><option value="100">Cumplido</option>
                      </select>
                    ) : (
                      <input name="percent" type="number" min={0} max={100} step={1} defaultValue={a.percent_complete ?? 0} aria-label={`Avance de ${a.name} (%)`} style={{ width: '5rem' }} />
                    )}
                    <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
                  </form>
                )}
              </td></tr>
          ))}</tbody></table>
        {(acts ?? []).length === 0 && <p>Sin actividades.</p>}
      </div>
      <div className="card">
        <h2>Recursos asignados</h2>
        {canAssign && canEditData !== true && <p style={{ color: 'var(--muted)' }}>Como miembro del proyecto puedes asignar recursos a cualquier actividad; no modifica el cronograma.</p>}
        {overloads.length > 0 && (
          <p role="status" className="err">
            Sobreasignación (suma todos los proyectos): {overloads.map((o) => `${resName.get(o.resourceId) ?? '—'} en ${o.weeks.length} semana(s), desde el ${shortDate(o.weeks[0])}`).join('; ')}.{' '}
            <Link href={`/resources/load?from=${overloads.map((o) => o.weeks[0]).sort()[0]}`}>Ver carga semanal</Link>
          </p>
        )}
        {(assigns ?? []).length === 0 ? <p>Sin recursos asignados.</p> : (
          <table><thead><tr><th>Actividad</th><th>Recurso</th><th>Dedicación</th>{canAssign && <th></th>}</tr></thead>
            <tbody>{(assigns ?? []).map((x) => (
              <tr key={x.id}><td>{nameOf.get(x.activity_id)}</td><td>{resName.get(x.resource_id) ?? '—'}</td><td>{x.allocation_percent} %</td>
                {canAssign && (
                  <td><form action={unassignResource}><input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={x.id} />
                    <button className="secondary" style={{ marginTop: 0 }}>Quitar</button></form></td>
                )}</tr>
            ))}</tbody></table>
        )}
        {canAssign && (acts ?? []).length > 0 && (resList ?? []).some((r) => r.active) && (
          <form action={assignResource}>
            <input type="hidden" name="project" value={id} />
            <label htmlFor="as-activity">Actividad</label>
            <select id="as-activity" name="activity" required>{(acts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <label htmlFor="as-resource">Recurso</label>
            <select id="as-resource" name="resource" required>{(resList ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} ({formatHours(Number(r.daily_hours))}/día)</option>)}</select>
            <label htmlFor="as-percent">Dedicación (% de su jornada, 1 a 100)</label>
            <input id="as-percent" name="percent" type="number" min={1} max={100} step={1} defaultValue={100} required />
            <button>Asignar recurso</button>
          </form>
        )}
        {canAssign && (resList ?? []).filter((r) => r.active).length === 0 && <p style={{ color: 'var(--muted)' }}>No hay recursos activos. <Link href="/resources">Crear recursos</Link></p>}
      </div>
      <div className="card">
        <h2>Dependencias</h2>
        <p style={{ color: 'var(--muted)' }}>
          Abre una actividad para ver sus predecesoras y sucesoras, cambiar su tipo o desfase y agregar más. La lista solo ofrece actividades que no crean un ciclo.
          Tras cambiar dependencias, recalcula el cronograma.
        </p>
        {(acts ?? []).length === 0 ? <p>Sin actividades.</p> : (acts ?? []).map((a, i) => {
          const preds = (deps ?? []).filter((d) => d.successor_id === a.id);
          const succs = (deps ?? []).filter((d) => d.predecessor_id === a.id);
          const label = (id: string) => { const k = (acts ?? []).findIndex((x) => x.id === id); return k < 0 ? '—' : actLabel(k, nameOf.get(id) ?? ''); };
          const row = (d: (typeof preds)[number], shown: string) => (
            <li key={d.id} style={{ marginBottom: 6 }}>
              <span>{shown}</span>{' '}
              {canEditData === true && <form action={updateDependency} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="open" value={a.id} />
                <select name="type" defaultValue={d.type} aria-label="Tipo">{(Object.keys(DEP_TYPE_LABEL) as (keyof typeof DEP_TYPE_LABEL)[]).map((t) => <option key={t} value={t}>{DEP_TYPE_LABEL[t]}</option>)}</select>
                <input name="lag" type="number" min={-36500} max={36500} defaultValue={d.lag} aria-label="Desfase en días hábiles" style={{ width: 80 }} />
                <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
              </form>}
              {canEditData !== true && <span> · {depLabel(d.type, d.lag)}</span>}
              {canEditData === true && (
                <form action={removeDependency} style={{ display: 'inline' }}>
                  <input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="open" value={a.id} />
                  <button className="secondary" style={{ marginTop: 0 }}>Quitar</button>
                </form>
              )}
            </li>
          );
          const addForm = (dir: 'pred' | 'succ', options: { id: string; name: string }[]) => options.length === 0 ? <p style={{ color: 'var(--muted)' }}>No hay actividades disponibles (todas ya están relacionadas o crearían un ciclo).</p> : (
            <form action={addDependency} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="hidden" name="project" value={id} /><input type="hidden" name="open" value={a.id} /><input type="hidden" name="direction" value={dir === 'pred' ? 'pred' : 'succ'} />
              <select name="other" required aria-label={dir === 'pred' ? 'Nueva predecesora' : 'Nueva sucesora'}>
                {options.map((o) => <option key={o.id} value={o.id}>{label(o.id)}</option>)}
              </select>
              <select name="type" defaultValue="FS" aria-label="Tipo">{(Object.keys(DEP_TYPE_LABEL) as (keyof typeof DEP_TYPE_LABEL)[]).map((t) => <option key={t} value={t}>{DEP_TYPE_LABEL[t]}</option>)}</select>
              <input name="lag" type="number" min={-36500} max={36500} defaultValue={0} aria-label="Desfase en días hábiles" style={{ width: 80 }} />
              <button style={{ marginTop: 0 }}>{dir === 'pred' ? 'Agregar predecesora' : 'Agregar sucesora'}</button>
            </form>
          );
          return (
            <details key={a.id} id={`dep-${a.id}`} open={sp.open === a.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <summary>{actLabel(i, a.name)} — {preds.length} predecesora(s), {succs.length} sucesora(s)</summary>
              <h3>Predecesoras</h3>
              {preds.length === 0 ? <p>Ninguna.</p> : <ul>{preds.map((d) => row(d, label(d.predecessor_id)))}</ul>}
              {canEditData === true && addForm('pred', predecessorCandidates(acts ?? [], deps ?? [], a.id))}
              <h3>Sucesoras</h3>
              {succs.length === 0 ? <p>Ninguna.</p> : <ul>{succs.map((d) => row(d, label(d.successor_id)))}</ul>}
              {canEditData === true && addForm('succ', successorCandidates(acts ?? [], deps ?? [], a.id))}
            </details>
          );
        })}
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
