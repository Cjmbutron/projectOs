do $$
declare
  v_p uuid; v_n bigint; v_c uuid; rec record;
begin
  -- Hechos ya generados por los fixtures y pruebas anteriores
  perform t.reset();
  perform t.ok('alta de organización auditada', exists (select 1 from public.audit_log where entity_table = 'organizations' and action = 'insert' and entity_id = t.fx('org_a')::text));
  perform t.ok('alta de miembro auditada', exists (select 1 from public.audit_log where entity_table = 'organization_members' and action = 'insert' and organization_id = t.fx('org_a')));
  perform t.ok('creación de proyecto auditada con su autor', exists (select 1 from public.audit_log where entity_table = 'projects' and action = 'insert' and entity_id = t.fx('p1')::text and actor_id = t.uid('pm_a')));
  perform t.ok('cambio de rol de miembro auditado con valores antes/después',
    exists (select 1 from public.audit_log where entity_table = 'organization_members' and action = 'update'
            and old_values ->> 'role_id' <> new_values ->> 'role_id' and organization_id = t.fx('org_rbac')));
  perform t.ok('cambio de estado registrado como status_change con motivo', exists (select 1 from public.audit_log where entity_table = 'projects' and action = 'status_change' and reason = 'listo'));
  perform t.ok('reapertura registrada con motivo', exists (select 1 from public.audit_log where entity_table = 'projects' and action = 'reopen' and reason = 'Ajuste contable pendiente' and entity_id = t.fx('p_closed')::text));
  perform t.ok('el motivo no se filtra a operaciones posteriores', not exists (select 1 from public.audit_log where entity_table = 'projects' and action = 'update' and reason = 'Ajuste contable pendiente'));
  perform t.ok('invitaciones auditadas', exists (select 1 from public.audit_log where entity_table = 'invitations' and action = 'insert'));
  perform t.eq('NUNCA se registra token_hash', (select count(*) from public.audit_log where old_values ? 'token_hash' or new_values ? 'token_hash'), 0::bigint);
  perform t.ok('creación de roles personalizados auditada', exists (select 1 from public.audit_log where entity_table = 'roles' and action = 'insert' and organization_id = t.fx('org_rbac')));
  perform t.ok('permisos de rol auditados con su organización', exists (select 1 from public.audit_log where entity_table = 'role_permissions' and organization_id = t.fx('org_rbac')));
  perform t.ok('archivar proyecto auditado', exists (select 1 from public.audit_log where entity_table = 'projects' and new_values ->> 'archived_at' is not null and old_values ->> 'archived_at' is null));
  perform t.ok('papelera auditada', exists (select 1 from public.audit_log where entity_table = 'projects' and new_values ->> 'deleted_at' is not null and old_values ->> 'deleted_at' is null));
  perform t.ok('purga auditada como borrado del sistema (sin actor)', exists (select 1 from public.audit_log where entity_table = 'projects' and action = 'delete' and actor_id is null));
  perform t.eq('toda fila tiene acción y tabla', (select count(*) from public.audit_log where action is null or entity_table is null), 0::bigint);

  -- No se registra ruido: UPDATE que no cambia nada
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'AUD-1', 'Auditoría', t.uid('pm_a'), 'predictive');
  perform t.reset();
  select count(*) into v_n from public.audit_log where entity_id = v_p::text and entity_table = 'projects';
  perform t.ok('la creación dejó 1 fila de auditoría', v_n = 1);
  perform t.as_user('pm_a');
  update public.projects set name = name where id = v_p;
  perform t.reset();
  perform t.eq('un UPDATE sin cambios no genera auditoría', (select count(*) from public.audit_log where entity_id = v_p::text and entity_table = 'projects')::bigint, v_n);
  perform t.as_user('pm_a');
  update public.projects set name = 'Auditoría v2' where id = v_p;
  perform t.reset();
  perform t.eq('un cambio real sí', (select count(*) from public.audit_log where entity_id = v_p::text and entity_table = 'projects')::bigint, v_n + 1);

  -- Inmutabilidad (incluso para el dueño de la tabla y service_role)
  perform t.reset();
  perform t.throws('superusuario: UPDATE bloqueado', 'update public.audit_log set action = ''x''', 'audit_log_is_immutable');
  perform t.throws('superusuario: DELETE bloqueado', 'delete from public.audit_log', 'audit_log_is_immutable');
  perform t.throws('superusuario: TRUNCATE bloqueado', 'truncate public.audit_log', 'audit_log_is_immutable');
  perform t.as_service();
  perform t.throws('service_role: UPDATE bloqueado', 'update public.audit_log set action = ''x''', 'audit_log_is_immutable');
  perform t.throws('service_role: DELETE bloqueado', 'delete from public.audit_log', 'audit_log_is_immutable');
  perform t.throws('service_role: TRUNCATE bloqueado', 'truncate public.audit_log', 'audit_log_is_immutable');
  perform t.as_user('owner_a');
  perform t.throws('owner: INSERT directo denegado', 'insert into public.audit_log (action, entity_table) values (''falso'', ''projects'')', '42501');
  perform t.throws('owner: UPDATE directo denegado', 'update public.audit_log set action = ''x''', '42501');
  perform t.throws('owner: DELETE directo denegado', 'delete from public.audit_log', '42501');
  perform t.throws('owner: TRUNCATE denegado', 'truncate public.audit_log', '42501');
  perform t.throws('borrar un proyecto con historial no borra la bitácora (no hay FK que lo impida ni lo arrastre)', 'delete from public.projects', '42501');

  -- Lectura: audit.read dentro de la propia organización
  perform t.as_user('auditor_a');
  perform t.ok('auditor lee la bitácora de A', t.count_of('select 1 from public.audit_log where organization_id = ''' || t.fx('org_a') || '''') > 10);
  perform t.eq('auditor no ve la de B', t.count_of('select 1 from public.audit_log where organization_id = ''' || t.fx('org_b') || ''''), 0::bigint);
  perform t.as_user('admin_a');
  perform t.ok('admin lee la bitácora', t.count_of('select 1 from public.audit_log') > 10);
  perform t.as_user('member_a');
  perform t.eq('member no lee la bitácora', t.count_of('select 1 from public.audit_log'), 0::bigint);
  perform t.as_user('pm_a');
  perform t.eq('project_manager no lee la bitácora', t.count_of('select 1 from public.audit_log'), 0::bigint);
  perform t.as_user('owner_b');
  perform t.ok('owner_b solo ve su organización', t.count_of('select 1 from public.audit_log') > 0 and t.count_of('select 1 from public.audit_log where organization_id <> ''' || t.fx('org_b') || '''') = 0);
  perform t.as_user('loner');
  perform t.ok('loner solo ve la suya (Gamma)', t.count_of('select 1 from public.audit_log where organization_id <> ''' || t.fx('org_gamma') || '''') = 0);
  perform t.reset();
end $$;
