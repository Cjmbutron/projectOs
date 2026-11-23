import Link from 'next/link';
import { redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { formatHours, KIND_LABEL, type ResourceKind } from '@/lib/resources';
import { createClient } from '@/lib/supabase/server';
import { createResource, deleteResource, updateResource } from './actions';

export default async function Resources({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: orgs } = await supabase.from('organizations').select('id,name').order('name');
  if (!orgs?.length) redirect('/onboarding');
  const org = orgs[0];
  const [{ data: canManage }, { data: rows }, { data: counts }] = await Promise.all([
    supabase.rpc('can_manage_resources', { p_org: org.id }),
    supabase.from('resources').select('id,name,kind,daily_hours,active').eq('organization_id', org.id).order('name'),
    supabase.from('activity_resources').select('resource_id').eq('organization_id', org.id),
  ]);
  const used = new Map<string, number>();
  for (const c of counts ?? []) used.set(c.resource_id, (used.get(c.resource_id) ?? 0) + 1);
  const manage = canManage === true;
  return (
    <main>
      <p><Link href="/projects">← Proyectos</Link></p>
      <h1>Recursos — {org.name}</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      <div className="card">
        {(rows ?? []).length === 0 ? <p>Aún no hay recursos.{manage ? ' Crea el primero abajo.' : ''}</p> : (
          <table>
            <thead><tr><th>Recurso</th><th>Tipo</th><th>Capacidad diaria</th><th>Estado</th><th>Asignaciones</th>{manage && <th></th>}</tr></thead>
            <tbody>{(rows ?? []).map((r) => (
              <tr key={r.id}>
                {manage ? (
                  <td colSpan={4}>
                    <form action={updateResource} className="row" style={{ flexWrap: 'nowrap' }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input name="name" defaultValue={r.name} aria-label={`Nombre de ${r.name}`} required maxLength={120} />
                      <select name="kind" defaultValue={r.kind} aria-label="Tipo">
                        <option value="person">Persona</option><option value="equipment">Equipo</option>
                      </select>
                      <input name="daily_hours" type="number" min={0.25} max={24} step={0.25} defaultValue={Number(r.daily_hours)} aria-label="Horas por día" style={{ width: '5rem' }} />
                      <label><input type="checkbox" name="active" defaultChecked={r.active} /> Activo</label>
                      <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td>{r.name}</td><td>{KIND_LABEL[r.kind as ResourceKind]}</td><td>{formatHours(Number(r.daily_hours))}</td><td>{r.active ? 'Activo' : 'Inactivo'}</td>
                  </>
                )}
                <td>{used.get(r.id) ?? 0}</td>
                {manage && (
                  <td>
                    <form action={deleteResource}><input type="hidden" name="id" value={r.id} />
                      <button className="secondary" style={{ marginTop: 0 }} disabled={(used.get(r.id) ?? 0) > 0} title={(used.get(r.id) ?? 0) > 0 ? 'Tiene asignaciones: desactívalo en lugar de eliminarlo' : undefined}>Eliminar</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {manage ? (
        <form action={createResource} className="card">
          <h2>Nuevo recurso</h2>
          <input type="hidden" name="org" value={org.id} />
          <label htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={120} />
          <label htmlFor="kind">Tipo</label>
          <select id="kind" name="kind"><option value="person">Persona</option><option value="equipment">Equipo</option></select>
          <label htmlFor="daily_hours">Horas por día</label>
          <input id="daily_hours" name="daily_hours" type="number" min={0.25} max={24} step={0.25} defaultValue={8} required />
          <button>Crear recurso</button>
        </form>
      ) : <p style={{ color: 'var(--muted)' }}>Solo owner, administradores y Project Managers pueden crear o editar recursos.</p>}
    </main>
  );
}
