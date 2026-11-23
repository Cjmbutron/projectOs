-- =============================================================================
-- 2300 · Recursos (R3, parte 1): recursos de la organización, asignación a actividades y carga
--
-- Recursos de la ORGANIZACIÓN (compartidos entre proyectos): personas (opcionalmente vinculadas a un
-- miembro interno) y equipos. Capacidad diaria en horas (por defecto 8).
-- Asignación: una actividad puede tener varios recursos, cada uno con % de dedicación (1–100). Distinta
-- del responsable (`activities.assignee_id`). Asignar NO mueve el cronograma (sin nivelación).
-- Carga semanal (`resource_load`): horas = dedicación × capacidad diaria × días laborables del PROYECTO
-- de la actividad dentro de la semana (fechas ya calculadas, semanas ISO lunes–domingo). La capacidad
-- semanal es capacidad diaria × 5. Sobreasignado si horas > capacidad. Informativa.
-- Permisos: `resource.manage` (owner, admin, project_manager) crea/edita/desactiva recursos; asignar
-- exige `schedule.edit` en el proyecto. Los externos no ven recursos.
-- =============================================================================
insert into public.permissions (code, scope, description) values
  ('resource.manage', 'organization', 'Crear, editar y desactivar los recursos de la organización');

insert into public.role_permissions (role_id, permission_code)
select r.id, 'resource.manage'
from public.roles r
where r.is_system and r.scope = 'organization' and r.key in ('owner', 'admin', 'project_manager');

create function private.is_internal_member(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_org(p_org) and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and m.membership_type = 'internal')
$$;
revoke all on function private.is_internal_member(uuid) from public, anon;
grant execute on function private.is_internal_member(uuid) to authenticated, service_role;  -- la usan las políticas RLS

-- ---------------------------------------------------------------------------
-- Recursos
-- ---------------------------------------------------------------------------
create table public.resources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  kind            text not null default 'person' check (kind in ('person', 'equipment')),
  user_id         uuid references public.profiles (id) on delete set null,
  daily_hours     numeric(4, 2) not null default 8 check (daily_hours > 0 and daily_hours <= 24),
  active          boolean not null default true,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index resources_name_uq on public.resources (organization_id, lower(btrim(name)));
create unique index resources_user_uq on public.resources (organization_id, user_id) where user_id is not null;
select private.harden_table('public.resources');

create function private.resources_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is not null then
    if new.kind <> 'person' then
      raise exception 'equipment_cannot_have_user' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
      perform private.assert_internal_active_member(new.organization_id, new.user_id, 'resource_user');
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function private.resources_guard() from public, anon, authenticated;
create trigger resources_guard before insert or update on public.resources
  for each row execute function private.resources_guard();
create trigger resources_audit after insert or update or delete on public.resources
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------------------
-- Asignaciones actividad ↔ recurso
-- ---------------------------------------------------------------------------
create table public.activity_resources (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  project_id         uuid not null,
  activity_id        uuid not null,
  resource_id        uuid not null,
  allocation_percent integer not null default 100 check (allocation_percent between 1 and 100),
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (activity_id, resource_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (activity_id, project_id) references public.activities (id, project_id) on delete cascade,
  -- RESTRICT: un recurso con asignaciones se desactiva, no se borra
  foreign key (resource_id, organization_id) references public.resources (id, organization_id) on delete restrict
);
create index activity_resources_resource_idx on public.activity_resources (resource_id);
create index activity_resources_project_idx on public.activity_resources (project_id);
select private.harden_table('public.activity_resources');

create function private.activity_resources_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.resources r where r.id = new.resource_id and r.active) then
    raise exception 'resource_inactive' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.activity_resources_guard() from public, anon, authenticated;
create trigger activity_resources_guard before insert on public.activity_resources
  for each row execute function private.activity_resources_guard();
create trigger activity_resources_audit after insert or update or delete on public.activity_resources
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------------------
-- Carga semanal. SECURITY DEFINER a propósito: la sobreasignación solo es verdadera si se suman TODOS
-- los proyectos de la organización, también los que quien consulta no puede abrir. Devuelve solo
-- totales por recurso y semana (nunca nombres de proyecto ni de actividad).
-- ---------------------------------------------------------------------------
create function public.resource_load(p_org uuid, p_from date, p_to date)
returns table (resource_id uuid, week_start date, hours numeric, capacity_hours numeric, overallocated boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.is_internal_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  if p_to - p_from > 372 then
    raise exception 'range_too_large' using errcode = 'P0001';
  end if;
  return query
  with days as (
    select ar.resource_id as rid, r.daily_hours, ar.allocation_percent, g.day::date as day
    from public.activity_resources ar
    join public.resources r on r.id = ar.resource_id and r.organization_id = p_org
    join public.activities a on a.id = ar.activity_id and a.project_id = ar.project_id
    join public.projects p on p.id = ar.project_id
    left join public.project_schedules s on s.project_id = ar.project_id
    cross join lateral generate_series(greatest(a.early_start, p_from), least(a.early_finish, p_to), interval '1 day') g(day)
    where ar.organization_id = p_org
      and p.deleted_at is null and p.status <> 'cancelled'
      and a.early_start is not null and a.early_finish is not null
      and (exists (select 1 from public.project_calendar_days c where c.project_id = ar.project_id and c.day = g.day::date and c.kind = 'working')
           or (extract(dow from g.day)::smallint = any (coalesce(s.working_weekdays, '{1,2,3,4,5}'::smallint[]))
               and not exists (select 1 from public.project_calendar_days c where c.project_id = ar.project_id and c.day = g.day::date and c.kind = 'holiday')))
  ),
  weekly as (
    select d.rid, date_trunc('week', d.day)::date as wk, d.daily_hours,
           sum(d.allocation_percent / 100.0 * d.daily_hours) as h
    from days d
    group by d.rid, date_trunc('week', d.day)::date, d.daily_hours
  )
  select w.rid, w.wk, round(w.h, 2), round(w.daily_hours * 5, 2), (round(w.h, 2) > round(w.daily_hours * 5, 2))
  from weekly w
  order by w.rid, w.wk;
end $$;
revoke all on function public.resource_load(uuid, date, date) from public, anon;
grant execute on function public.resource_load(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS y concesiones
-- ---------------------------------------------------------------------------
grant select on public.resources to authenticated;
grant insert (organization_id, name, kind, user_id, daily_hours, active) on public.resources to authenticated;
grant update (name, kind, user_id, daily_hours, active) on public.resources to authenticated;
grant delete on public.resources to authenticated;
create policy resources_read on public.resources for select to authenticated
  using (private.is_internal_member(organization_id));
create policy resources_insert on public.resources for insert to authenticated
  with check (private.has_org_permission(organization_id, 'resource.manage'));
create policy resources_update on public.resources for update to authenticated
  using (private.has_org_permission(organization_id, 'resource.manage'))
  with check (private.has_org_permission(organization_id, 'resource.manage'));
create policy resources_delete on public.resources for delete to authenticated
  using (private.has_org_permission(organization_id, 'resource.manage'));

grant select on public.activity_resources to authenticated;
grant insert (organization_id, project_id, activity_id, resource_id, allocation_percent) on public.activity_resources to authenticated;
grant update (allocation_percent) on public.activity_resources to authenticated;
grant delete on public.activity_resources to authenticated;
create policy activity_resources_read on public.activity_resources for select to authenticated
  using (private.can_read_project(project_id));
create policy activity_resources_insert on public.activity_resources for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy activity_resources_update on public.activity_resources for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy activity_resources_delete on public.activity_resources for delete to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'));
