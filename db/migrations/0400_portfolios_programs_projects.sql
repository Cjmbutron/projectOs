-- =============================================================================
-- 0400 · Portafolios, programas, proyectos, fases y miembros de proyecto
-- US-008…013, 058…060 · POS-001 §6.1, §6.2, §7.1
--
-- Anti-fuga entre organizaciones: toda relación entre filas de negocio usa claves
-- foráneas COMPUESTAS (id, organization_id). Así la base de datos misma impide que
-- un proyecto de la organización A cuelgue de un portafolio de la B, aunque el código
-- de la aplicación o una política tuvieran un error.
-- =============================================================================

create table public.portfolios (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  description    text,
  responsible_id uuid references public.profiles (id) on delete set null,
  archived_at    timestamptz,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index portfolios_name_uk on public.portfolios (organization_id, lower(name)) where archived_at is null;
create trigger portfolios_touch before update on public.portfolios
  for each row execute function private.touch_updated_at();

create table public.programs (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  portfolio_id   uuid,
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  description    text,
  responsible_id uuid references public.profiles (id) on delete set null,
  archived_at    timestamptz,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (portfolio_id, organization_id) references public.portfolios (id, organization_id)
);
comment on column public.programs.portfolio_id is 'NULL = programa sin portafolio.';
create unique index programs_name_uk on public.programs (organization_id, lower(name)) where archived_at is null;
create index programs_portfolio_idx on public.programs (portfolio_id);
create trigger programs_touch before update on public.programs
  for each row execute function private.touch_updated_at();

-- Quien responde de un portafolio o programa debe ser miembro interno y activo.
create function private.responsible_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.responsible_id is not null
     and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform private.assert_internal_active_member(new.organization_id, new.responsible_id, 'responsible');
  end if;
  return new;
end $$;
revoke all on function private.responsible_guard() from public, anon, authenticated;

create trigger portfolios_guard before insert or update on public.portfolios
  for each row execute function private.responsible_guard();
create trigger programs_guard before insert or update on public.programs
  for each row execute function private.responsible_guard();

-- ---------------------------------------------------------------------------
-- Estados del proyecto (POS-001 §6.2 y §7.1). `health` es un indicador aparte.
-- ---------------------------------------------------------------------------
create table public.project_status_transitions (
  from_status         text not null,
  to_status           text not null,
  required_permission text not null default 'project.change_status' references public.permissions (code),
  needs_reopen        boolean not null default false,
  primary key (from_status, to_status)
);
comment on table public.project_status_transitions is
  'Transiciones permitidas. needs_reopen: solo mediante reopen_project (permiso de organización, con motivo).';

insert into public.project_status_transitions (from_status, to_status, required_permission, needs_reopen) values
  ('draft',     'proposed',  'project.change_status', false),
  ('draft',     'cancelled', 'project.change_status', false),
  ('proposed',  'approved',  'project.approve',       false),
  ('proposed',  'draft',     'project.change_status', false),
  ('proposed',  'cancelled', 'project.change_status', false),
  ('approved',  'planning',  'project.change_status', false),
  ('approved',  'cancelled', 'project.change_status', false),
  ('planning',  'executing', 'project.change_status', false),
  ('planning',  'on_hold',   'project.change_status', false),
  ('planning',  'cancelled', 'project.change_status', false),
  ('executing', 'on_hold',   'project.change_status', false),
  ('executing', 'closing',   'project.change_status', false),
  ('executing', 'cancelled', 'project.change_status', false),
  ('on_hold',   'planning',  'project.change_status', false),
  ('on_hold',   'executing', 'project.change_status', false),
  ('on_hold',   'cancelled', 'project.change_status', false),
  ('closing',   'closed',    'project.change_status', false),
  ('closing',   'executing', 'project.change_status', false),
  ('closing',   'cancelled', 'project.change_status', false),
  ('closed',    'closing',   'project.change_status', true);

-- ---------------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------------
create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  portfolio_id       uuid,
  program_id         uuid,
  code               text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  name               text not null check (char_length(btrim(name)) between 2 and 160),
  description        text,
  responsible_id     uuid not null references public.profiles (id) on delete restrict,
  methodology        text not null check (methodology in ('predictive', 'agile', 'hybrid')),
  complexity_profile text not null default 'standard' check (complexity_profile in ('personal', 'standard', 'enterprise')),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  status             text not null default 'draft' check (status in
                       ('draft', 'proposed', 'approved', 'planning', 'executing', 'on_hold', 'closing', 'closed', 'cancelled')),
  health             text not null default 'unknown' check (health in ('green', 'amber', 'red', 'unknown')),
  progress_percent   numeric(5, 2) not null default 0 check (progress_percent between 0 and 100),
  priority           smallint not null default 3 check (priority between 1 and 5),
  sort_order         integer not null default 0,
  visibility         text not null default 'organization' check (visibility in ('organization', 'private')),
  planned_start      date,
  planned_end        date,
  status_changed_at  timestamptz not null default now(),
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, organization_id),
  constraint projects_dates check (planned_end is null or planned_start is null or planned_end >= planned_start),
  -- MVP (POS-001 v1.3): solo predictivo. Este CHECK se elimina en la migración de R3 (Scrum/Kanban).
  constraint projects_methodology_mvp check (methodology = 'predictive'),
  foreign key (portfolio_id, organization_id) references public.portfolios (id, organization_id),
  foreign key (program_id, organization_id) references public.programs (id, organization_id)
);
comment on column public.projects.health is 'Indicador calculado (no editable por usuarios). En R1 siempre unknown; se calcula en R2/R4.';
comment on column public.projects.progress_percent is 'Calculado (US-028, R2). No editable por usuarios.';
comment on column public.projects.deleted_at is 'Papelera: el proyecto se restaura o se purga tras 30 días.';

create unique index projects_code_uk on public.projects (organization_id, lower(code));
create index projects_org_status_idx on public.projects (organization_id, status);
create index projects_portfolio_idx on public.projects (portfolio_id);
create index projects_program_idx on public.projects (program_id);
create index projects_responsible_idx on public.projects (responsible_id);

create trigger projects_touch before update on public.projects
  for each row execute function private.touch_updated_at();

create function private.projects_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_prog public.programs%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new_project_must_be_draft' using errcode = 'P0001';
    end if;
    perform private.assert_internal_active_member(new.organization_id, new.responsible_id, 'responsible');
  else
    if new.organization_id <> old.organization_id or new.methodology <> old.methodology
       or new.currency <> old.currency or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at then
      raise exception 'immutable_column' using errcode = '42501',
        hint = 'Organización, metodología y moneda no cambian después de crear el proyecto.';
    end if;

    -- Cerrado y cancelado son de solo lectura (RN-09). Únicas excepciones:
    --   * reabrir (closed → closing), que no puede tocar nada más que el estado;
    --   * tareas de archivo: archivar, papelera, orden y el arrastre de portafolio.
    if old.status in ('closed', 'cancelled') then
      if old.status = 'closed' and new.status = 'closing' then
        if (to_jsonb(old) - 'status' - 'status_changed_at' - 'updated_at')
           <> (to_jsonb(new) - 'status' - 'status_changed_at' - 'updated_at') then
          raise exception 'project_read_only' using errcode = 'P0001';
        end if;
      elsif (to_jsonb(old) - 'archived_at' - 'deleted_at' - 'updated_at' - 'portfolio_id' - 'sort_order')
            <> (to_jsonb(new) - 'archived_at' - 'deleted_at' - 'updated_at' - 'portfolio_id' - 'sort_order') then
        raise exception 'project_read_only' using errcode = 'P0001';
      end if;
    end if;

    if new.status <> old.status then
      if not exists (select 1 from public.project_status_transitions t
                     where t.from_status = old.status and t.to_status = new.status) then
        raise exception 'invalid_transition' using errcode = 'P0001',
          detail = format('%s -> %s', old.status, new.status);
      end if;
      new.status_changed_at := now();
    end if;

    if new.responsible_id <> old.responsible_id then
      perform private.assert_internal_active_member(new.organization_id, new.responsible_id, 'responsible');
    end if;
  end if;

  -- Un proyecto de un programa pertenece al mismo portafolio que el programa.
  if new.program_id is not null then
    select * into v_prog from public.programs g where g.id = new.program_id;
    if v_prog.portfolio_id is distinct from new.portfolio_id then
      raise exception 'portfolio_mismatch' using errcode = 'P0001',
        hint = 'El proyecto debe estar en el mismo portafolio que su programa.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.projects_guard() from public, anon, authenticated;

create trigger projects_guard before insert or update on public.projects
  for each row execute function private.projects_guard();

-- Mover un programa de portafolio arrastra a sus proyectos (US-058).
create function private.programs_cascade_portfolio() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.projects p
     set portfolio_id = new.portfolio_id
   where p.program_id = new.id and p.portfolio_id is distinct from new.portfolio_id;
  return null;
end $$;
revoke all on function private.programs_cascade_portfolio() from public, anon, authenticated;

create trigger programs_cascade_portfolio after update of portfolio_id on public.programs
  for each row when (old.portfolio_id is distinct from new.portfolio_id)
  execute function private.programs_cascade_portfolio();

-- ¿Se puede escribir en el proyecto? (no, si está cerrado o cancelado)
create function private.project_is_writable(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.status not in ('closed', 'cancelled') from public.projects p where p.id = p_project), true)
$$;
revoke all on function private.project_is_writable(uuid) from public, anon;
grant execute on function private.project_is_writable(uuid) to authenticated, service_role;

create function private.assert_project_writable(p_project uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.project_is_writable(p_project) then
    raise exception 'project_read_only' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.assert_project_writable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fases del ciclo de vida (US-013)
-- ---------------------------------------------------------------------------
create table public.project_phases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  description     text,
  position        integer not null check (position >= 1),
  planned_start   date,
  planned_end     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint project_phases_dates check (planned_end is null or planned_start is null or planned_end >= planned_start),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  constraint project_phases_position_uk unique (project_id, position) deferrable initially deferred
);
create index project_phases_project_idx on public.project_phases (project_id);
create trigger project_phases_touch before update on public.project_phases
  for each row execute function private.touch_updated_at();

create function private.project_phases_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.organization_id <> old.organization_id) then
    raise exception 'immutable_column' using errcode = '42501';
  end if;
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'INSERT' and new.position is null then
    select coalesce(max(f.position), 0) + 1 into new.position
    from public.project_phases f where f.project_id = new.project_id;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.project_phases_guard() from public, anon, authenticated;

-- `position` puede omitirse al insertar: el disparador BEFORE la calcula antes de que
-- se evalúe NOT NULL.
create trigger project_phases_guard before insert or update or delete on public.project_phases
  for each row execute function private.project_phases_guard();

-- ---------------------------------------------------------------------------
-- Miembros del proyecto (US-060)
-- ---------------------------------------------------------------------------
create table public.project_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  user_id         uuid not null,
  role_id         uuid not null references public.roles (id) on delete restrict,
  added_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, user_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index project_members_user_idx on public.project_members (user_id);
create index project_members_role_idx on public.project_members (role_id);
create trigger project_members_touch before update on public.project_members
  for each row execute function private.touch_updated_at();

create function private.project_members_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.roles%rowtype;
  v_type text;
  v_status text;
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.organization_id <> old.organization_id
     or new.user_id <> old.user_id) then
    raise exception 'immutable_column' using errcode = '42501';
  end if;
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'DELETE' then
    return old;
  end if;

  select * into v_role from public.roles r where r.id = new.role_id;
  if v_role.scope <> 'project' then
    raise exception 'role_scope_mismatch' using errcode = 'P0001';
  end if;
  if v_role.organization_id is not null and v_role.organization_id <> new.organization_id then
    raise exception 'role_wrong_organization' using errcode = '42501';
  end if;
  select m.membership_type, m.status into v_type, v_status
  from public.organization_members m
  where m.organization_id = new.organization_id and m.user_id = new.user_id;
  if tg_op = 'INSERT' and v_status <> 'active' then
    raise exception 'member_not_active' using errcode = 'P0001';
  end if;
  if v_type = 'external' and not v_role.external_assignable then
    raise exception 'role_not_assignable_to_external' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.project_members_guard() from public, anon, authenticated;

create trigger project_members_guard before insert or update or delete on public.project_members
  for each row execute function private.project_members_guard();
