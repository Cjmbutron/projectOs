do $$
declare v_org uuid := t.fx('org_a');
begin
  perform t.as_user('owner_a');   perform t.eq('owner puede gestionar recursos', public.can_manage_resources(v_org), true);
  perform t.as_user('admin_a');   perform t.eq('admin puede', public.can_manage_resources(v_org), true);
  perform t.as_user('pm_a');      perform t.eq('PM puede', public.can_manage_resources(v_org), true);
  perform t.as_user('member_a');  perform t.eq('member no puede', public.can_manage_resources(v_org), false);
  perform t.as_user('auditor_a'); perform t.eq('auditor no puede', public.can_manage_resources(v_org), false);
  perform t.as_user('portfolio_a'); perform t.eq('portfolio manager no puede', public.can_manage_resources(v_org), false);
  perform t.as_user('ext_a');     perform t.eq('un externo no puede', public.can_manage_resources(v_org), false);
  perform t.as_user('owner_b');   perform t.eq('otra organización no puede en org_a', public.can_manage_resources(v_org), false);
  perform t.as_user('pm_a');      perform t.eq('organización inexistente: falso', public.can_manage_resources(gen_random_uuid()), false);
  perform t.as_anon();
  perform t.throws('anónimo no ejecuta la función', format('select public.can_manage_resources(%L)', v_org), '42501');
  perform t.reset();
end $$;
