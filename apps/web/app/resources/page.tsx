import Link from 'next/link';
import { redirect } from 'next/navigation';
import { rangeLabel, upcoming, weekdaysInRange } from '@/lib/absences';
import { messageFor } from '@/lib/errors';
import { shortDate } from '@/lib/load';
import { formatHours, KIND_LABEL, type ResourceKind } from '@/lib/resources';
import { createClient } from '@/lib/supabase/server';
import { addAbsence, createResource, deleteAbsence, deleteResource, updateResource } from './actions';

export default async function Resources({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: orgs } = await supabase.from('organizations').select('id,name').order('name');
  if (!orgs?.length) redirect('/onboarding');
  const org = orgs[0];
  const [{ data: canManage }, { data: rows }, { data: counts }, { data: absences }, { data: memberRows }] = await Promise.all([
    supabase.rpc('can_manage_resources', { p_org: org.id }),
    supabase.from('resources').select('id,name,kind,daily_hours,active,user_id').eq('organization_id', org.id).order('name'),
    supabase.from('activity_resources').select('resource_id').eq('organization_id', org.id),
    supabase.from('resource_absences').select('id,resource_id,start_date,end_date,reason').eq('organization_id', org.id),
    supabase.from('organization_members').select('user_id').eq('organization_id', org.id).eq('status', 'active').eq('membership_type', 'internal'),
  ]);
  const ids = (memberRows ?? []).map((m) => m.user_id);
  const { data: profs } = ids.length ? await supabase.from('profiles').select('id,display_name').in('id', ids) : { data: [] as { id: string; display_name: string }[] };
  const members = [...(profs ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'));
  const linkedTo = new Map((rows ?? []).filter((r) => r.user_id).map((r) => [r.user_id as string, r.id]));
  const userName = new Map(members.map((m) => [m.id, m.display_name]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/La_Paz' }).format(new Date());
  const names = new Map((rows ?? []).map((r) => [r.id, r.name]));
  const abs = upcoming(absences ?? [], today);
  const used = new Map<string, number>();
  for (const c of counts ?? []) used.set(c.resource_id, (used.get(c.resource_id) ?? 0) + 1);
  const manage = canManage === true;
  return (
    <main>
      <p className="row"><Link href="/projects">← Proyectos</Link><Link href="/resources/load">Carga semanal →</Link></p>
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
                      <select name="user" defaultValue={r.user_id ?? ''} aria-label={`Miembro vinculado a ${r.name}`}>
                        <option value="">Sin miembro</option>
                        {members.filter((m) => !linkedTo.has(m.id) || linkedTo.get(m.id) === r.id).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                      </select>
                      <label><input type="checkbox" name="active" defaultChecked={r.active} /> Activo</label>
                      <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td>{r.name}{r.user_id && userName.get(r.user_id) ? ` (${userName.get(r.user_id)})` : ''}</td><td>{KIND_LABEL[r.kind as ResourceKind]}</td><td>{formatHours(Number(r.daily_hours))}</td><td>{r.active ? 'Activo' : 'Inactivo'}</td>
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
      <div className="card">
        <h2>Ausencias y vacaciones</h2>
        {abs.length === 0 ? <p>No hay ausencias registradas o próximas.</p> : (
          <table>
            <thead><tr><th>Recurso</th><th>Fechas</th><th>Días hábiles (lun–vie)</th><th>Motivo</th>{manage && <th></th>}</tr></thead>
            <tbody>{abs.map((a) => (
              <tr key={a.id}>
                <td>{names.get(a.resource_id) ?? '—'}</td>
                <td>{rangeLabel(a.start_date, a.end_date, shortDate)}</td>
                <td>{weekdaysInRange(a.start_date, a.end_date)}</td>
                <td>{a.reason ?? ''}</td>
                {manage && <td><form action={deleteAbsence}><input type="hidden" name="id" value={a.id} /><button className="secondary" style={{ marginTop: 0 }}>Quitar</button></form></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
        <p style={{ color: 'var(--muted)' }}>Cada día hábil de ausencia resta la capacidad diaria del recurso en la carga semanal. No mueve actividades: si hay trabajo asignado esos días, la semana aparece sobreasignada.</p>
      </div>
      {manage && (rows ?? []).some((r) => r.active) && (
        <form action={addAbsence} className="card">
          <h2>Nueva ausencia</h2>
          <input type="hidden" name="org" value={org.id} />
          <label htmlFor="abs_resource">Recurso</label>
          <select id="abs_resource" name="resource" required>{(rows ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <label htmlFor="abs_start">Desde</label><input id="abs_start" name="start" type="date" required />
          <label htmlFor="abs_end">Hasta (inclusive)</label><input id="abs_end" name="end" type="date" required />
          <label htmlFor="abs_reason">Motivo (opcional)</label><input id="abs_reason" name="reason" maxLength={200} />
          <button>Registrar ausencia</button>
        </form>
      )}
      {manage ? (
        <form action={createResource} className="card">
          <h2>Nuevo recurso</h2>
          <input type="hidden" name="org" value={org.id} />
          <label htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={120} />
          <label htmlFor="kind">Tipo</label>
          <select id="kind" name="kind"><option value="person">Persona</option><option value="equipment">Equipo</option></select>
          <label htmlFor="daily_hours">Horas por día</label>
          <input id="daily_hours" name="daily_hours" type="number" min={0.25} max={24} step={0.25} defaultValue={8} required />
          <label htmlFor="user">Miembro vinculado (solo personas, opcional)</label>
          <select id="user" name="user"><option value="">Sin miembro</option>{members.filter((m) => !linkedTo.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
          <button>Crear recurso</button>
        </form>
      ) : <p style={{ color: 'var(--muted)' }}>Solo owner, administradores y Project Managers pueden crear o editar recursos.</p>}
    </main>
  );
}
