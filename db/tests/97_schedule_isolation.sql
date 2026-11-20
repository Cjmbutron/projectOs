-- Aislamiento del cronograma: otra organización, proyecto privado, externos, sin sesión.
do $$
declare
  rec record; v_org uuid := t.fx('org_a'); v_p uuid; v_a uuid; v_b uuid; v_bl uuid;
begin
  -- Proyecto PRIVADO con actividades, dependencia, restricción, feriado y línea base
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'ISO-1', 'Privado con cronograma', t.uid('pm_a'), 'predictive', 'standard', null, null, null, null, 'private');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'P1', 2) returning id into v_a;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'P2', 2) returning id into v_b;
  insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (v_org, v_p, v_a, v_b);
  insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (v_org, v_p, v_a, 'SNET', '2026-03-09');
  insert into public.project_calendar_days (organization_id, project_id, day, kind) values (v_org, v_p, '2026-03-10', 'holiday');
  perform t.as_service();
  perform public.apply_schedule(v_p, t.sched_version(v_p), t.uid('pm_a'), t.fake_results(v_p), t.fake_summary());
  perform t.as_user('pm_a');
  v_bl := public.create_baseline(v_p, 'LB privada');
  perform t.fx_set('iso', v_p);

  -- Quien tiene acceso lo ve todo
  for rec in select unnest(array['project_schedules','project_calendar_days','activities','activity_constraints',
                                 'activity_dependencies','baselines','baseline_activities']) as tbl loop
    perform t.as_user('pm_a');
    perform t.ok('creador ve ' || rec.tbl || ' del proyecto privado', t.count_of(format('select 1 from public.%I where project_id = %L', rec.tbl, v_p)) > 0);
    perform t.as_user('auditor_a');
    perform t.ok('read_all ve ' || rec.tbl, t.count_of(format('select 1 from public.%I where project_id = %L', rec.tbl, v_p)) > 0);
    -- Quien NO es miembro y el proyecto es privado: nada
    perform t.as_user('member_a');
    perform t.eq('member sin acceso NO ve ' || rec.tbl || ' (privado)', t.count_of(format('select 1 from public.%I where project_id = %L', rec.tbl, v_p)), 0::bigint);
    perform t.as_user('portfolio_a');
    perform t.eq('portfolio_manager sin acceso NO ve ' || rec.tbl || ' (privado)', t.count_of(format('select 1 from public.%I where project_id = %L', rec.tbl, v_p)), 0::bigint);
    perform t.as_user('ext_a');
    perform t.eq('externo sin asignación NO ve ' || rec.tbl, t.count_of(format('select 1 from public.%I where project_id = %L', rec.tbl, v_p)), 0::bigint);
    -- Otra organización: nada de la organización A en ninguna tabla del cronograma
    perform t.as_user('owner_b');
    perform t.eq('otra organización NO ve ' || rec.tbl, t.count_of(format('select 1 from public.%I where organization_id = %L', rec.tbl, v_org)), 0::bigint);
    perform t.as_user('loner');
    perform t.eq('usuario sin organización NO ve ' || rec.tbl, t.count_of(format('select 1 from public.%I', rec.tbl)), 0::bigint);
    perform t.as_anon();
    perform t.throws('anon NO lee ' || rec.tbl, format('select 1 from public.%I limit 1', rec.tbl), '42501');
  end loop;

  -- Escrituras cruzadas desde otra organización
  perform t.as_user('owner_b');
  perform t.eq('no edita actividades de A', t.affected(format('update public.activities set name = ''Hack'' where id = %L', v_a)), 0::bigint);
  perform t.eq('no borra actividades de A', t.affected(format('delete from public.activities where id = %L', v_a)), 0::bigint);
  perform t.eq('no borra dependencias de A', t.affected(format('delete from public.activity_dependencies where project_id = %L', v_p)), 0::bigint);
  perform t.eq('no edita restricciones de A', t.affected(format('update public.activity_constraints set date = ''2026-12-31'' where project_id = %L', v_p)), 0::bigint);
  perform t.eq('no edita el calendario de A', t.affected(format('update public.project_calendar_days set kind = ''working'' where project_id = %L', v_p)), 0::bigint);
  perform t.eq('no edita los ajustes de A', t.affected(format('update public.project_schedules set start_date = ''2030-01-01'' where project_id = %L', v_p)), 0::bigint);
  perform t.throws('no crea actividades en A', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''X'')', v_org, v_p), '42501');
  perform t.throws('no crea dependencias en A', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, type) values (%L,%L,%L,%L,''SS'')', v_org, v_p, v_b, v_a), '42501');
  perform t.throws('no crea restricciones en A', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''FNLT'',%L)', v_org, v_p, v_a, '2026-04-01'), '42501');
  perform t.throws('no crea feriados en A', format('insert into public.project_calendar_days (organization_id, project_id, day, kind) values (%L,%L,''2026-05-01'',''holiday'')', v_org, v_p), '42501');
  perform t.throws('no crea líneas base en A', format('select public.create_baseline(%L, ''x'')', v_p), 'project_not_found');
  perform t.throws('no reporta avance en A', format('select public.update_activity_progress(%L, 10)', v_a), 'activity_not_found');
  -- Sin información sobre ciclos del grafo ajeno: el error es de permisos, no del grafo
  perform t.throws('un ajeno no obtiene señal de ciclo (RLS, no dependency_cycle)', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_b, v_a), '42501');

  -- Quien lee pero no edita tampoco escribe
  perform t.as_user('auditor_a');
  perform t.throws('auditor (solo lectura) no crea actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''X'')', v_org, v_p), '42501');
  perform t.eq('auditor no edita actividades', t.affected(format('update public.activities set name = ''Hack'' where id = %L', v_a)), 0::bigint);

  -- apply_schedule no cruza organizaciones
  perform t.as_service();
  perform t.throws('apply de A con actor de B', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, t.sched_version(v_p), t.uid('owner_b'), v_p), 'forbidden');
  perform t.as_service();
  perform t.throws('resultados con actividades de otro proyecto de A', format('select public.apply_schedule(%L,%L,%L,t.fake_results(%L),t.fake_summary())', v_p, t.sched_version(v_p), t.uid('pm_a'), t.fx('apl')), 'results_mismatch');
  perform t.reset();
end $$;
