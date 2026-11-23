'use server';
import { redirect } from 'next/navigation';
import { parseAbsenceForm } from '@/lib/absences';
import { UUID_RE } from '@/lib/http';
import { parseResourceForm, resourceErrorCode } from '@/lib/resources';
import { createClient } from '@/lib/supabase/server';

const back = (error?: string) => redirect(`/resources${error ? `?error=${error}` : ''}`);

export async function createResource(formData: FormData) {
  const org = String(formData.get('org'));
  const p = parseResourceForm(formData);
  if (!UUID_RE.test(org)) back('invalid_resource');
  if (!p.ok) back(p.error);
  const v = p as Extract<typeof p, { ok: true }>;
  const supabase = await createClient();
  const { error } = await supabase.from('resources').insert({ organization_id: org, name: v.name, kind: v.kind, daily_hours: v.dailyHours });
  back(resourceErrorCode(error, 'resource'));
}

export async function updateResource(formData: FormData) {
  const id = String(formData.get('id'));
  const p = parseResourceForm(formData);
  if (!UUID_RE.test(id)) back('invalid_resource');
  if (!p.ok) back(p.error);
  const v = p as Extract<typeof p, { ok: true }>;
  const supabase = await createClient();
  const { data, error } = await supabase.from('resources')
    .update({ name: v.name, kind: v.kind, daily_hours: v.dailyHours, active: formData.get('active') === 'on' })
    .eq('id', id).select('id');
  back(error ? resourceErrorCode(error, 'resource') : !data?.length ? 'forbidden' : undefined);
}

export async function deleteResource(formData: FormData) {
  const id = String(formData.get('id'));
  if (!UUID_RE.test(id)) back('invalid_resource');
  const supabase = await createClient();
  const { data, error } = await supabase.from('resources').delete().eq('id', id).select('id');
  back(error ? resourceErrorCode(error, 'delete') : !data?.length ? 'forbidden' : undefined);
}

export async function addAbsence(formData: FormData) {
  const org = String(formData.get('org'));
  const p = parseAbsenceForm(formData);
  if (!UUID_RE.test(org)) back('invalid_absence');
  if (!p.ok) back(p.error);
  const v = p as Extract<typeof p, { ok: true }>;
  const supabase = await createClient();
  const { error } = await supabase.from('resource_absences').insert({ organization_id: org, resource_id: v.resourceId, start_date: v.start, end_date: v.end, reason: v.reason });
  back(error ? (error.code === '42501' ? 'forbidden' : error.code === '23514' || error.code === '23503' ? 'invalid_absence' : 'unknown') : undefined);
}

export async function deleteAbsence(formData: FormData) {
  const id = String(formData.get('id'));
  if (!UUID_RE.test(id)) back('invalid_absence');
  const supabase = await createClient();
  const { data, error } = await supabase.from('resource_absences').delete().eq('id', id).select('id');
  back(error ? 'unknown' : !data?.length ? 'forbidden' : undefined);
}
