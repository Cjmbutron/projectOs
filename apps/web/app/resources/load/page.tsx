import Link from 'next/link';
import { redirect } from 'next/navigation';
import { messageFor } from '@/lib/errors';
import { shiftIso } from '@/lib/gantt/drag';
import { buildGrid, cellLabel, parseLoadParams, shortDate, weekStarts, type LoadRow } from '@/lib/load';
import { createClient } from '@/lib/supabase/server';

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/La_Paz' }).format(new Date());
}

export default async function LoadPage({ searchParams }: { searchParams: Promise<{ from?: string; weeks?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: orgs } = await supabase.from('organizations').select('id,name').order('name');
  if (!orgs?.length) redirect('/onboarding');
  const org = orgs[0];
  const { from, weeks, to } = parseLoadParams(sp, todayIso());
  const [{ data: rows, error }, { data: resources }] = await Promise.all([
    supabase.rpc('resource_load', { p_org: org.id, p_from: from, p_to: to }),
    supabase.from('resources').select('id,name,active').eq('organization_id', org.id),
  ]);
  const starts = weekStarts(from, weeks);
  const grid = buildGrid(resources ?? [], (rows ?? []) as LoadRow[], starts);
  const q = (f: string, w = weeks) => `/resources/load?from=${f}&weeks=${w}`;
  return (
    <main>
      <p><Link href="/resources">← Recursos</Link></p>
      <h1>Carga semanal — {org.name}</h1>
      {error && <p className="err" role="alert">{messageFor(error.message.includes('forbidden') || error.code === '42501' ? 'forbidden' : 'invalid_value')}</p>}
      <p className="row">
        <Link href={q(shiftIso(from, -weeks * 7))}>← Anterior</Link>
        <Link href={q(shiftIso(from, weeks * 7))}>Siguiente →</Link>
        {[4, 8, 12, 26].map((w) => <Link key={w} href={q(from, w)} aria-current={w === weeks ? 'true' : undefined}>{w} semanas</Link>)}
      </p>
      <p role="status">
        {grid.overCells === 0 ? 'Sin sobreasignaciones en este periodo.' : `${grid.overCells} semana(s) con sobreasignación en este periodo.`}
      </p>
      <div className="card" style={{ overflowX: 'auto' }}>
        {grid.rows.length === 0 ? <p>No hay recursos con carga en este periodo.</p> : (
          <table>
            <thead><tr><th>Recurso</th>{starts.map((w) => <th key={w} scope="col">Sem. {shortDate(w)}</th>)}</tr></thead>
            <tbody>{grid.rows.map((r) => (
              <tr key={r.resource.id}>
                <th scope="row">{r.resource.name}{r.resource.active ? '' : ' (inactivo)'}</th>
                {r.cells.map((c, i) => (
                  <td key={starts[i]} style={c?.over ? { fontWeight: 600, color: 'var(--danger, #b00020)' } : undefined}>{cellLabel(c)}</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p style={{ color: 'var(--muted)' }}>Horas = dedicación × horas por día × días laborables del proyecto en la semana. Capacidad = horas por día × 5.</p>
    </main>
  );
}
