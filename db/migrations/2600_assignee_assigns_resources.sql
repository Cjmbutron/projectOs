-- =============================================================================
-- 2600 · El responsable de una actividad también asigna recursos a ESA actividad
--
-- Antes: asignar/cambiar/quitar recursos exigía `schedule.edit` en el proyecto (PM, líder técnico).
-- Ahora también puede quien es el responsable (`activities.assignee_id`) de la actividad, si es miembro
-- interno activo de la organización y miembro del proyecto (igual que el registro de avance). Solo
-- sobre sus actividades; no cambia nada más del cronograma.
-- =============================================================================
create function private.can_assign_resources(p_project uuid, p_activity uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.has_project_permission(p_project, 'schedule.edit'), false)
      or exists (
        select 1
        from public.activities a
        join public.organization_members m
          on m.organization_id = a.organization_id and m.user_id = auth.uid()
         and m.status = 'active' and m.membership_type = 'internal'
        join public.project_members pm on pm.project_id = a.project_id and pm.user_id = auth.uid()
        where a.id = p_activity and a.project_id = p_project and a.assignee_id = auth.uid())
$$;
revoke all on function private.can_assign_resources(uuid, uuid) from public, anon;
grant execute on function private.can_assign_resources(uuid, uuid) to authenticated, service_role;  -- la usan las políticas RLS

drop policy activity_resources_insert on public.activity_resources;
drop policy activity_resources_update on public.activity_resources;
drop policy activity_resources_delete on public.activity_resources;
create policy activity_resources_insert on public.activity_resources for insert to authenticated
  with check (private.can_assign_resources(project_id, activity_id));
create policy activity_resources_update on public.activity_resources for update to authenticated
  using (private.can_assign_resources(project_id, activity_id))
  with check (private.can_assign_resources(project_id, activity_id));
create policy activity_resources_delete on public.activity_resources for delete to authenticated
  using (private.can_assign_resources(project_id, activity_id));
