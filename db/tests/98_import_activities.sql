-- Importación atómica de actividades (US-071).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_res jsonb; v_n bigint; v_ver int;
  v_rows jsonb := '[
    {"ref":"1","name":"Análisis","duration":3,"predecessors":[]},
    {"ref":"2","name":"Desarrollo","duration":5,"predecessors":[{"ref":"1","type":"FS","lag":0}]},
    {"ref":"3","name":"Pruebas","duration":2,"predecessors":[{"ref":"2","type":"SS","lag":-1},{"ref":"1"}]},
    {"ref":"4","name":"Hito","duration":0,"predecessors":[{"ref":"3","type":"FF","lag":2}]}]';
begin
  perform t.ok('import_activities es SECURITY INVOKER (RLS aplica en cada insert)', not (select prosecdef from pg_proc where oid = 'public.import_activities(uuid, jsonb)'::regprocedure));
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'IMP-1', 'Importación', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  perform t.fx_set('imp', v_p);
  v_ver := t.sched_version(v_p);

  v_res := public.import_activities(v_p, v_rows);
  perform t.eq('importa 4 actividades', v_res ->> 'activities', '4');
  perform t.eq('importa 4 dependencias', v_res ->> 'dependencies', '4');
  perform t.eq('actividades en la tabla', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 4::bigint);
  perform t.eq('tipo y desfase conservados', t.count_of(format($q$select 1 from public.activity_dependencies d join public.activities s on s.id = d.successor_id join public.activities p on p.id = d.predecessor_id
     where d.project_id = %L and p.name = 'Desarrollo' and s.name = 'Pruebas' and d.type = 'SS' and d.lag = -1$q$, v_p)), 1::bigint);
  perform t.eq('la duración 0 queda como hito', t.count_of(format('select 1 from public.activities where project_id = %L and is_milestone and name = %L', v_p, 'Hito')), 1::bigint);
  perform t.ok('el cronograma queda marcado como desactualizado', t.sched_version(v_p) > v_ver);
  perform t.eq('quedó en orden (sort_order creciente)', (select string_agg(name, ',' order by sort_order) from public.activities where project_id = v_p), 'Análisis,Desarrollo,Pruebas,Hito');

  -- Una segunda importación se agrega después
  perform public.import_activities(v_p, '[{"ref":"x","name":"Extra","duration":1}]');
  perform t.eq('segunda importación se anexa al final', (select name from public.activities where project_id = v_p order by sort_order desc limit 1), 'Extra');

  -- Atomicidad: un error en la fila 3 no deja nada de lo anterior
  select count(*) into v_n from public.activities where project_id = v_p;
  perform t.throws('predecesora inexistente', format('select public.import_activities(%L, %L)', v_p,
    '[{"ref":"a","name":"A","duration":1},{"ref":"b","name":"B","duration":1,"predecessors":[{"ref":"zzz"}]}]'), 'import_invalid');
  perform t.eq('error → no entra NADA (atómico)', (select count(*) from public.activities where project_id = v_p), v_n);

  perform t.throws('ciclo en el archivo', format('select public.import_activities(%L, %L)', v_p,
    '[{"ref":"a","name":"A","duration":1,"predecessors":[{"ref":"b"}]},{"ref":"b","name":"B","duration":1,"predecessors":[{"ref":"a"}]}]'), 'dependency_cycle');
  perform t.eq('ciclo → no entra NADA', (select count(*) from public.activities where project_id = v_p), v_n);

  perform t.throws('ref repetido', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1},{"ref":"a","name":"B","duration":1}]'), 'import_invalid');
  perform t.throws('autodependencia', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1,"predecessors":[{"ref":"a"}]}]'), 'import_invalid');
  perform t.throws('predecesora duplicada', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1},{"ref":"b","name":"B","duration":1,"predecessors":[{"ref":"a"},{"ref":"a","type":"SS"}]}]'), 'import_invalid');
  perform t.throws('tipo de dependencia inválido', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1},{"ref":"b","name":"B","duration":1,"predecessors":[{"ref":"a","type":"XX"}]}]'), 'import_invalid');
  perform t.throws('desfase no numérico', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1},{"ref":"b","name":"B","duration":1,"predecessors":[{"ref":"a","lag":"x"}]}]'), 'import_invalid');
  perform t.throws('duración negativa', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":-1}]'), 'import_invalid');
  perform t.throws('duración decimal', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1.5}]'), 'import_invalid');
  perform t.throws('duración como texto', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":"3"}]'), 'import_invalid');
  perform t.throws('duración excesiva', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":36501}]'), 'import_invalid');
  perform t.throws('nombre vacío', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"  ","duration":1}]'), 'import_invalid');
  perform t.throws('ref vacío', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"","name":"A","duration":1}]'), 'import_invalid');
  perform t.throws('arreglo vacío', format('select public.import_activities(%L, %L)', v_p, '[]'), 'import_invalid');
  perform t.throws('no es arreglo', format('select public.import_activities(%L, %L)', v_p, '{"a":1}'), 'import_invalid');
  perform t.throws('más de 1000 filas', format('select public.import_activities(%L, (select jsonb_agg(jsonb_build_object(%L, g::text, %L, %L, %L, 1)) from generate_series(1,1001) g))', v_p, 'ref', 'name', 'N', 'duration'), 'import_invalid');
  perform t.lives('exactamente 1000 filas', format('select public.import_activities(%L, (select jsonb_agg(jsonb_build_object(%L, g::text, %L, %L, %L, 1)) from generate_series(1,1000) g))', v_p, 'ref', 'name', 'N', 'duration'));

  -- Autorización: la decide la base de datos
  perform t.as_user('member_a');
  perform t.throws('contributor sin schedule.edit no importa', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1}]'), 'forbidden');
  perform t.as_user('ext_a');
  perform t.throws('visor no importa', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1}]'), 'forbidden');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no importa', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1}]'), 'forbidden');
  perform t.as_anon();
  perform t.throws('anon no ejecuta la función', format('select public.import_activities(%L, %L)', v_p, '[{"ref":"a","name":"A","duration":1}]'), '42501');
  perform t.reset();
end $$;
