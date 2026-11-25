-- Matriz RACI por entregable (migración 2800).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_d uuid; v_d2 uuid; v_pc uuid; v_dc uuid;
  v_m uuid; v_t uuid; v_x uuid; v_ext uuid;
  v_set text := 'select public.raci_set_cell(%L, %L, %L::text[])';
  v_roles text;
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'RACI-1', 'Matriz RACI', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  v_m := t.uid('member_a'); v_t := t.uid('auditor_a'); v_x := t.uid('pm_a'); v_ext := t.uid('ext_a');
  insert into public.deliverables (organization_id, project_id, name) values (v_org, v_p, 'Informe') returning id into v_d;
  insert into public.deliverables (organization_id, project_id, name) values (v_org, v_p, 'Manual') returning id into v_d2;

  create or replace function pg_temp.roles(p_d uuid, p_u uuid) returns text language sql as $f$
    select coalesce(string_agg(role, '' order by role), '-') from public.raci_assignments where deliverable_id = p_d and user_id = p_u
  $f$;

  -- ---- Asignar y reemplazar ----
  perform t.lives('PM asigna R', format(v_set, v_d, v_m, '{R}'));
  perform t.eq('queda R', pg_temp.roles(v_d, v_m), 'R');
  perform t.lives('cambia a C (reemplaza, no suma)', format(v_set, v_d, v_m, '{C}'));
  perform t.eq('solo C', pg_temp.roles(v_d, v_m), 'C');
  perform t.lives('R y A en la misma persona', format(v_set, v_d, v_t, '{R,A}'));
  perform t.eq('queda AR', pg_temp.roles(v_d, v_t), 'AR');
  perform t.lives('repetidos se normalizan', format(v_set, v_d, v_ext, '{I,I}'));
  perform t.eq('queda I', pg_temp.roles(v_d, v_ext), 'I');
  perform t.lives('repetir lo mismo no falla', format(v_set, v_d, v_ext, '{I}'));
  perform t.eq('sigue una sola fila', t.count_of(format('select 1 from public.raci_assignments where deliverable_id = %L and user_id = %L', v_d, v_ext)), 1::bigint);

  -- ---- Un solo aprobador por entregable ----
  perform t.throws('segundo A en el mismo entregable', format(v_set, v_d, v_m, '{A}'), 'raci_accountable_taken');
  perform t.eq('el rechazo no cambió nada', pg_temp.roles(v_d, v_m), 'C');
  perform t.lives('el mismo aprobador puede repetirse', format(v_set, v_d, v_t, '{A}'));
  perform t.eq('pasa a solo A', pg_temp.roles(v_d, v_t), 'A');
  perform t.lives('otro entregable puede tener otro A', format(v_set, v_d2, v_m, '{A}'));
  perform t.lives('quitar al aprobador…', format(v_set, v_d, v_t, '{}'));
  perform t.lives('…libera el A para otra persona', format(v_set, v_d, v_m, '{A}'));
  perform t.eq('un único A en el entregable', t.count_of(format('select 1 from public.raci_assignments where deliverable_id = %L and role = ''A''', v_d)), 1::bigint);

  -- ---- Combinaciones inválidas ----
  perform t.throws('C con I', format(v_set, v_d, v_t, '{C,I}'), 'invalid_raci');
  perform t.throws('R con C', format(v_set, v_d, v_t, '{R,C}'), 'invalid_raci');
  perform t.throws('A con I', format(v_set, v_d, v_t, '{A,I}'), 'invalid_raci');
  perform t.throws('letra desconocida', format(v_set, v_d, v_t, '{X}'), 'invalid_raci');
  perform t.throws('minúscula no vale', format(v_set, v_d, v_t, '{r}'), 'invalid_raci');
  perform t.eq('nada se guardó de lo inválido', pg_temp.roles(v_d, v_t), '-');
  perform t.lives('NULL equivale a quitar', format('select public.raci_set_cell(%L, %L, null)', v_d, v_ext));
  perform t.eq('quitado', pg_temp.roles(v_d, v_ext), '-');

  -- ---- Solo miembros del proyecto ----
  perform t.throws('no miembro', format(v_set, v_d, t.uid('portfolio_a'), '{R}'), 'raci_not_member');
  perform t.throws('persona de otra organización', format(v_set, v_d, t.uid('member_b'), '{R}'), 'raci_not_member');
  perform t.throws('entregable inexistente', format(v_set, gen_random_uuid(), v_m, '{R}'), 'raci_deliverable_not_found');

  -- ---- Quién escribe ----
  perform t.as_user('auditor_a');
  perform t.lives('el líder técnico (scope.edit) asigna', format(v_set, v_d2, v_t, '{R}'));
  perform t.as_user('member_a');
  perform t.throws('un colaborador no asigna', format(v_set, v_d, v_m, '{R}'), '42501');
  perform t.throws('ni se quita a sí mismo', format(v_set, v_d, v_m, '{}'), '42501');
  perform t.as_user('ext_a');
  perform t.throws('un visor no asigna', format(v_set, v_d, v_ext, '{R}'), '42501');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no asigna', format(v_set, v_d, v_m, '{R}'), '42501');
  perform t.as_anon();
  perform t.throws('sin sesión no asigna', format(v_set, v_d, v_m, '{R}'));

  -- ---- Lectura ----
  perform t.as_user('member_a');
  perform t.eq('un colaborador lee la matriz', t.count_of(format('select 1 from public.raci_assignments where project_id = %L', v_p)) > 0, true);
  perform t.as_user('ext_a');
  perform t.eq('un visor lee la matriz', t.count_of(format('select 1 from public.raci_assignments where project_id = %L', v_p)) > 0, true);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve nada', t.count_of(format('select 1 from public.raci_assignments where project_id = %L', v_p)), 0::bigint);
  perform t.as_user('portfolio_a');
  perform t.eq('un miembro de la organización sin rol en el proyecto lo lee (visibilidad por defecto)', t.count_of(format('select 1 from public.raci_assignments where project_id = %L', v_p)) > 0, true);

  -- ---- Escritura directa cerrada ----
  perform t.as_user('pm_a');
  perform t.throws('no se inserta directo', format('insert into public.raci_assignments (organization_id, project_id, deliverable_id, user_id, role) values (%L,%L,%L,%L,''I'')', v_org, v_p, v_d, v_ext), '42501');
  perform t.throws('no se borra directo', 'delete from public.raci_assignments', '42501');
  perform t.throws('no se edita directo', 'update public.raci_assignments set role = ''I''', '42501');

  -- ---- Cascadas ----
  perform t.lives('R para después quitar al miembro', format(v_set, v_d2, v_m, '{I}'));
  perform t.lives('el PM saca a un miembro del proyecto', format('select public.remove_project_member(%L, %L)', v_p, v_m));
  perform t.eq('sus filas se fueron', t.count_of(format('select 1 from public.raci_assignments where project_id = %L and user_id = %L', v_p, v_m)), 0::bigint);
  perform t.lives('borrar un entregable', format('delete from public.deliverables where id = %L', v_d2));
  perform t.eq('sus filas se fueron', t.count_of(format('select 1 from public.raci_assignments where deliverable_id = %L', v_d2)), 0::bigint);

  -- ---- Proyecto cerrado ----
  v_pc := public.create_project(v_org, 'RACI-2', 'Cerrado', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_pc, t.uid('member_a'), private.role_id('project', 'contributor'));
  insert into public.deliverables (organization_id, project_id, name) values (v_org, v_pc, 'Z') returning id into v_dc;
  perform t.lives('antes de cerrar se asigna', format(v_set, v_dc, t.uid('member_a'), '{R}'));
  perform public.change_project_status(v_pc, 'proposed');
  perform public.change_project_status(v_pc, 'approved');
  perform public.change_project_status(v_pc, 'planning');
  perform public.change_project_status(v_pc, 'executing');
  perform public.change_project_status(v_pc, 'closing');
  perform public.change_project_status(v_pc, 'closed');
  perform t.throws('cerrado: no se cambia la matriz', format(v_set, v_dc, t.uid('member_a'), '{C}'), 'project_read_only');
  perform t.throws('cerrado: no se quita a nadie', format(v_set, v_dc, t.uid('member_a'), '{}'), 'project_read_only');
  select string_agg(role, '') into v_roles from public.raci_assignments where deliverable_id = v_dc;
  perform t.eq('cerrado: queda como estaba', v_roles, 'R');
  -- ---- can_edit_scope (la usa la interfaz) ----
  perform t.as_user('pm_a');
  perform t.ok('PM puede editar el alcance', public.can_edit_scope(v_p));
  perform t.as_user('auditor_a');
  perform t.ok('el líder técnico también', public.can_edit_scope(v_p));
  perform t.as_user('member_a');
  perform t.ok('un colaborador no (ya salió del proyecto, pero lo lee por la organización)', not public.can_edit_scope(v_p));
  perform t.as_user('ext_a');
  perform t.ok('un visor no', not public.can_edit_scope(v_p));
  perform t.as_user('owner_b');
  perform t.ok('otra organización no', not public.can_edit_scope(v_p));
  perform t.ok('proyecto inexistente: falso', not public.can_edit_scope(gen_random_uuid()));
  perform t.as_anon();
  perform t.throws('sin sesión no se puede llamar', format('select public.can_edit_scope(%L)', v_p), '42501');

  -- ---- Auditoría ----
  perform t.reset();
  -- Respaldo de la regla del aprobador único, aun saltándose la función (por ejemplo, dos sesiones a la vez)
  perform t.lives('(sin pasar por la función) un primer A', format('insert into public.raci_assignments (organization_id, project_id, deliverable_id, user_id, role) values (%L,%L,%L,%L,''A'')', v_org, v_p, v_d, v_t));
  perform t.throws('el índice impide dos A aunque se salte la función', format('insert into public.raci_assignments (organization_id, project_id, deliverable_id, user_id, role) values (%L,%L,%L,%L,''A'')', v_org, v_p, v_d, v_ext), '23505');
  perform t.eq('las asignaciones quedan auditadas', (select count(*) > 0 from public.audit_log where entity_table = 'raci_assignments' and action = 'insert'), true);
  perform t.eq('y los retiros también', (select count(*) > 0 from public.audit_log where entity_table = 'raci_assignments' and action = 'delete'), true);

end $$;
