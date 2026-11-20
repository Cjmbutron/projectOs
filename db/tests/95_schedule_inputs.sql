-- Cronograma R2: entradas, permisos, versionado, ciclos, estados de solo lectura, visibilidad.
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_p2 uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_ph uuid; v_dep uuid;
  v_ver int; v_n bigint; v_step text;
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'SCH-1', 'Cronograma 1', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('portfolio_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  perform t.fx_set('sch1', v_p);
  perform t.reset();

  perform t.eq('el proyecto nace con su fila de cronograma', (select count(*) from public.project_schedules where project_id = v_p), 1::bigint);
  perform t.eq('versión inicial 0', (select schedule_version from public.project_schedules where project_id = v_p), 0);
  perform t.ok('sin cálculo aún', (select computed_version is null from public.project_schedules where project_id = v_p));

  -- ---- Ajustes y calendario ----
  perform t.as_user('pm_a');
  perform t.eq('PM fija el inicio', t.affected(format('update public.project_schedules set start_date = %L where project_id = %L', '2026-03-02', v_p)), 1::bigint);
  perform t.eq('la versión sube con el inicio', (select schedule_version from public.project_schedules where project_id = v_p), 1);
  perform t.eq('semana laboral válida', t.affected(format('update public.project_schedules set working_weekdays = %L where project_id = %L', '{1,2,3,4,5,6}', v_p)), 1::bigint);
  perform t.throws('semana con día inválido', format('update public.project_schedules set working_weekdays = %L where project_id = %L', '{1,7}', v_p), '23514');
  perform t.throws('semana con días repetidos', format('update public.project_schedules set working_weekdays = %L where project_id = %L', '{1,1}', v_p), '23514');
  perform t.throws('semana vacía', format('update public.project_schedules set working_weekdays = %L where project_id = %L', '{}', v_p), '23514');
  perform t.throws('inicio fuera de rango', format('update public.project_schedules set start_date = %L where project_id = %L', '1800-01-01', v_p), '23514');
  perform t.throws('la versión no se escribe directamente', format('update public.project_schedules set schedule_version = 99 where project_id = %L', v_p), '42501');
  perform t.throws('computed_* no se escriben directamente', format('update public.project_schedules set computed_version = 1 where project_id = %L', v_p), '42501');
  perform t.throws('no hay INSERT directo en project_schedules', format('insert into public.project_schedules (project_id, organization_id) values (%L, %L)', gen_random_uuid(), v_org), '42501');
  perform t.throws('no hay DELETE directo en project_schedules', 'delete from public.project_schedules', '42501');
  perform t.lives('feriado', format('insert into public.project_calendar_days (organization_id, project_id, day, kind, name) values (%L, %L, %L, ''holiday'', ''Año nuevo andino'')', v_org, v_p, '2026-06-21'));
  perform t.eq('feriado sube la versión', (select schedule_version from public.project_schedules where project_id = v_p), 3);
  perform t.throws('día repetido', format('insert into public.project_calendar_days (organization_id, project_id, day, kind) values (%L, %L, %L, ''working'')', v_org, v_p, '2026-06-21'), '23505');
  perform t.throws('tipo de día inválido', format('insert into public.project_calendar_days (organization_id, project_id, day, kind) values (%L, %L, %L, ''feriadito'')', v_org, v_p, '2026-06-22'), '23514');
  perform t.as_user('member_a');
  perform t.eq('contributor no edita el calendario', t.affected(format('update public.project_schedules set start_date = %L where project_id = %L', '2026-04-01', v_p)), 0::bigint);
  perform t.throws('contributor no agrega feriados', format('insert into public.project_calendar_days (organization_id, project_id, day, kind) values (%L, %L, %L, ''holiday'')', v_org, v_p, '2026-07-01'), '42501');
  perform t.eq('contributor sí lee el calendario', t.count_of(format('select 1 from public.project_calendar_days where project_id = %L', v_p)), 1::bigint);

  -- ---- Actividades ----
  perform t.as_user('pm_a');
  insert into public.project_phases (organization_id, project_id, name) values (v_org, v_p, 'Ejecución') returning id into v_ph;
  insert into public.activities (organization_id, project_id, name, duration, phase_id, assignee_id)
    values (v_org, v_p, 'Diseñar', 3, v_ph, t.uid('member_a')) returning id into v_a;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Construir', 5) returning id into v_b;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Entrega', 0) returning id into v_c;
  perform t.reset();
  perform t.eq('3 actividades suben la versión a 6', (select schedule_version from public.project_schedules where project_id = v_p), 6);
  perform t.ok('duración 0 = hito (columna generada)', (select is_milestone from public.activities where id = v_c));
  perform t.ok('duración > 0 no es hito', not (select is_milestone from public.activities where id = v_a));
  perform t.ok('actividad nueva sin fechas calculadas', (select early_start is null and is_critical is null from public.activities where id = v_a));

  perform t.as_user('pm_a');
  perform t.throws('duración negativa', format('insert into public.activities (organization_id, project_id, name, duration) values (%L,%L,''X'',-1)', v_org, v_p), '23514');
  perform t.throws('duración excesiva', format('insert into public.activities (organization_id, project_id, name, duration) values (%L,%L,''X'',36501)', v_org, v_p), '23514');
  perform t.throws('nombre vacío', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''  '')', v_org, v_p), '23514');
  perform t.throws('responsable que no es del proyecto', format('insert into public.activities (organization_id, project_id, name, assignee_id) values (%L,%L,''X'',%L)', v_org, v_p, t.uid('admin_a')), 'assignee_must_be_project_member');
  perform t.throws('responsable externo', format('insert into public.activities (organization_id, project_id, name, assignee_id) values (%L,%L,''X'',%L)', v_org, v_p, t.uid('ext_a')));
  perform t.throws('responsable de otra organización', format('insert into public.activities (organization_id, project_id, name, assignee_id) values (%L,%L,''X'',%L)', v_org, v_p, t.uid('owner_b')));
  perform t.throws('organización distinta a la del proyecto (FK compuesta)', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''X'')', t.fx('org_b'), v_p), '23503');
  perform t.throws('fase de otro proyecto (FK compuesta)', format('insert into public.activities (organization_id, project_id, name, phase_id) values (%L,%L,''X'',%L)', v_org, v_p, gen_random_uuid()), '23503');
  perform t.throws('calculadas: early_start no se escribe', format('update public.activities set early_start = %L where id = %L', '2026-03-02', v_a), '42501');
  perform t.throws('calculadas: is_critical no se escribe', format('update public.activities set is_critical = true where id = %L', v_a), '42501');
  perform t.throws('avance: status no se escribe directo', format('update public.activities set status = ''done'' where id = %L', v_a), '42501');
  perform t.throws('avance: percent_complete no se escribe directo', format('update public.activities set percent_complete = 100 where id = %L', v_a), '42501');
  perform t.throws('no se inserta con fechas calculadas', format('insert into public.activities (organization_id, project_id, name, early_start) values (%L,%L,''X'',%L)', v_org, v_p, '2026-03-02'), '42501');
  select schedule_version into v_ver from public.project_schedules where project_id = v_p;
  perform t.lives('editar el nombre', format('update public.activities set name = ''Diseñar v2'' where id = %L', v_a));
  perform t.eq('cambiar el nombre NO sube la versión', (select schedule_version from public.project_schedules where project_id = v_p), v_ver);
  perform t.lives('cambiar la duración', format('update public.activities set duration = 4 where id = %L', v_a));
  perform t.eq('cambiar la duración SÍ sube la versión', (select schedule_version from public.project_schedules where project_id = v_p), v_ver + 1);
  perform t.lives('borrar la fase no borra la actividad', format('delete from public.project_phases where id = %L', v_ph));
  perform t.ok('la actividad conserva todo salvo la fase', (select phase_id is null and name = 'Diseñar v2' from public.activities where id = v_a));

  -- ---- Quién puede editar ----
  perform t.as_user('portfolio_a');
  perform t.lives('team_lead (schedule.edit) crea actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''Tarea TL'')', v_org, v_p));
  perform t.throws('team_lead no crea líneas base', format('select public.create_baseline(%L, ''x'')', v_p), 'forbidden');
  perform t.as_user('member_a');
  perform t.throws('contributor no crea actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''Colado'')', v_org, v_p), '42501');
  perform t.eq('contributor no edita actividades', t.affected(format('update public.activities set name = ''Hack'' where id = %L', v_a)), 0::bigint);
  perform t.eq('contributor no borra actividades', t.affected(format('delete from public.activities where id = %L', v_a)), 0::bigint);
  perform t.eq('contributor lee las actividades', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 4::bigint);
  perform t.as_user('ext_a');
  perform t.eq('externo (viewer) lee actividades', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 4::bigint);
  perform t.throws('externo no crea actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''Colado'')', v_org, v_p), '42501');
  perform t.as_user('admin_a');
  perform t.lives('admin (manage_all) crea actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''Tarea admin'')', v_org, v_p));
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve actividades', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 0::bigint);
  perform t.throws('otra organización no inserta actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''Colado'')', v_org, v_p), '42501');
  perform t.eq('otra organización no ve el cronograma', t.count_of(format('select 1 from public.project_schedules where project_id = %L', v_p)), 0::bigint);

  -- ---- Restricciones ----
  perform t.as_user('pm_a');
  perform t.reset(); select schedule_version into v_ver from public.project_schedules where project_id = v_p; perform t.as_user('pm_a');
  perform t.lives('restricción SNET', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''SNET'',%L)', v_org, v_p, v_a, '2026-03-09'));
  perform t.lives('segunda restricción de otro tipo (sprint: SNET + FNLT)', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''FNLT'',%L)', v_org, v_p, v_a, '2026-03-20'));
  perform t.throws('una sola restricción por tipo', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''SNET'',%L)', v_org, v_p, v_a, '2026-03-10'), '23505');
  perform t.throws('tipo de restricción inválido', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''XYZ'',%L)', v_org, v_p, v_a, '2026-03-10'), '23514');
  perform t.throws('fecha fuera de rango', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''MSO'',%L)', v_org, v_p, v_a, '2300-01-01'), '23514');
  perform t.throws('la actividad debe ser del proyecto', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''MSO'',%L)', v_org, v_p, gen_random_uuid(), '2026-03-10'), '23503');
  perform t.reset();
  perform t.eq('las restricciones suben la versión', (select schedule_version from public.project_schedules where project_id = v_p), v_ver + 2);
  perform t.as_user('member_a');
  perform t.throws('contributor no crea restricciones', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''MFO'',%L)', v_org, v_p, v_b, '2026-03-10'), '42501');

  -- ---- Dependencias y ciclos ----
  perform t.as_user('pm_a');
  perform t.lives('A → B (FS)', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_a, v_b));
  perform t.lives('B → C (SS con adelanto)', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, type, lag) values (%L,%L,%L,%L,''SS'',-1)', v_org, v_p, v_b, v_c));
  perform t.throws('dependencia repetida', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, type) values (%L,%L,%L,%L,''SS'')', v_org, v_p, v_a, v_b), '23505');
  perform t.throws('dependencia consigo misma', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_a, v_a), '23514');
  perform t.throws('ciclo directo B → A', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_b, v_a), 'dependency_cycle');
  perform t.throws('ciclo indirecto C → A', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_c, v_a), 'dependency_cycle');
  perform t.throws('tipo de dependencia inválido', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, type) values (%L,%L,%L,%L,''XX'')', v_org, v_p, v_a, v_c), '23514');
  perform t.throws('desfase fuera de rango', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id, lag) values (%L,%L,%L,%L,40000)', v_org, v_p, v_a, v_c), '23514');
  perform t.lives('A → C sin ciclo (atajo)', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_a, v_c));
  select id into v_dep from public.activity_dependencies where predecessor_id = v_b and successor_id = v_c;
  perform t.lives('cambiar tipo y desfase', format('update public.activity_dependencies set type = ''FF'', lag = 2 where id = %L', v_dep));
  perform t.throws('no se reasignan los extremos directamente', format('update public.activity_dependencies set successor_id = %L where id = %L', v_a, v_dep), '42501');
  perform t.as_user('member_a');
  perform t.throws('contributor no crea dependencias (RLS)', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,(select id from public.activities where project_id = %L and name = ''Tarea TL''))', v_org, v_p, v_c, v_p), '42501');
  perform t.eq('contributor lee dependencias', t.count_of(format('select 1 from public.activity_dependencies where project_id = %L', v_p)), 3::bigint);
  perform t.as_user('pm_a');
  perform t.eq('borrar la actividad B borra sus dependencias', (select 0) + t.affected(format('delete from public.activities where id = %L', v_b)), 1::bigint);
  perform t.eq('quedan solo A → C', t.count_of(format('select 1 from public.activity_dependencies where project_id = %L', v_p)), 1::bigint);

  -- Dependencia entre proyectos distintos (FK compuesta)
  v_p2 := public.create_project(v_org, 'SCH-2', 'Cronograma 2', t.uid('pm_a'), 'predictive');
  insert into public.activities (organization_id, project_id, name) values (v_org, v_p2, 'Otra') returning id into v_d;
  perform t.throws('dependencia entre proyectos distintos', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p, v_a, v_d), '23503');

  -- ---- Visibilidad ----
  perform t.as_user('pm_a');
  perform t.fx_set('sch2', v_p2);
  perform t.lives('proyecto privado', format('update public.projects set visibility = ''private'' where id = %L', v_p2));
  perform t.as_user('portfolio_a');
  perform t.eq('un miembro sin acceso no ve actividades de un proyecto privado', t.count_of(format('select 1 from public.activities where project_id = %L', v_p2)), 0::bigint);
  perform t.as_user('auditor_a');
  perform t.eq('read_all sí las ve', t.count_of(format('select 1 from public.activities where project_id = %L', v_p2)), 1::bigint);
  perform t.as_user('pm_a');
  perform t.lives('papelera', format('select public.trash_project(%L, true)', v_p));
  perform t.as_user('member_a');
  perform t.eq('en papelera: miembros no ven actividades', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 0::bigint);
  perform t.eq('en papelera: ni fases', t.count_of(format('select 1 from public.project_phases where project_id = %L', v_p)), 0::bigint);
  perform t.eq('en papelera: ni el cronograma', t.count_of(format('select 1 from public.project_schedules where project_id = %L', v_p)), 0::bigint);
  perform t.as_user('pm_a');
  perform t.eq('quien puede restaurar sí las ve', t.count_of(format('select 1 from public.activities where project_id = %L', v_p)), 4::bigint);
  perform t.lives('restaura', format('select public.trash_project(%L, false)', v_p));

  -- ---- Proyecto cerrado: solo lectura ----
  perform t.as_user('owner_a');
  v_p2 := public.create_project(v_org, 'SCH-3', 'Para cerrar', t.uid('owner_a'), 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p2, 'Única', 2) returning id into v_a;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p2, 'Segunda', 2) returning id into v_b;
  insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (v_org, v_p2, v_a, v_b);
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p2, 'Tercera', 1) returning id into v_c;
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_p2, v_step);
  end loop;
  perform t.throws('cerrado: no se crean actividades', format('insert into public.activities (organization_id, project_id, name) values (%L,%L,''X'')', v_org, v_p2), 'project_read_only');
  perform t.throws('cerrado: no se editan', format('update public.activities set name = ''Y'' where id = %L', v_a), 'project_read_only');
  perform t.throws('cerrado: no se borran', format('delete from public.activities where id = %L', v_a), 'project_read_only');
  perform t.throws('cerrado: no se crean dependencias', format('insert into public.activity_dependencies (organization_id, project_id, predecessor_id, successor_id) values (%L,%L,%L,%L)', v_org, v_p2, v_a, v_c), 'project_read_only');
  perform t.throws('cerrado: no se crean restricciones', format('insert into public.activity_constraints (organization_id, project_id, activity_id, type, date) values (%L,%L,%L,''MSO'',%L)', v_org, v_p2, v_a, '2026-03-10'), 'project_read_only');
  perform t.throws('cerrado: no se tocan los ajustes', format('update public.project_schedules set start_date = %L where project_id = %L', '2026-05-01', v_p2), 'project_read_only');
  perform t.throws('cerrado: no se agregan feriados', format('insert into public.project_calendar_days (organization_id, project_id, day, kind) values (%L,%L,%L,''holiday'')', v_org, v_p2, '2026-05-02'), 'project_read_only');
  perform t.lives('reabrir devuelve la edición', format('select public.reopen_project(%L, ''ajuste'')', v_p2));
  perform t.lives('y ya se puede editar', format('update public.activities set name = ''Y'' where id = %L', v_a));
  perform t.fx_set('sch3', v_p2);

  -- ---- Auditoría de entradas ----
  perform t.reset();
  perform t.ok('crear actividades queda auditado', exists (select 1 from public.audit_log where entity_table = 'activities' and action = 'insert' and organization_id = v_org));
  perform t.ok('crear dependencias queda auditado', exists (select 1 from public.audit_log where entity_table = 'activity_dependencies' and action = 'insert'));
  perform t.ok('las restricciones quedan auditadas', exists (select 1 from public.audit_log where entity_table = 'activity_constraints' and action = 'insert'));
  perform t.ok('los cambios de calendario quedan auditados', exists (select 1 from public.audit_log where entity_table = 'project_schedules' and action = 'update'));
  perform t.ok('quién cambió: el actor figura', exists (select 1 from public.audit_log where entity_table = 'activities' and action = 'insert' and actor_id = t.uid('pm_a')));
end $$;
