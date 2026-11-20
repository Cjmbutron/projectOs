-- =============================================================================
-- 1800 · WBS y entregables (US-016, US-017)
--
-- La WBS es un árbol por proyecto con código jerárquico AUTOMÁTICO (1, 1.1, 1.1.2).
-- Código y posición los mantiene el sistema: las personas solo cambian name/description
-- directamente; crear, mover y borrar nodos va por funciones (que recodifican).
--  · No se borra un nodo con hijos.
--  · No se puede mover un nodo bajo sí mismo ni bajo un descendiente.
--  · Profundidad máxima 10 niveles; máximo 5000 nodos por proyecto.
-- Entregables: dos estados independientes (elaboración / revisión). Cambiar el estado de
-- revisión exige scope.review (separación de funciones: quien elabora no acepta).
-- =============================================================================
insert into public.permissions (code, scope, description) values
  ('scope.edit',   'project', 'Editar la WBS y los entregables del proyecto'),
  ('scope.review', 'project', 'Aceptar o rechazar entregables (estado de revisión)');

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from (values
  ('project_manager', 'scope.edit'), ('project_manager', 'scope.review'),
  ('team_lead',       'scope.edit')
) as v(role_key, code)
join public.roles r on r.is_system and r.scope = 'project' and r.key = v.role_key;

-- ---------------------------------------------------------------------------
-- WBS
-- ---------------------------------------------------------------------------
create table public.wbs_nodes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  parent_id       uuid,
  position        integer not null check (position > 0),
  code            text not null default '?',
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  description     text check (description is null or char_length(description) <= 4000),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, project_id),
  unique (id, project_id, organization_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  -- RESTRICT: un nodo con hijos no se borra (la regla vive también en la base de datos)
  foreign key (parent_id, project_id) references public.wbs_nodes (id, project_id) on delete restrict,
  constraint wbs_not_own_parent check (parent_id is distinct from id)
);
-- Diferida: la recodificación reasigna varios códigos en una sola sentencia.
alter table public.wbs_nodes add constraint wbs_nodes_code_uq unique (project_id, code) deferrable initially deferred;
create index wbs_nodes_parent_idx on public.wbs_nodes (project_id, parent_id, position);
select private.harden_table('public.wbs_nodes');

-- ---------------------------------------------------------------------------
-- Entregables
-- ---------------------------------------------------------------------------
create table public.deliverables (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  project_id          uuid not null,
  wbs_node_id         uuid,
  name                text not null check (char_length(btrim(name)) between 1 and 200),
  description         text check (description is null or char_length(description) <= 4000),
  acceptance_criteria text check (acceptance_criteria is null or char_length(acceptance_criteria) <= 4000),
  responsible_id      uuid references public.profiles (id) on delete set null,
  authoring_status    text not null default 'draft' check (authoring_status in ('draft', 'in_progress', 'completed')),
  review_status       text not null default 'pending' check (review_status in ('pending', 'in_review', 'accepted', 'rejected')),
  created_by          uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, project_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (wbs_node_id, project_id) references public.wbs_nodes (id, project_id) on delete set null (wbs_node_id)
);
create index deliverables_project_idx on public.deliverables (project_id);
create index deliverables_node_idx on public.deliverables (wbs_node_id);
select private.harden_table('public.deliverables');

create function private.scope_input_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    if tg_table_name = 'deliverables' then
      new.updated_at := now();
      if new.review_status <> old.review_status
         and not private.has_project_permission(new.project_id, 'scope.review') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and tg_table_name = 'deliverables' and new.review_status <> 'pending'
     and not private.has_project_permission(new.project_id, 'scope.review') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.scope_input_guard() from public, anon, authenticated;
create trigger deliverables_guard before insert or update or delete on public.deliverables
  for each row execute function private.scope_input_guard();

create function private.touch_wbs() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.description is distinct from old.description then
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function private.touch_wbs() from public, anon, authenticated;
create trigger wbs_nodes_touch before update on public.wbs_nodes
  for each row execute function private.touch_wbs();

-- Guarda de escritura directa (solo name/description llegan hasta aquí por las concesiones)
create function private.wbs_direct_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  return coalesce(new, old);
end $$;
revoke all on function private.wbs_direct_guard() from public, anon, authenticated;
create trigger wbs_nodes_guard before update on public.wbs_nodes
  for each row execute function private.wbs_direct_guard();

-- Auditoría: cambios de nombre/descripción/ubicación (el código solo cambia con la posición).
create trigger wbs_nodes_audit after insert or delete or update of parent_id, position, name, description
  on public.wbs_nodes for each row execute function private.audit_trigger();
create trigger deliverables_audit after insert or update or delete on public.deliverables
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------------------
-- Recodificación: posiciones contiguas por padre y códigos 1, 1.1, 1.1.2 …
-- ---------------------------------------------------------------------------
create function private.wbs_normalize(p_project uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_depth integer;
  v_count integer;
begin
  with recursive ranked as (
    select n.id, n.parent_id,
           row_number() over (partition by n.parent_id order by n.position, n.created_at, n.id)::integer as rn
    from public.wbs_nodes n where n.project_id = p_project
  ), tree as (
    select r.id, r.rn, r.rn::text as code from ranked r where r.parent_id is null
    union all
    select r.id, r.rn, t.code || '.' || r.rn from ranked r join tree t on r.parent_id = t.id
  )
  update public.wbs_nodes n set position = t.rn, code = t.code
  from tree t
  where n.id = t.id and (n.position is distinct from t.rn or n.code is distinct from t.code);

  select count(*), coalesce(max(array_length(string_to_array(code, '.'), 1)), 0)
    into v_count, v_depth from public.wbs_nodes where project_id = p_project;
  if v_depth > 10 then
    raise exception 'wbs_too_deep' using errcode = 'P0001';
  end if;
  if v_count > 5000 then
    raise exception 'wbs_too_large' using errcode = 'P0001';
  end if;
  -- Nodos que no cuelgan de ningún árbol (no debería ocurrir): fallo ruidoso
  if exists (select 1 from public.wbs_nodes where project_id = p_project and code = '?') then
    raise exception 'wbs_corrupt' using errcode = 'XX000';
  end if;
end $$;
revoke all on function private.wbs_normalize(uuid) from public, anon, authenticated;

create function private.wbs_authorize(p_project uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) or not private.has_project_permission(p_project, 'scope.edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_project_writable(p_project);
end $$;
revoke all on function private.wbs_authorize(uuid) from public, anon, authenticated;

create function public.wbs_add_node(p_project uuid, p_parent uuid, p_name text,
                                    p_description text default null, p_position integer default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
  v_pos integer;
begin
  perform private.wbs_authorize(p_project);
  perform pg_advisory_xact_lock(hashtextextended('wbs:' || p_project::text, 0));
  select organization_id into v_org from public.projects where id = p_project;
  if p_parent is not null and not exists (select 1 from public.wbs_nodes where id = p_parent and project_id = p_project) then
    raise exception 'wbs_node_not_found' using errcode = 'P0001';
  end if;
  -- hace hueco: posiciones pares para los hermanos y una impar para el nuevo
  update public.wbs_nodes set position = position * 2 where project_id = p_project and parent_id is not distinct from p_parent;
  v_pos := case when p_position is null or p_position < 1 then 2000000000 else least(p_position, 1000000) * 2 - 1 end;
  insert into public.wbs_nodes (organization_id, project_id, parent_id, position, name, description)
  values (v_org, p_project, p_parent, v_pos, btrim(p_name), p_description)
  returning id into v_id;
  perform private.wbs_normalize(p_project);
  return v_id;
end $$;

create function public.wbs_move_node(p_node uuid, p_parent uuid, p_position integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.wbs_nodes where id = p_node;
  if v_project is null then
    -- no revela la existencia de nodos que la persona no puede ver
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.wbs_authorize(v_project);
  perform pg_advisory_xact_lock(hashtextextended('wbs:' || v_project::text, 0));
  if p_parent is not null then
    if not exists (select 1 from public.wbs_nodes where id = p_parent and project_id = v_project) then
      raise exception 'wbs_node_not_found' using errcode = 'P0001';
    end if;
    -- el destino no puede ser el propio nodo ni uno de sus descendientes
    if p_parent = p_node or exists (
      with recursive d as (
        select id from public.wbs_nodes where parent_id = p_node
        union all select c.id from public.wbs_nodes c join d on c.parent_id = d.id)
      select 1 from d where id = p_parent) then
      raise exception 'wbs_cycle' using errcode = 'P0001';
    end if;
  end if;
  update public.wbs_nodes set position = position * 2 where project_id = v_project and parent_id is not distinct from p_parent and id <> p_node;
  update public.wbs_nodes
     set parent_id = p_parent,
         position = case when p_position is null or p_position < 1 then 2000000000 else least(p_position, 1000000) * 2 - 1 end
   where id = p_node;
  perform private.wbs_normalize(v_project);
end $$;

create function public.wbs_delete_node(p_node uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.wbs_nodes where id = p_node;
  if v_project is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.wbs_authorize(v_project);
  perform pg_advisory_xact_lock(hashtextextended('wbs:' || v_project::text, 0));
  if exists (select 1 from public.wbs_nodes where parent_id = p_node) then
    raise exception 'wbs_has_children' using errcode = 'P0001';
  end if;
  delete from public.wbs_nodes where id = p_node;
  perform private.wbs_normalize(v_project);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.wbs_add_node(uuid, uuid, text, text, integer)',
                           'public.wbs_move_node(uuid, uuid, integer)', 'public.wbs_delete_node(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS y concesiones
-- ---------------------------------------------------------------------------
grant select on public.wbs_nodes to authenticated;
grant update (name, description) on public.wbs_nodes to authenticated;
create policy wbs_read on public.wbs_nodes for select to authenticated
  using (private.can_read_project(project_id));
create policy wbs_update on public.wbs_nodes for update to authenticated
  using (private.has_project_permission(project_id, 'scope.edit'))
  with check (private.has_project_permission(project_id, 'scope.edit'));

grant select on public.deliverables to authenticated;
grant insert (organization_id, project_id, wbs_node_id, name, description, acceptance_criteria,
              responsible_id, authoring_status, review_status) on public.deliverables to authenticated;
grant update (wbs_node_id, name, description, acceptance_criteria, responsible_id, authoring_status, review_status)
  on public.deliverables to authenticated;
grant delete on public.deliverables to authenticated;
create policy deliverables_read on public.deliverables for select to authenticated
  using (private.can_read_project(project_id));
create policy deliverables_insert on public.deliverables for insert to authenticated
  with check (private.has_project_permission(project_id, 'scope.edit'));
create policy deliverables_update on public.deliverables for update to authenticated
  using (private.has_project_permission(project_id, 'scope.edit') or private.has_project_permission(project_id, 'scope.review'))
  with check (private.has_project_permission(project_id, 'scope.edit') or private.has_project_permission(project_id, 'scope.review'));
create policy deliverables_delete on public.deliverables for delete to authenticated
  using (private.has_project_permission(project_id, 'scope.edit'));
