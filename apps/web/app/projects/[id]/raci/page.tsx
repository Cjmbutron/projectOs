import { notFound } from 'next/navigation';
import { RaciView, type RaciDeliverable, type RaciMember } from '@/components/RaciView';
import { UUID_RE } from '@/lib/http';
import { buildCells } from '@/lib/raci';
import { createClient } from '@/lib/supabase/server';

const codeKey = (c: string | null) => (c === null ? [Infinity] : c.split('.').map(Number));
function cmp(a: RaciDeliverable, b: RaciDeliverable) {
  const x = codeKey(a.code), y = codeKey(b.code);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d !== 0 && !Number.isNaN(d)) return d;
  }
  return a.name.localeCompare(b.name, 'es');
}

export default async function RaciPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: project } = await supabase.from('projects').select('id,code,name,status').eq('id', id).maybeSingle();
  if (!project) notFound();
  const [{ data: canEditData }, { data: dels }, { data: nodes }, { data: mem }, { data: raci }] = await Promise.all([
    supabase.rpc('can_edit_scope', { p_project: id }),
    supabase.from('deliverables').select('id,name,wbs_node_id,responsible_id').eq('project_id', id),
    supabase.from('wbs_nodes').select('id,code').eq('project_id', id),
    supabase.from('project_members').select('user_id,role:roles(name)').eq('project_id', id),
    supabase.from('raci_assignments').select('deliverable_id,user_id,role').eq('project_id', id),
  ]);
  const userIds = [...new Set([...(mem ?? []).map((m) => m.user_id as string), ...(dels ?? []).map((d) => d.responsible_id as string | null).filter((x): x is string => !!x)])];
  const { data: profs } = userIds.length ? await supabase.from('profiles').select('id,display_name').in('id', userIds) : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
  const codes = new Map((nodes ?? []).map((n) => [n.id as string, n.code as string]));
  const deliverables: RaciDeliverable[] = (dels ?? []).map((d) => ({
    id: d.id as string, name: d.name as string, code: d.wbs_node_id ? codes.get(d.wbs_node_id as string) ?? null : null,
    responsible: d.responsible_id ? names.get(d.responsible_id as string) ?? null : null,
  })).sort(cmp);
  const members: RaciMember[] = (mem ?? []).map((m) => ({
    id: m.user_id as string, name: names.get(m.user_id as string) ?? 'Sin nombre',
    role: String((m.role as unknown as { name?: string } | null)?.name ?? ''),
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const closed = project.status === 'closed' || project.status === 'cancelled';
  return (
    <RaciView id={id} project={{ code: project.code, name: project.name }} deliverables={deliverables} members={members}
      cells={buildCells((raci ?? []) as { deliverable_id: string; user_id: string; role: string }[])}
      canEdit={canEditData === true} closed={closed} sp={{ error: sp.error, saved: sp.saved }} />
  );
}
