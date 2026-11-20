-- apply_schedule (atómico, con versión), avance de actividades y líneas base inmutables.
create function t.fake_results(p_project uuid, p_skip uuid default null) returns jsonb
language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'early_start', '2026-03-02', 'early_finish', date '2026-03-02' + a.duration,
    'late_start', '2026-03-02', 'late_finish', date '2026-03-02' + a.duration,
    'total_float', 0, 'free_float', 0, 'critical', true, 'violated', '[]'::jsonb)), '[]'::jsonb)
  from public.activities a where a.project_id = p_project and a.id is distinct from p_skip
$$;
create function t.fake_summary() returns jsonb language sql as $$
  select jsonb_build_object('project_start', '2026-03-02', 'project_finish', '2026-03-12', 'duration_days', 8,
                            'warnings', '[{"code":"NEGATIVE_FLOAT"}]'::jsonb)
$$;
create function t.sched_version(p_project uuid) returns int language sql security definer as
$$ select schedule_version from public.project_schedules where project_id = p_project $$;

do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_a uuid; v_b uuid; v_c uuid; v_other uuid; v_ver int;
  v_res jsonb; v_audit bigint; v_bl uuid; v_bl2 uuid; v_n bigint; v_step text; v_prog numeric;
begin
  -- ---- Escenario: A(2) → B(3) → hito C(0) ----
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'APL-1', 'Aplicar cronograma', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  insert into public.activities (organization_id, project_id, name, duration, assignee_id) values (v_org, v_p, 'A', 2, t.uid('member_a')) returning id into v_a;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'B', 3) returning id into v_b;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Hito', 0) returning id into v_c;
  insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (v_org, v_p, v_a, v_b), (v_org, v_p, v_b, v_c);
  perform t.fx_set('apl', v_p);
  v_ver := t.sched_version(v_p);

  -- ---- Quién puede llamar a apply_schedule ----
  perform t.throws('authenticated no ejecuta apply_schedule', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p), '42501');
  perform t.as_anon();
  perform t.throws('anon no ejecuta apply_schedule', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p), '42501');
  perform t.as_service();
  perform t.throws('actor sin schedule.edit (contributor)', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('member_a'), v_p), 'forbidden');
  perform t.throws('actor externo (viewer)', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('ext_a'), v_p), 'forbidden');
  perform t.throws('actor de otra organización', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('owner_b'), v_p), 'forbidden');
  perform t.throws('actor nulo', format('select public.apply_schedule(%L,%L,null,t.fake_results(%L),t.fake_summary())', v_p, v_ver, v_p), 'forbidden');
  perform t.throws('proyecto inexistente', format('select public.apply_schedule(%L,0,%L,''[]'',t.fake_summary())', gen_random_uuid(), t.uid('pm_a')), 'project_not_found');

  -- ---- Resultados inválidos: se rechazan sin dejar nada escrito ----
  perform t.throws('faltan actividades', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L,%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p, v_c), 'results_mismatch');
  perform t.throws('resultados no es un arreglo', format('select public.apply_schedule(%L,%L,%L,''{}''::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a')), 'invalid_results');
  perform t.throws('resumen no es un objeto', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),''[]''::jsonb)', v_p, v_ver, t.uid('pm_a'), v_p), 'invalid_results');
  v_res := t.fake_results(v_p);
  perform t.throws('id repetido', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array(v_res -> 0, v_res -> 0, v_res -> 1)), 'results_mismatch');
  perform t.throws('id de otro proyecto', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array(v_res -> 0, v_res -> 1, jsonb_set(v_res -> 2, '{id}', to_jsonb(gen_random_uuid()::text)))), 'results_mismatch');
  perform t.throws('fin anterior al inicio', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array(jsonb_set(v_res -> 0, '{early_finish}', '"2026-01-01"'), v_res -> 1, v_res -> 2)), 'invalid_results');
  perform t.throws('restricción violada con código inválido', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array(jsonb_set(v_res -> 0, '{violated}', '["XXX"]'), v_res -> 1, v_res -> 2)), 'invalid_results');
  perform t.throws('holgura libre negativa', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array(jsonb_set(v_res -> 0, '{free_float}', '-1'), v_res -> 1, v_res -> 2)), 'invalid_results');
  perform t.throws('campo faltante', format('select public.apply_schedule(%L,%L,%L,%L::jsonb,t.fake_summary())', v_p, v_ver, t.uid('pm_a'), jsonb_build_array((v_res -> 0) - 'total_float', v_res -> 1, v_res -> 2)), 'invalid_results');
  perform t.reset();
  perform t.eq('rechazos no dejan nada escrito', (select count(*) from public.activities where project_id = v_p and early_start is not null), 0::bigint);
  perform t.ok('ni resultado a nivel de proyecto', (select computed_version is null from public.project_schedules where project_id = v_p));

  -- ---- Aplicación correcta ----
  select count(*) into v_audit from public.audit_log where organization_id = v_org and entity_table = 'activities' and action = 'update';
  perform t.as_service();
  perform t.eq('apply_schedule devuelve el nº de actividades', public.apply_schedule(v_p, v_ver, t.uid('pm_a'), t.fake_results(v_p), t.fake_summary()), 3);
  perform t.reset();
  perform t.eq('fechas guardadas', (select early_finish from public.activities where id = v_a), date '2026-03-04');
  perform t.ok('crítica y holguras guardadas', (select is_critical and total_float = 0 and free_float = 0 from public.activities where id = v_a));
  perform t.eq('versión calculada = versión de entradas', (select computed_version from public.project_schedules where project_id = v_p), v_ver);
  perform t.eq('apply NO sube la versión', t.sched_version(v_p), v_ver);
  perform t.eq('fin del proyecto', (select computed_finish from public.project_schedules where project_id = v_p), date '2026-03-12');
  perform t.eq('advertencias guardadas', (select warnings -> 0 ->> 'code' from public.project_schedules where project_id = v_p), 'NEGATIVE_FLOAT');
  perform t.eq('no genera ruido de auditoría por actividad', (select count(*) from public.audit_log where organization_id = v_org and entity_table = 'activities' and action = 'update'), v_audit);
  perform t.ok('sí deja un evento schedule_recalculated con el actor', exists (select 1 from public.audit_log where action = 'schedule_recalculated' and entity_id = v_p::text and actor_id = t.uid('pm_a')));
  perform t.as_service();
  perform t.lives('se puede reaplicar con la misma versión', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('admin_a'), v_p));
  perform t.lives('admin (manage_all) puede aplicar', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('admin_a'), v_p));

  -- ---- Conflicto de versión (edición concurrente) ----
  perform t.as_user('pm_a');
  perform t.lives('otra persona edita la duración mientras el servidor calculaba', format('update public.activities set duration = 4 where id = %L', v_b));
  perform t.as_service();
  perform t.throws('apply con la versión vieja → conflicto (40001)', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p), '40001');
  perform t.throws('el error es schedule_conflict', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p), 'schedule_conflict');
  perform t.reset();
  v_ver := t.sched_version(v_p);
  perform t.ok('el cronograma quedó marcado como no al día', (select computed_version <> schedule_version from public.project_schedules where project_id = v_p));
  perform t.as_service();
  perform t.lives('con la versión nueva se aplica', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, v_ver, t.uid('pm_a'), v_p));

  -- ---- Avance (US-028) ----
  perform t.as_user('member_a');
  perform t.lives('la persona asignada reporta su avance', format('select public.update_activity_progress(%L, 50)', v_a));
  perform t.reset();
  perform t.eq('estado derivado del porcentaje', (select status from public.activities where id = v_a), 'in_progress');
  select progress_percent into v_prog from public.projects where id = v_p;
  perform t.eq('progreso ponderado por duración: (2·50)/(2+4) = 16,67', v_prog, 16.67::numeric);
  perform t.as_user('pm_a');
  perform t.lives('PM reporta B al 100 %', format('select public.update_activity_progress(%L, 100)', v_b));
  perform t.reset();
  perform t.eq('progreso: (2·50 + 4·100)/6 = 83,33', (select progress_percent from public.projects where id = v_p), 83.33::numeric);
  perform t.eq('B queda done', (select status from public.activities where id = v_b), 'done');
  perform t.as_user('auditor_a');
  perform t.throws('un contributor NO asignado no reporta avance ajeno', format('select public.update_activity_progress(%L, 10)', v_a), 'forbidden');
  perform t.as_user('member_a');
  perform t.throws('la persona asignada no reporta actividades de otra', format('select public.update_activity_progress(%L, 10)', v_b), 'forbidden');
  perform t.throws('porcentaje fuera de rango', format('select public.update_activity_progress(%L, 101)', v_a), 'invalid_percent');
  perform t.throws('porcentaje negativo', format('select public.update_activity_progress(%L, -1)', v_a), 'invalid_percent');
  perform t.as_user('pm_a');
  perform t.throws('un hito solo admite 0 o 100', format('select public.update_activity_progress(%L, 50)', v_c), 'milestone_progress_invalid');
  perform t.lives('hito al 100', format('select public.update_activity_progress(%L, 100)', v_c));
  perform t.as_user('ext_a');
  perform t.throws('externo no reporta avance', format('select public.update_activity_progress(%L, 10)', v_a), 'forbidden');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no ve la actividad', format('select public.update_activity_progress(%L, 10)', v_a), 'activity_not_found');
  perform t.as_anon();
  perform t.throws('anon no reporta avance', format('select public.update_activity_progress(%L, 10)', v_a), '42501');
  perform t.reset();
  perform t.eq('el avance no sube la versión del cronograma', t.sched_version(v_p), v_ver);
  perform t.eq('el cambio de progreso del proyecto no se audita como edición', (select count(*) from public.audit_log where entity_table = 'projects' and entity_id = v_p::text and action = 'update'), 0::bigint);
  perform t.as_user('pm_a');
  perform t.throws('hito en curso (duración 0 con avance parcial)', format('update public.activities set duration = 0 where id = %L', v_a), '23514');

  -- ---- Líneas base ----
  perform t.as_user('pm_a');
  perform t.lives('PM cambia una duración tras el último cálculo', format('update public.activities set duration = 5 where id = %L', v_b));
  perform t.throws('sin calcular, no hay línea base', format('select public.create_baseline(%L, ''LB0'')', v_p), 'schedule_not_current');
  perform t.as_service();
  perform t.lives('se recalcula', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, t.sched_version(v_p), t.uid('pm_a'), v_p));
  perform t.as_user('member_a');
  perform t.throws('contributor no crea línea base', format('select public.create_baseline(%L, ''LB1'')', v_p), 'forbidden');
  perform t.as_user('ext_a');
  perform t.throws('externo no crea línea base', format('select public.create_baseline(%L, ''LB1'')', v_p), 'forbidden');
  perform t.as_user('owner_b');
  perform t.throws('otra organización: no existe', format('select public.create_baseline(%L, ''LB1'')', v_p), 'project_not_found');
  perform t.as_anon();
  perform t.throws('anon no crea líneas base', format('select public.create_baseline(%L, ''LB1'')', v_p), '42501');
  perform t.as_user('pm_a');
  perform t.throws('nombre vacío', format('select public.create_baseline(%L, ''   '')', v_p), '23514');
  v_bl := public.create_baseline(v_p, 'Línea base inicial');
  perform t.ok('PM crea la línea base', v_bl is not null);
  perform t.eq('versión 1', (select version from public.baselines where id = v_bl), 1);
  perform t.eq('copia las 3 actividades', (select count(*) from public.baseline_activities where baseline_id = v_bl), 3::bigint);
  perform t.eq('con las fechas calculadas', (select finish_date from public.baseline_activities where baseline_id = v_bl and activity_id = v_a), date '2026-03-04');
  perform t.eq('con el inicio y fin del proyecto', (select project_finish from public.baselines where id = v_bl), date '2026-03-12');
  perform t.eq('quien la capturó', (select captured_by from public.baselines where id = v_bl), t.uid('pm_a'));
  perform t.lives('editar actividades después de la línea base', format('update public.activities set duration = 6 where id = %L', v_b));
  perform t.throws('con entradas cambiadas, otra línea base exige recalcular', format('select public.create_baseline(%L, ''LB2'')', v_p), 'schedule_not_current');
  perform t.as_service();
  perform t.lives('recalcula', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, t.sched_version(v_p), t.uid('pm_a'), v_p));
  perform t.as_user('pm_a');
  v_bl2 := public.create_baseline(v_p, 'Replanificación');
  perform t.eq('versión 2', (select version from public.baselines where id = v_bl2), 2);
  perform t.eq('la versión 1 no cambió', (select name from public.baselines where id = v_bl), 'Línea base inicial');
  perform t.eq('la versión 1 conserva su duración original', (select duration from public.baseline_activities where baseline_id = v_bl and activity_id = v_b), 5);
  perform t.eq('la versión 2 tiene la nueva', (select duration from public.baseline_activities where baseline_id = v_bl2 and activity_id = v_b), 6);

  -- Lectura
  perform t.as_user('member_a');
  perform t.eq('contributor lee líneas base', t.count_of(format('select 1 from public.baselines where project_id = %L', v_p)), 2::bigint);
  perform t.eq('y sus actividades', t.count_of(format('select 1 from public.baseline_activities where project_id = %L', v_p)), 6::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve líneas base', t.count_of('select 1 from public.baselines'), 0::bigint);
  perform t.eq('ni sus actividades', t.count_of('select 1 from public.baseline_activities where organization_id = ''' || v_org || ''''), 0::bigint);

  -- Inmutabilidad
  perform t.as_user('pm_a');
  perform t.throws('PM no inserta líneas base directamente', format('insert into public.baselines (organization_id, project_id, version, name, project_start, project_finish) values (%L,%L,9,''x'',%L,%L)', v_org, v_p, '2026-01-01', '2026-02-01'), '42501');
  perform t.throws('PM no modifica líneas base', format('update public.baselines set name = ''x'' where id = %L', v_bl), '42501');
  perform t.throws('PM no borra líneas base', format('delete from public.baselines where id = %L', v_bl), '42501');
  perform t.throws('PM no modifica actividades de línea base', 'update public.baseline_activities set duration = 1', '42501');
  perform t.reset();
  perform t.throws('superusuario: UPDATE de línea base bloqueado', format('update public.baselines set name = ''x'' where id = %L', v_bl), 'baseline_is_immutable');
  perform t.throws('superusuario: DELETE de línea base bloqueado', format('delete from public.baselines where id = %L', v_bl), 'baseline_is_immutable');
  perform t.throws('superusuario: UPDATE de actividades de línea base', 'update public.baseline_activities set duration = 1', 'baseline_is_immutable');
  perform t.throws('superusuario: DELETE de actividades de línea base', 'delete from public.baseline_activities', 'baseline_is_immutable');
  perform t.throws('superusuario: TRUNCATE bloqueado', 'truncate public.baselines cascade', 'baseline_is_immutable');
  perform t.as_service();
  perform t.throws('service_role: DELETE bloqueado', format('delete from public.baselines where id = %L', v_bl), 'baseline_is_immutable');
  perform t.as_user('pm_a');
  perform t.lives('borrar una actividad no toca la línea base', format('delete from public.activities where id = %L', v_c));
  perform t.eq('la línea base conserva la actividad borrada', (select count(*) from public.baseline_activities where baseline_id = v_bl), 3::bigint);
  perform t.reset();
  perform t.ok('la creación de línea base queda auditada', exists (select 1 from public.audit_log where entity_table = 'baselines' and action = 'insert' and entity_id = v_bl::text));

  -- ---- Proyecto cerrado: sin apply ni líneas base; purga en cascada ----
  perform t.as_user('owner_a');
  v_other := public.create_project(v_org, 'APL-2', 'Cerrar y purgar', t.uid('owner_a'), 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_other, 'Única', 2) returning id into v_a;
  perform t.reset();
  perform t.as_service();
  perform public.apply_schedule(v_other, t.sched_version(v_other), t.uid('owner_a'), t.fake_results(v_other), t.fake_summary());
  perform t.as_user('owner_a');
  v_bl := public.create_baseline(v_other, 'LB cerrar');
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_other, v_step);
  end loop;
  perform t.throws('cerrado: no hay más líneas base', format('select public.create_baseline(%L, ''otra'')', v_other), 'project_read_only');
  perform t.as_service();
  perform t.throws('cerrado: apply_schedule rechazado', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_other, t.sched_version(v_other), t.uid('owner_a'), v_other), 'project_read_only');
  perform t.as_user('owner_a');
  perform t.throws('cerrado: avance rechazado', format('select public.update_activity_progress(%L, 50)', v_a), 'project_read_only');
  perform t.lives('papelera', format('select public.trash_project(%L, true)', v_other));
  perform t.reset();
  update public.projects set deleted_at = now() - interval '31 days' where id = v_other;
  perform t.as_service();
  perform t.eq('la purga de un proyecto cerrado con línea base funciona', public.purge_trashed_projects(), 1);
  perform t.reset();
  perform t.eq('se llevó actividades', (select count(*) from public.activities where project_id = v_other), 0::bigint);
  perform t.eq('se llevó líneas base', (select count(*) from public.baselines where project_id = v_other), 0::bigint);
  perform t.eq('se llevó el detalle de líneas base', (select count(*) from public.baseline_activities where project_id = v_other), 0::bigint);
  perform t.eq('se llevó el cronograma', (select count(*) from public.project_schedules where project_id = v_other), 0::bigint);
end $$;
