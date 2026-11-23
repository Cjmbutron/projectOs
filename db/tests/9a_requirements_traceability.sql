-- Requisitos (US-015) y trazabilidad requisito → entregable → nodo ← actividad.
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_q uuid; v_n uuid; v_d uuid; v_d2 uuid; v_dq uuid; v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_a uuid; v_act uuid; v_step text; i integer; v_tr record;
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'REQ-P', 'Trazabilidad', t.uid('pm_a'), 'predictive');
  v_q := public.create_project(v_org, 'REQ-Q', 'Otro proyecto', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  perform t.fx_set('req', v_p);
  v_n := public.wbs_add_node(v_p, null, 'Módulo ventas');
  insert into public.deliverables (organization_id, project_id, wbs_node_id, name) values (v_org, v_p, v_n, 'Informe de ventas') returning id into v_d;
  insert into public.deliverables (organization_id, project_id, name) values (v_org, v_p, 'Sin nodo') returning id into v_d2;
  insert into public.deliverables (organization_id, project_id, name) values (v_org, v_q, 'De otro proyecto') returning id into v_dq;

  -- ---- Código automático por proyecto ----
  insert into public.requirements (organization_id, project_id, description, source) values (v_org, v_p, 'El sistema emite el informe de ventas', 'Gerencia comercial') returning id into v_r1;
  insert into public.requirements (organization_id, project_id, description, source) values (v_org, v_p, 'Exportar a Excel', 'Contabilidad') returning id into v_r2;
  insert into public.requirements (organization_id, project_id, description, source) values (v_org, v_q, 'Otro proyecto', 'X') returning id into v_r3;
  perform t.eq('REQ-001 automático', (select code from public.requirements where id = v_r1), 'REQ-001');
  perform t.eq('REQ-002 consecutivo', (select code from public.requirements where id = v_r2), 'REQ-002');
  perform t.eq('la numeración es por proyecto', (select code from public.requirements where id = v_r3), 'REQ-001');
  perform t.eq('estado inicial', (select status from public.requirements where id = v_r1), 'proposed');
  perform t.throws('el código no se escribe a mano', format('insert into public.requirements (organization_id, project_id, description, source, seq) values (%L, %L, ''x'', ''y'', 9)', v_org, v_p), '42501');
  perform t.throws('seq no se edita', format('update public.requirements set seq = 9 where id = %L', v_r1), '42501');
  perform t.throws('descripción vacía', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''  '', ''y'')', v_org, v_p), '23514');
  perform t.throws('origen obligatorio', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''x'', '' '')', v_org, v_p), '23514');
  perform t.throws('estado inválido', format('update public.requirements set status = ''listo'' where id = %L', v_r1), '23514');
  -- los códigos no se reutilizan tras borrar el último
  perform t.lives('borrar REQ-002', format('delete from public.requirements where id = %L', v_r2));
  insert into public.requirements (organization_id, project_id, description, source) values (v_org, v_p, 'Nuevo', 'Y') returning id into v_r2;
  perform t.eq('tras borrar el último se reutiliza su número (no hay huecos)', (select code from public.requirements where id = v_r2), 'REQ-002');

  -- ---- Aprobado ⇒ ≥ 1 entregable ----
  perform t.throws('no se aprueba sin entregable', format('update public.requirements set status = ''approved'' where id = %L', v_r1), 'requirement_needs_deliverable');
  perform t.eq('el rechazo no cambió el estado', (select status from public.requirements where id = v_r1), 'proposed');
  perform t.throws('no se crea ya aprobado sin entregable', format('insert into public.requirements (organization_id, project_id, description, source, status) values (%L, %L, ''x'', ''y'', ''approved'')', v_org, v_p), 'requirement_needs_deliverable');
  perform t.lives('rechazado sin entregable sí es posible', format('update public.requirements set status = ''rejected'' where id = %L', v_r2));
  perform t.throws('entregable de otro proyecto no se vincula', format('insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (%L, %L, %L, %L)', v_org, v_p, v_r1, v_dq), '23503');
  insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (v_org, v_p, v_r1, v_d);
  perform t.lives('con entregable se aprueba', format('update public.requirements set status = ''approved'' where id = %L', v_r1));
  perform t.throws('vínculo duplicado', format('insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (%L, %L, %L, %L)', v_org, v_p, v_r1, v_d), '23505');
  insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (v_org, v_p, v_r1, v_d2);
  perform t.lives('quitar uno de dos vínculos', format('delete from public.requirement_deliverables where requirement_id = %L and deliverable_id = %L', v_r1, v_d2));
  perform t.throws('no se quita el ÚLTIMO vínculo de un requisito aprobado', format('delete from public.requirement_deliverables where requirement_id = %L', v_r1), 'requirement_needs_deliverable');
  perform t.eq('el vínculo sigue', (select count(*) from public.requirement_deliverables where requirement_id = v_r1), 1::bigint);
  perform t.throws('borrar el entregable que cubre al requisito aprobado tampoco deja huérfano', format('delete from public.deliverables where id = %L', v_d), 'requirement_needs_deliverable');
  perform t.lives('devolverlo a propuesto permite quitar el vínculo', format('update public.requirements set status = ''proposed'' where id = %L', v_r1));
  perform t.lives('y ahora sí se quita', format('delete from public.requirement_deliverables where requirement_id = %L', v_r1));
  insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (v_org, v_p, v_r1, v_d);
  update public.requirements set status = 'verified' where id = v_r1;

  -- Todos los estados avanzados exigen entregable
  insert into public.requirements (organization_id, project_id, description, source) values (v_org, v_p, 'Sin cobertura', 'x') returning id into v_r3;
  perform t.throws('implementado sin entregable', format('update public.requirements set status = ''implemented'' where id = %L', v_r3), 'requirement_needs_deliverable');
  perform t.throws('verificado sin entregable', format('update public.requirements set status = ''verified'' where id = %L', v_r3), 'requirement_needs_deliverable');
  perform t.reset();
  perform t.throws('seq inmutable incluso para el dueño de la tabla', format('update public.requirements set seq = 99 where id = %L', v_r3), '42501');
  perform t.as_user('pm_a');

  -- ---- Actividad ↔ nodo de la WBS ----
  insert into public.activities (organization_id, project_id, name, duration, wbs_node_id) values (v_org, v_p, 'Programar informe', 3, v_n) returning id into v_act;
  insert into public.activities (organization_id, project_id, name, duration, wbs_node_id) values (v_org, v_p, 'Probar informe', 2, v_n);
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Suelta', 1);
  perform t.eq('actividades vinculadas al nodo', (select count(*) from public.activities where wbs_node_id = v_n), 2::bigint);
  perform t.throws('nodo de otro proyecto no se vincula', format('update public.activities set wbs_node_id = %L where id = %L', public.wbs_add_node(v_q, null, 'Nodo de Q'), v_act), '23503');
  perform t.lives('vincular y desvincular una actividad', format('update public.activities set wbs_node_id = null where id = %L', v_act));
  update public.activities set wbs_node_id = v_n where id = v_act;
  update public.deliverables set review_status = 'accepted' where id = v_d;

  insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (v_org, v_p, v_r1, v_d2);
  -- ---- Vista de cobertura ----
  select * into v_tr from public.requirement_traceability where requirement_id = v_r1;
  perform t.eq('cobertura: entregables', v_tr.deliverables, 2);
  perform t.eq('cobertura: entregables aceptados', v_tr.deliverables_accepted, 1);
  perform t.eq('cobertura: actividades vía nodo', v_tr.activities, 2);
  perform t.eq('requisito sin vínculos: ceros', (select deliverables + activities from public.requirement_traceability where requirement_id = v_r2), 0);

  -- borrar el nodo desvincula las actividades y el entregable (no los borra)
  perform t.lives('borrar el nodo', format('select public.wbs_delete_node(%L)', v_n));
  perform t.eq('las actividades sobreviven sin nodo', (select count(*) from public.activities where project_id = v_p and wbs_node_id is null), 3::bigint);
  perform t.eq('el entregable sobrevive', (select count(*) from public.deliverables where id = v_d), 1::bigint);

  -- ---- Permisos ----
  perform t.as_user('auditor_a');  -- team_lead: scope.edit
  perform t.lives('team_lead registra requisitos', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''TL'', ''x'')', v_org, v_p));
  -- Separación de funciones: aprobar/rechazar es del PM (scope.review)
  perform t.throws('team_lead no crea requisitos ya aprobados', format('insert into public.requirements (organization_id, project_id, description, source, status) values (%L, %L, ''x'', ''y'', ''rejected'')', v_org, v_p), '42501');
  perform t.throws('team_lead no aprueba', format('update public.requirements set status = ''approved'' where id = %L', v_r2), '42501');
  perform t.throws('team_lead no rechaza (propuesto → rechazado)', format('update public.requirements set status = ''rejected'' where project_id = %L and description = ''TL''', v_p), '42501');
  perform t.throws('team_lead no reabre un rechazado', format('update public.requirements set status = ''proposed'' where id = %L', v_r2), '42501');
  perform t.throws('team_lead no salta de propuesto a implementado', format('update public.requirements set status = ''implemented'' where id = %L', v_r2), '42501');
  perform t.eq('v_r1 sigue verificado (precondición)', (select status from public.requirements where id = v_r1), 'verified');
  perform t.throws('team_lead no devuelve un aprobado a propuesto', format('update public.requirements set status = ''proposed'' where id = %L', v_r1), '42501');
  perform t.lives('team_lead sí avanza uno aprobado (verified → implemented)', format('update public.requirements set status = ''implemented'' where id = %L', v_r1));
  perform t.lives('team_lead edita la descripción sin tocar el estado', format('update public.requirements set description = ''Descripción ajustada'' where id = %L', v_r2));
  perform t.as_user('pm_a');
  perform t.lives('el PM sí rechaza', format('update public.requirements set status = ''rejected'' where project_id = %L and description = ''TL''', v_p));
  perform t.lives('el PM sí devuelve a propuesto', format('update public.requirements set status = ''proposed'' where id = %L', v_r2));
  perform t.lives('el PM restaura verified', format('update public.requirements set status = ''verified'' where id = %L', v_r1));
  perform t.as_user('member_a');
  perform t.eq('contributor ve requisitos', t.count_of(format('select 1 from public.requirements where project_id = %L', v_p)) > 0, true);
  perform t.eq('contributor ve la cobertura', t.count_of(format('select 1 from public.requirement_traceability where project_id = %L', v_p)) > 0, true);
  perform t.throws('contributor no crea requisitos', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''x'', ''y'')', v_org, v_p), '42501');
  perform t.eq('contributor no edita (0 filas)', t.affected(format('update public.requirements set description = ''hack'' where id = %L', v_r1)), 0::bigint);
  perform t.eq('contributor no borra (0 filas)', t.affected(format('delete from public.requirements where id = %L', v_r1)), 0::bigint);
  perform t.throws('contributor no vincula', format('insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (%L, %L, %L, %L)', v_org, v_p, v_r2, v_d), '42501');
  perform t.eq('contributor no cambia el nodo de una actividad (0 filas)', t.affected(format('update public.activities set wbs_node_id = null where id = %L', v_act)), 0::bigint);
  perform t.as_user('ext_a');
  perform t.throws('visor no crea', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''x'', ''y'')', v_org, v_p), '42501');
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve requisitos', t.count_of(format('select 1 from public.requirements where project_id = %L', v_p)), 0::bigint);
  perform t.eq('otra organización no ve vínculos', t.count_of(format('select 1 from public.requirement_deliverables where project_id = %L', v_p)), 0::bigint);
  perform t.eq('otra organización no ve la cobertura', t.count_of(format('select 1 from public.requirement_traceability where project_id = %L', v_p)), 0::bigint);
  perform t.throws('otra organización no crea', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''x'', ''y'')', v_org, v_p), '42501');
  perform t.as_anon();
  perform t.throws('anon no lee requisitos', 'select count(*) from public.requirements', '42501');
  perform t.throws('anon no lee la cobertura', 'select count(*) from public.requirement_traceability', '42501');

  -- ---- Proyecto cerrado: solo lectura ----
  perform t.as_user('owner_a');
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_p, v_step);
  end loop;
  perform t.as_user('pm_a');
  perform t.throws('cerrado: no se crean requisitos', format('insert into public.requirements (organization_id, project_id, description, source) values (%L, %L, ''x'', ''y'')', v_org, v_p), 'project_read_only');
  perform t.throws('cerrado: no se editan', format('update public.requirements set description = ''z'' where id = %L', v_r1), 'project_read_only');
  perform t.throws('cerrado: no se vincula', format('insert into public.requirement_deliverables (organization_id, project_id, requirement_id, deliverable_id) values (%L, %L, %L, %L)', v_org, v_p, v_r2, v_d), 'project_read_only');

  -- ---- Auditoría y purga ----
  perform t.reset();
  perform t.ok('requisitos y vínculos quedan en la bitácora', (select count(distinct entity_table) from public.audit_log where entity_table in ('requirements', 'requirement_deliverables') and organization_id = v_org) = 2);
  update public.projects set deleted_at = now() - interval '31 days' where id = v_p;
  perform t.as_service();
  perform t.lives('la purga con requisitos aprobados y vínculos funciona', 'select public.purge_trashed_projects()');
  perform t.reset();
  perform t.eq('se llevó requisitos y vínculos', (select count(*) from public.requirements where project_id = v_p) + (select count(*) from public.requirement_deliverables where project_id = v_p), 0::bigint);
end $$;
