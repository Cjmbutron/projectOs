-- Quién asigna recursos a las actividades: schedule.edit o cualquier miembro interno del proyecto con
-- rol de escritura (migraciones 2600 y 2700).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_mine uuid; v_other uuid; v_r uuid; v_as uuid; v_v uuid;
  v_ins text := 'insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)';
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'ASG-P', 'Miembros asignan', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('portfolio_a'), private.role_id('project', 'viewer'));
  insert into public.activities (organization_id, project_id, name, duration, assignee_id) values (v_org, v_p, 'Mía', 3, t.uid('member_a')) returning id into v_mine;
  insert into public.activities (organization_id, project_id, name, duration, assignee_id) values (v_org, v_p, 'De otro', 3, t.uid('auditor_a')) returning id into v_other;
  insert into public.resources (organization_id, name) values (v_org, 'Recurso ASG') returning id into v_r;

  -- Un colaborador (contributor) asigna en su actividad y en la de otro
  perform t.as_user('member_a');
  perform t.lives('un miembro asigna en su actividad', format(v_ins, v_org, v_p, v_mine, v_r));
  perform t.lives('un miembro asigna también en la actividad de otro', format(v_ins, v_org, v_p, v_other, v_r));
  select id into v_as from public.activity_resources where activity_id = v_other;
  perform t.lives('cambia la dedicación en la de otro', format('update public.activity_resources set allocation_percent = 30 where id = %L', v_as));
  perform t.lives('quita la asignación de la de otro', format('delete from public.activity_resources where id = %L', v_as));
  perform t.lives('quita la suya', format('delete from public.activity_resources where activity_id = %L', v_mine));

  -- Un lector (viewer) no asigna ni cambia
  perform t.as_user('pm_a');
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (v_org, v_p, v_other, v_r) returning id into v_as;
  perform t.as_user('portfolio_a');
  perform t.throws('un viewer no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');
  perform t.eq('un viewer no cambia asignaciones (0 filas)', t.affected(format('update public.activity_resources set allocation_percent = 5 where id = %L', v_as)), 0::bigint);
  perform t.eq('un viewer no quita asignaciones (0 filas)', t.affected(format('delete from public.activity_resources where id = %L', v_as)), 0::bigint);

  -- Un cliente/stakeholder (solo lectura) tampoco asigna
  perform t.as_user('pm_a');
  perform public.remove_project_member(v_p, t.uid('portfolio_a'));
  perform public.add_project_member(v_p, t.uid('portfolio_a'), private.role_id('project', 'client_stakeholder'));
  perform t.as_user('portfolio_a');
  perform t.throws('un client_stakeholder no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');

  -- Quien edita el cronograma por permiso de organización asigna sin ser miembro del proyecto
  perform t.as_user('owner_a');
  perform t.lives('el owner de la organización asigna (schedule.edit)', format(v_ins, v_org, v_p, v_mine, v_r));
  perform t.as_user('pm_a');
  perform t.lives('limpieza', format('delete from public.activity_resources where activity_id = %L', v_mine));

  -- La función pública para la interfaz coincide con lo que permite RLS
  perform t.as_user('pm_a');        perform t.eq('PM: la interfaz ofrece asignar', public.can_assign_resources(v_p), true);
  perform t.as_user('auditor_a');   perform t.eq('contributor: la interfaz ofrece asignar', public.can_assign_resources(v_p), true);
  perform t.as_user('portfolio_a'); perform t.eq('client_stakeholder: no la ofrece', public.can_assign_resources(v_p), false);
  perform t.as_user('owner_b');     perform t.eq('otra organización: no la ofrece', public.can_assign_resources(v_p), false);
  perform t.as_user('pm_a');        perform t.eq('proyecto inexistente: falso', public.can_assign_resources(gen_random_uuid()), false);

  -- Un miembro suspendido en la organización deja de asignar
  perform t.reset();
  update public.organization_members set status = 'suspended', suspended_at = now() where organization_id = v_org and user_id = t.uid('member_a');
  perform t.as_user('member_a');
  perform t.throws('un miembro suspendido no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');
  perform t.reset();
  update public.organization_members set status = 'active', suspended_at = null where organization_id = v_org and user_id = t.uid('member_a');

  -- Quitado del proyecto, deja de asignar
  perform t.as_user('pm_a');
  perform public.remove_project_member(v_p, t.uid('member_a'));
  perform t.as_user('member_a');
  perform t.throws('quien ya no es miembro del proyecto no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');

  -- Un externo (invitado) tampoco asigna, aunque sea miembro del proyecto
  perform t.as_user('pm_a');
  perform public.add_project_member(v_p, t.uid('ext_a'), private.role_id('project', 'contributor'));
  perform t.as_user('ext_a');
  perform t.throws('un externo no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');

  -- Proyecto en la papelera: nadie sin permiso asigna
  perform t.as_user('pm_a');
  perform t.lives('el PM sigue asignando', format('delete from public.activity_resources where id = %L', v_as));
  perform t.as_anon();
  perform t.throws('anónimo no ejecuta el helper', format('select private.can_assign_resources(%L, %L)', v_p, v_mine), '42501');
  perform t.reset();
end $$;
