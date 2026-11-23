import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HEALTH_BADGE, HEALTH_LABEL, isHealth, parseThresholds, summarizeHealth } from '@/lib/health';
import { messageFor } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

async function createProject(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  const org = String(formData.get('org'));
  if (!uid) redirect('/login');
  const { data, error } = await supabase.rpc('create_project', {
    p_org: org,
    p_code: String(formData.get('code') ?? '').trim(),
    p_name: String(formData.get('name') ?? '').trim(),
    p_responsible: uid,
    p_methodology: 'predictive',
  });
  if (error) redirect(`/projects?error=${encodeURIComponent(error.message.split('\n')[0].slice(0, 40))}`);
  redirect(`/projects/${data}`);
}

async function saveThresholds(formData: FormData) {
  'use server';
  const org = String(formData.get('org'));
  const parsed = parseThresholds(formData);
  if (!parsed.ok) redirect(`/projects?error=${parsed.error}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from('organizations')
    .update({ health_amber_days: (parsed as { amber: number }).amber, health_red_days: (parsed as { red: number }).red })
    .eq('id', org).select('id');
  redirect(`/projects${error ? '?error=invalid_thresholds' : !data?.length ? '?error=forbidden' : ''}`);
}

export default async function Projects({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: orgs } = await supabase.from('organizations').select('id,name,health_amber_days,health_red_days').order('name');
  if (!orgs || orgs.length === 0) redirect('/onboarding');
  const { data: projects } = await supabase
    .from('projects').select('id,code,name,status,health,progress_percent,organization_id').is('deleted_at', null).order('code');
  return (
    <main>
      <h1>Proyectos — {orgs[0].name}</h1>
      {projects && projects.length > 0 && (() => {
        const sum = summarizeHealth(projects);
        return (
          <div className="card" aria-label="Resumen de salud de los proyectos">
            <p className="legend">
              <strong>{sum.total} proyecto(s)</strong>
              {(['green', 'amber', 'red', 'unknown'] as const).map((h) => (
                <span key={h} className={HEALTH_BADGE[h]}>{HEALTH_LABEL[h]}: {sum.counts[h]}</span>
              ))}
            </p>
          </div>
        );
      })()}
      <div className="card">
        {projects && projects.length > 0 ? (
          <table><thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th>Salud</th><th>Avance</th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id}><td>{p.code}</td><td><Link href={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.status}</td><td>{isHealth(p.health) ? <span className={HEALTH_BADGE[p.health]}>{HEALTH_LABEL[p.health]}</span> : '—'}</td><td>{Number(p.progress_percent ?? 0)} %</td></tr>
            ))}</tbody></table>
        ) : <p>Aún no hay proyectos.</p>}
      </div>
      <form action={createProject} className="card">
        <h2>Nuevo proyecto</h2>
        <input type="hidden" name="org" value={orgs[0].id} />
        <label htmlFor="code">Código</label><input id="code" name="code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" />
        <label htmlFor="name">Nombre</label><input id="name" name="name" required maxLength={200} />
        <button>Crear proyecto</button>
        {sp.error && <p className="err" role="alert">{messageFor(sp.error)}</p>}
      </form>
      <form action={saveThresholds} className="card">
        <h2>Umbrales de salud</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.9rem' }}>
          Atraso del fin del proyecto respecto de la última línea base, en días laborables: verde hasta el primer umbral,
          ámbar hasta el segundo, rojo por encima. Sin línea base o sin fechas calculadas: «Sin datos».
        </p>
        <input type="hidden" name="org" value={orgs[0].id} />
        <label htmlFor="amber">Verde hasta (días)</label><input id="amber" name="amber" type="number" min={0} max={3650} defaultValue={orgs[0].health_amber_days} required />
        <label htmlFor="red">Ámbar hasta (días)</label><input id="red" name="red" type="number" min={0} max={3650} defaultValue={orgs[0].health_red_days} required />
        <button>Guardar umbrales</button>
      </form>
    </main>
  );
}
