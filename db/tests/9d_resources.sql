-- Recursos de la organización, asignación a actividades y carga semanal (migración 2300).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_q uuid; v_a1 uuid; v_a2 uuid; v_a3 uuid; v_aq uuid; v_au uuid; v_aq1 uuid;
  v_r1 uuid; v_r2 uuid; v_rb uuid; v_re uuid; v_rm uuid; v_as1 uuid;
  v_ob uuid := t.fx('org_b');
  v_w record; v_n integer;
begin
  -- ---- Permisos para crear recursos ----
  perform t.as_user('pm_a');
  insert into public.resources (organization_id, name, daily_hours) values (v_org, 'Ana Rojas', 8) returning id into v_r1;
  perform t.ok('PM (rol de organización) crea recursos', v_r1 is not null);
  perform t.as_user('admin_a');
  insert into public.resources (organization_id, name, kind, daily_hours) values (v_org, 'Servidor de pruebas', 'equipment', 4) returning id into v_re;
  perform t.ok('admin crea un equipo', v_re is not null);
  perform t.as_user('owner_a');
  insert into public.resources (organization_id, name) values (v_org, 'Luis Mamani') returning id into v_r2;
  perform t.ok('owner crea recursos', v_r2 is not null);
  perform t.as_user('member_a');
  perform t.throws('member no crea recursos', format('insert into public.resources (organization_id, name) values (%L, ''X'')', v_org), '42501');
  perform t.as_user('auditor_a');
  perform t.throws('auditor no crea recursos', format('insert into public.resources (organization_id, name) values (%L, ''X'')', v_org), '42501');
  perform t.as_user('portfolio_a');
  perform t.throws('portfolio manager no crea recursos', format('insert into public.resources (organization_id, name) values (%L, ''X'')', v_org), '42501');
  perform t.as_user('ext_a');
  perform t.throws('un externo no crea recursos', format('insert into public.resources (organization_id, name) values (%L, ''X'')', v_org), '42501');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no crea recursos en org_a', format('insert into public.resources (organization_id, name) values (%L, ''X'')', v_org), '42501');

  -- ---- Validaciones ----
  perform t.as_user('pm_a');
  perform t.throws('nombre repetido (sin distinguir mayúsculas ni espacios)', format('insert into public.resources (organization_id, name) values (%L, '' ana rojas '')', v_org), '23505');
  perform t.throws('nombre vacío', format('insert into public.resources (organization_id, name) values (%L, ''  '')', v_org), '23514');
  perform t.throws('capacidad 0', format('insert into public.resources (organization_id, name, daily_hours) values (%L, ''C0'', 0)', v_org), '23514');
  perform t.throws('capacidad mayor a 24', format('insert into public.resources (organization_id, name, daily_hours) values (%L, ''C25'', 24.5)', v_org), '23514');
  perform t.lives('capacidad 24 es válida', format('insert into public.resources (organization_id, name, daily_hours) values (%L, ''C24'', 24)', v_org));
  perform t.throws('tipo inválido', format('insert into public.resources (organization_id, name, kind) values (%L, ''K'', ''robot'')', v_org), '23514');
  perform t.as_user('owner_b');
  perform t.lives('el mismo nombre en otra organización sí se permite', format('insert into public.resources (organization_id, name) values (%L, ''Ana Rojas'')', v_ob));
  perform t.as_user('pm_a');

  -- ---- Vínculo con un miembro ----
  perform t.lives('vincular un miembro interno', format('update public.resources set user_id = %L where id = %L', t.uid('member_a'), v_r1));
  perform t.throws('el mismo miembro no puede ser dos recursos', format('update public.resources set user_id = %L where id = %L', t.uid('member_a'), v_r2), '23505');
  perform t.throws('un externo no puede vincularse', format('update public.resources set user_id = %L where id = %L', t.uid('ext_a'), v_r2), 'P0001');
  perform t.throws('alguien de otra organización no puede vincularse', format('update public.resources set user_id = %L where id = %L', t.uid('member_b'), v_r2), 'P0001');
  perform t.throws('un equipo no tiene miembro', format('update public.resources set user_id = %L where id = %L', t.uid('auditor_a'), v_re), 'P0001');
  perform t.throws('no se puede convertir en equipo conservando el miembro', format('update public.resources set kind = ''equipment'' where id = %L', v_r1), 'P0001');

  -- ---- Lectura ----
  perform t.as_user('member_a');
  perform t.ok('un miembro interno ve los recursos', t.count_of('select 1 from public.resources') >= 4);
  perform t.as_user('ext_a');
  perform t.eq('un externo no ve recursos', t.count_of('select 1 from public.resources'), 0::bigint);
  perform t.as_user('member_b');
  perform t.eq('otra organización solo ve los suyos', t.count_of('select 1 from public.resources'), 1::bigint);

  -- ---- Edición ----
  perform t.as_user('member_a');
  perform t.eq('member no edita recursos (0 filas)', t.affected(format('update public.resources set name = ''Hack'' where id = %L', v_r1)), 0::bigint);
  perform t.eq('member no borra recursos (0 filas)', t.affected(format('delete from public.resources where id = %L', v_r1)), 0::bigint);
  perform t.as_user('pm_a');
  perform t.lives('PM renombra', format('update public.resources set name = ''Ana M. Rojas'' where id = %L', v_r1));
  perform t.throws('la organización no se cambia', format('update public.resources set organization_id = %L where id = %L', v_ob, v_r1), '42501');
  perform t.as_user('owner_b');
  perform t.eq('otra organización no edita recursos de org_a (0 filas)', t.affected(format('update public.resources set name = ''Hack'' where id = %L', v_r1)), 0::bigint);

  -- ---- Proyecto y actividades ----
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'RES-P', 'Recursos', t.uid('pm_a'), 'predictive');
  v_q := public.create_project(v_org, 'RES-Q', 'Otro proyecto', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform t.fx_set('res', v_p);
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Larga', 10) returning id into v_a1;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Corta', 5) returning id into v_a2;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Sin fechas', 3) returning id into v_a3;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_q, 'Del otro proyecto', 5) returning id into v_aq;
  -- Fechas calculadas (las escribe apply_schedule; aquí se fijan directamente): lun 2026-03-02
  perform t.reset();
  update public.activities set early_start = '2026-03-02', early_finish = '2026-03-13' where id = v_a1;
  update public.activities set early_start = '2026-03-02', early_finish = '2026-03-06' where id = v_a2;
  update public.activities set early_start = '2026-03-09', early_finish = '2026-03-13' where id = v_aq;

  -- ---- Asignación ----
  perform t.as_user('pm_a');
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_p, v_a1, v_r1, 50) returning id into v_as1;
  perform t.ok('PM asigna un recurso con 50 %', v_as1 is not null);
  perform t.as_user('auditor_a');
  perform t.lives('team_lead asigna (schedule.edit)', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_p, v_a2, v_r1));
  perform t.as_user('member_a');
  perform t.throws('contributor no asigna', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_p, v_a3, v_r1), '42501');
  perform t.eq('contributor ve las asignaciones de su proyecto', t.count_of('select 1 from public.activity_resources'), 2::bigint);
  perform t.eq('contributor no cambia asignaciones (0 filas)', t.affected(format('update public.activity_resources set allocation_percent = 5 where id = %L', v_as1)), 0::bigint);
  perform t.as_user('member_b');
  perform t.eq('otra organización no ve asignaciones', t.count_of('select 1 from public.activity_resources'), 0::bigint);
  perform t.as_user('pm_a');
  perform t.throws('dedicación 0', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (%L, %L, %L, %L, 0)', v_org, v_p, v_a3, v_r2), '23514');
  perform t.throws('dedicación 101', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (%L, %L, %L, %L, 101)', v_org, v_p, v_a3, v_r2), '23514');
  perform t.throws('el mismo recurso dos veces en la actividad', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_p, v_a1, v_r1), '23505');
  perform t.throws('actividad de otro proyecto', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_q, v_a1, v_r2), '23503');
  select id into v_rb from public.resources where false;
  perform t.reset();
  insert into public.resources (organization_id, name) values (v_ob, 'Recurso de B') returning id into v_rb;
  perform t.as_user('pm_a');
  perform t.throws('recurso de otra organización', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_p, v_a3, v_rb), '23503');
  perform t.lives('PM cambia la dedicación', format('update public.activity_resources set allocation_percent = 40 where id = %L', v_as1));
  perform t.lives('PM la deja otra vez en 50', format('update public.activity_resources set allocation_percent = 50 where id = %L', v_as1));
  perform t.throws('la actividad de una asignación no se cambia', format('update public.activity_resources set activity_id = %L where id = %L', v_a3, v_as1), '42501');

  -- ---- Desactivar y borrar ----
  perform t.throws('un recurso con asignaciones no se borra', format('delete from public.resources where id = %L', v_r1), '23503');
  perform t.lives('un recurso sin asignaciones sí se borra', format('delete from public.resources where id = %L', v_r2));
  insert into public.resources (organization_id, name) values (v_org, 'Inactivo') returning id into v_rm;
  perform t.lives('desactivar', format('update public.resources set active = false where id = %L', v_rm));
  perform t.throws('no se asigna un recurso inactivo', format('insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)', v_org, v_p, v_a3, v_rm), 'P0001');
  perform t.lives('desactivar uno ya asignado conserva sus asignaciones', format('update public.resources set active = false where id = %L', v_re));
  perform t.lives('reactivar', format('update public.resources set active = true where id = %L', v_re));

  -- ---- Carga semanal ----
  -- v_r1 (8 h/día): 'Larga' 50 % del 02 al 13 de marzo, 'Corta' 100 % del 02 al 06
  perform t.as_user('member_a');
  perform t.eq('semana 1: 4 h × 5 + 8 h × 5 = 60 h', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), 60.00::numeric);
  perform t.eq('semana 1: capacidad 40 h', (select capacity_hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), 40.00::numeric);
  perform t.eq('semana 1 sobreasignada', (select overallocated from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), true);
  perform t.eq('semana 2: 4 h × 5 = 20 h', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), 20.00::numeric);
  perform t.eq('semana 2 no está sobreasignada', (select overallocated from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), false);
  perform t.eq('solo hay dos semanas con carga', (select count(*) from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1), 2::bigint);
  perform t.eq('un recurso sin asignaciones no aparece', (select count(*) from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_re), 0::bigint);
  perform t.eq('la actividad sin fechas no suma', (select count(*) from public.resource_load(v_org, '2026-03-02', '2026-03-15') where hours > 60), 0::bigint);
  -- El rango recorta: desde el miércoles 04 solo cuentan 04, 05 y 06 → 3 × 4 + 3 × 8 = 36 h
  perform t.eq('el rango recorta la primera semana', (select hours from public.resource_load(v_org, '2026-03-04', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), 36.00::numeric);
  perform t.eq('con 36 h ya no está sobreasignada', (select overallocated from public.resource_load(v_org, '2026-03-04', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), false);
  perform t.eq('el rango recorta la última semana (hasta el martes 10 = 2 días × 4 h)', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-10') where resource_id = v_r1 and week_start = '2026-03-09'), 8.00::numeric);
  -- Calendario del proyecto: feriado el miércoles 04 y sábado 07 laborable
  perform t.as_user('pm_a');
  insert into public.project_calendar_days (organization_id, project_id, day, kind, name) values (v_org, v_p, '2026-03-04', 'holiday', 'Feriado');
  perform t.eq('feriado: (4 + 8) h × 4 días = 48 h', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), 48.00::numeric);
  insert into public.project_calendar_days (organization_id, project_id, day, kind, name) values (v_org, v_p, '2026-03-07', 'working', 'Sábado trabajado');
  perform t.eq('sábado laborable dentro de la actividad larga: + 4 h = 52 h', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-02'), 52.00::numeric);
  -- Carga de otro proyecto que quien consulta no puede abrir
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_q, v_aq, v_r1, 100);
  perform t.reset();
  update public.projects set visibility = 'private' where id = v_q;
  perform t.as_user('member_a');
  perform t.eq('member no ve el proyecto B (privado)', t.count_of(format('select 1 from public.projects where id = %L', v_q)), 0::bigint);
  perform t.eq('member no ve las asignaciones del proyecto B', t.count_of(format('select 1 from public.activity_resources where project_id = %L', v_q)), 0::bigint);
  perform t.eq('semana 2 suma ambos proyectos: 20 + 40 = 60 h', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), 60.00::numeric);
  perform t.eq('semana 2 sobreasignada por la suma', (select overallocated from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), true);
  -- Proyecto en la papelera o cancelado: no cuenta
  perform t.reset();
  update public.projects set deleted_at = now() where id = v_q;
  perform t.as_user('member_a');
  perform t.eq('un proyecto en la papelera no cuenta', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), 20.00::numeric);
  perform t.reset();
  update public.projects set deleted_at = null where id = v_q;
  update public.projects set status = 'cancelled' where id = v_q;
  perform t.as_user('member_a');
  perform t.eq('un proyecto cancelado no cuenta', (select hours from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_r1 and week_start = '2026-03-09'), 20.00::numeric);
  -- Equipo con 4 h/día: capacidad 20 h
  perform t.as_user('pm_a');
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_p, v_a2, v_re, 100);
  perform t.as_user('member_a');
  perform t.eq('equipo: 4 h × 5 = 20 h con capacidad 20 h, sin sobreasignar', (select hours::text || '/' || capacity_hours::text || '/' || overallocated::text from public.resource_load(v_org, '2026-03-02', '2026-03-15') where resource_id = v_re and week_start = '2026-03-02'), '16.00/20.00/false');
  -- Exactamente la capacidad: 'Larga' (5 días del 09 al 13) al 100 % con 4 h/día = 20 h de 20 h → no es sobreasignación
  perform t.as_user('pm_a');
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id, allocation_percent) values (v_org, v_p, v_a1, v_re, 100);
  perform t.as_user('member_a');
  perform t.eq('con exactamente la capacidad no hay sobreasignación', (select hours::text || '/' || capacity_hours::text || '/' || overallocated::text from public.resource_load(v_org, '2026-03-09', '2026-03-15') where resource_id = v_re and week_start = '2026-03-09'), '20.00/20.00/false');

  -- ---- Quién puede consultar la carga ----
  perform t.as_user('ext_a');
  perform t.throws('un externo no consulta la carga', format('select * from public.resource_load(%L, ''2026-03-02'', ''2026-03-15'')', v_org), '42501');
  perform t.as_user('member_b');
  perform t.throws('otra organización no consulta la carga', format('select * from public.resource_load(%L, ''2026-03-02'', ''2026-03-15'')', v_org), '42501');
  perform t.as_anon();
  perform t.throws('anónimo no ejecuta la carga', format('select * from public.resource_load(%L, ''2026-03-02'', ''2026-03-15'')', v_org), '42501');
  perform t.as_user('member_a');
  perform t.throws('rango invertido', format('select * from public.resource_load(%L, ''2026-03-15'', ''2026-03-02'')', v_org), 'P0001');
  perform t.lives('rango de 372 días permitido', format('select * from public.resource_load(%L, ''2026-01-01'', ''2027-01-08'')', v_org));
  perform t.throws('rango de 373 días rechazado', format('select * from public.resource_load(%L, ''2026-01-01'', ''2027-01-09'')', v_org), 'P0001');
  perform t.as_anon();
  perform t.throws('anónimo no llama a las funciones privadas', 'select private.is_internal_member(gen_random_uuid())', '42501');

  -- ---- Auditoría ----
  perform t.reset();
  perform t.ok('crear un recurso queda auditado', exists (select 1 from public.audit_log where entity_table = 'resources' and entity_id = v_r1::text and action = 'insert'));
  perform t.ok('cambiar un recurso queda auditado', exists (select 1 from public.audit_log where entity_table = 'resources' and entity_id = v_r1::text and action = 'update'));
  perform t.ok('asignar queda auditado', exists (select 1 from public.audit_log where entity_table = 'activity_resources' and entity_id = v_as1::text and action = 'insert'));

  -- ---- Borrar la actividad borra su asignación; el recurso permanece ----
  perform t.as_user('pm_a');
  perform t.lives('borrar la actividad', format('delete from public.activities where id = %L', v_a1));
  perform t.eq('su asignación desaparece', (select count(*) from public.activity_resources where id = v_as1), 0::bigint);
  perform t.eq('el recurso permanece', (select count(*) from public.resources where id = v_r1), 1::bigint);
  perform t.reset();
end $$;
