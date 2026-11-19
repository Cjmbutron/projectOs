-- =============================================================================
-- 0900 · RLS y privilegios
--
-- Principio: negar todo y abrir lo mínimo.
--  1. RLS activado (y FORZADO) en todas las tablas de public.
--  2. Se revocan TODOS los privilegios a anon y authenticated (Supabase los concede por defecto).
--  3. Se conceden solo SELECT (a nivel de columna donde hay secretos) y las columnas
--     editables. Membresías, invitaciones, estados y ubicación de proyectos solo cambian
--     mediante las funciones de 0800.
--  4. anon no recibe nada: ninguna tabla es legible sin sesión.
-- =============================================================================

-- Nadie de la API crea objetos en public (evita sustituir funciones/tablas de la aplicación).
revoke create on schema public from public, anon, authenticated;

do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- service_role (servidor) mantiene bypassrls; no requiere políticas.

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
grant select on public.permissions, public.project_status_transitions to authenticated;
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy transitions_read on public.project_status_transitions for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Perfiles y aceptaciones legales
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, locale, timezone) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or private.can_see_profile(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select on public.legal_acceptances to authenticated;
create policy legal_read_own on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant update (name, reference_currency, mfa_required) on public.organizations to authenticated;
create policy organizations_read on public.organizations for select to authenticated
  using (private.is_active_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_org_permission(id, 'org.settings.manage'))
  with check (private.has_org_permission(id, 'org.settings.manage'));

-- ---------------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------------
grant select on public.roles, public.role_permissions to authenticated;
grant insert (organization_id, scope, name, description, external_assignable) on public.roles to authenticated;
grant update (name, description) on public.roles to authenticated;
grant delete on public.roles to authenticated;
grant insert, delete on public.role_permissions to authenticated;

create policy roles_read on public.roles for select to authenticated
  using (is_system or private.is_active_member(organization_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (not is_system and private.has_org_permission(organization_id, 'org.roles.manage'));
create policy roles_update on public.roles for update to authenticated
  using (not is_system and private.has_org_permission(organization_id, 'org.roles.manage'))
  with check (not is_system and private.has_org_permission(organization_id, 'org.roles.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (not is_system and private.has_org_permission(organization_id, 'org.roles.manage'));

create policy role_permissions_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id
                 and (r.is_system or private.is_active_member(r.organization_id))));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                      and private.has_org_permission(r.organization_id, 'org.roles.manage')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                 and private.has_org_permission(r.organization_id, 'org.roles.manage')));

-- ---------------------------------------------------------------------------
-- Miembros e invitaciones (solo lectura: se modifican con funciones)
-- ---------------------------------------------------------------------------
grant select on public.organization_members to authenticated;
create policy members_read on public.organization_members for select to authenticated
  using (user_id = auth.uid() or private.has_org_permission(organization_id, 'org.members.read'));

grant select (id, organization_id, email, role_id, membership_type, project_id, project_role_id,
              expires_at, accepted_at, accepted_by, revoked_at, invited_by, created_at)
  on public.invitations to authenticated;
create policy invitations_read on public.invitations for select to authenticated
  using (private.has_org_permission(organization_id, 'org.members.invite'));

-- ---------------------------------------------------------------------------
-- Portafolios y programas
-- ---------------------------------------------------------------------------
grant select on public.portfolios, public.programs to authenticated;
grant insert (organization_id, name, description, responsible_id) on public.portfolios to authenticated;
grant update (name, description, responsible_id, archived_at) on public.portfolios to authenticated;
grant insert (organization_id, portfolio_id, name, description, responsible_id) on public.programs to authenticated;
grant update (name, description, responsible_id, archived_at) on public.programs to authenticated;

create policy portfolios_read on public.portfolios for select to authenticated
  using (private.has_org_permission(organization_id, 'portfolio.read'));
create policy portfolios_insert on public.portfolios for insert to authenticated
  with check (private.has_org_permission(organization_id, 'portfolio.manage'));
create policy portfolios_update on public.portfolios for update to authenticated
  using (private.has_org_permission(organization_id, 'portfolio.manage'))
  with check (private.has_org_permission(organization_id, 'portfolio.manage'));

create policy programs_read on public.programs for select to authenticated
  using (private.has_org_permission(organization_id, 'portfolio.read'));
create policy programs_insert on public.programs for insert to authenticated
  with check (private.has_org_permission(organization_id, 'program.manage')
              or private.has_org_permission(organization_id, 'portfolio.manage'));
create policy programs_update on public.programs for update to authenticated
  using (private.has_org_permission(organization_id, 'program.manage')
         or private.has_org_permission(organization_id, 'portfolio.manage'))
  with check (private.has_org_permission(organization_id, 'program.manage')
              or private.has_org_permission(organization_id, 'portfolio.manage'));

-- ---------------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------------
grant select on public.projects to authenticated;
-- Solo datos descriptivos. Estado, ubicación, archivo y papelera: funciones de 0800.
grant update (name, description, responsible_id, complexity_profile, priority, sort_order,
              visibility, planned_start, planned_end)
  on public.projects to authenticated;

create policy projects_read on public.projects for select to authenticated
  using (private.can_read_project(id)
         and (deleted_at is null or private.has_project_permission(id, 'project.delete')));
create policy projects_update on public.projects for update to authenticated
  using (private.can_read_project(id) and private.has_project_permission(id, 'project.update'))
  with check (private.has_project_permission(id, 'project.update'));

grant select on public.project_phases, public.project_members to authenticated;
grant insert (organization_id, project_id, name, description, planned_start, planned_end)
  on public.project_phases to authenticated;
grant update (name, description, planned_start, planned_end) on public.project_phases to authenticated;
grant delete on public.project_phases to authenticated;

create policy phases_read on public.project_phases for select to authenticated
  using (private.can_read_project(project_id));
create policy phases_insert on public.project_phases for insert to authenticated
  with check (private.has_project_permission(project_id, 'project.update'));
create policy phases_update on public.project_phases for update to authenticated
  using (private.has_project_permission(project_id, 'project.update'))
  with check (private.has_project_permission(project_id, 'project.update'));
create policy phases_delete on public.project_phases for delete to authenticated
  using (private.has_project_permission(project_id, 'project.update'));

create policy project_members_read on public.project_members for select to authenticated
  using (private.can_read_project(project_id));

-- ---------------------------------------------------------------------------
-- Auditoría (lectura con audit.read)
-- ---------------------------------------------------------------------------
grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated
  using (organization_id is not null and private.has_org_permission(organization_id, 'audit.read'));
