-- =============================================================================
-- 0300 · Organizaciones, permisos, roles y membresías
-- US-004…007, 056, 057 · POS-001 §6.1 y §7
--
-- Decisiones:
--  * "Organización" y "workspace" son el mismo concepto (hallazgo #1).
--  * Rol de organización ≠ rol de proyecto (campo roles.scope).
--  * Plantillas del sistema: organization_id NULL, is_system = true, inmutables para
--    cualquier sesión de usuario. Cada organización crea roles propios (is_system = false).
--  * Externo = membership_type 'external' con rol de sistema `guest`.
-- =============================================================================

create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 2 and 120),
  reference_currency text not null check (reference_currency ~ '^[A-Z]{3}$'),
  mfa_required       boolean not null default false,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.organizations is 'Organización (inquilino). Todo dato de negocio cuelga de una.';

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

-- Activar MFA obligatorio exige que quien lo activa tenga ya una sesión aal2
-- (si no, se dejaría fuera a sí mismo).
create function private.organizations_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.mfa_required and not old.mfa_required
     and auth.uid() is not null and private.current_aal() <> 'aal2' then
    raise exception 'mfa_session_required_to_enable_mfa' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.organizations_guard() from public, anon, authenticated;

create trigger organizations_guard before update on public.organizations
  for each row execute function private.organizations_guard();

-- ---------------------------------------------------------------------------
-- Catálogo de permisos
-- ---------------------------------------------------------------------------
create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  scope       text not null check (scope in ('organization', 'project')),
  description text not null
);
comment on table public.permissions is 'Catálogo cerrado de permisos. Los roles son conjuntos de estos códigos.';

insert into public.permissions (code, scope, description) values
  ('org.settings.manage',  'organization', 'Editar nombre, moneda de referencia y MFA obligatorio de la organización'),
  ('org.members.read',     'organization', 'Ver la lista de miembros de la organización'),
  ('org.members.invite',   'organization', 'Invitar miembros internos y externos'),
  ('org.members.manage',   'organization', 'Cambiar roles, suspender y reactivar miembros'),
  ('org.roles.manage',     'organization', 'Crear y editar roles propios de la organización'),
  ('org.ownership.manage', 'organization', 'Otorgar y retirar el rol de owner (solo plantilla owner)'),
  ('portfolio.read',       'organization', 'Ver portafolios y programas'),
  ('portfolio.manage',     'organization', 'Crear y editar portafolios'),
  ('program.manage',       'organization', 'Crear y editar programas y ubicar proyectos en ellos'),
  ('project.create',       'organization', 'Crear proyectos'),
  ('project.read_all',     'organization', 'Ver todos los proyectos, incluidos los privados'),
  ('project.manage_all',   'organization', 'Actuar como gestor en cualquier proyecto de la organización'),
  ('project.reopen',       'organization', 'Reabrir un proyecto cerrado (con motivo, queda en auditoría)'),
  ('audit.read',           'organization', 'Consultar la bitácora de auditoría'),
  ('project.read',         'project',      'Ver el proyecto'),
  ('project.update',       'project',      'Editar datos del proyecto, fases y archivarlo'),
  ('project.change_status','project',      'Cambiar el estado del proyecto'),
  ('project.approve',      'project',      'Aprobar el proyecto (proposed → approved)'),
  ('project.manage_members','project',     'Asignar miembros y roles del proyecto'),
  ('project.delete',       'project',      'Enviar a la papelera y restaurar el proyecto');

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create table public.roles (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid references public.organizations (id) on delete cascade,
  scope               text not null check (scope in ('organization', 'project')),
  key                 text check (key ~ '^[a-z_]+$'),
  name                text not null check (char_length(btrim(name)) between 2 and 80),
  description         text,
  is_system           boolean not null default false,
  external_assignable boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint roles_shape check (
    (is_system and organization_id is null and key is not null)
    or (not is_system and organization_id is not null and key is null)
  )
);
comment on table public.roles is 'Roles. organization_id NULL = plantilla del sistema (inmutable).';
comment on column public.roles.external_assignable is
  'Si es true, puede asignarse a miembros externos; solo puede contener project.read.';

create unique index roles_system_key_uk on public.roles (scope, key) where is_system;
create unique index roles_custom_name_uk on public.roles (organization_id, scope, lower(name)) where not is_system;
create index roles_organization_idx on public.roles (organization_id);

create trigger roles_touch before update on public.roles
  for each row execute function private.touch_updated_at();

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete restrict,
  primary key (role_id, permission_code)
);

-- Identificadores fijos de las plantillas (estables entre entornos).
--   Organización: 1000…0001 owner · 02 admin · 03 portfolio_manager · 04 program_manager
--                 05 project_manager · 06 member · 07 auditor · 08 guest
--   Proyecto:     2000…0001 project_manager · 02 team_lead · 03 contributor
--                 04 client_stakeholder · 05 viewer
insert into public.roles (id, organization_id, scope, key, name, description, is_system, external_assignable) values
  ('10000000-0000-4000-8000-000000000001', null, 'organization', 'owner',             'Owner',             'Control total, incluida la propiedad de la organización', true, false),
  ('10000000-0000-4000-8000-000000000002', null, 'organization', 'admin',             'Administrador',     'Administra miembros, roles, ajustes y todos los proyectos', true, false),
  ('10000000-0000-4000-8000-000000000003', null, 'organization', 'portfolio_manager', 'Portfolio Manager', 'Gestiona portafolios y programas y crea proyectos', true, false),
  ('10000000-0000-4000-8000-000000000004', null, 'organization', 'program_manager',   'Program Manager',   'Gestiona programas y crea proyectos', true, false),
  ('10000000-0000-4000-8000-000000000005', null, 'organization', 'project_manager',   'Project Manager',   'Crea proyectos', true, false),
  ('10000000-0000-4000-8000-000000000006', null, 'organization', 'member',            'Miembro',           'Participa en los proyectos visibles de la organización', true, false),
  ('10000000-0000-4000-8000-000000000007', null, 'organization', 'auditor',           'Auditor',           'Solo lectura de proyectos y bitácora', true, false),
  ('10000000-0000-4000-8000-000000000008', null, 'organization', 'guest',             'Invitado externo',  'Externo: solo accede a los proyectos que se le asignan', true, false),
  ('20000000-0000-4000-8000-000000000001', null, 'project',      'project_manager',   'Project Manager',   'Gestiona el proyecto', true, false),
  ('20000000-0000-4000-8000-000000000002', null, 'project',      'team_lead',         'Team Lead',         'Lidera al equipo del proyecto', true, false),
  ('20000000-0000-4000-8000-000000000003', null, 'project',      'contributor',       'Contributor',       'Contribuye al proyecto', true, true),
  ('20000000-0000-4000-8000-000000000004', null, 'project',      'client_stakeholder','Client/Stakeholder','Cliente o interesado', true, true),
  ('20000000-0000-4000-8000-000000000005', null, 'project',      'viewer',            'Viewer',            'Solo lectura', true, true);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.scope = r.scope
where r.is_system and r.scope = 'organization' and r.key = 'owner';

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.scope = r.scope and p.code <> 'org.ownership.manage'
where r.is_system and r.scope = 'organization' and r.key = 'admin';

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from (values
  ('portfolio_manager', 'portfolio.read'), ('portfolio_manager', 'portfolio.manage'),
  ('portfolio_manager', 'program.manage'), ('portfolio_manager', 'project.create'),
  ('portfolio_manager', 'org.members.read'),
  ('program_manager',   'portfolio.read'), ('program_manager',   'program.manage'),
  ('program_manager',   'project.create'), ('program_manager',   'org.members.read'),
  ('project_manager',   'portfolio.read'), ('project_manager',   'project.create'),
  ('project_manager',   'org.members.read'),
  ('member',            'portfolio.read'), ('member',            'org.members.read'),
  ('auditor',           'audit.read'),     ('auditor',           'project.read_all'),
  ('auditor',           'portfolio.read'), ('auditor',           'org.members.read')
) as v(role_key, code)
join public.roles r on r.is_system and r.scope = 'organization' and r.key = v.role_key;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from (values
  ('project_manager',    'project.read'), ('project_manager', 'project.update'),
  ('project_manager',    'project.change_status'), ('project_manager', 'project.approve'),
  ('project_manager',    'project.manage_members'), ('project_manager', 'project.delete'),
  ('team_lead',          'project.read'),
  ('contributor',        'project.read'),
  ('client_stakeholder', 'project.read'),
  ('viewer',             'project.read')
) as v(role_key, code)
join public.roles r on r.is_system and r.scope = 'project' and r.key = v.role_key;

-- Las plantillas del sistema no se modifican desde ninguna sesión de usuario
-- (las migraciones corren sin sesión de usuario, así que sí pueden sembrarlas).
create function private.roles_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_bad int;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.is_system and auth.uid() is not null then
    raise exception 'system_role_immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.scope <> old.scope or new.organization_id is distinct from old.organization_id
       or new.is_system <> old.is_system or new.key is distinct from old.key then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    if new.external_assignable and not old.external_assignable then
      select count(*) into v_bad from public.role_permissions rp
      where rp.role_id = new.id and rp.permission_code <> 'project.read';
      if v_bad > 0 then
        raise exception 'external_role_read_only' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and new.is_system and auth.uid() is not null then
    raise exception 'system_role_immutable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.roles_guard() from public, anon, authenticated;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function private.roles_guard();

create function private.role_permissions_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role  public.roles%rowtype;
  v_scope text;
begin
  select * into v_role from public.roles r where r.id = coalesce(new.role_id, old.role_id);
  if not found then
    return coalesce(new, old);   -- el rol ya no existe (borrado en cascada)
  end if;
  if v_role.is_system and auth.uid() is not null then
    raise exception 'system_role_immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select p.scope into v_scope from public.permissions p where p.code = new.permission_code;
  if v_scope is distinct from v_role.scope then
    raise exception 'permission_scope_mismatch' using errcode = 'P0001';
  end if;
  if not v_role.is_system and new.permission_code = 'org.ownership.manage' then
    raise exception 'ownership_permission_reserved_to_owner' using errcode = '42501';
  end if;
  if v_role.external_assignable and new.permission_code <> 'project.read' then
    raise exception 'external_role_read_only' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.role_permissions_guard() from public, anon, authenticated;

create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function private.role_permissions_guard();

-- ---------------------------------------------------------------------------
-- Membresías
-- ---------------------------------------------------------------------------
create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  membership_type text not null check (membership_type in ('internal', 'external')),
  role_id         uuid not null references public.roles (id) on delete restrict,
  status          text not null default 'active' check (status in ('active', 'suspended')),
  invited_by      uuid references public.profiles (id) on delete set null,
  joined_at       timestamptz not null default now(),
  suspended_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint organization_members_suspension check ((status = 'suspended') = (suspended_at is not null))
);
comment on table public.organization_members is 'Pertenencia de una persona a una organización, con rol y estado.';
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_role_idx on public.organization_members (role_id);

create trigger organization_members_touch before update on public.organization_members
  for each row execute function private.touch_updated_at();

-- ¿Es la plantilla `owner`?
create function private.role_is_owner(p_role uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select r.is_system and r.key = 'owner' and r.scope = 'organization'
                   from public.roles r where r.id = p_role), false)
$$;
revoke all on function private.role_is_owner(uuid) from public, anon;
grant execute on function private.role_is_owner(uuid) to authenticated, service_role;

create function private.organization_members_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.roles%rowtype;
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id
     or new.user_id <> old.user_id or new.membership_type <> old.membership_type) then
    raise exception 'immutable_column' using errcode = '42501';
  end if;

  select * into v_role from public.roles r where r.id = new.role_id;
  if v_role.scope <> 'organization' then
    raise exception 'role_scope_mismatch' using errcode = 'P0001';
  end if;
  if v_role.organization_id is not null and v_role.organization_id <> new.organization_id then
    raise exception 'role_wrong_organization' using errcode = '42501';
  end if;
  if new.membership_type = 'external' and not (v_role.is_system and v_role.key = 'guest') then
    raise exception 'external_requires_guest_role' using errcode = 'P0001';
  end if;
  if new.membership_type = 'internal' and v_role.is_system and v_role.key = 'guest' then
    raise exception 'internal_cannot_be_guest' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.organization_members_guard() from public, anon, authenticated;

create trigger organization_members_guard before insert or update on public.organization_members
  for each row execute function private.organization_members_guard();

-- Siempre queda al menos un owner activo (US-006). El bloqueo sobre la fila de la
-- organización serializa dos degradaciones simultáneas.
create function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_others int;
begin
  if not (private.role_is_owner(old.role_id) and old.status = 'active') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and private.role_is_owner(new.role_id) and new.status = 'active' then
    return new;
  end if;
  perform 1 from public.organizations o where o.id = old.organization_id for update;
  if not found then
    return coalesce(new, old);   -- la organización se está eliminando en cascada
  end if;
  select count(*) into v_others
  from public.organization_members m
  where m.organization_id = old.organization_id and m.id <> old.id
    and m.status = 'active' and private.role_is_owner(m.role_id);
  if v_others = 0 then
    raise exception 'last_owner' using errcode = 'P0001',
      hint = 'La organización debe conservar al menos un owner activo.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.protect_last_owner() from public, anon, authenticated;

create trigger organization_members_last_owner before update or delete on public.organization_members
  for each row execute function private.protect_last_owner();

-- Utilidad: la persona debe ser miembro interno y activo de la organización.
create function private.assert_internal_active_member(p_org uuid, p_user uuid, p_what text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = p_user
      and m.membership_type = 'internal' and m.status = 'active'
  ) then
    raise exception '%_must_be_active_internal_member', p_what using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.assert_internal_active_member(uuid, uuid, text) from public, anon, authenticated;
