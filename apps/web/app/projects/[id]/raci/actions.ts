'use server';
import { redirect } from 'next/navigation';
import { parseRowForm, rolesOfCell } from '@/lib/raci';
import { UUID_RE } from '@/lib/http';
import { scopeErrorCode } from '@/lib/scope/wbs';
import { createClient } from '@/lib/supabase/server';

/** Guarda una fila de la matriz: solo las personas cuyo valor cambió, una por una (la base de datos vuelve a validar todo). */
export async function saveRow(formData: FormData) {
  const project = String(formData.get('project'));
  const deliverable = String(formData.get('deliverable'));
  if (!UUID_RE.test(project) || !UUID_RE.test(deliverable)) redirect('/projects');
  const base = `/projects/${project}/raci`;
  const supabase = await createClient();
  const { data: members } = await supabase.from('project_members').select('user_id').eq('project_id', project);
  const changes = parseRowForm((k) => formData.get(k), (members ?? []).map((m) => m.user_id as string));
  if (!changes) redirect(`${base}?error=invalid_raci#d-${deliverable}`);
  let saved = 0;
  for (const c of changes) {
    const { error } = await supabase.rpc('raci_set_cell', { p_deliverable: deliverable, p_user: c.userId, p_roles: rolesOfCell(c.to) });
    if (error) redirect(`${base}?${new URLSearchParams({ error: scopeErrorCode(error), saved: String(saved) })}#d-${deliverable}`);
    saved++;
  }
  redirect(`${base}?${new URLSearchParams({ saved: String(saved) })}#d-${deliverable}`);
}
