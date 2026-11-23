import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { UUID_RE } from '@/lib/http';
import { CHARTER_FIELDS, describeMissing, parseCharterForm, parseStakeholderForm, statusActions } from '@/lib/scope/charter';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

const back = (project: string, error = '') => redirect(`/projects/${project}/charter${error ? `?error=${error}` : ''}`);

async function saveCharter(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const parsed = parseCharterForm(formData);
  if (!parsed.ok) back(project, parsed.error);
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { data: existing } = await supabase.from('project_charters').select('project_id').eq('project_id', project).maybeSingle();
  const values = (parsed as { ok: true; values: Record<string, string | null> }).values;
  const { error } = existing
    ? await supabase.from('project_charters').update(values).eq('project_id', project)
    : await supabase.from('project_charters').insert({ project_id: project, organization_id: p.organization_id, ...values });
  back(project, scopeErrorCode(error));
}

async function addStakeholder(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  if (!UUID_RE.test(project)) redirect('/projects');
  const parsed = parseStakeholderForm(formData);
  if (!parsed.ok) back(project, parsed.error);
  const supabase = await createClient();
  const { data: p } = await supabase.from('projects').select('organization_id').eq('id', project).single();
  if (!p) redirect('/projects');
  const { error } = await supabase.from('project_stakeholders').insert({
    organization_id: p.organization_id, project_id: project, ...(parsed as { ok: true; value: object }).value,
  });
  back(project, scopeErrorCode(error));
}

async function deleteStakeholder(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const id = String(formData.get('id'));
  if (!UUID_RE.test(project) || !UUID_RE.test(id)) redirect('/projects');
  const supabase = await createClient();
  const { data, error } = await supabase.from('project_stakeholders').delete().eq('id', id).eq('project_id', project).select('id');
  back(project, error ? scopeErrorCode(error) : !data?.length ? 'forbidden' : '');
}

async function changeStatus(formData: FormData) {
  'use server';
  const project = String(formData.get('project'));
  const to = String(formData.get('to'));
  if (!UUID_RE.test(project)) redirect('/projects');
  if (!['proposed', 'approved', 'draft'].includes(to)) back(project, 'invalid_transition');
  const supabase = await createClient();
  const { error } = await supabase.rpc('change_project_status', { p_project: project, p_status: to });
  back(project, scopeErrorCode(error));
}

const LEVEL = { low: 'Bajo', medium: 'Medio', high: 'Alto' } as const;
const LABEL: Record<(typeof CHARTER_FIELDS)[number], string> = {
  objectives: 'Objetivos (mín. 10 caracteres)', scope: 'Alcance (mín. 10 caracteres)', out_of_scope: 'Fuera de alcance',
  success_criteria: 'Criterios de éxito', assumptions: 'Supuestos', constraints: 'Restricciones',
};
const STATUS_ES: Record<string, string> = {
  draft: 'Borrador', proposed: 'Propuesto', approved: 'Aprobado', planning: 'Planificación', executing: 'Ejecución',
  on_hold: 'En pausa', closing: 'Cierre', closed: 'Cerrado', cancelled: 'Cancelado',
};

export default async function CharterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: charter }, { data: people }, { data: st }] = await Promise.all([
    supabase.from('project_charters').select('objectives,scope,out_of_scope,success_criteria,assumptions,constraints').eq('project_id', id).maybeSingle(),
    supabase.from('project_stakeholders').select('id,name,role,influence,interest,notes').eq('project_id', id).order('created_at'),
    supabase.rpc('charter_status', { p_project: id }),
  ]);
  const status = st as { complete: boolean; missing: string[] } | null;
  const editable = project.status === 'draft' || project.status === 'proposed';
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return (
    <main>
      <p><Link href={`/projects/${id}`}>← {project.code} · {project.name}</Link></p>
      <h1>Project Charter</h1>
      <p>Estado del proyecto: <strong>{STATUS_ES[project.status] ?? project.status}</strong></p>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      {status && (status.complete
        ? <p className="okmsg">El charter está completo.</p>
        : <p className="err" role="status">Falta: {describeMissing(status.missing)}.</p>)}
      <div className="row">
        {statusActions(project.status).map((a) => (
          <form key={a.to} action={changeStatus}>{hidden('project', id)}{hidden('to', a.to)}<button disabled={a.to === 'proposed' && status?.complete === false}>{a.label}</button></form>
        ))}
      </div>
      <form action={saveCharter} className="card">
        {hidden('project', id)}
        {CHARTER_FIELDS.map((f) => (
          <div key={f}>
            <label htmlFor={`c-${f}`}>{LABEL[f]}</label>
            <textarea id={`c-${f}`} name={f} rows={3} maxLength={8000} defaultValue={charter?.[f] ?? ''} disabled={!editable}
              style={{ width: '100%', padding: 10, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--fg)', font: 'inherit' }} />
          </div>
        ))}
        {editable ? <button>Guardar charter</button> : <p>El charter es de solo lectura desde que el proyecto fue aprobado.</p>}
      </form>
      <div className="card">
        <h2>Stakeholders</h2>
        {(people ?? []).length === 0 ? <p>Sin stakeholders.</p> : (
          <table><thead><tr><th>Nombre</th><th>Rol</th><th>Influencia</th><th>Interés</th><th></th></tr></thead>
            <tbody>{(people ?? []).map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{s.role ?? '—'}</td><td>{LEVEL[s.influence as keyof typeof LEVEL]}</td><td>{LEVEL[s.interest as keyof typeof LEVEL]}</td>
                <td><form action={deleteStakeholder}>{hidden('project', id)}{hidden('id', s.id)}<button className="secondary" style={{ marginTop: 0 }}>Quitar</button></form></td></tr>
            ))}</tbody></table>
        )}
        <form action={addStakeholder}>
          {hidden('project', id)}
          <label htmlFor="s-name">Nombre</label><input id="s-name" name="name" required maxLength={200} />
          <label htmlFor="s-role">Rol</label><input id="s-role" name="role" maxLength={200} />
          <label htmlFor="s-inf">Influencia</label>
          <select id="s-inf" name="influence" defaultValue="medium"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select>
          <label htmlFor="s-int">Interés</label>
          <select id="s-int" name="interest" defaultValue="medium"><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option></select>
          <button>Agregar stakeholder</button>
        </form>
      </div>
    </main>
  );
}
