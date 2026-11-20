-- WBS (US-016) y entregables (US-017).
create function t.wbs(p_project uuid) returns text language sql security definer as $$
  select string_agg(code || ' ' || name, ' | ' order by string_to_array(code, '.')::int[]) from public.wbs_nodes where project_id = p_project
$$;

do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_1 uuid; v_2 uuid; v_3 uuid; v_11 uuid; v_12 uuid; v_111 uuid; v_other uuid;
  v_d uuid; v_n bigint; v_x uuid; v_deep uuid; i integer; v_step text;
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'WBS-1', 'WBS', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  perform t.fx_set('wbs', v_p);

  -- ---- Construcción y códigos automáticos ----
  v_1 := public.wbs_add_node(v_p, null, 'Gestión');
  v_2 := public.wbs_add_node(v_p, null, 'Desarrollo');
  v_3 := public.wbs_add_node(v_p, null, 'Cierre');
  v_11 := public.wbs_add_node(v_p, v_2, 'Backend');
  v_12 := public.wbs_add_node(v_p, v_2, 'Frontend');
  v_111 := public.wbs_add_node(v_p, v_11, 'API');
  perform t.eq('códigos jerárquicos automáticos', t.wbs(v_p), '1 Gestión | 2 Desarrollo | 2.1 Backend | 2.1.1 API | 2.2 Frontend | 3 Cierre');

  -- Insertar en una posición recodifica a los hermanos y a sus descendientes
  v_x := public.wbs_add_node(v_p, null, 'Alcance', null, 1);
  perform t.eq('insertar al inicio recodifica todo el subárbol', t.wbs(v_p), '1 Alcance | 2 Gestión | 3 Desarrollo | 3.1 Backend | 3.1.1 API | 3.2 Frontend | 4 Cierre');

  -- Muchas inserciones al inicio del mismo padre: el orden resultante es determinista
  -- (created_at es igual dentro de una transacción; nada debe depender del desempate por id).
  for i in 1 .. 12 loop perform public.wbs_add_node(v_p, v_3, 'C' || i, null, 1); end loop;
  perform t.eq('insertar siempre al inicio deja el orden inverso', (select string_agg(name, ',' order by position) from public.wbs_nodes where parent_id = v_3),
               'C12,C11,C10,C9,C8,C7,C6,C5,C4,C3,C2,C1');
  perform t.eq('posiciones contiguas', (select max(position) - min(position) + 1 - count(*) from public.wbs_nodes where parent_id = v_3), 0::bigint);
  for i in 1 .. 12 loop perform public.wbs_delete_node((select id from public.wbs_nodes where parent_id = v_3 limit 1)); end loop;
  perform t.eq('se vació el padre', (select count(*) from public.wbs_nodes where parent_id = v_3), 0::bigint);

  -- Contrato de posiciones que usa la interfaz: "bajar" = pedir posición i+3; "subir" = i; "desangrar" = posición del padre + 1
  for i in 1 .. 3 loop perform public.wbs_add_node(v_p, v_3, 'D' || i); end loop;
  perform public.wbs_move_node((select id from public.wbs_nodes where parent_id = v_3 and name = 'D1'), v_3, 3);
  perform t.eq('bajar (posición i+3) intercambia con el siguiente', (select string_agg(name, ',' order by position) from public.wbs_nodes where parent_id = v_3), 'D2,D1,D3');
  perform public.wbs_move_node((select id from public.wbs_nodes where parent_id = v_3 and name = 'D3'), v_3, 2);
  perform t.eq('subir (posición i) intercambia con el anterior', (select string_agg(name, ',' order by position) from public.wbs_nodes where parent_id = v_3), 'D2,D3,D1');
  perform public.wbs_move_node((select id from public.wbs_nodes where parent_id = v_3 and name = 'D3'), null, (select position + 1 from public.wbs_nodes where id = v_3));
  perform t.eq('desangrar: queda justo después de su padre', (select string_agg(name, ',' order by string_to_array(code, '.')::int[]) from public.wbs_nodes where project_id = v_p and (name = 'D3' or id = v_3)), 'Cierre,D3');
  perform t.eq('el desangrado quedó inmediatamente después', (select (select code from public.wbs_nodes where id = v_3)::int + 1 = (select code from public.wbs_nodes where name = 'D3' and project_id = v_p)::int), true);
  for i in 1 .. 3 loop perform public.wbs_delete_node((select id from public.wbs_nodes where project_id = v_p and name in ('D1','D2','D3') limit 1)); end loop;

  -- Mover: reordenar dentro del mismo padre
  perform public.wbs_move_node(v_12, v_2, 1);
  perform t.eq('reordenar recodifica', t.wbs(v_p), '1 Alcance | 2 Gestión | 3 Desarrollo | 3.1 Frontend | 3.2 Backend | 3.2.1 API | 4 Cierre');
  -- Mover a otro padre (con su subárbol)
  perform public.wbs_move_node(v_11, v_1, null);
  perform t.eq('mover subárbol a otro padre', t.wbs(v_p), '1 Alcance | 2 Gestión | 2.1 Backend | 2.1.1 API | 3 Desarrollo | 3.1 Frontend | 4 Cierre');
  -- Mover a la raíz, al final
  perform public.wbs_move_node(v_111, null, null);
  perform t.eq('mover a la raíz al final', t.wbs(v_p), '1 Alcance | 2 Gestión | 2.1 Backend | 3 Desarrollo | 3.1 Frontend | 4 Cierre | 5 API');

  -- Ciclos
  perform t.throws('no se mueve bajo sí mismo', format('select public.wbs_move_node(%L, %L, 1)', v_1, v_1), 'wbs_cycle');
  perform t.throws('no se mueve bajo un descendiente', format('select public.wbs_move_node(%L, %L, 1)', v_1, v_11), 'wbs_cycle');
  perform t.eq('un movimiento rechazado no cambia nada', t.wbs(v_p), '1 Alcance | 2 Gestión | 2.1 Backend | 3 Desarrollo | 3.1 Frontend | 4 Cierre | 5 API');

  -- Borrado
  perform t.throws('no se borra un nodo con hijos', format('select public.wbs_delete_node(%L)', v_1), 'wbs_has_children');
  perform public.wbs_delete_node(v_111);
  perform t.eq('borrar una hoja recodifica', t.wbs(v_p), '1 Alcance | 2 Gestión | 2.1 Backend | 3 Desarrollo | 3.1 Frontend | 4 Cierre');
  perform public.wbs_delete_node(v_x);
  perform t.reset();
  perform t.throws('borrado directo con hijos bloqueado por la base de datos', format('delete from public.wbs_nodes where id = %L', v_2), '23503');
  perform t.as_user('pm_a');

  -- Datos incorrectos
  perform t.throws('padre inexistente', format('select public.wbs_add_node(%L, %L, ''x'')', v_p, gen_random_uuid()), 'wbs_node_not_found');
  perform t.throws('nombre vacío', format('select public.wbs_add_node(%L, null, ''  '')', v_p), '23514');
  perform t.throws('nodo de otro proyecto no puede ser padre', format('select public.wbs_add_node(%L, %L, ''x'')', t.fx('imp'), v_2), 'wbs_node_not_found');

  -- Profundidad: 10 niveles sí, 11 no
  v_deep := public.wbs_add_node(v_p, null, 'N1');
  for i in 2 .. 10 loop v_deep := public.wbs_add_node(v_p, v_deep, 'N' || i); end loop;
  perform t.throws('más de 10 niveles', format('select public.wbs_add_node(%L, %L, ''N11'')', v_p, v_deep), 'wbs_too_deep');
  perform t.eq('el nivel 10 quedó creado', (select max(array_length(string_to_array(code, '.'), 1)) from public.wbs_nodes where project_id = v_p), 10);

  -- ---- Edición directa: solo nombre y descripción ----
  perform t.lives('renombrar', format('update public.wbs_nodes set name = ''Backend v2'' where id = %L', v_11));
  perform t.throws('el código no se edita a mano', format('update public.wbs_nodes set code = ''9'' where id = %L', v_11), '42501');
  perform t.throws('la posición no se edita a mano', format('update public.wbs_nodes set position = 9 where id = %L', v_11), '42501');
  perform t.throws('el padre no se edita a mano', format('update public.wbs_nodes set parent_id = null where id = %L', v_11), '42501');
  perform t.throws('no hay INSERT directo', format('insert into public.wbs_nodes (organization_id, project_id, position, name) values (%L, %L, 1, ''x'')', v_org, v_p), '42501');
  perform t.throws('no hay DELETE directo', format('delete from public.wbs_nodes where id = %L', v_3), '42501');

  -- ---- Entregables ----
  v_other := public.wbs_add_node(t.fx('imp'), null, 'Nodo de otro proyecto');
  insert into public.deliverables (organization_id, project_id, wbs_node_id, name, acceptance_criteria, responsible_id)
  values (v_org, v_p, v_11, 'Manual de usuario', 'Revisado por el cliente', t.uid('member_a')) returning id into v_d;
  perform t.eq('estados iniciales independientes', (select authoring_status || '/' || review_status from public.deliverables where id = v_d), 'draft/pending');
  perform t.lives('elaboración avanza sin tocar la revisión', format('update public.deliverables set authoring_status = ''completed'' where id = %L', v_d));
  perform t.eq('la revisión sigue pendiente', (select review_status from public.deliverables where id = v_d), 'pending');
  perform t.lives('PM (scope.review) acepta', format('update public.deliverables set review_status = ''accepted'' where id = %L', v_d));
  perform t.throws('estado inválido', format('update public.deliverables set review_status = ''ok'' where id = %L', v_d), '23514');
  perform t.throws('entregable no puede apuntar a un nodo de otro proyecto', format('update public.deliverables set wbs_node_id = %L where id = %L', v_other, v_d), '23503');

  perform t.as_user('auditor_a');  -- team_lead: scope.edit pero NO scope.review
  perform t.lives('team_lead elabora', format('update public.deliverables set authoring_status = ''in_progress'' where id = %L', v_d));
  perform t.throws('team_lead NO cambia la revisión (separación de funciones)', format('update public.deliverables set review_status = ''rejected'' where id = %L', v_d), 'forbidden');
  perform t.throws('team_lead NO crea ya aceptado', format('insert into public.deliverables (organization_id, project_id, name, review_status) values (%L, %L, ''x'', ''accepted'')', v_org, v_p), 'forbidden');
  perform t.lives('team_lead edita la WBS', format('select public.wbs_add_node(%L, null, ''Por team_lead'')', v_p));

  -- ---- Quién puede qué ----
  perform t.as_user('member_a');
  perform t.eq('contributor ve la WBS', t.count_of(format('select 1 from public.wbs_nodes where project_id = %L', v_p)) > 0, true);
  perform t.throws('contributor no agrega nodos', format('select public.wbs_add_node(%L, null, ''x'')', v_p), 'forbidden');
  perform t.throws('contributor no mueve', format('select public.wbs_move_node(%L, null, 1)', v_3), 'forbidden');
  perform t.throws('contributor no borra', format('select public.wbs_delete_node(%L)', v_3), 'forbidden');
  perform t.eq('contributor no renombra (0 filas)', (select t.affected(format('update public.wbs_nodes set name = ''hack'' where id = %L', v_3))), 0::bigint);
  perform t.throws('contributor no crea entregables', format('insert into public.deliverables (organization_id, project_id, name) values (%L, %L, ''x'')', v_org, v_p), '42501');
  perform t.eq('contributor no borra entregables (0 filas)', (select t.affected(format('delete from public.deliverables where id = %L', v_d))), 0::bigint);
  perform t.as_user('ext_a');
  perform t.throws('visor no agrega nodos', format('select public.wbs_add_node(%L, null, ''x'')', v_p), 'forbidden');
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve la WBS', t.count_of(format('select 1 from public.wbs_nodes where project_id = %L', v_p)), 0::bigint);
  perform t.eq('otra organización no ve entregables', t.count_of(format('select 1 from public.deliverables where project_id = %L', v_p)), 0::bigint);
  perform t.throws('otra organización no agrega nodos', format('select public.wbs_add_node(%L, null, ''x'')', v_p), 'forbidden');
  perform t.throws('otra organización no mueve nodos (no revela existencia)', format('select public.wbs_move_node(%L, null, 1)', v_3), 'forbidden');
  perform t.throws('otra organización no borra nodos', format('select public.wbs_delete_node(%L)', v_3), 'forbidden');
  perform t.as_anon();
  perform t.throws('anon no ejecuta funciones WBS', format('select public.wbs_add_node(%L, null, ''x'')', v_p), '42501');
  perform t.throws('anon no lee la tabla', 'select count(*) from public.wbs_nodes', '42501');

  -- Borrar un nodo deja sus entregables sin nodo (no los borra)
  perform t.as_user('pm_a');
  perform public.wbs_move_node(v_11, null, null);
  perform t.lives('borrar el nodo con entregable', format('select public.wbs_delete_node(%L)', v_11));
  perform t.eq('el entregable sobrevive sin nodo', (select count(*) from public.deliverables where id = v_d and wbs_node_id is null), 1::bigint);

  -- Auditoría
  perform t.reset();
  perform t.ok('la WBS y los entregables quedan en la bitácora',
    (select count(*) from public.audit_log where entity_table in ('wbs_nodes', 'deliverables') and organization_id = v_org) > 5);
  perform t.ok('un cambio de revisión queda con su valor anterior', exists (
    select 1 from public.audit_log where entity_table = 'deliverables' and entity_id = v_d::text
      and old_values ->> 'review_status' = 'pending' and new_values ->> 'review_status' = 'accepted'));

  -- Proyecto cerrado: solo lectura
  perform t.as_user('owner_a');
  foreach v_step in array array['proposed','approved','planning','executing','closing','closed'] loop
    perform public.change_project_status(v_p, v_step);
  end loop;
  perform t.as_user('pm_a');
  perform t.throws('cerrado: no se agregan nodos', format('select public.wbs_add_node(%L, null, ''x'')', v_p), 'project_read_only');
  perform t.throws('cerrado: no se mueven nodos', format('select public.wbs_move_node(%L, null, 1)', v_3), 'project_read_only');
  perform t.throws('cerrado: no se borran nodos', format('select public.wbs_delete_node(%L)', v_3), 'project_read_only');
  perform t.throws('cerrado: no se renombra', format('update public.wbs_nodes set name = ''z'' where id = %L', v_3), 'project_read_only');
  perform t.throws('cerrado: no se editan entregables', format('update public.deliverables set name = ''z'' where id = %L', v_d), 'project_read_only');
  perform t.reset();

  -- Purga del proyecto con WBS jerárquica (cascada con FK RESTRICT autorreferenciada)
  update public.projects set deleted_at = now() - interval '31 days' where id = v_p;
  perform t.as_service();
  perform t.lives('la purga de un proyecto con WBS anidada funciona', 'select public.purge_trashed_projects()');
  perform t.reset();
  perform t.eq('se llevó nodos y entregables', (select count(*) from public.wbs_nodes where project_id = v_p) + (select count(*) from public.deliverables where project_id = v_p), 0::bigint);
end $$;
