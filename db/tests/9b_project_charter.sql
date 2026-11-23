-- Project Charter y stakeholders (US-014).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_s uuid; v_st jsonb; v_step text; v_det text; v_ok boolean;
begin
  perform set_config('t.no_auto_charter', 'on', false);   -- aquí el charter se prepara a mano
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'CHT-1', 'Charter', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  perform t.fx_set('cht', v_p);

  -- ---- Compuerta: draft → proposed ----
  v_st := public.charter_status(v_p);
  perform t.eq('sin nada: incompleto', v_st ->> 'complete', 'false');
  perform t.eq('faltan los tres elementos', (v_st -> 'missing')::text, '["objectives", "scope", "stakeholders"]');
  begin
    perform public.change_project_status(v_p, 'proposed');
    perform t.ok('someter sin charter se rechaza', false);
  exception when others then
    get stacked diagnostics v_det = pg_exception_detail;
    perform t.eq('someter sin charter se rechaza (charter_incomplete)', sqlerrm, 'charter_incomplete');
    perform t.eq('el detalle dice qué falta', v_det, 'objectives,scope,stakeholders');
  end;
  perform t.eq('el proyecto sigue en draft', (select status from public.projects where id = v_p), 'draft');

  insert into public.project_charters (project_id, organization_id, objectives, scope) values (v_p, v_org, 'corto', '           ');
  perform t.eq('texto demasiado corto o en blanco cuenta como faltante', (public.charter_status(v_p) -> 'missing')::text, '["objectives", "scope", "stakeholders"]');
  update public.project_charters set objectives = 'Implementar el módulo de ventas en SAP B1' where project_id = v_p;
  perform t.eq('con objetivos faltan alcance y stakeholders', (public.charter_status(v_p) -> 'missing')::text, '["scope", "stakeholders"]');
  update public.project_charters set scope = 'Ventas, inventario y reportes de la sucursal La Paz' where project_id = v_p;
  perform t.throws('con alcance pero sin stakeholders aún se rechaza', format('select public.change_project_status(%L, ''proposed'')', v_p), 'charter_incomplete');
  insert into public.project_stakeholders (organization_id, project_id, name, role, influence, interest) values (v_org, v_p, 'Gerente General', 'Patrocinador', 'high', 'high');
  perform t.eq('completo', public.charter_status(v_p) ->> 'complete', 'true');
  perform t.lives('con el charter completo se somete', format('select public.change_project_status(%L, ''proposed'', ''listo'')', v_p));

  -- La compuerta no depende de la función de la API
  perform t.as_user('pm_a');
  declare v_q uuid; begin
    v_q := public.create_project(v_org, 'CHT-2', 'Sin charter', t.uid('pm_a'), 'predictive');
    perform t.reset();
    perform t.throws('UPDATE directo (incluso del dueño de la tabla) también se rechaza', format('update public.projects set status = ''proposed'' where id = %L', v_q), 'charter_incomplete');
    perform t.as_user('pm_a');
  end;

  -- ---- En proposed el charter sigue editable; devolver a draft y volver a someter ----
  perform t.lives('proposed: se edita el charter', format('update public.project_charters set assumptions = ''Hay acceso al servidor'' where project_id = %L', v_p));
  perform t.lives('proposed → draft', format('select public.change_project_status(%L, ''draft'')', v_p));
  delete from public.project_stakeholders where project_id = v_p;
  perform t.throws('sin stakeholders no se vuelve a someter', format('select public.change_project_status(%L, ''proposed'')', v_p), 'charter_incomplete');
  insert into public.project_stakeholders (organization_id, project_id, name, user_id) values (v_org, v_p, 'Jefe de TI', t.uid('member_a'));
  perform t.lives('de nuevo completo', format('select public.change_project_status(%L, ''proposed'')', v_p));

  -- ---- Aprobado: charter de solo lectura, stakeholders aún editables ----
  perform t.as_user('pm_a');
  perform t.lives('aprobar', format('select public.change_project_status(%L, ''approved'')', v_p));
  perform t.throws('aprobado: el charter ya no se edita', format('update public.project_charters set scope = ''Cambio posterior al alcance aprobado'' where project_id = %L', v_p), 'charter_locked');
  perform t.throws('aprobado: el charter no se borra', format('delete from public.project_charters where project_id = %L', v_p), '42501');
  perform t.reset();
  perform t.throws('aprobado: ni siquiera el dueño de la tabla lo borra', format('delete from public.project_charters where project_id = %L', v_p), 'charter_locked');
  perform t.as_user('pm_a');
  perform t.lives('aprobado: los stakeholders sí se actualizan', format('update public.project_stakeholders set influence = ''low'' where project_id = %L', v_p));
  perform t.lives('aprobado: se agregan stakeholders', format('insert into public.project_stakeholders (organization_id, project_id, name) values (%L, %L, ''Usuario clave'')', v_org, v_p));

  -- ---- Validaciones ----
  perform t.throws('influencia inválida', format('insert into public.project_stakeholders (organization_id, project_id, name, influence) values (%L, %L, ''x'', ''enorme'')', v_org, v_p), '23514');
  perform t.throws('nombre vacío', format('insert into public.project_stakeholders (organization_id, project_id, name) values (%L, %L, ''  '')', v_org, v_p), '23514');
  perform t.throws('stakeholder interno de otra organización', format('insert into public.project_stakeholders (organization_id, project_id, name, user_id) values (%L, %L, ''x'', %L)', v_org, v_p, t.uid('owner_b')), 'stakeholder_not_member');
  perform t.throws('project_id inmutable', format('update public.project_stakeholders set project_id = %L where project_id = %L', t.fx('imp'), v_p), '42501');

  -- ---- Permisos ----
  v_s := public.create_project(v_org, 'CHT-3', 'Permisos del charter', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_s, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_s, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform t.as_user('auditor_a');   -- team_lead: sin project.update
  perform t.eq('team_lead lee el charter', t.count_of(format('select 1 from public.project_charters where project_id = %L', v_p)), 1::bigint);
  perform t.throws('team_lead no crea stakeholders', format('insert into public.project_stakeholders (organization_id, project_id, name) values (%L, %L, ''x'')', v_org, v_p), '42501');
  perform t.eq('team_lead no edita stakeholders (0 filas)', t.affected(format('update public.project_stakeholders set name = ''hack'' where project_id = %L', v_p)), 0::bigint);
  perform t.eq('team_lead no borra stakeholders (0 filas)', t.affected(format('delete from public.project_stakeholders where project_id = %L', v_p)), 0::bigint);
  perform t.as_user('member_a');
  perform t.eq('contributor lee stakeholders', t.count_of(format('select 1 from public.project_stakeholders where project_id = %L', v_p)) > 0, true);
  perform t.throws('contributor no escribe el charter', format('insert into public.project_charters (project_id, organization_id, objectives) values (%L, %L, ''intento de escritura sin permiso'')', v_s, v_org), '42501');
  perform t.as_user('auditor_a');
  perform t.throws('team_lead no escribe el charter', format('insert into public.project_charters (project_id, organization_id, objectives) values (%L, %L, ''intento de escritura sin permiso'')', v_s, v_org), '42501');
  perform t.as_user('ext_a');
  perform t.throws('visor no crea stakeholders', format('insert into public.project_stakeholders (organization_id, project_id, name) values (%L, %L, ''x'')', v_org, v_p), '42501');
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve el charter', t.count_of(format('select 1 from public.project_charters where project_id = %L', v_p)), 0::bigint);
  perform t.eq('otra organización no ve stakeholders', t.count_of(format('select 1 from public.project_stakeholders where project_id = %L', v_p)), 0::bigint);
  perform t.throws('charter_status no revela proyectos ajenos', format('select public.charter_status(%L)', v_p), 'project_not_found');
  perform t.as_anon();
  perform t.throws('anon no ejecuta charter_status', format('select public.charter_status(%L)', v_p), '42501');
  perform t.throws('anon no lee charters', 'select count(*) from public.project_charters', '42501');

  -- ---- Proyecto cerrado: stakeholders de solo lectura ----
  perform t.as_user('owner_a');
  foreach v_step in array array['planning','executing','closing','closed'] loop
    perform public.change_project_status(v_p, v_step);
  end loop;
  perform t.as_user('pm_a');
  perform t.throws('cerrado: no se agregan stakeholders', format('insert into public.project_stakeholders (organization_id, project_id, name) values (%L, %L, ''x'')', v_org, v_p), 'project_read_only');
  perform t.throws('cerrado: no se editan', format('update public.project_stakeholders set name = ''z'' where project_id = %L', v_p), 'project_read_only');

  -- ---- Auditoría y purga ----
  perform t.reset();
  perform t.ok('el charter y los stakeholders quedan en la bitácora',
    (select count(distinct entity_table) from public.audit_log where entity_table in ('project_charters', 'project_stakeholders') and organization_id = v_org) = 2);
  perform t.ok('el cambio del charter guarda el valor anterior', exists (
    select 1 from public.audit_log where entity_table = 'project_charters' and entity_id = v_p::text
      and old_values ->> 'assumptions' is null and new_values ->> 'assumptions' = 'Hay acceso al servidor'));
  update public.projects set deleted_at = now() - interval '31 days' where id = v_p;
  perform t.as_service();
  perform t.lives('la purga con charter y stakeholders funciona', 'select public.purge_trashed_projects()');
  perform t.reset();
  perform t.eq('se llevó charter y stakeholders', (select count(*) from public.project_charters where project_id = v_p) + (select count(*) from public.project_stakeholders where project_id = v_p), 0::bigint);
  perform set_config('t.no_auto_charter', 'off', false);
end $$;
