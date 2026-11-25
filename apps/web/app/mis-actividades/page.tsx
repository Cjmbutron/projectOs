import Link from 'next/link';
import { formatDay } from '@/lib/dates';
import { redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { DEADLINE_LABEL, deadlineState, groupByProject, sortByDue, type MyActivity } from '@/lib/my-activities';
import { STATUS_LABEL } from '@/lib/progress';
import { createClient } from '@/lib/supabase/server';
import { reportMyProgress } from './actions';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/La_Paz' }).format(new Date());

export default async function MyActivities({ searchParams }: { searchParams: Promise<{ error?: string; all?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const all = sp.all === '1';
  let q = supabase.from('activities')
    .select('id,project_id,name,duration,status,percent_complete,early_start,early_finish')
    .eq('assignee_id', auth.user.id);
  if (!all) q = q.neq('status', 'done');
  const { data: rows } = await q.limit(1000);
  const acts = sortByDue((rows ?? []) as (MyActivity & { duration: number; percent_complete: number })[]);
  const ids = [...new Set(acts.map((a) => a.project_id))];
  const { data: projects } = ids.length ? await supabase.from('projects').select('id,code,name,status').in('id', ids) : { data: [] };
  const proj = new Map((projects ?? []).map((p) => [p.id, p]));
  const groups = groupByProject(acts);
  const now = today();
  return (
    <main>
      <p><Link href="/projects">← Proyectos</Link></p>
      <h1>Mis actividades</h1>
      {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      <p className="legend">
        <span>{acts.length} actividad(es) {all ? '' : 'pendientes'}</span>
        <Link href={all ? '/mis-actividades' : '/mis-actividades?all=1'}>{all ? 'Ocultar terminadas' : 'Mostrar también las terminadas'}</Link>
      </p>
      {acts.length === 0 && <div className="card"><p>No tienes actividades asignadas{all ? '' : ' pendientes'}.</p></div>}
      {[...groups.entries()].map(([pid, list]) => {
        const p = proj.get(pid);
        const writable = !!p && !['closed', 'cancelled'].includes(p.status);
        return (
          <div className="card" key={pid}>
            <h2>{p ? <Link href={`/projects/${pid}`}>{p.code} · {p.name}</Link> : 'Proyecto'}</h2>
            <table>
              <thead><tr><th>Actividad</th><th>Inicio</th><th>Fin</th><th>Plazo</th><th>Avance</th></tr></thead>
              <tbody>{list.map((a) => {
                const d = deadlineState(a.early_finish, a.status, now);
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td><td>{formatDay(a.early_start)}</td><td>{formatDay(a.early_finish)}</td>
                    <td className={d === 'overdue' ? 'err' : undefined}>{DEADLINE_LABEL[d]}</td>
                    <td>
                      <span>{a.percent_complete} % · {STATUS_LABEL[a.status] ?? a.status}</span>
                      {writable && (
                        <form action={reportMyProgress} className="row" style={{ flexWrap: 'nowrap' }}>
                          <input type="hidden" name="activity" value={a.id} />{all && <input type="hidden" name="all" value="1" />}
                          {a.duration === 0 ? (
                            <select name="percent" defaultValue={String(a.percent_complete)} aria-label={`Estado del hito ${a.name}`}>
                              <option value="0">Pendiente</option><option value="100">Cumplido</option>
                            </select>
                          ) : (
                            <input name="percent" type="number" min={0} max={100} step={1} defaultValue={a.percent_complete} aria-label={`Avance de ${a.name} (%)`} style={{ width: '5rem' }} />
                          )}
                          <button className="secondary" style={{ marginTop: 0 }}>Guardar</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        );
      })}
    </main>
  );
}
