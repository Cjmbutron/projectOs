-- =============================================================================
-- 0600 · Bitácora de auditoría inmutable
-- US-062 · RNF-09 (100 % de acciones sensibles, retención ≥ 2 años)
--
--  * Solo se escribe desde disparadores y funciones del sistema.
--  * No admite UPDATE, DELETE ni TRUNCATE (ni siquiera del propietario).
--  * Sin datos sensibles: se eliminan los campos de la lista de redacción.
--  * Sin claves foráneas: el historial sobrevive aunque se borre la entidad.
-- =============================================================================

create table public.audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  organization_id uuid,
  actor_id        uuid,
  action          text not null,
  entity_table    text not null,
  entity_id       text,
  old_values      jsonb,
  new_values      jsonb,
  reason          text
);
comment on table public.audit_log is 'Bitácora inmutable. actor_id NULL = proceso del sistema.';
create index audit_log_org_time_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_table, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

create function private.audit_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_log_is_immutable' using errcode = '42501';
end $$;
revoke all on function private.audit_immutable() from public, anon, authenticated;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Campos que nunca se registran.
create function private.audit_redact(p_values jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select p_values - 'token_hash' $$;
revoke all on function private.audit_redact(jsonb) from public, anon, authenticated;

-- Contexto opcional (acción y motivo) que una función puede fijar para su transacción.
create function private.set_audit_context(p_action text, p_reason text) returns void
language plpgsql set search_path = ''
as $$
begin
  perform set_config('app.audit_action', coalesce(p_action, ''), true);
  perform set_config('app.audit_reason', coalesce(p_reason, ''), true);
end $$;
revoke all on function private.set_audit_context(text, text) from public, anon, authenticated;

create function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_any    jsonb;
  v_org    uuid;
  v_action text := lower(tg_op);
  v_reason text := nullif(current_setting('app.audit_reason', true), '');
  v_ctx    text := nullif(current_setting('app.audit_action', true), '');
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := private.audit_redact(to_jsonb(old)); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := private.audit_redact(to_jsonb(new)); end if;
  -- Un UPDATE que solo cambia updated_at no es un cambio real.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  v_any := coalesce(v_new, v_old);

  if tg_table_name = 'organizations' then
    v_org := (v_any ->> 'id')::uuid;
  elsif tg_table_name = 'role_permissions' then
    select r.organization_id into v_org from public.roles r where r.id = (v_any ->> 'role_id')::uuid;
  else
    v_org := (v_any ->> 'organization_id')::uuid;
  end if;

  if tg_op = 'UPDATE' and v_ctx is not null then
    v_action := v_ctx;
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_table, entity_id, old_values, new_values, reason)
  values (v_org, auth.uid(), v_action, tg_table_name,
          coalesce(v_any ->> 'id', v_any ->> 'role_id'), v_old, v_new, v_reason);
  return null;
end $$;
revoke all on function private.audit_trigger() from public, anon, authenticated;

-- Tablas auditadas (acciones sensibles: organización, accesos, roles, proyectos).
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'roles', 'role_permissions', 'organization_members', 'invitations',
    'portfolios', 'programs', 'projects', 'project_phases', 'project_members'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.audit_trigger()',
      t || '_audit', t);
  end loop;
end $$;
