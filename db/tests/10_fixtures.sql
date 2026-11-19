-- Escenario compartido (solo lectura para las demás pruebas):
--   Org A "Alpha": owner_a, admin_a, pm_a (rol org project_manager), member_a, auditor_a,
--                  portfolio_a (portfolio_manager), ext_a (externo, contributor en p1)
--   Org B "Beta":  owner_b, member_b
--   loner (sin organización), unverified (correo sin verificar)
--   Proyectos: p1 (visibility organization) y p2 (private) en A, creados por pm_a; pb1 en B.
do $$
declare
  n text;
begin
  foreach n in array array['owner_a','admin_a','pm_a','member_a','auditor_a','portfolio_a','ext_a',
                           'owner_b','member_b','loner'] loop
    perform t.mk_user(n);
  end loop;
  perform t.mk_user('unverified', false);

  perform t.as_user('owner_a');
  perform t.fx_set('org_a', public.create_organization('Alpha', 'USD'));
  perform t.as_user('owner_b');
  perform t.fx_set('org_b', public.create_organization('Beta', 'EUR'));
  perform t.reset();

  perform t.join('org_a', 'owner_a', 'admin_a', 'admin');
  perform t.join('org_a', 'owner_a', 'pm_a', 'project_manager');
  perform t.join('org_a', 'owner_a', 'member_a', 'member');
  perform t.join('org_a', 'owner_a', 'auditor_a', 'auditor');
  perform t.join('org_a', 'owner_a', 'portfolio_a', 'portfolio_manager');
  perform t.join('org_b', 'owner_b', 'member_b', 'member');

  perform t.as_user('pm_a');
  perform t.fx_set('p1', public.create_project(t.fx('org_a'), 'ALPHA-1', 'Proyecto Alfa 1', t.uid('pm_a'), 'predictive'));
  perform t.fx_set('p2', public.create_project(t.fx('org_a'), 'ALPHA-2', 'Proyecto Alfa 2 (privado)', t.uid('pm_a'),
                  'predictive', 'standard', null, null, null, null, 'private'));
  perform t.as_user('owner_b');
  perform t.fx_set('pb1', public.create_project(t.fx('org_b'), 'BETA-1', 'Proyecto Beta 1', t.uid('owner_b'), 'predictive'));
  perform t.reset();

  perform t.join('org_a', 'owner_a', 'ext_a', 'guest', 'external', 'p1', 'contributor');

  perform t.as_user('portfolio_a');
  insert into public.portfolios (organization_id, name, responsible_id)
  values (t.fx('org_a'), 'Portafolio A', t.uid('portfolio_a'));
  perform t.reset();
end $$;
