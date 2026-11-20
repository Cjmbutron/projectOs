import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { depthOf, indentTarget, orderNodes, outdentTarget, reorderTarget, scopeErrorCode, type WbsNode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

const back = (project: string, error = '') => redirect(`/projects/${project}/wbs${error ? `?error=${error}` : ''}`);
const uuidOrNull = (v: FormDataEntryValue | null) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

async function addNode(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const supabase = await createClient();
  const { error } = await supabase.rpc('wbs_add_node', {
    p_project: project, p_parent: uuidOrNull(formData.get('parent')), p_name: String(formData.get('name') ?? '').trim(),
  });
  back(project, scopeErrorCode(error));
}

async function moveNode(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  const action = String(formData.get('action'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data } = await supabase.from('wbs_nodes').select('id,parent_id,position,code,name').eq('project_id', project);
  const nodes = (data ?? []) as WbsNode[];
  const target =
    action === 'up' || action === 'down' ? reorderTarget(nodes, id, action)
    : action === 'indent' ? indentTarget(nodes, id)
    : action === 'outdent' ? outdentTarget(nodes, id) : null;
  if (!target) back(project);
  const { error } = await supabase.rpc('wbs_move_node', { p_node: id, p_parent: target!.parent, p_position: target!.position });
  back(project, scopeErrorCode(error));
}

async function deleteNode(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { error } = await supabase.rpc('wbs_delete_node', { p_node: id });
  back(project, scopeErrorCode(error));
}

async function renameNode(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('wbs_nodes').update({ name: String(formData.get('name') ?? '').trim() }).eq('id', id).eq('project_id', project).select('id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

async function addDeliverable(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('deliverables').insert({
    organization_id: p.organization_id, project_id: project, wbs_node_id: uuidOrNull(formData.get('node')),
    name: String(formData.get('name') ?? '').trim(), acceptance_criteria: String(formData.get('criteria') ?? '').trim() || null,
  });
  back(project, scopeErrorCode(error));
}

async function setDeliverableStatus(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const field = String(formData.get('field'));
  const value = String(formData.get('value'));
  const allowed: Record<string, string[]> = { authoring_status: ['draft', 'in_progress', 'completed'], review_status: ['pending', 'in_review', 'accepted', 'rejected'] };
  if (!allowed[field]?.includes(value)) back(project, 'invalid_value');
  const supabase = await createClient();
  const { data, error } = await supabase.from('deliverables').update({ [field]: value }).eq('id', id).eq('project_id', project).select('id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

const AUTH = { draft: 'Borrador', in_progress: 'En elaboración', completed: 'Completado' } as const;
const REV = { pending: 'Pendiente', in_review: 'En revisión', accepted: 'Aceptado', rejected: 'Rechazado' } as const;

export default async function WbsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: raw }, { data: dels }] = await Promise.all([
    supabase.from('wbs_nodes').select('id,parent_id,position,code,name').eq('project_id', id),
    supabase.from('deliverables').select('id,wbs_node_id,name,acceptance_criteria,authoring_status,review_status').eq('project_id', id).order('created_at'),
  ]);
  const nodes = orderNodes((raw ?? []) as WbsNode[]);
  const codeOf = new Map(nodes.map((n) => [n.id, n.code]));
  const hidden = <T extends string>(name: string, value: T) => <input type="hidden" name={name} value={value} />;
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>WBS y entregables</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      <div className="card">
        <h2>Estructura de desglose</h2>
        {nodes.length === 0 ? <p>Aún no hay nodos.</p> : (
          <table><thead><tr><th>Código</th><th>Nombre</th><th>Acciones</th></tr></thead>
            <tbody>{nodes.map((n) => (
              <tr key={n.id}>
                <td>{n.code}</td>
                <td style={{ paddingLeft: 8 + depthOf(n.code) * 20 }}>
                  <form action={renameNode} className="row" style={{ flexWrap: 'nowrap' }}>
                    {hidden('project', id)}{hidden('id', n.id)}
                    <input name="name" defaultValue={n.name} required maxLength={200} aria-label={`Nombre de ${n.code}`} />
                    <button className="secondary" style={{ marginTop: 0 }}>Renombrar</button>
                  </form>
                </td>
                <td>
                  <form action={moveNode} className="row" style={{ justifyContent: 'flex-start' }}>
                    {hidden('project', id)}{hidden('id', n.id)}
                    {(['up', 'down', 'indent', 'outdent'] as const).map((a) => (
                      <button key={a} name="action" value={a} className="secondary" style={{ marginTop: 0 }}
                        aria-label={{ up: 'Subir', down: 'Bajar', indent: 'Sangrar', outdent: 'Quitar sangría' }[a]}>
                        {{ up: '↑', down: '↓', indent: '→', outdent: '←' }[a]}
                      </button>
                    ))}
                  </form>
                  <form action={deleteNode}>{hidden('project', id)}{hidden('id', n.id)}
                    <button className="secondary" style={{ marginTop: 4 }}>Borrar</button></form>
                </td>
              </tr>
            ))}</tbody></table>
        )}
        <form action={addNode}>
          {hidden('project', id)}
          <label htmlFor="n-name">Nuevo nodo</label><input id="n-name" name="name" required maxLength={200} />
          <label htmlFor="n-parent">Dentro de</label>
          <select id="n-parent" name="parent" defaultValue=""><option value="">(raíz)</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select>
          <button>Agregar nodo</button>
        </form>
      </div>
      <div className="card">
        <h2>Entregables</h2>
        {(dels ?? []).length === 0 ? <p>Sin entregables.</p> : (
          <table><thead><tr><th>Entregable</th><th>Nodo</th><th>Elaboración</th><th>Revisión</th></tr></thead>
            <tbody>{(dels ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.name}{d.acceptance_criteria ? <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{d.acceptance_criteria}</div> : null}</td>
                <td>{d.wbs_node_id ? codeOf.get(d.wbs_node_id) : '—'}</td>
                {(['authoring_status', 'review_status'] as const).map((field) => (
                  <td key={field}>
                    <form action={setDeliverableStatus}>
                      {hidden('project', id)}{hidden('id', d.id)}{hidden('field', field)}
                      <select name="value" defaultValue={d[field]} aria-label={field === 'authoring_status' ? 'Estado de elaboración' : 'Estado de revisión'}>
                        {Object.entries(field === 'authoring_status' ? AUTH : REV).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <button className="secondary" style={{ marginTop: 4 }}>Guardar</button>
                    </form>
                  </td>
                ))}
              </tr>
            ))}</tbody></table>
        )}
        <form action={addDeliverable}>
          {hidden('project', id)}
          <label htmlFor="d-name">Nuevo entregable</label><input id="d-name" name="name" required maxLength={200} />
          <label htmlFor="d-node">Nodo de la WBS</label>
          <select id="d-node" name="node" defaultValue=""><option value="">(sin nodo)</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select>
          <label htmlFor="d-crit">Criterios de aceptación</label><input id="d-crit" name="criteria" maxLength={4000} />
          <button>Agregar entregable</button>
        </form>
      </div>
    </main>
  );
}
