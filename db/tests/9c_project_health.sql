-- Salud del proyecto (verde / ámbar / rojo) a partir del atraso frente a la última línea base.
create function t.health(p_project uuid) returns text language sql security definer as
$$ select health from public.projects where id = p_project $$;

-- Aplica un cálculo cuyo fin de proyecto es `p_finish` (como service_role) y vuelve a la identidad anterior.
create function t.apply_finish(p_project uuid, p_actor uuid, p_finish date) returns void language plpgsql security definer as $$
begin
  perform public.apply_schedule(p_project, (select schedule_version from public.project_schedules where project_id = p_project), p_actor,
    t.fake_results(p_project), jsonb_build_object('project_start', '2026-03-02', 'project_finish', p_finish, 'duration_days', 5, 'warnings', '[]'::jsonb));
end $$;

do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_q uuid; v_pm uuid := t.uid('pm_a'); v_step text; v_base_finish date := '2026-03-12';
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'HLT-1', 'Salud', v_pm, 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'A', 5);
  update public.project_schedules set start_date = '2026-03-02' where project_id = v_p;
  perform t.fx_set('hlt', v_p);

  perform t.eq('proyecto nuevo: sin datos', t.health(v_p), 'unknown');
  perform t.reset();
  perform t.as_service();
  perform t.apply_finish(v_p, v_pm, v_base_finish);
  perform t.reset();
  perform t.eq('con fechas pero sin línea base: sin datos', t.health(v_p), 'unknown');

  perform t.as_user('pm_a');
  perform public.create_baseline(v_p, 'Plan aprobado');
  perform t.eq('recién creada la línea base: verde (atraso 0)', t.health(v_p), 'green');

  -- ---- Umbrales por defecto: verde ≤ 2, ámbar ≤ 5, rojo > 5 (días laborables) ----
  perform t.as_service();
  perform t.apply_finish(v_p, v_pm, '2026-03-16'); perform t.reset();
  perform t.eq('atraso de 2 días laborables (cruza fin de semana): verde', t.health(v_p), 'green');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-17'); perform t.reset();
  perform t.eq('atraso de 3: ámbar', t.health(v_p), 'amber');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-19'); perform t.reset();
  perform t.eq('atraso de 5: ámbar (límite superior inclusivo)', t.health(v_p), 'amber');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-20'); perform t.reset();
  perform t.eq('atraso de 6: rojo', t.health(v_p), 'red');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-04'); perform t.reset();
  perform t.eq('adelantado 6 días laborables: verde (el signo cuenta)', t.health(v_p), 'green');

  -- ---- Calendario del proyecto: un feriado reduce el atraso ----
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-17'); perform t.reset();
  perform t.eq('(control) atraso 3 sin feriado: ámbar', t.health(v_p), 'amber');
  perform t.as_user('pm_a');
  insert into public.project_calendar_days (organization_id, project_id, day, kind, name) values (v_org, v_p, '2026-03-16', 'holiday', 'Feriado');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-17'); perform t.reset();
  perform t.eq('con el lunes 16 feriado el atraso es 2: verde', t.health(v_p), 'green');
  perform t.as_user('pm_a');
  insert into public.project_calendar_days (organization_id, project_id, day, kind, name) values (v_org, v_p, '2026-03-14', 'working', 'Sábado trabajado');
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-17'); perform t.reset();
  perform t.eq('un sábado trabajado suma un día laborable: atraso 3, ámbar', t.health(v_p), 'amber');

  -- ---- La última línea base manda ----
  perform t.as_user('pm_a');
  perform public.create_baseline(v_p, 'Re-planificación');
  perform t.eq('nueva línea base con las fechas actuales: verde', t.health(v_p), 'green');

  -- ---- Nadie edita la salud ----
  perform t.throws('el PM no escribe health', format('update public.projects set health = ''green'' where id = %L', v_p), '42501');
  perform t.as_user('owner_a');
  perform t.throws('ni el propietario de la organización', format('update public.projects set health = ''green'' where id = %L', v_p), '42501');
  perform t.as_user('pm_a');
  perform t.throws('la función de cálculo no es invocable por usuarios', format('select private.refresh_project_health(%L)', v_p), '42501');
  perform t.throws('tampoco working_days_between', format('select private.working_days_between(%L, ''2026-03-01'', ''2026-03-05'')', v_p), '42501');

  -- ---- Umbrales de la organización ----
  perform t.as_service(); perform t.apply_finish(v_p, v_pm, '2026-03-26'); perform t.reset();
  perform t.eq('(control) con los umbrales por defecto este atraso es rojo', t.health(v_p), 'red');
  perform t.as_user('owner_a');
  perform t.lives('el propietario cambia los umbrales', format('update public.organizations set health_amber_days = 0, health_red_days = 20 where id = %L', v_org));
  perform t.eq('se recalcula solo: ahora ámbar', t.health(v_p), 'amber');
  perform t.lives('umbrales más holgados', format('update public.organizations set health_amber_days = 30, health_red_days = 60 where id = %L', v_org));
  perform t.eq('se recalcula solo: ahora verde', t.health(v_p), 'green');
  perform t.throws('rojo no puede ser menor que ámbar', format('update public.organizations set health_amber_days = 10, health_red_days = 5 where id = %L', v_org), '23514');
  perform t.throws('umbral negativo', format('update public.organizations set health_amber_days = -1 where id = %L', v_org), '23514');
  perform t.as_user('pm_a');
  perform t.eq('el PM no cambia umbrales (0 filas)', t.affected(format('update public.organizations set health_red_days = 99 where id = %L', v_org)), 0::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no los cambia (0 filas)', t.affected(format('update public.organizations set health_red_days = 99 where id = %L', v_org)), 0::bigint);
  perform t.as_user('owner_a');
  perform t.lives('restaurar los valores por defecto', format('update public.organizations set health_amber_days = 2, health_red_days = 5 where id = %L', v_org));
  perform t.reset();
  perform t.ok('el cambio de umbrales queda en la bitácora', exists (
    select 1 from public.audit_log where entity_table = 'organizations' and entity_id = v_org::text and new_values ->> 'health_red_days' = '20'));
  perform t.ok('pero la salud calculada no ensucia la bitácora de proyectos', not exists (
    select 1 from public.audit_log where entity_table = 'projects' and entity_id = v_p::text and new_values ->> 'health' is not null and old_values ->> 'health' is not null and action = 'update' and (old_values - 'health' - 'updated_at') = (new_values - 'health' - 'updated_at')));

  -- ---- Un proyecto cerrado también se recalcula sin error ----
  perform t.as_user('owner_a');
  v_q := public.create_project(v_org, 'HLT-2', 'Salud cerrado', v_pm, 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_q, 'A', 5);
  update public.project_schedules set start_date = '2026-03-02' where project_id = v_q;
  perform t.as_service(); perform t.apply_finish(v_q, v_pm, v_base_finish); perform t.reset();
  perform t.as_user('pm_a'); perform public.create_baseline(v_q, 'LB'); perform t.as_user('owner_a');
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_q, v_step);
  end loop;
  perform t.eq('cerrado conserva su salud', t.health(v_q), 'green');
  perform t.lives('cambiar umbrales con un proyecto cerrado no falla', format('update public.organizations set health_amber_days = 1 where id = %L', v_org));
  perform t.lives('restaurar', format('update public.organizations set health_amber_days = 2 where id = %L', v_org));

  -- ---- Panel: la vista agrupa por salud y respeta el aislamiento ----
  perform t.eq('el panel cuenta el proyecto verde cerrado', (select coalesce(sum(projects), 0) from public.project_dashboard where organization_id = v_org and status = 'closed' and health = 'green'), 1::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve el panel de A', t.count_of(format('select 1 from public.project_dashboard where organization_id = %L', v_org)), 0::bigint);
  perform t.reset();
end $$;
