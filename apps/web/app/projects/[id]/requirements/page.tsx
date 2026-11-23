import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

const STATUS = { proposed: 'Propuesto', approved: 'Aprobado', implemented: 'Implementado', verified: 'Verificado', rejected: 'Rechazado' } as const;
const back = (project: string, error = '') => redirect(`/projects/${project}/requirements${error ? `?error=${error}` : ''}`);

async function addRequirement(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('requirements').insert({
    organization_id: p.organization_id, project_id: project,
    description: String(formData.get('description') ?? '').trim(), source: String(formData.get('source') ?? '').trim(),
  });
  back(project, scopeErrorCode(error));
}

async function setStatus(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  if (!Object.keys(STATUS).includes(status)) back(project, 'invalid_value');
  const supabase = await createClient();
  const { data, error } = await supabase.from('requirements').update({ status }).eq('id', id).eq('project_id', project).select('id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

async function deleteRequirement(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('requirements').delete().eq('id', id).eq('project_id', project).select('id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

async function link(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const req = String(formData.get('requirement'));
  const del = String(formData.get('deliverable'));
  if (!UUID_RE.test(project) || !UUID_RE.test(req) || !UUID_RE.test(del)) redirect('/projects');
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('requirement_deliverables').insert({
    organization_id: p.organization_id, project_id: project, requirement_id: req, deliverable_id: del,
  });
  back(project, scopeErrorCode(error));
}

async function unlink(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const req = String(formData.get('requirement'));
  const del = String(formData.get('deliverable'));
  if (!UUID_RE.test(project) || !UUID_RE.test(req) || !UUID_RE.test(del)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('requirement_deliverables').delete()
    .eq('requirement_id', req).eq('deliverable_id', del).eq('project_id', project).select('requirement_id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

export default async function RequirementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: reqs }, { data: dels }, { data: links }] = await Promise.all([
    supabase.from('requirement_traceability').select('requirement_id,code,description,source,status,deliverables,deliverables_accepted,activities').eq('project_id', id).order('code'),
    supabase.from('deliverables').select('id,name').eq('project_id', id).order('created_at'),
    supabase.from('requirement_deliverables').select('requirement_id,deliverable_id').eq('project_id', id),
  ]);
  const delName = new Map((dels ?? []).map((d) => [d.id, d.name]));
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const total = reqs?.length ?? 0;
  const covered = (reqs ?? []).filter((r) => r.deliverables > 0).length;
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link> · <Link href={`/projects/${id}/wbs`}>WBS y entregables</Link></p>
      <h1>Requisitos y trazabilidad</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>Aprobar, rechazar o reabrir un requisito lo hace el PM; el equipo líder registra y hace avanzar los ya aprobados.</p>
      <p>{total === 0 ? 'Sin requisitos.' : `${covered} de ${total} requisitos tienen al menos un entregable.`}</p>
      {(reqs ?? []).map((r) => {
        const mine = (links ?? []).filter((l) => l.requirement_id === r.requirement_id);
        const linked = new Set(mine.map((l) => l.deliverable_id));
        const free = (dels ?? []).filter((d) => !linked.has(d.id));
        return (
          <div className="card" key={r.requirement_id}>
            <div className="row"><strong>{r.code}</strong>
              <form action={setStatus} className="row" style={{ flexWrap: 'nowrap' }}>
                {hidden('project', id)}{hidden('id', r.requirement_id)}
                <select name="status" defaultValue={r.status} aria-label={`Estado de ${r.code}`}>
                  {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
              </form>
            </div>
            <p>{r.description}</p>
            <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Origen: {r.source} · Entregables: {r.deliverables} ({r.deliverables_accepted} aceptados) · Actividades: {r.activities}</p>
            <ul>{mine.map((l) => (
              <li key={l.deliverable_id}>{delName.get(l.deliverable_id) ?? '—'}{' '}
                <form action={unlink} style={{ display: 'inline' }}>{hidden('project', id)}{hidden('requirement', r.requirement_id)}{hidden('deliverable', l.deliverable_id)}
                  <button className="secondary" style={{ marginTop: 0, padding: '2px 8px' }}>Quitar</button></form></li>
            ))}</ul>
            {free.length > 0 && (
              <form action={link} className="row" style={{ justifyContent: 'flex-start' }}>
                {hidden('project', id)}{hidden('requirement', r.requirement_id)}
                <select name="deliverable" aria-label={`Vincular entregable a ${r.code}`}>{free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                <button className="secondary" style={{ marginTop: 0 }}>Vincular entregable</button>
              </form>
            )}
            <form action={deleteRequirement}>{hidden('project', id)}{hidden('id', r.requirement_id)}
              <button className="secondary" style={{ marginTop: 8 }}>Borrar requisito</button></form>
          </div>
        );
      })}
      <form action={addRequirement} className="card">
        <h2>Nuevo requisito</h2>
        {hidden('project', id)}
        <label htmlFor="r-desc">Descripción</label><input id="r-desc" name="description" required maxLength={4000} />
        <label htmlFor="r-src">Origen (quién lo pidió)</label><input id="r-src" name="source" required maxLength={200} />
        <button>Agregar requisito</button>
      </form>
    </main>
  );
}
