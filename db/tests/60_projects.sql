do $$
declare
  v_p uuid; v_c uuid; v_s text; v_from text; v_to text; v_step text; v_ok boolean;
  allowed text[] := array['draft>proposed','draft>cancelled','proposed>draft','proposed>approved','proposed>cancelled',
    'approved>planning','approved>cancelled','planning>executing','planning>on_hold','planning>cancelled',
    'executing>on_hold','executing>closing','executing>cancelled','on_hold>planning','on_hold>executing','on_hold>cancelled',
    'closing>closed','closing>executing','closing>cancelled','closed>closing'];
  states text[] := array['draft','proposed','approved','planning','executing','on_hold','closing','closed','cancelled'];
  path jsonb := '{"draft":[],"proposed":["proposed"],"approved":["proposed","approved"],"planning":["proposed","approved","planning"],
    "executing":["proposed","approved","planning","executing"],"on_hold":["proposed","approved","planning","executing","on_hold"],
    "closing":["proposed","approved","planning","executing","closing"],"closed":["proposed","approved","planning","executing","closing","closed"],
    "cancelled":["cancelled"]}';
  n int := 0; bad int := 0; v_err text; i int;
begin
  -- ---- Creación ----
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'NEW-1', 'Proyecto Nuevo', t.uid('pm_a'), 'predictive', 'standard', null, 'desc');
  perform t.eq('estado inicial draft', (select status from public.projects where id = v_p), 'draft');
  perform t.eq('moneda por defecto = referencia de la organización', (select currency from public.projects where id = v_p), 'USD');
  perform t.eq('created_by = quien lo crea', (select created_by from public.projects where id = v_p), t.uid('pm_a'));
  perform t.eq('el responsable queda como PM del proyecto', t.val('select r.key from public.project_members pm join public.roles r on r.id = pm.role_id where pm.project_id = ''' || v_p || ''' and pm.user_id = auth.uid()'), 'project_manager');
  perform t.throws('código duplicado (insensible a mayúsculas)', 'select public.create_project(''' || t.fx('org_a') || ''', ''new-1'', ''Otro'', auth.uid(), ''predictive'')', '23505');
  perform t.throws('MVP: solo metodología predictiva', 'select public.create_project(''' || t.fx('org_a') || ''', ''AG-1'', ''Ágil'', auth.uid(), ''agile'')', '23514');
  perform t.throws('responsable externo', 'select public.create_project(''' || t.fx('org_a') || ''', ''R-1'', ''Resp ext'', ''' || t.uid('ext_a') || ''', ''predictive'')');
  perform t.throws('responsable de otra organización', 'select public.create_project(''' || t.fx('org_a') || ''', ''R-2'', ''Resp otra'', ''' || t.uid('owner_b') || ''', ''predictive'')');
  perform t.throws('fechas invertidas', 'select public.create_project(''' || t.fx('org_a') || ''', ''F-1'', ''Fechas'', auth.uid(), ''predictive'', ''standard'', null, null, null, null, ''organization'', ''2026-12-31'', ''2026-01-01'')', '23514');
  perform t.throws('visibilidad inválida', 'select public.create_project(''' || t.fx('org_a') || ''', ''V-1'', ''Vis'', auth.uid(), ''predictive'', ''standard'', null, null, null, null, ''public'')', '23514');
  perform t.as_user('member_a');
  perform t.throws('member sin project.create', 'select public.create_project(''' || t.fx('org_a') || ''', ''M-1'', ''Nope'', auth.uid(), ''predictive'')', 'forbidden');
  perform t.as_user('ext_a');
  perform t.throws('externo no crea proyectos', 'select public.create_project(''' || t.fx('org_a') || ''', ''E-1'', ''Nope'', auth.uid(), ''predictive'')', 'forbidden');
  perform t.as_user('pm_a');
  perform t.throws('INSERT directo denegado', 'insert into public.projects (organization_id, code, name, responsible_id, methodology) values (''' || t.fx('org_a') || ''', ''D-1'', ''Directo'', auth.uid(), ''predictive'')', '42501');

  -- ---- Visibilidad (US-009) ----
  perform t.as_user('member_a');
  perform t.eq('member ve p1 (visibilidad organización)', t.count_of('select 1 from public.projects where id = ''' || t.fx('p1') || ''''), 1::bigint);
  perform t.eq('member NO ve p2 (privado)', t.count_of('select 1 from public.projects where id = ''' || t.fx('p2') || ''''), 0::bigint);
  perform t.as_user('pm_a');
  perform t.eq('el creador ve su proyecto privado', t.count_of('select 1 from public.projects where id = ''' || t.fx('p2') || ''''), 1::bigint);
  perform t.as_user('portfolio_a');
  perform t.eq('portfolio_manager sin read_all NO ve p2', t.count_of('select 1 from public.projects where id = ''' || t.fx('p2') || ''''), 0::bigint);
  perform t.eq('pero sí ve p1', t.count_of('select 1 from public.projects where id = ''' || t.fx('p1') || ''''), 1::bigint);
  foreach v_s in array array['owner_a','admin_a','auditor_a'] loop
    perform t.as_user(v_s);
    perform t.eq(v_s || ' ve p2 (project.read_all)', t.count_of('select 1 from public.projects where id = ''' || t.fx('p2') || ''''), 1::bigint);
  end loop;
  perform t.as_user('ext_a');
  perform t.eq('externo ve el proyecto al que fue asignado', t.count_of('select 1 from public.projects where id = ''' || t.fx('p1') || ''''), 1::bigint);
  perform t.eq('externo NO ve otros proyectos', t.count_of('select 1 from public.projects where id <> ''' || t.fx('p1') || ''''), 0::bigint);

  -- ---- Edición ----
  perform t.as_user('pm_a');
  perform t.eq('PM del proyecto edita', t.affected('update public.projects set name = ''Alfa 1 v2'' where id = ''' || t.fx('p1') || ''''), 1::bigint);
  perform t.eq('prioridad válida', t.affected('update public.projects set priority = 2 where id = ''' || t.fx('p1') || ''''), 1::bigint);
  perform t.throws('prioridad fuera de rango', 'update public.projects set priority = 9 where id = ''' || t.fx('p1') || '''', '23514');
  perform t.eq('PM no edita proyecto en el que no es miembro (visible pero sin permiso)', t.affected('update public.projects set name = ''X1234'' where id = ''' || t.fx('pb1') || ''''), 0::bigint);
  perform t.as_user('member_a');
  perform t.eq('member con lectura no edita', t.affected('update public.projects set name = ''Hack1'' where id = ''' || t.fx('p1') || ''''), 0::bigint);
  perform t.as_user('ext_a');
  perform t.eq('externo contributor no edita', t.affected('update public.projects set name = ''Hack2'' where id = ''' || t.fx('p1') || ''''), 0::bigint);
  perform t.as_user('admin_a');
  perform t.eq('admin edita cualquier proyecto', t.affected('update public.projects set name = ''Alfa 1'' where id = ''' || t.fx('p1') || ''''), 1::bigint);
  perform t.as_user('pm_a');
  perform t.throws('status no se escribe directo', 'update public.projects set status = ''approved'' where id = ''' || t.fx('p1') || '''', '42501');
  perform t.throws('health no se escribe directo', 'update public.projects set health = ''red'' where id = ''' || t.fx('p1') || '''', '42501');
  perform t.throws('deleted_at no se escribe directo', 'update public.projects set deleted_at = now() where id = ''' || t.fx('p1') || '''', '42501');
  perform t.throws('no hay DELETE directo', 'delete from public.projects where id = ''' || t.fx('p1') || '''', '42501');

  -- ---- Máquina de estados: 9 × 9 contra una lista escrita a mano ----
  perform t.as_user('owner_a');
  for v_from in select unnest(states) loop
    for v_to in select unnest(states) loop
      n := n + 1;
      v_c := public.create_project(t.fx('org_a'), 'M-' || n, 'Matriz ' || v_from || '-' || v_to, t.uid('owner_a'), 'predictive');
      for v_step in select jsonb_array_elements_text(path -> v_from) loop
        perform public.change_project_status(v_c, v_step);
      end loop;
      if (select status from public.projects where id = v_c) <> v_from then
        perform t.ok('preparación de la matriz ' || v_from, false);
      end if;
      v_ok := (v_from || '>' || v_to) = any (allowed);
      begin
        if v_from = 'closed' and v_to = 'closing' then
          perform public.reopen_project(v_c, 'motivo de prueba');
        else
          perform public.change_project_status(v_c, v_to);
        end if;
        if not v_ok or (select status from public.projects where id = v_c) <> v_to then
          bad := bad + 1; raise notice 'FAIL: transición % → % no debía ser permitida', v_from, v_to;
        end if;
      exception when others then
        get stacked diagnostics v_err = message_text;
        if v_ok then bad := bad + 1; raise notice 'FAIL: transición % → % debía permitirse (%)', v_from, v_to, v_err; end if;
        if (select status from public.projects where id = v_c) <> v_from then
          bad := bad + 1; raise notice 'FAIL: % → % rechazada pero cambió el estado', v_from, v_to;
        end if;
      end;
    end loop;
  end loop;
  perform t.eq('matriz de 81 transiciones coincide con la especificación', bad, 0);
  perform t.eq('se probaron 81 combinaciones', n, 81);

  -- ---- Permisos de cambio de estado ----
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'ST-1', 'Estados', t.uid('pm_a'), 'predictive');
  perform t.lives('PM del proyecto: draft → proposed', 'select public.change_project_status(''' || v_p || ''', ''proposed'', ''listo'')');
  perform t.as_user('member_a');
  perform t.throws('member (solo lectura) no cambia estado', 'select public.change_project_status(''' || v_p || ''', ''approved'')', 'forbidden');
  perform t.as_user('ext_a');
  perform t.throws('externo no ve ni cambia estado de proyecto ajeno', 'select public.change_project_status(''' || v_p || ''', ''approved'')', 'project_not_found');
  perform t.as_user('pm_a');
  perform t.lives('PM aprueba (project.approve)', 'select public.change_project_status(''' || v_p || ''', ''approved'')');
  perform t.throws('transición inexistente', 'select public.change_project_status(''' || v_p || ''', ''closed'')', 'invalid_transition');
  perform t.throws('estado desconocido', 'select public.change_project_status(''' || v_p || ''', ''volando'')', 'invalid_transition');
  perform t.throws('closed → closing solo por reopen_project', 'select public.change_project_status(''' || v_p || ''', ''closing'')', 'invalid_transition');

  -- Separación de funciones: rol de proyecto que cambia estados pero NO aprueba
  perform t.as_user('admin_a');
  insert into public.roles (organization_id, scope, name) values (t.fx('org_a'), 'project', 'Coordinador sin aprobación') returning id into v_c;
  insert into public.role_permissions values (v_c, 'project.read'), (v_c, 'project.change_status');
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'ST-2', 'Separación de funciones', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), v_c);
  perform t.as_user('member_a');
  perform t.lives('coordinador: draft → proposed', 'select public.change_project_status(''' || v_p || ''', ''proposed'')');
  perform t.throws('coordinador NO aprueba (falta project.approve)', 'select public.change_project_status(''' || v_p || ''', ''approved'')', 'forbidden');
  perform t.lives('coordinador: proposed → cancelled', 'select public.change_project_status(''' || v_p || ''', ''cancelled'')');
  perform t.eq('coordinador no edita datos (falta project.update)', t.affected('update public.projects set name = ''Hackeo'' where id = ''' || v_p || ''''), 0::bigint);

  -- ---- Estados terminales de solo lectura + reapertura ----
  perform t.as_user('owner_a');
  v_c := public.create_project(t.fx('org_a'), 'TERM-1', 'Terminal', t.uid('owner_a'), 'predictive');
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_c, v_step);
  end loop;
  perform t.fx_set('p_closed', v_c);
  perform t.throws('proyecto cerrado: no se edita', 'update public.projects set name = ''Reabierto?'' where id = ''' || v_c || '''');
  perform t.throws('proyecto cerrado: no se añaden fases', 'insert into public.project_phases (organization_id, project_id, name) values (''' || t.fx('org_a') || ''', ''' || v_c || ''', ''Fase'')');
  perform t.throws('proyecto cerrado: no se añaden miembros', 'select public.add_project_member(''' || v_c || ''', ''' || t.uid('member_a') || ''', private.role_id(''project'',''contributor''))');
  perform t.throws('proyecto cerrado: no se mueve', 'select public.move_project(''' || v_c || ''', null, null)');
  perform t.lives('proyecto cerrado: se puede archivar (mantenimiento)', 'select public.archive_project(''' || v_c || ''', true)');
  perform t.lives('y desarchivar', 'select public.archive_project(''' || v_c || ''', false)');
  perform t.as_user('pm_a');
  perform t.throws('PM del proyecto NO reabre (falta project.reopen de organización)', 'select public.reopen_project(''' || v_c || ''', ''necesito'')', 'forbidden');
  perform t.as_user('owner_a');
  perform t.throws('reapertura exige motivo', 'select public.reopen_project(''' || v_c || ''', ''   '')', 'reason_required');
  perform t.throws('reapertura solo de cerrados', 'select public.reopen_project(''' || t.fx('p1') || ''', ''motivo'')', 'invalid_transition');
  perform t.lives('owner reabre con motivo', 'select public.reopen_project(''' || v_c || ''', ''Ajuste contable pendiente'')');
  perform t.eq('queda en closing', (select status from public.projects where id = v_c), 'closing');
  perform t.lives('y vuelve a ser editable', 'update public.projects set name = ''Terminal reabierto'' where id = ''' || v_c || '''');
  v_p := public.create_project(t.fx('org_a'), 'CAN-1', 'Cancelado', t.uid('owner_a'), 'predictive');
  perform public.change_project_status(v_p, 'cancelled');
  perform t.throws('cancelado: no se edita', 'update public.projects set name = ''Revivir'' where id = ''' || v_p || '''');
  perform t.throws('cancelado: no se reabre', 'select public.reopen_project(''' || v_p || ''', ''quiero'')', 'invalid_transition');
  perform t.throws('cancelado: ninguna transición', 'select public.change_project_status(''' || v_p || ''', ''draft'')', 'invalid_transition');

  -- ---- Archivar / papelera / purga ----
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'ARC-1', 'Archivable', t.uid('pm_a'), 'predictive');
  perform t.lives('PM archiva', 'select public.archive_project(''' || v_p || ''', true)');
  perform t.ok('archived_at fijado', (select archived_at is not null from public.projects where id = v_p));
  perform t.as_user('member_a');
  perform t.throws('member no archiva', 'select public.archive_project(''' || v_p || ''', false)', 'forbidden');
  perform t.throws('member no envía a papelera', 'select public.trash_project(''' || v_p || ''', true)', 'forbidden');
  perform t.as_user('pm_a');
  perform t.lives('PM envía a papelera', 'select public.trash_project(''' || v_p || ''', true)');
  perform t.as_user('member_a');
  perform t.eq('en papelera: otros no lo ven', t.count_of('select 1 from public.projects where id = ''' || v_p || ''''), 0::bigint);
  perform t.as_user('pm_a');
  perform t.eq('quien puede eliminar lo ve (para restaurar)', t.count_of('select 1 from public.projects where id = ''' || v_p || ''''), 1::bigint);
  perform t.lives('restaura', 'select public.trash_project(''' || v_p || ''', false)');
  perform t.as_user('member_a');
  perform t.eq('restaurado: visible otra vez', t.count_of('select 1 from public.projects where id = ''' || v_p || ''''), 1::bigint);
  perform t.as_user('pm_a');
  perform t.lives('a papelera de nuevo', 'select public.trash_project(''' || v_p || ''', true)');
  perform t.throws('purga: no ejecutable por authenticated', 'select public.purge_trashed_projects()', '42501');
  perform t.reset();
  perform t.eq('purga no toca lo reciente', (select public.purge_trashed_projects()) , 0);
  update public.projects set deleted_at = now() - interval '31 days' where id = v_p;
  perform t.as_service();
  perform t.eq('service_role purga lo > 30 días', public.purge_trashed_projects(), 1);
  perform t.reset();
  perform t.eq('el proyecto purgado ya no existe', (select count(*) from public.projects where id = v_p), 0::bigint);

  -- ---- Miembros de proyecto ----
  perform t.as_user('pm_a');
  perform t.lives('PM añade a member_a como contributor', 'select public.add_project_member(''' || t.fx('p1') || ''', ''' || t.uid('member_a') || ''', private.role_id(''project'',''contributor''))');
  perform t.throws('no duplica membresía', 'select public.add_project_member(''' || t.fx('p1') || ''', ''' || t.uid('member_a') || ''', private.role_id(''project'',''viewer''))', '23505');
  perform t.throws('no se añade a quien no es miembro de la organización', 'select public.add_project_member(''' || t.fx('p1') || ''', ''' || t.uid('loner') || ''', private.role_id(''project'',''viewer''))', 'member_not_active');
  perform t.throws('rol de organización no vale en proyecto', 'select public.add_project_member(''' || t.fx('p1') || ''', ''' || t.uid('auditor_a') || ''', private.role_id(''organization'',''admin''))');
  perform t.throws('un externo no puede ser project_manager', 'select public.change_project_member_role(''' || t.fx('p1') || ''', ''' || t.uid('ext_a') || ''', private.role_id(''project'',''project_manager''))');
  perform t.lives('externo pasa de contributor a viewer', 'select public.change_project_member_role(''' || t.fx('p1') || ''', ''' || t.uid('ext_a') || ''', private.role_id(''project'',''viewer''))');
  perform t.as_user('member_a');
  perform t.throws('contributor no gestiona miembros', 'select public.remove_project_member(''' || t.fx('p1') || ''', ''' || t.uid('ext_a') || ''')', 'forbidden');
  perform t.as_user('pm_a');
  perform t.lives('PM quita a member_a', 'select public.remove_project_member(''' || t.fx('p1') || ''', ''' || t.uid('member_a') || ''')');
  perform t.throws('quitar a quien no es miembro', 'select public.remove_project_member(''' || t.fx('p1') || ''', ''' || t.uid('member_a') || ''')', 'member_not_found');
  perform t.throws('no hay INSERT directo en project_members', 'insert into public.project_members (organization_id, project_id, user_id, role_id) values (''' || t.fx('org_a') || ''', ''' || t.fx('p1') || ''', ''' || t.uid('member_a') || ''', private.role_id(''project'',''viewer''))', '42501');

  -- ---- Fases ----
  perform t.as_user('pm_a');
  v_p := public.create_project(t.fx('org_a'), 'PH-1', 'Con fases', t.uid('pm_a'), 'predictive');
  declare v_a uuid; v_b uuid; v_d uuid; begin
    insert into public.project_phases (organization_id, project_id, name) values (t.fx('org_a'), v_p, 'Inicio') returning id into v_a;
    insert into public.project_phases (organization_id, project_id, name) values (t.fx('org_a'), v_p, 'Planificación') returning id into v_b;
    insert into public.project_phases (organization_id, project_id, name) values (t.fx('org_a'), v_p, 'Ejecución') returning id into v_d;
    perform t.eq('posiciones asignadas 1,2,3', (select string_agg(position::text, ',' order by position) from public.project_phases where project_id = v_p), '1,2,3');
    perform t.lives('reordena', 'select public.reorder_project_phases(''' || v_p || ''', array[''' || v_d || ''',''' || v_a || ''',''' || v_b || ''']::uuid[])');
    perform t.eq('nuevo orden Ejecución, Inicio, Planificación', (select string_agg(name, ',' order by position) from public.project_phases where project_id = v_p), 'Ejecución,Inicio,Planificación');
    perform t.throws('reordenar con conjunto incompleto', 'select public.reorder_project_phases(''' || v_p || ''', array[''' || v_a || ''']::uuid[])', 'phase_set_mismatch');
    perform t.throws('reordenar con fase repetida', 'select public.reorder_project_phases(''' || v_p || ''', array[''' || v_a || ''',''' || v_a || ''',''' || v_b || ''']::uuid[])', 'phase_set_mismatch');
    perform t.throws('reordenar con fase ajena', 'select public.reorder_project_phases(''' || v_p || ''', array[''' || v_a || ''',''' || v_b || ''',gen_random_uuid()]::uuid[])', 'phase_set_mismatch');
    perform t.throws('la posición no se escribe directamente', 'update public.project_phases set position = 9 where id = ''' || v_a || '''', '42501');
    perform t.as_user('member_a');
    perform t.eq('member lee fases', t.count_of('select 1 from public.project_phases where project_id = ''' || v_p || ''''), 3::bigint);
    perform t.throws('member no crea fases', 'insert into public.project_phases (organization_id, project_id, name) values (''' || t.fx('org_a') || ''', ''' || v_p || ''', ''X fase'')', '42501');
    perform t.as_user('pm_a');
    perform t.eq('PM borra una fase', t.affected('delete from public.project_phases where id = ''' || v_b || ''''), 1::bigint);
  end;
  perform t.reset();
end $$;
