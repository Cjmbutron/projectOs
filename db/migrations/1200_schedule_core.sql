-- =============================================================================
-- 1200 · Cronograma (R2): calendario, actividades, restricciones, dependencias
-- US-021 a US-028 · ADR-003
--
-- Modelo:
--  * Las columnas de ENTRADA (duración, dependencias, restricciones, calendario) las editan
--    las personas con `schedule.edit`.
--  * Las columnas CALCULADAS (fechas tempranas/tardías, holguras, crítica) solo las escribe
--    `apply_schedule` (service_role) con el resultado del motor `schedule-engine`.
--  * `project_schedules.schedule_version` sube con cada cambio de entradas; `apply_schedule`
--    exige la versión que leyó el servidor: si alguien editó mientras tanto → conflicto.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Utilidad: toda tabla nueva nace cerrada (Supabase concede privilegios por defecto)
-- ---------------------------------------------------------------------------
create function private.harden_table(p_table regclass) returns void
language plpgsql set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('revoke all on table %s from public, anon, authenticated', p_table);
end $$;
revoke all on function private.harden_table(regclass) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permisos nuevos
-- ---------------------------------------------------------------------------
insert into public.permissions (code, scope, description) values
  ('schedule.edit',     'project', 'Editar actividades, dependencias, restricciones y calendario del cronograma'),
  ('schedule.baseline', 'project', 'Crear líneas base del cronograma');

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from (values
  ('project_manager', 'schedule.edit'), ('project_manager', 'schedule.baseline'),
  ('team_lead',       'schedule.edit')
) as v(role_key, code)
join public.roles r on r.is_system and r.scope = 'project' and r.key = v.role_key;

-- Lectura de proyecto: un proyecto en la papelera solo lo ve quien puede eliminarlo
-- (para restaurarlo). Antes esa condición solo estaba en la política de `projects`;
-- aquí se mueve a la función para que cubra también fases, miembros, actividades, etc.
create or replace function private.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and private.can_access_org(p.organization_id)
      and (p.deleted_at is null or private.has_project_permission(p.id, 'project.delete'))
      and (
        private.has_org_permission(p.organization_id, 'project.read_all')
        or p.created_by = auth.uid()
        or exists (select 1 from public.project_members pm
                   where pm.project_id = p.id and pm.user_id = auth.uid())
        or (p.visibility = 'organization' and exists (
              select 1 from public.organization_members m
              where m.organization_id = p.organization_id and m.user_id = auth.uid()
                and m.status = 'active' and m.membership_type = 'internal'))
      ))
$$;

-- Permiso de un usuario EXPLÍCITO (para funciones que corren como service_role en nombre
-- de una persona ya autenticada por el servidor). No evalúa MFA: eso lo valida el servidor
-- con el JWT de la persona.
create function private.user_can_project(p_user uuid, p_project uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.organization_members m
      on m.organization_id = p.organization_id and m.user_id = p_user and m.status = 'active'
    where p.id = p_project
      and (
        exists (select 1 from public.role_permissions rp
                where rp.role_id = m.role_id and rp.permission_code = 'project.manage_all')
        or exists (select 1 from public.project_members pm
                   join public.role_permissions rp on rp.role_id = pm.role_id
                   where pm.project_id = p.id and pm.user_id = p_user and rp.permission_code = p_code)
      ))
$$;
revoke all on function private.user_can_project(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.user_can_project(uuid, uuid, text) to service_role;

-- Unicidad necesaria para claves foráneas compuestas
alter table public.project_phases add constraint project_phases_id_project_uk unique (id, project_id);

-- ---------------------------------------------------------------------------
-- Ajustes y resultado del cronograma por proyecto (1:1)
-- ---------------------------------------------------------------------------
create function private.valid_weekdays(p smallint[]) returns boolean
language sql immutable set search_path = ''
as $$
  select cardinality(p) between 1 and 7
     and p <@ array[0,1,2,3,4,5,6]::smallint[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$$;

revoke all on function private.valid_weekdays(smallint[]) from public, anon;
grant execute on function private.valid_weekdays(smallint[]) to authenticated, service_role;

create table public.project_schedules (
  project_id       uuid primary key,
  organization_id  uuid not null,
  start_date       date check (start_date between '1900-01-01' and '2200-12-31'),
  working_weekdays smallint[] not null default '{1,2,3,4,5}' check (private.valid_weekdays(working_weekdays)),
  schedule_version integer not null default 0,
  -- resultado del último cálculo aplicado (solo apply_schedule)
  computed_version integer,
  computed_at      timestamptz,
  computed_start   date,
  computed_finish  date,
  duration_days    integer,
  warnings         jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
comment on column public.project_schedules.schedule_version is 'Sube con cada cambio de entradas del cronograma. Base del bloqueo optimista.';
comment on column public.project_schedules.computed_version is 'Versión de entradas con la que se calcularon las fechas guardadas. Igual a schedule_version = cronograma al día.';
select private.harden_table('public.project_schedules');
create trigger project_schedules_touch before update on public.project_schedules
  for each row execute function private.touch_updated_at();

create function private.project_schedules_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
    raise exception 'immutable_column' using errcode = '42501';
  end if;
  -- Cambiar el inicio o la semana laboral cambia el cronograma.
  if new.start_date is distinct from old.start_date or new.working_weekdays <> old.working_weekdays then
    perform private.assert_project_writable(new.project_id);
    new.schedule_version := old.schedule_version + 1;
  end if;
  return new;
end $$;
revoke all on function private.project_schedules_guard() from public, anon, authenticated;
create trigger project_schedules_guard before update on public.project_schedules
  for each row execute function private.project_schedules_guard();

-- Un proyecto nuevo nace con su fila de cronograma (inicio = fecha planificada, si existe).
create function private.projects_create_schedule() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.project_schedules (project_id, organization_id, start_date)
  values (new.id, new.organization_id, new.planned_start);
  return null;
end $$;
revoke all on function private.projects_create_schedule() from public, anon, authenticated;
create trigger projects_create_schedule after insert on public.projects
  for each row execute function private.projects_create_schedule();

insert into public.project_schedules (project_id, organization_id, start_date)
select p.id, p.organization_id, p.planned_start from public.projects p
on conflict do nothing;

-- Sube la versión del cronograma (tras un cambio de entradas).
create function private.bump_schedule_version(p_project uuid) returns void
language sql security definer set search_path = ''
as $$ update public.project_schedules set schedule_version = schedule_version + 1 where project_id = p_project $$;
revoke all on function private.bump_schedule_version(uuid) from public, anon, authenticated;

create function private.bump_schedule_trigger() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.bump_schedule_version(coalesce(new.project_id, old.project_id));
  return null;
end $$;
revoke all on function private.bump_schedule_trigger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Calendario: feriados y días trabajados excepcionales
-- ---------------------------------------------------------------------------
create table public.project_calendar_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  day             date not null check (day between '1900-01-01' and '2200-12-31'),
  kind            text not null check (kind in ('holiday', 'working')),
  name            text check (name is null or char_length(btrim(name)) between 1 and 120),
  created_at      timestamptz not null default now(),
  unique (project_id, day),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
select private.harden_table('public.project_calendar_days');

-- ---------------------------------------------------------------------------
-- Actividades
-- ---------------------------------------------------------------------------
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  project_id       uuid not null,
  phase_id         uuid,
  name             text not null check (char_length(btrim(name)) between 1 and 200),
  description      text,
  duration         integer not null default 1 check (duration between 0 and 36500),
  is_milestone     boolean generated always as (duration = 0) stored,
  assignee_id      uuid references public.profiles (id) on delete set null,
  status           text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  percent_complete smallint not null default 0 check (percent_complete between 0 and 100),
  sort_order       integer not null default 0,
  -- calculadas (solo apply_schedule)
  early_start      date,
  early_finish     date,
  late_start       date,
  late_finish      date,
  total_float      integer,
  free_float       integer,
  is_critical      boolean,
  violated_constraints text[] not null default '{}',
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, project_id),
  constraint activities_progress_consistent check (
    (status = 'not_started' and percent_complete = 0)
    or (status = 'in_progress' and percent_complete between 1 and 99)
    or (status = 'done' and percent_complete = 100)),
  constraint activities_milestone_not_in_progress check (not (duration = 0 and status = 'in_progress')),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (phase_id, project_id) references public.project_phases (id, project_id) on delete set null (phase_id)
);
comment on column public.activities.early_start is 'Calculada por el motor (apply_schedule). NULL = aún sin calcular.';
create index activities_project_idx on public.activities (project_id, sort_order);
create index activities_assignee_idx on public.activities (assignee_id) where assignee_id is not null;
select private.harden_table('public.activities');
create trigger activities_touch before update on public.activities
  for each row execute function private.touch_updated_at();

create function private.activities_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.organization_id <> old.organization_id) then
    raise exception 'immutable_column' using errcode = '42501';
  end if;
  perform private.assert_project_writable(v_project);
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Quien ejecuta debe ser un miembro interno y activo del PROYECTO.
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform private.assert_internal_active_member(new.organization_id, new.assignee_id, 'assignee');
    if not exists (select 1 from public.project_members pm
                   where pm.project_id = new.project_id and pm.user_id = new.assignee_id) then
      raise exception 'assignee_must_be_project_member' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.activities_guard() from public, anon, authenticated;
create trigger activities_guard before insert or update or delete on public.activities
  for each row execute function private.activities_guard();

create trigger activities_bump after insert or delete on public.activities
  for each row execute function private.bump_schedule_trigger();
create trigger activities_bump_duration after update of duration on public.activities
  for each row when (old.duration is distinct from new.duration)
  execute function private.bump_schedule_trigger();

-- ---------------------------------------------------------------------------
-- Restricciones de fecha (una por tipo y actividad; un sprint usa SNET + FNLT)
-- ---------------------------------------------------------------------------
create table public.activity_constraints (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  activity_id     uuid not null,
  type            text not null check (type in ('SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO')),
  date            date not null check (date between '1900-01-01' and '2200-12-31'),
  created_at      timestamptz not null default now(),
  unique (activity_id, type),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (activity_id, project_id) references public.activities (id, project_id) on delete cascade
);
create index activity_constraints_project_idx on public.activity_constraints (project_id);
select private.harden_table('public.activity_constraints');

-- ---------------------------------------------------------------------------
-- Dependencias
-- ---------------------------------------------------------------------------
create table public.activity_dependencies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  predecessor_id  uuid not null,
  successor_id    uuid not null,
  type            text not null default 'FS' check (type in ('FS', 'SS', 'FF', 'SF')),
  lag             integer not null default 0 check (lag between -36500 and 36500),
  created_at      timestamptz not null default now(),
  constraint activity_dependencies_not_self check (predecessor_id <> successor_id),
  unique (predecessor_id, successor_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (predecessor_id, project_id) references public.activities (id, project_id) on delete cascade,
  foreign key (successor_id, project_id) references public.activities (id, project_id) on delete cascade
);
create index activity_dependencies_project_idx on public.activity_dependencies (project_id);
create index activity_dependencies_successor_idx on public.activity_dependencies (successor_id);
select private.harden_table('public.activity_dependencies');

-- Defensa en profundidad: la base de datos tampoco admite ciclos (el motor ya los detecta).
create function private.dependencies_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.organization_id <> old.organization_id
                           or new.predecessor_id <> old.predecessor_id or new.successor_id <> old.successor_id) then
    raise exception 'immutable_column' using errcode = '42501',
      hint = 'Para cambiar los extremos de una dependencia, elimínala y crea otra.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.dependencies_guard() from public, anon, authenticated;
create trigger dependencies_guard before insert or update or delete on public.activity_dependencies
  for each row execute function private.dependencies_guard();

-- La búsqueda de ciclos corre con los privilegios de QUIEN ESCRIBE (SECURITY INVOKER):
-- así RLS limita lo que "ve" y quien no tiene acceso no obtiene señal alguna sobre el grafo.
create function private.dependencies_cycle_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (
    with recursive reach(id) as (
      select d.successor_id from public.activity_dependencies d
      where d.predecessor_id = new.successor_id and d.id <> new.id
      union
      select d.successor_id from public.activity_dependencies d
      join reach r on d.predecessor_id = r.id where d.id <> new.id)
    select 1 from reach where id = new.predecessor_id) then
    raise exception 'dependency_cycle' using errcode = 'P0001',
      hint = 'La dependencia crearía un ciclo en el cronograma.';
  end if;
  return new;
end $$;
revoke all on function private.dependencies_cycle_guard() from public, anon;
grant execute on function private.dependencies_cycle_guard() to authenticated, service_role;
create trigger dependencies_cycle_guard before insert on public.activity_dependencies
  for each row execute function private.dependencies_cycle_guard();

create function private.schedule_input_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    if tg_table_name = 'activity_constraints' then
      if new.activity_id <> old.activity_id then
        raise exception 'immutable_column' using errcode = '42501';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.schedule_input_guard() from public, anon, authenticated;
create trigger activity_constraints_guard before insert or update or delete on public.activity_constraints
  for each row execute function private.schedule_input_guard();
create trigger project_calendar_days_guard before insert or update or delete on public.project_calendar_days
  for each row execute function private.schedule_input_guard();

create trigger dependencies_bump after insert or update or delete on public.activity_dependencies
  for each row execute function private.bump_schedule_trigger();
create trigger constraints_bump after insert or update or delete on public.activity_constraints
  for each row execute function private.bump_schedule_trigger();
create trigger calendar_days_bump after insert or update or delete on public.project_calendar_days
  for each row execute function private.bump_schedule_trigger();

-- ---------------------------------------------------------------------------
-- Auditoría: se amplía la función (las tablas nuevas) y se omiten los cambios que
-- solo tocan columnas calculadas (no son acciones de una persona).
-- ---------------------------------------------------------------------------
create or replace function private.audit_trigger() returns trigger
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
  v_system text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := private.audit_redact(to_jsonb(old)); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := private.audit_redact(to_jsonb(new)); end if;

  if tg_op = 'UPDATE' then
    -- Columnas mantenidas por el sistema: un UPDATE que solo las cambia no es un cambio real.
    v_system := case tg_table_name
      when 'activities' then array['updated_at', 'early_start', 'early_finish', 'late_start', 'late_finish',
                                   'total_float', 'free_float', 'is_critical', 'violated_constraints']
      when 'project_schedules' then array['updated_at', 'computed_version', 'computed_at', 'computed_start',
                                          'computed_finish', 'duration_days', 'warnings', 'schedule_version']
      when 'projects' then array['updated_at', 'progress_percent', 'health']
      else array['updated_at']
    end;
    if (v_old - v_system) = (v_new - v_system) then
      return null;
    end if;
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
          coalesce(v_any ->> 'id', v_any ->> 'role_id', v_any ->> 'project_id'), v_old, v_new, v_reason);
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'activity_dependencies', 'activity_constraints',
                           'project_schedules', 'project_calendar_days'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function private.audit_trigger()', t || '_audit', t);
  end loop;
end $$;
