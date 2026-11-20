-- =============================================================================
-- 1500 · RLS y privilegios del cronograma
-- Lectura: quien puede leer el proyecto. Escritura de entradas: schedule.edit.
-- Las columnas calculadas, el avance y las líneas base se escriben solo por funciones.
-- =============================================================================

grant select on public.project_schedules, public.project_calendar_days, public.activities,
  public.activity_constraints, public.activity_dependencies, public.baselines, public.baseline_activities
  to authenticated;

create policy schedules_read on public.project_schedules for select to authenticated
  using (private.can_read_project(project_id));
grant update (start_date, working_weekdays) on public.project_schedules to authenticated;
create policy schedules_update on public.project_schedules for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));

create policy calendar_read on public.project_calendar_days for select to authenticated
  using (private.can_read_project(project_id));
grant insert (organization_id, project_id, day, kind, name), update (kind, name), delete on public.project_calendar_days to authenticated;
create policy calendar_insert on public.project_calendar_days for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy calendar_update on public.project_calendar_days for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy calendar_delete on public.project_calendar_days for delete to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'));

create policy activities_read on public.activities for select to authenticated
  using (private.can_read_project(project_id));
grant insert (organization_id, project_id, phase_id, name, description, duration, assignee_id, sort_order) on public.activities to authenticated;
grant update (phase_id, name, description, duration, assignee_id, sort_order) on public.activities to authenticated;
grant delete on public.activities to authenticated;
create policy activities_insert on public.activities for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy activities_update on public.activities for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy activities_delete on public.activities for delete to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'));

create policy constraints_read on public.activity_constraints for select to authenticated
  using (private.can_read_project(project_id));
grant insert (organization_id, project_id, activity_id, type, date), update (type, date), delete on public.activity_constraints to authenticated;
create policy constraints_insert on public.activity_constraints for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy constraints_update on public.activity_constraints for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy constraints_delete on public.activity_constraints for delete to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'));

create policy dependencies_read on public.activity_dependencies for select to authenticated
  using (private.can_read_project(project_id));
grant insert (organization_id, project_id, predecessor_id, successor_id, type, lag), update (type, lag), delete on public.activity_dependencies to authenticated;
create policy dependencies_insert on public.activity_dependencies for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy dependencies_update on public.activity_dependencies for update to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'))
  with check (private.has_project_permission(project_id, 'schedule.edit'));
create policy dependencies_delete on public.activity_dependencies for delete to authenticated
  using (private.has_project_permission(project_id, 'schedule.edit'));

create policy baselines_read on public.baselines for select to authenticated
  using (private.can_read_project(project_id));
create policy baseline_activities_read on public.baseline_activities for select to authenticated
  using (private.can_read_project(project_id));
