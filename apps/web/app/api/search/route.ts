import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { likePattern, MAX_ACTIVITIES, MAX_PROJECTS, mergeProjects, parseQuery, type ActivityHit, type ProjectHit } from '@/lib/search';

/** Busca proyectos (nombre o código) y actividades (nombre) con la sesión de la persona: lo que no puede leer, no aparece (RLS). */
export async function GET(request: Request) {
  const q = parseQuery(new URL(request.url).searchParams.get('q'));
  if (!q) return NextResponse.json({ projects: [], activities: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const pat = likePattern(q);
  const base = () => supabase.from('projects').select('id,code,name').is('deleted_at', null).is('archived_at', null).order('name').limit(MAX_PROJECTS);
  const [byName, byCode, acts] = await Promise.all([
    base().ilike('name', pat),
    base().ilike('code', pat),
    supabase.from('activities').select('id,name,project_id').ilike('name', pat).order('name').limit(MAX_ACTIVITIES),
  ]);
  if (byName.error || byCode.error || acts.error) return NextResponse.json({ error: 'search_failed' }, { status: 500 });

  const projects: ProjectHit[] = mergeProjects(byName.data ?? [], byCode.data ?? []);
  const ids = [...new Set((acts.data ?? []).map((a) => a.project_id as string))];
  const names = new Map<string, string>();
  if (ids.length) {
    // Solo proyectos activos: las actividades de uno archivado o en la papelera no se ofrecen.
    const { data } = await supabase.from('projects').select('id,name').in('id', ids).is('deleted_at', null).is('archived_at', null);
    for (const p of data ?? []) names.set(p.id as string, p.name as string);
  }
  const activities: ActivityHit[] = (acts.data ?? [])
    .filter((a) => names.has(a.project_id as string))
    .map((a) => ({ id: a.id as string, name: a.name as string, projectId: a.project_id as string, projectName: names.get(a.project_id as string)! }));
  return NextResponse.json({ projects, activities }, { headers: { 'Cache-Control': 'no-store' } });
}
