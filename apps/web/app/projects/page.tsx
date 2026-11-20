import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components';
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

export default async function Projects({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: orgs } = await supabase.from('organizations').select('id,name').order('name');
  if (!orgs || orgs.length === 0) redirect('/onboarding');
  const { data: projects } = await supabase
    .from('projects').select('id,code,name,status,health,organization_id').is('deleted_at', null).order('code');
  return (
    <main>
      <div className="row"><h1>Proyectos — {orgs[0].name}</h1><LogoutButton /></div>
      <div className="card">
        {projects && projects.length > 0 ? (
          <table><thead><tr><th>Código</th><th>Nombre</th><th>Estado</th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id}><td>{p.code}</td><td><Link href={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.status}</td></tr>
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
    </main>
  );
}
