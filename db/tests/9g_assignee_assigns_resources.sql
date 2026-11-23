-- El responsable de una actividad asigna recursos solo a esa actividad (migración 2600).
do $$
declare
  v_org uuid := t.fx('org_a'); v_p uuid; v_mine uuid; v_other uuid; v_r uuid; v_as uuid;
  v_ins text := 'insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (%L, %L, %L, %L)';
begin
  perform t.as_user('pm_a');
  v_p := public.create_project(v_org, 'ASG-P', 'Responsable asigna', t.uid('pm_a'), 'predictive');
  perform public.add_project_member(v_p, t.uid('member_a'), private.role_id('project', 'contributor'));
  perform public.add_project_member(v_p, t.uid('auditor_a'), private.role_id('project', 'contributor'));
  insert into public.activities (organization_id, project_id, name, duration, assignee_id) values (v_org, v_p, 'Mía', 3, t.uid('member_a')) returning id into v_mine;
  insert into public.activities (organization_id, project_id, name, duration, assignee_id) values (v_org, v_p, 'De otro', 3, t.uid('auditor_a')) returning id into v_other;
  insert into public.resources (organization_id, name) values (v_org, 'Recurso ASG') returning id into v_r;

  perform t.as_user('member_a');
  perform t.lives('el responsable asigna un recurso a su actividad', format(v_ins, v_org, v_p, v_mine, v_r));
  perform t.throws('no asigna en la actividad de otro responsable', format(v_ins, v_org, v_p, v_other, v_r), '42501');
  select id into v_as from public.activity_resources where activity_id = v_mine;
  perform t.lives('cambia la dedicación en la suya', format('update public.activity_resources set allocation_percent = 30 where id = %L', v_as));
  perform t.lives('quita la asignación de la suya', format('delete from public.activity_resources where id = %L', v_as));

  -- No puede apropiarse de una asignación ajena ni moverla a otra actividad
  perform t.as_user('pm_a');
  insert into public.activity_resources (organization_id, project_id, activity_id, resource_id) values (v_org, v_p, v_other, v_r) returning id into v_as;
  perform t.as_user('member_a');
  perform t.eq('no cambia asignaciones de actividades ajenas (0 filas)', t.affected(format('update public.activity_resources set allocation_percent = 5 where id = %L', v_as)), 0::bigint);
  perform t.eq('no quita asignaciones de actividades ajenas (0 filas)', t.affected(format('delete from public.activity_resources where id = %L', v_as)), 0::bigint);

  -- Quien no es responsable ni tiene schedule.edit no asigna
  perform t.as_user('pm_a');
  update public.activities set assignee_id = null where id = v_mine;
  perform t.as_user('member_a');
  perform t.throws('sin ser responsable ya no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');
  perform t.as_user('pm_a');
  update public.activities set assignee_id = t.uid('member_a') where id = v_mine;

  -- Un responsable suspendido en la organización deja de asignar
  perform t.reset();
  update public.organization_members set status = 'suspended', suspended_at = now() where organization_id = v_org and user_id = t.uid('member_a');
  perform t.as_user('member_a');
  perform t.throws('un responsable suspendido no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');
  perform t.reset();
  update public.organization_members set status = 'active', suspended_at = null where organization_id = v_org and user_id = t.uid('member_a');

  -- Requisitos: miembro del proyecto y miembro interno activo
  perform t.as_user('pm_a');
  perform public.remove_project_member(v_p, t.uid('member_a'));
  perform t.as_user('member_a');
  perform t.throws('un responsable que ya no es miembro del proyecto no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');

  -- Los permisos anteriores siguen vigentes
  perform t.as_user('pm_a');
  perform t.lives('el PM sigue asignando en cualquier actividad', format(v_ins, v_org, v_p, v_mine, v_r));
  perform t.as_user('ext_a');
  perform t.throws('un externo no asigna', format(v_ins, v_org, v_p, v_mine, v_r), '42501');
  perform t.as_anon();
  perform t.throws('anónimo no ejecuta el helper', format('select private.can_assign_resources(%L, %L)', v_p, v_mine), '42501');
  perform t.reset();
end $$;
