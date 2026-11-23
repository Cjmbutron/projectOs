-- =============================================================================
-- 2000 · Project Charter y stakeholders (US-014)
--
-- Un proyecto en `draft` solo pasa a `proposed` (someterlo a aprobación) con el charter
-- completo: objetivos, alcance y al menos un stakeholder. La regla vive en la base de datos
-- (disparador sobre projects), no solo en la interfaz.
-- El charter se edita mientras el proyecto está en draft/proposed; después queda de solo
-- lectura (un cambio posterior será un cambio formal, R4). Los stakeholders siguen
-- editándose mientras el proyecto no esté cerrado o cancelado.
-- Escritura con `project.update` (PM). Lectura: quien puede leer el proyecto.
-- =============================================================================
create table public.project_charters (
  project_id       uuid primary key,
  organization_id  uuid not null,
  objectives       text check (objectives is null or char_length(objectives) <= 8000),
  scope            text check (scope is null or char_length(scope) <= 8000),
  out_of_scope     text check (out_of_scope is null or char_length(out_of_scope) <= 8000),
  success_criteria text check (success_criteria is null or char_length(success_criteria) <= 8000),
  assumptions      text check (assumptions is null or char_length(assumptions) <= 8000),
  constraints      text check (constraints is null or char_length(constraints) <= 8000),
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
select private.harden_table('public.project_charters');

create table public.project_stakeholders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  role            text check (role is null or char_length(role) <= 200),
  user_id         uuid references public.profiles (id) on delete set null,
  influence       text not null default 'medium' check (influence in ('low', 'medium', 'high')),
  interest        text not null default 'medium' check (interest in ('low', 'medium', 'high')),
  notes           text check (notes is null or char_length(notes) <= 4000),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
create index project_stakeholders_project_idx on public.project_stakeholders (project_id);
select private.harden_table('public.project_stakeholders');

-- Qué falta para poder someter el proyecto (lista vacía = completo)
create function private.charter_missing(p_project uuid) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when coalesce(char_length(btrim(c.objectives)), 0) < 10 then 'objectives' end,
    case when coalesce(char_length(btrim(c.scope)), 0) < 10 then 'scope' end,
    case when not exists (select 1 from public.project_stakeholders s where s.project_id = p_project) then 'stakeholders' end
  ], null)
  from (select 1) x left join public.project_charters c on c.project_id = p_project
$$;
revoke all on function private.charter_missing(uuid) from public, anon, authenticated;

create function public.charter_status(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_missing text[];
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  v_missing := private.charter_missing(p_project);
  return jsonb_build_object('complete', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing));
end $$;
revoke all on function public.charter_status(uuid) from public, anon;
grant execute on function public.charter_status(uuid) to authenticated;

-- Guarda de escritura del charter: solo en draft/proposed
create function private.charter_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.projects where id = coalesce(new.project_id, old.project_id);
  if v_status is not null and v_status not in ('draft', 'proposed') then
    raise exception 'charter_locked' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    new.updated_by := auth.uid();
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.charter_guard() from public, anon, authenticated;
create trigger project_charters_guard before insert or update or delete on public.project_charters
  for each row execute function private.charter_guard();

create function private.stakeholder_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  -- un stakeholder interno debe ser miembro activo de la misma organización
  if tg_op <> 'DELETE' and new.user_id is not null and not exists (
       select 1 from public.organization_members m
       where m.organization_id = new.organization_id and m.user_id = new.user_id) then
    raise exception 'stakeholder_not_member' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.stakeholder_guard() from public, anon, authenticated;
create trigger project_stakeholders_guard before insert or update or delete on public.project_stakeholders
  for each row execute function private.stakeholder_guard();

-- Compuerta: draft → proposed exige charter completo
create function private.charter_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_missing text[];
begin
  if old.status = 'draft' and new.status = 'proposed' then
    v_missing := private.charter_missing(new.id);
    if cardinality(v_missing) > 0 then
      raise exception 'charter_incomplete' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
    end if;
  end if;
  return new;
end $$;
revoke all on function private.charter_gate() from public, anon, authenticated;
create trigger projects_charter_gate before update of status on public.projects
  for each row execute function private.charter_gate();

create trigger project_charters_audit after insert or update or delete on public.project_charters
  for each row execute function private.audit_trigger();
create trigger project_stakeholders_audit after insert or update or delete on public.project_stakeholders
  for each row execute function private.audit_trigger();

-- RLS
grant select on public.project_charters, public.project_stakeholders to authenticated;
grant insert (project_id, organization_id, objectives, scope, out_of_scope, success_criteria, assumptions, constraints)
  on public.project_charters to authenticated;
grant update (objectives, scope, out_of_scope, success_criteria, assumptions, constraints) on public.project_charters to authenticated;
grant insert (organization_id, project_id, name, role, user_id, influence, interest, notes) on public.project_stakeholders to authenticated;
grant update (name, role, user_id, influence, interest, notes) on public.project_stakeholders to authenticated;
grant delete on public.project_stakeholders to authenticated;

create policy charters_read on public.project_charters for select to authenticated
  using (private.can_read_project(project_id));
create policy charters_insert on public.project_charters for insert to authenticated
  with check (private.has_project_permission(project_id, 'project.update'));
create policy charters_update on public.project_charters for update to authenticated
  using (private.has_project_permission(project_id, 'project.update'))
  with check (private.has_project_permission(project_id, 'project.update'));
create policy stakeholders_read on public.project_stakeholders for select to authenticated
  using (private.can_read_project(project_id));
create policy stakeholders_insert on public.project_stakeholders for insert to authenticated
  with check (private.has_project_permission(project_id, 'project.update'));
create policy stakeholders_update on public.project_stakeholders for update to authenticated
  using (private.has_project_permission(project_id, 'project.update'))
  with check (private.has_project_permission(project_id, 'project.update'));
create policy stakeholders_delete on public.project_stakeholders for delete to authenticated
  using (private.has_project_permission(project_id, 'project.update'));
