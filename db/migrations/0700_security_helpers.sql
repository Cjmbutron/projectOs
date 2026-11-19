-- =============================================================================
-- 0700 · Funciones auxiliares de seguridad (las usan las políticas RLS y las RPC)
--
-- Todas son SECURITY DEFINER (leen tablas con RLS sin recursión) y fijan search_path = ''.
-- Todas dependen de auth.uid(): para un llamante anónimo devuelven false.
-- =============================================================================

create function private.require_auth() returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v_uid;
end $$;

create function private.role_id(p_scope text, p_key text) returns uuid
language sql stable security definer set search_path = ''
as $$ select r.id from public.roles r where r.is_system and r.scope = p_scope and r.key = p_key $$;

-- Membresía ACTIVA (sin exigir MFA): sirve para que la persona vea su propia
-- organización y sepa que debe activar MFA.
create function private.is_active_member(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active')
$$;

-- ¿Cumple la sesión el MFA que exige la organización? (RNF-01, US-055)
create function private.mfa_satisfied(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select (not o.mfa_required) or private.current_aal() = 'aal2'
     from public.organizations o where o.id = p_org), false)
$$;

-- Acceso a los DATOS de la organización: miembro activo y, si se exige, MFA.
create function private.can_access_org(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_active_member(p_org) and private.mfa_satisfied(p_org) $$;

create function private.has_org_permission(p_org uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_org(p_org) and exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and rp.permission_code = p_code)
$$;

create function private.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_org(p_org) and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and private.role_is_owner(m.role_id))
$$;

-- Permiso de PROYECTO: por rol de proyecto, o por actuar como gestor de toda la organización.
create function private.has_project_permission(p_project uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and private.can_access_org(p.organization_id)
      and (
        private.has_org_permission(p.organization_id, 'project.manage_all')
        or exists (
          select 1
          from public.project_members pm
          join public.role_permissions rp on rp.role_id = pm.role_id
          where pm.project_id = p.id and pm.user_id = auth.uid() and rp.permission_code = p_code)
      ))
$$;

-- Lectura de un proyecto (US-009): quién puede verlo.
--  * quien tiene project.read_all (owner, admin, auditor);
--  * quien lo creó;
--  * quien es miembro del proyecto (internos y externos);
--  * cualquier miembro INTERNO activo, si la visibilidad es 'organization' (A-9).
create function private.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project
      and private.can_access_org(p.organization_id)
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

-- Perfiles visibles: el propio; los miembros de una organización donde puedo ver miembros;
-- y los compañeros de los proyectos que puedo leer (así un externo ve solo a su proyecto).
create function private.can_see_profile(p_target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = p_target and them.status = 'active'
      and private.has_org_permission(me.organization_id, 'org.members.read'))
  or exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = p_target
      and private.can_read_project(mine.project_id))
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.require_auth()', 'private.role_id(text, text)', 'private.is_active_member(uuid)',
    'private.mfa_satisfied(uuid)', 'private.can_access_org(uuid)',
    'private.has_org_permission(uuid, text)', 'private.is_org_owner(uuid)',
    'private.has_project_permission(uuid, text)', 'private.can_read_project(uuid)',
    'private.can_see_profile(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
