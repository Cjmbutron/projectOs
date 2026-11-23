-- =============================================================================
-- 2700 · Todo miembro interno del proyecto asigna recursos en cualquier actividad
--
-- Decisión de Cristhian (21-nov-2026): la carga de recursos no queda solo en quien edita el cronograma.
-- Sustituye la regla de la 2600 (solo el responsable de la actividad). Ahora asigna, cambia la dedicación
-- o quita recursos: quien tiene `schedule.edit` O cualquier miembro del proyecto con rol project_manager,
-- team_lead o contributor que sea miembro interno ACTIVO de la organización. Quedan fuera los roles de
-- solo lectura (client_stakeholder, viewer) y los externos. Sigue sin tocar fechas ni nada más del
-- cronograma. La firma no cambia (p_activity ya no se usa pero se conserva para no tocar las políticas).
-- =============================================================================
create or replace function private.can_assign_resources(p_project uuid, p_activity uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.has_project_permission(p_project, 'schedule.edit'), false)
      or exists (
        select 1
        from public.projects p
        join public.organization_members m
          on m.organization_id = p.organization_id and m.user_id = auth.uid()
         and m.status = 'active' and m.membership_type = 'internal'
        join public.project_members pm on pm.project_id = p.id and pm.user_id = auth.uid()
        join public.roles r on r.id = pm.role_id and r.is_system and r.scope = 'project'
         and r.key in ('project_manager', 'team_lead', 'contributor')
        where p.id = p_project and p.deleted_at is null)
$$;

-- Para la interfaz: ¿puede quien consulta asignar recursos en este proyecto? (la decisión real la toma RLS)
create function public.can_assign_resources(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.can_read_project(p_project) and private.can_assign_resources(p_project, null), false) $$;
revoke all on function public.can_assign_resources(uuid) from public, anon;
grant execute on function public.can_assign_resources(uuid) to authenticated, service_role;
