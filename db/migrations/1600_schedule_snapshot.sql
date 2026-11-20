-- =============================================================================
-- 1600 · Lectura coherente de las entradas del cronograma
-- Una sola llamada = una sola instantánea (versión y datos son del mismo momento).
-- Solo service_role: la usa el servidor antes de calcular (ADR-003).
-- =============================================================================

create function public.get_schedule_snapshot(p_project uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'projectId', s.project_id,
    'version', s.schedule_version,
    'startDate', s.start_date,
    'workingWeekdays', to_jsonb(s.working_weekdays),
    'calendarDays', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'kind', d.kind) order by d.day)
                              from public.project_calendar_days d where d.project_id = s.project_id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'duration', a.duration)
                                             order by a.sort_order, a.created_at, a.id)
                            from public.activities a where a.project_id = s.project_id), '[]'::jsonb),
    'constraints', coalesce((select jsonb_agg(jsonb_build_object('activityId', c.activity_id, 'type', c.type, 'date', c.date) order by c.id)
                             from public.activity_constraints c where c.project_id = s.project_id), '[]'::jsonb),
    'dependencies', coalesce((select jsonb_agg(jsonb_build_object('predecessorId', x.predecessor_id, 'successorId', x.successor_id,
                                                                    'type', x.type, 'lag', x.lag) order by x.id)
                              from public.activity_dependencies x where x.project_id = s.project_id), '[]'::jsonb))
  from public.project_schedules s
  where s.project_id = p_project
$$;

revoke all on function public.get_schedule_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_schedule_snapshot(uuid) to service_role;

-- ¿Puede la persona autenticada editar/recalcular el cronograma de este proyecto?
-- Se evalúa con SU sesión (JWT): exige membresía activa, MFA si la organización lo pide,
-- poder leer el proyecto y el permiso schedule.edit. La usa la ruta de recálculo.
create function public.can_edit_schedule(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.can_read_project(p_project)
                  and private.has_project_permission(p_project, 'schedule.edit')
                  and private.project_is_writable(p_project), false)
$$;
revoke all on function public.can_edit_schedule(uuid) from public, anon;
grant execute on function public.can_edit_schedule(uuid) to authenticated, service_role;
