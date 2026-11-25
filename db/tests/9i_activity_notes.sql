-- Notas en las actividades (migración 2900).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_p2 uuid; v_a uuid; v_a2 uuid; v_other uuid; v_n1 uuid; v_n2 uuid; v_n3 uuid; v_pc uuid; v_ac uuid; v_nc uuid; v_t1 timestamptz;
  v_ins text := 'insert into public.activity_notes (organization_id, project_id, activity_id, body) values (%L, %L, %L, %L)';
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'NOT-1', 'Notas', t.uid('pm_a'), 'predictive');
  v_p2 := public.create_project(v_org, 'NOT-2', 'Otro proyecto', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'team_lead'));
  perform public.add_project_member(v_p, t.uid('portfolio_a'), private.role_id('project', 'viewer'));
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'viewer'));
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Act 1', 3) returning id into v_a;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p, 'Act 2', 3) returning id into v_a2;
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_p2, 'Act otro', 3) returning id into v_other;

  -- ---- Escribir ----
  perform t.as_user('member_a');
  perform t.lives('un colaborador escribe una nota', format(v_ins, v_org, v_p, v_a, '  Revisar con el cliente  '));
  select id into v_n1 from public.activity_notes where activity_id = v_a;
  perform t.eq('queda a su nombre', (select author_id = t.uid('member_a') from public.activity_notes where id = v_n1), true);
  perform t.eq('el texto se guarda como se escribió', (select body from public.activity_notes where id = v_n1), '  Revisar con el cliente  ');
  perform t.throws('no admite nota vacía', format(v_ins, v_org, v_p, v_a, ''), '23514');
  perform t.throws('ni solo espacios', format(v_ins, v_org, v_p, v_a, E'  \n '), '23514');
  perform t.lives('2000 caracteres sí', format(v_ins, v_org, v_p, v_a, repeat('x', 2000)));
  perform t.throws('2001 no', format(v_ins, v_org, v_p, v_a, repeat('x', 2001)), '23514');
  perform t.throws('no se puede poner otro autor', format('insert into public.activity_notes (organization_id, project_id, activity_id, body, author_id) values (%L,%L,%L,''x'',%L)', v_org, v_p, v_a, t.uid('pm_a')), '42501');
  perform t.throws('una actividad de otro proyecto no vale', format(v_ins, v_org, v_p, v_other, 'x'), '23503');
  perform t.throws('organización que no es la del proyecto', format(v_ins, t.fx('org_b'), v_p, v_a, 'x'), '23503');
  perform t.as_user('auditor_a');
  perform t.lives('el líder técnico escribe', format(v_ins, v_org, v_p, v_a, 'Nota del líder'));
  select id into v_n2 from public.activity_notes where author_id = t.uid('auditor_a');
  perform t.as_user('pm_a');
  perform t.lives('el PM escribe', format(v_ins, v_org, v_p, v_a, 'Nota del PM'));
  select id into v_n3 from public.activity_notes where author_id = t.uid('pm_a');

  -- ---- Quién no escribe ----
  perform t.as_user('portfolio_a');
  perform t.throws('un visor no escribe', format(v_ins, v_org, v_p, v_a, 'x'), '42501');
  perform t.as_user('ext_a');
  perform t.throws('un externo no escribe', format(v_ins, v_org, v_p, v_a, 'x'), '42501');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no escribe', format(v_ins, v_org, v_p, v_a, 'x'), '42501');
  perform t.as_anon();
  perform t.throws('sin sesión no escribe', format(v_ins, v_org, v_p, v_a, 'x'));

  -- ---- Leer ----
  perform t.as_user('member_a');
  perform t.eq('un colaborador ve las notas de todos', t.count_of(format('select 1 from public.activity_notes where activity_id = %L', v_a)), 4::bigint);
  perform t.as_user('portfolio_a');
  perform t.eq('un visor interno las lee', t.count_of(format('select 1 from public.activity_notes where activity_id = %L', v_a)), 4::bigint);
  perform t.as_user('ext_a');
  perform t.eq('un externo no ve ninguna', t.count_of('select 1 from public.activity_notes'), 0::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve ninguna', t.count_of('select 1 from public.activity_notes'), 0::bigint);
  perform t.as_anon();
  perform t.throws('sin sesión no lee', 'select 1 from public.activity_notes', '42501');

  -- ---- Editar ----
  -- (dentro de una transacción now() no avanza: se retrocede la nota un día para ver el cambio)
  perform t.reset();
  alter table public.activity_notes disable trigger activity_notes_touch;
  update public.activity_notes set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = v_n1;
  alter table public.activity_notes enable trigger activity_notes_touch;
  perform t.as_user('member_a');
  select updated_at into v_t1 from public.activity_notes where id = v_n1;
  perform t.lives('el autor edita su nota', format('update public.activity_notes set body = ''Revisado'' where id = %L', v_n1));
  perform t.eq('quedó editada', (select body from public.activity_notes where id = v_n1), 'Revisado');
  perform t.eq('la fecha de edición cambió', (select updated_at > v_t1 from public.activity_notes where id = v_n1), true);
  perform t.eq('la de creación no', (select created_at < updated_at from public.activity_notes where id = v_n1), true);
  perform t.eq('no edita la de otro (0 filas)', t.affected(format('update public.activity_notes set body = ''hack'' where id = %L', v_n2)), 0::bigint);
  perform t.throws('solo se edita el texto (autor)', format('update public.activity_notes set author_id = %L where id = %L', t.uid('pm_a'), v_n1), '42501');
  perform t.throws('solo se edita el texto (actividad)', format('update public.activity_notes set activity_id = %L where id = %L', v_a2, v_n1), '42501');
  perform t.throws('ni se vacía', format('update public.activity_notes set body = '''' where id = %L', v_n1), '23514');
  perform t.as_user('pm_a');
  perform t.eq('ni el PM edita la de otro (0 filas)', t.affected(format('update public.activity_notes set body = ''hack'' where id = %L', v_n1)), 0::bigint);

  -- ---- Borrar ----
  perform t.as_user('member_a');
  perform t.eq('un colaborador no borra la de otro (0 filas)', t.affected(format('delete from public.activity_notes where id = %L', v_n2)), 0::bigint);
  perform t.as_user('portfolio_a');
  perform t.eq('un visor no borra (0 filas)', t.affected(format('delete from public.activity_notes where id = %L', v_n1)), 0::bigint);
  perform t.as_user('member_a');
  perform t.eq('borra la suya', t.affected(format('delete from public.activity_notes where id = %L', v_n1)), 1::bigint);
  perform t.as_user('pm_a');
  perform t.eq('el PM borra la de otro', t.affected(format('delete from public.activity_notes where id = %L', v_n2)), 1::bigint);
  perform t.as_user('auditor_a');
  perform t.lives('el líder técnico escribe otra', format(v_ins, v_org, v_p, v_a, 'Otra del líder'));
  perform t.eq('el líder técnico (schedule.edit) borra la del PM', t.affected(format('delete from public.activity_notes where id = %L', v_n3)), 1::bigint);

  -- ---- Salir del proyecto ----
  perform t.as_user('pm_a');
  perform t.lives('el PM saca al colaborador', format('select public.remove_project_member(%L, %L)', v_p, t.uid('member_a')));
  perform t.as_user('member_a');
  perform t.throws('quien salió no escribe', format(v_ins, v_org, v_p, v_a, 'x'), '42501');
  perform t.eq('ni edita las suyas (0 filas)', t.affected(format('update public.activity_notes set body = ''z'' where author_id = %L', t.uid('member_a'))), 0::bigint);
  perform t.eq('ni borra las suyas (0 filas)', t.affected(format('delete from public.activity_notes where author_id = %L', t.uid('member_a'))), 0::bigint);
  perform t.ok('sus notas siguen ahí', t.count_of(format('select 1 from public.activity_notes where author_id = %L', t.uid('member_a'))) > 0);

  -- ---- can_write_notes (la usa la interfaz) ----
  perform t.as_user('pm_a');
  perform t.ok('PM puede', public.can_write_notes(v_p));
  perform t.as_user('auditor_a');
  perform t.ok('líder técnico puede', public.can_write_notes(v_p));
  perform t.as_user('portfolio_a');
  perform t.ok('visor no', not public.can_write_notes(v_p));
  perform t.as_user('ext_a');
  perform t.ok('externo no', not public.can_write_notes(v_p));
  perform t.as_user('owner_b');
  perform t.ok('otra organización no', not public.can_write_notes(v_p));
  perform t.ok('proyecto inexistente: falso', not public.can_write_notes(gen_random_uuid()));

  -- ---- Cascada ----
  perform t.as_user('pm_a');
  perform t.lives('nota en otra actividad', format(v_ins, v_org, v_p, v_a2, 'Se va con la actividad'));
  perform t.lives('se borra la actividad', format('delete from public.activities where id = %L', v_a2));
  perform t.eq('sus notas se fueron', t.count_of(format('select 1 from public.activity_notes where activity_id = %L', v_a2)), 0::bigint);

  -- ---- Proyecto cerrado: solo lectura ----
  v_pc := public.create_project(v_org, 'NOT-3', 'Cerrado', t.uid('pm_a'), 'predictive');
  insert into public.activities (organization_id, project_id, name, duration) values (v_org, v_pc, 'Z', 1) returning id into v_ac;
  perform t.lives('nota antes de cerrar', format(v_ins, v_org, v_pc, v_ac, 'Antes'));
  select id into v_nc from public.activity_notes where activity_id = v_ac;
  perform public.change_project_status(v_pc, 'proposed');
  perform public.change_project_status(v_pc, 'approved');
  perform public.change_project_status(v_pc, 'planning');
  perform public.change_project_status(v_pc, 'executing');
  perform public.change_project_status(v_pc, 'closing');
  perform public.change_project_status(v_pc, 'closed');
  perform t.throws('cerrado: no se escribe', format(v_ins, v_org, v_pc, v_ac, 'Después'), '42501');
  perform t.eq('cerrado: no se edita (0 filas)', t.affected(format('update public.activity_notes set body = ''x'' where id = %L', v_nc)), 0::bigint);
  perform t.eq('cerrado: no se borra (0 filas)', t.affected(format('delete from public.activity_notes where id = %L', v_nc)), 0::bigint);
  perform t.eq('cerrado: sigue legible', t.count_of(format('select 1 from public.activity_notes where id = %L', v_nc)), 1::bigint);

  -- ---- Auditoría ----
  perform t.reset();
  perform t.eq('altas auditadas', (select count(*) > 0 from public.audit_log where entity_table = 'activity_notes' and action = 'insert'), true);
  perform t.eq('cambios auditados', (select count(*) > 0 from public.audit_log where entity_table = 'activity_notes' and action = 'update'), true);
  perform t.eq('borrados auditados', (select count(*) > 0 from public.audit_log where entity_table = 'activity_notes' and action = 'delete'), true);
end $$;
