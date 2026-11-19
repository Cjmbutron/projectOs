do $$
declare
  v_pf uuid; v_pf2 uuid; v_pg uuid; v_proj uuid; v_proj2 uuid;
begin
  perform t.as_user('portfolio_a');
  insert into public.portfolios (organization_id, name, responsible_id) values (t.fx('org_a'), 'Portafolio Estratégico', t.uid('portfolio_a')) returning id into v_pf;
  insert into public.portfolios (organization_id, name, responsible_id) values (t.fx('org_a'), 'Portafolio Operativo', t.uid('portfolio_a')) returning id into v_pf2;
  perform t.ok('portfolio_manager crea portafolios', v_pf is not null);
  insert into public.programs (organization_id, portfolio_id, name, responsible_id) values (t.fx('org_a'), v_pf, 'Programa 1', t.uid('portfolio_a')) returning id into v_pg;
  perform t.ok('portfolio_manager crea programas', v_pg is not null);
  perform t.throws('nombre de portafolio vacío', 'insert into public.portfolios (organization_id, name, responsible_id) values (''' || t.fx('org_a') || ''', '' '', ''' || t.uid('portfolio_a') || ''')');
  perform t.throws('el responsable debe ser miembro interno activo (externo)', 'insert into public.portfolios (organization_id, name, responsible_id) values (''' || t.fx('org_a') || ''', ''X portf'', ''' || t.uid('ext_a') || ''')');
  perform t.throws('el responsable debe ser miembro (ajeno)', 'insert into public.portfolios (organization_id, name, responsible_id) values (''' || t.fx('org_a') || ''', ''Y portf'', ''' || t.uid('loner') || ''')');
  perform t.throws('programa con portafolio de otra organización (FK compuesta)',
    'insert into public.programs (organization_id, portfolio_id, name, responsible_id) values (''' || t.fx('org_a') || ''', ''' || t.fx('org_b') || ''', ''Cruce'', ''' || t.uid('portfolio_a') || ''')');
  perform t.eq('archiva portafolio', t.affected('update public.portfolios set archived_at = now() where id = ''' || v_pf2 || ''''), 1::bigint);
  perform t.throws('no se mueve portafolio de organización', 'update public.portfolios set organization_id = ''' || t.fx('org_b') || ''' where id = ''' || v_pf || '''', '42501');
  perform t.throws('no se borran portafolios', 'delete from public.portfolios', '42501');

  perform t.as_user('member_a');
  perform t.ok('member lee portafolios (portfolio.read)', t.count_of('select 1 from public.portfolios') >= 2);
  perform t.ok('member lee programas', t.count_of('select 1 from public.programs') >= 1);
  perform t.throws('member no crea portafolios', 'insert into public.portfolios (organization_id, name, responsible_id) values (''' || t.fx('org_a') || ''', ''Nope'', auth.uid())', '42501');
  perform t.eq('member no edita portafolios', t.affected('update public.portfolios set name = ''Hack'''), 0::bigint);
  perform t.as_user('pm_a');
  perform t.throws('project_manager (org) no crea programas', 'insert into public.programs (organization_id, portfolio_id, name, responsible_id) values (''' || t.fx('org_a') || ''', ''' || v_pf || ''', ''Nope'', auth.uid())', '42501');
  perform t.as_user('ext_a');
  perform t.eq('externo no ve portafolios', t.count_of('select 1 from public.portfolios'), 0::bigint);
  perform t.eq('externo no ve programas', t.count_of('select 1 from public.programs'), 0::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización no ve portafolios de A', t.count_of('select 1 from public.portfolios where organization_id = ''' || t.fx('org_a') || ''''), 0::bigint);
  perform t.eq('otra organización no edita portafolios de A', t.affected('update public.portfolios set name = ''Hack'' where id = ''' || v_pf || ''''), 0::bigint);

  -- Ubicación de proyectos
  perform t.as_user('pm_a');
  perform t.throws('crear proyecto en portafolio exige portfolio/program.manage',
    'select public.create_project(''' || t.fx('org_a') || ''', ''PF-1'', ''Con portafolio'', auth.uid(), ''predictive'', ''standard'', null, null, ''' || v_pf || ''')', 'forbidden');
  perform t.as_user('portfolio_a');
  v_proj := public.create_project(t.fx('org_a'), 'PF-2', 'En programa', t.uid('portfolio_a'), 'predictive', 'standard', null, null, null, v_pg);
  perform t.eq('el proyecto hereda el portafolio del programa', (select portfolio_id from public.projects where id = v_proj), v_pf);
  perform t.throws('portafolio distinto al del programa', 'select public.create_project(''' || t.fx('org_a') || ''', ''PF-3'', ''Cruce'', auth.uid(), ''predictive'', ''standard'', null, null, ''' || v_pf2 || ''', ''' || v_pg || ''')', 'portfolio_mismatch');
  perform t.throws('programa de otra organización', 'select public.create_project(''' || t.fx('org_a') || ''', ''PF-4'', ''Cruce'', auth.uid(), ''predictive'', ''standard'', null, null, null, gen_random_uuid())', 'program_not_found');

  perform t.lives('move_project a otro portafolio sin programa', 'select public.move_project(''' || v_proj || ''', ''' || v_pf2 || ''', null)');
  perform t.eq('quedó en el portafolio nuevo y sin programa', (select portfolio_id::text || '/' || coalesce(program_id::text,'-') from public.projects where id = v_proj), v_pf2::text || '/-');
  perform t.lives('move_project a programa', 'select public.move_project(''' || v_proj || ''', null, ''' || v_pg || ''')');
  perform t.eq('portafolio derivado del programa', (select portfolio_id from public.projects where id = v_proj), v_pf);
  perform t.as_user('pm_a');
  perform t.throws('pm no mueve proyectos (sin portfolio.manage)', 'select public.move_project(''' || t.fx('p1') || ''', ''' || v_pf || ''', null)', 'forbidden');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no mueve proyectos de A', 'select public.move_project(''' || v_proj || ''', null, null)', 'project_not_found');

  -- Mover un programa de portafolio arrastra a sus proyectos (consistencia)
  perform t.as_service();
  update public.programs set portfolio_id = v_pf2 where id = v_pg;
  perform t.reset();
  perform t.eq('los proyectos del programa siguen a su nuevo portafolio', (select portfolio_id from public.projects where id = v_proj), v_pf2);
  perform t.reset();
end $$;
