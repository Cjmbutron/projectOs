-- =============================================================================
-- 1400 · Funciones del cronograma (API)
-- =============================================================================

-- Progreso del proyecto (US-028): promedio de % completado ponderado por duración.
-- Sin actividades con duración, se usa la proporción de hitos cumplidos.
create function private.refresh_project_progress(p_project uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_progress numeric;
begin
  select case
           when sum(a.duration) > 0 then sum(a.duration::numeric * a.percent_complete) / sum(a.duration)
           when count(*) > 0 then avg(a.percent_complete::numeric)
           else 0
         end
    into v_progress
  from public.activities a
  where a.project_id = p_project and (a.duration > 0 or not exists (
          select 1 from public.activities b where b.project_id = p_project and b.duration > 0));
  update public.projects p set progress_percent = round(coalesce(v_progress, 0), 2)
   where p.id = p_project and p.progress_percent is distinct from round(coalesce(v_progress, 0), 2);
end $$;
revoke all on function private.refresh_project_progress(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_schedule: guarda el resultado del motor de forma atómica (ADR-003).
-- Solo service_role: el servidor ya autenticó a la persona (p_actor) y calculó con el motor.
-- ---------------------------------------------------------------------------
create function public.apply_schedule(
  p_project uuid, p_expected_version integer, p_actor uuid, p_results jsonb, p_summary jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_sched    public.project_schedules%rowtype;
  v_n_input  integer;
  v_n_unique integer;
  v_n_act    integer;
  v_updated  integer;
  v_invalid  integer;
begin
  select * into v_sched from public.project_schedules s where s.project_id = p_project for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if p_actor is null or not private.user_can_project(p_actor, p_project, 'schedule.edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_project_writable(p_project);
  if v_sched.schedule_version <> p_expected_version then
    raise exception 'schedule_conflict' using errcode = '40001',
      detail = format('versión esperada %s, actual %s', p_expected_version, v_sched.schedule_version);
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_typeof(p_summary) is distinct from 'object' then
    raise exception 'invalid_results' using errcode = 'P0001';
  end if;

  select count(*), count(distinct e ->> 'id') into v_n_input, v_n_unique from jsonb_array_elements(p_results) e;
  select count(*) into v_n_act from public.activities a where a.project_id = p_project;
  if v_n_input <> v_n_unique or v_n_input <> v_n_act then
    raise exception 'results_mismatch' using errcode = 'P0001',
      detail = format('recibidas %s (únicas %s), actividades %s', v_n_input, v_n_unique, v_n_act);
  end if;

  -- Coherencia mínima de los datos recibidos
  select count(*) into v_invalid
  from jsonb_to_recordset(p_results) as x(early_start date, early_finish date, late_start date, late_finish date,
                                          total_float integer, free_float integer, critical boolean, violated text[])
  where x.early_start is null or x.early_finish is null or x.late_start is null or x.late_finish is null
     or x.total_float is null or x.free_float is null or x.critical is null
     or x.early_finish < x.early_start or x.late_finish < x.late_start or x.free_float < 0
     or coalesce(x.violated, '{}') <@ array['SNET','SNLT','FNET','FNLT','MSO','MFO'] is not true;
  if v_invalid > 0 then
    raise exception 'invalid_results' using errcode = 'P0001', detail = format('%s filas inválidas', v_invalid);
  end if;

  update public.activities a
     set early_start = x.early_start, early_finish = x.early_finish,
         late_start = x.late_start, late_finish = x.late_finish,
         total_float = x.total_float, free_float = x.free_float,
         is_critical = x.critical, violated_constraints = coalesce(x.violated, '{}')
    from jsonb_to_recordset(p_results) as x(id uuid, early_start date, early_finish date, late_start date,
                                            late_finish date, total_float integer, free_float integer,
                                            critical boolean, violated text[])
   where a.id = x.id and a.project_id = p_project;
  get diagnostics v_updated = row_count;
  if v_updated <> v_n_act then
    raise exception 'results_mismatch' using errcode = 'P0001', detail = 'hay identificadores que no pertenecen al proyecto';
  end if;

  update public.project_schedules s
     set computed_version = p_expected_version, computed_at = now(),
         computed_start = (p_summary ->> 'project_start')::date,
         computed_finish = (p_summary ->> 'project_finish')::date,
         duration_days = (p_summary ->> 'duration_days')::integer,
         warnings = coalesce(p_summary -> 'warnings', '[]'::jsonb)
   where s.project_id = p_project;

  perform private.refresh_project_progress(p_project);

  insert into public.audit_log (organization_id, actor_id, action, entity_table, entity_id, new_values)
  values (v_sched.organization_id, p_actor, 'schedule_recalculated', 'project_schedules', p_project::text,
          jsonb_build_object('version', p_expected_version, 'activities', v_n_act,
                             'project_finish', p_summary ->> 'project_finish'));
  return v_n_act;
end $$;

-- ---------------------------------------------------------------------------
-- Avance de una actividad (US-025/028): quien tiene schedule.edit, o la persona asignada.
-- ---------------------------------------------------------------------------
create function public.update_activity_progress(p_activity uuid, p_percent integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
  v_act public.activities%rowtype;
  v_status text;
begin
  select * into v_act from public.activities a where a.id = p_activity for update;
  if not found or not private.can_read_project(v_act.project_id) then
    raise exception 'activity_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(private.has_project_permission(v_act.project_id, 'schedule.edit')
          or (coalesce(v_act.assignee_id = v_uid, false)
              and exists (select 1 from public.organization_members m
                          where m.organization_id = v_act.organization_id and m.user_id = v_uid
                            and m.status = 'active' and m.membership_type = 'internal')
              and exists (select 1 from public.project_members pm
                          where pm.project_id = v_act.project_id and pm.user_id = v_uid)), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_percent is null or p_percent not between 0 and 100 then
    raise exception 'invalid_percent' using errcode = 'P0001';
  end if;
  if v_act.duration = 0 and p_percent not in (0, 100) then
    raise exception 'milestone_progress_invalid' using errcode = 'P0001';
  end if;
  v_status := case when p_percent = 0 then 'not_started' when p_percent = 100 then 'done' else 'in_progress' end;
  update public.activities a set status = v_status, percent_complete = p_percent where a.id = p_activity;
  perform private.refresh_project_progress(v_act.project_id);
end $$;

-- ---------------------------------------------------------------------------
-- Línea base: copia las fechas YA calculadas (el cronograma debe estar al día).
-- ---------------------------------------------------------------------------
create function public.create_baseline(p_project uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_sched   public.project_schedules%rowtype;
  v_id      uuid;
  v_version integer;
  v_pending integer;
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'schedule.baseline') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_project_writable(p_project);

  select * into v_sched from public.project_schedules s where s.project_id = p_project for update;
  if v_sched.computed_version is distinct from v_sched.schedule_version then
    raise exception 'schedule_not_current' using errcode = 'P0001',
      hint = 'Recalcula el cronograma antes de crear la línea base.';
  end if;
  select count(*) into v_pending from public.activities a where a.project_id = p_project and a.early_start is null;
  if v_pending > 0 or not exists (select 1 from public.activities a where a.project_id = p_project) then
    raise exception 'schedule_not_current' using errcode = 'P0001';
  end if;

  select coalesce(max(b.version), 0) + 1 into v_version from public.baselines b where b.project_id = p_project;
  insert into public.baselines (organization_id, project_id, version, name, project_start, project_finish)
  values (v_sched.organization_id, p_project, v_version, btrim(p_name), v_sched.computed_start, v_sched.computed_finish)
  returning id into v_id;

  insert into public.baseline_activities (baseline_id, organization_id, project_id, activity_id, name, start_date, finish_date, duration)
  select v_id, a.organization_id, a.project_id, a.id, a.name, a.early_start, a.early_finish, a.duration
  from public.activities a where a.project_id = p_project;
  return v_id;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.update_activity_progress(uuid, integer)', 'public.create_baseline(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.apply_schedule(uuid, integer, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_schedule(uuid, integer, uuid, jsonb, jsonb) to service_role;
