-- Aislamiento entre organizaciones y contra usuarios sin sesión.
do $$
declare
  rec record; v_a uuid := t.fx('org_a'); v_b uuid := t.fx('org_b');
  v_pa uuid := t.fx('p1'); v_pb uuid := t.fx('pb1'); v_cnt bigint;
begin
  -- Cada usuario de B ve 0 filas de A, en cada tabla con organization_id
  for rec in select unnest(array['organization_members','invitations','portfolios','programs','projects','project_phases','project_members','audit_log']) as tbl loop
    perform t.as_user('owner_b');
    perform t.eq('owner_b ve 0 filas de A en ' || rec.tbl,
      t.count_of(format('select 1 from public.%I where organization_id = %L', rec.tbl, v_a)), 0::bigint);
    perform t.as_user('owner_a');
    perform t.eq('owner_a ve 0 filas de B en ' || rec.tbl,
      t.count_of(format('select 1 from public.%I where organization_id = %L', rec.tbl, v_b)), 0::bigint);
  end loop;
  perform t.as_user('owner_b');
  perform t.eq('owner_b no ve la organización A', t.count_of('select 1 from public.organizations where id = ''' || v_a || ''''), 0::bigint);
  perform t.eq('owner_b no ve roles personalizados de A', t.count_of('select 1 from public.roles where organization_id = ''' || v_a || ''''), 0::bigint);
  perform t.eq('owner_b no ve perfiles de A', t.count_of('select 1 from public.profiles where id in (''' || t.uid('member_a') || ''',''' || t.uid('owner_a') || ''')'), 0::bigint);
  perform t.eq('owner_b no ve su vista de panel de A', t.count_of('select 1 from public.project_dashboard where organization_id = ''' || v_a || ''''), 0::bigint);
  perform t.as_user('loner');
  perform t.eq('un usuario sin organización ve 0 proyectos', t.count_of('select 1 from public.projects'), 0::bigint);

  -- Escrituras cruzadas por tabla
  perform t.as_user('owner_b');
  perform t.eq('no actualiza proyectos de A', t.affected('update public.projects set name = ''Intruso'' where id = ''' || v_pa || ''''), 0::bigint);
  perform t.eq('no actualiza la organización A', t.affected('update public.organizations set name = ''Intruso'' where id = ''' || v_a || ''''), 0::bigint);
  perform t.throws('no inserta fases en proyecto de A', 'insert into public.project_phases (organization_id, project_id, name) values (''' || v_a || ''', ''' || v_pa || ''', ''Intruso'')', '42501');
  perform t.throws('no inserta portafolio en A', 'insert into public.portfolios (organization_id, name, responsible_id) values (''' || v_a || ''', ''Intruso'', auth.uid())');
  perform t.throws('no inserta roles en A', 'insert into public.roles (organization_id, scope, name) values (''' || v_a || ''', ''organization'', ''Intruso'')', '42501');
  perform t.eq('no edita su propio perfil por id ajeno', t.affected('update public.profiles set display_name = ''X'' where id = ''' || t.uid('owner_a') || ''''), 0::bigint);

  -- Funciones (RPC) con identificadores de otra organización
  perform t.throws('create_project en A', 'select public.create_project(''' || v_a || ''', ''X-1'', ''Intruso'', auth.uid(), ''predictive'')', 'forbidden');
  perform t.throws('invite_member en A', 'select * from public.invite_member(''' || v_a || ''', ''x@test.local'', private.role_id(''organization'',''member''))', 'forbidden');
  perform t.throws('change_member_role en A', 'select public.change_member_role(''' || v_a || ''', ''' || t.uid('member_a') || ''', private.role_id(''organization'',''owner''))', 'forbidden');
  perform t.throws('set_member_status en A', 'select public.set_member_status(''' || v_a || ''', ''' || t.uid('member_a') || ''', ''suspended'')', 'forbidden');
  perform t.throws('change_project_status de A', 'select public.change_project_status(''' || v_pa || ''', ''proposed'')', 'project_not_found');
  perform t.throws('reopen_project de A', 'select public.reopen_project(''' || t.fx('p_closed') || ''', ''motivo'')', 'project_not_found');
  perform t.throws('move_project de A', 'select public.move_project(''' || v_pa || ''', null, null)', 'project_not_found');
  perform t.throws('archive_project de A', 'select public.archive_project(''' || v_pa || ''', true)', 'project_not_found');
  perform t.throws('trash_project de A', 'select public.trash_project(''' || v_pa || ''', true)', 'project_not_found');
  perform t.throws('add_project_member en A', 'select public.add_project_member(''' || v_pa || ''', ''' || t.uid('owner_b') || ''', private.role_id(''project'',''viewer''))', 'project_not_found');
  perform t.throws('remove_project_member en A', 'select public.remove_project_member(''' || v_pa || ''', ''' || t.uid('pm_a') || ''')', 'project_not_found');
  perform t.throws('reorder_project_phases de A', 'select public.reorder_project_phases(''' || v_pa || ''', array[]::uuid[])', 'project_not_found');
  perform t.throws('invitar con proyecto de A desde B', 'select * from public.invite_member(''' || v_b || ''', ''x@test.local'', private.role_id(''organization'',''guest''), ''external'', ''' || v_pa || ''', private.role_id(''project'',''viewer''))', 'project_not_found');

  -- Protección en la propia base de datos (sin pasar por RLS): claves foráneas compuestas
  perform t.reset();
  perform t.throws('FK compuesta: miembro de proyecto con organización distinta',
    'insert into public.project_members (organization_id, project_id, user_id, role_id) values (''' || v_b || ''', ''' || v_pa || ''', ''' || t.uid('owner_b') || ''', private.role_id(''project'',''viewer''))', '23503');
  perform t.throws('FK compuesta: fase con organización distinta',
    'insert into public.project_phases (organization_id, project_id, name) values (''' || v_b || ''', ''' || v_pa || ''', ''Cruce'')', '23503');
  perform t.throws('FK compuesta: proyecto con portafolio de otra organización',
    'update public.projects set portfolio_id = (select id from public.portfolios limit 1), organization_id = organization_id where id = ''' || v_pb || '''');
  perform t.throws('un usuario no entra a proyecto de una organización de la que no es miembro',
    'insert into public.project_members (organization_id, project_id, user_id, role_id) values (''' || v_a || ''', ''' || v_pa || ''', ''' || t.uid('owner_b') || ''', private.role_id(''project'',''viewer''))');
  perform t.ok('existe un rol personalizado en otra organización para la prueba', exists (select 1 from public.roles where organization_id = t.fx('org_rbac')));
  perform t.throws('rol personalizado de otra organización en un miembro',
    'insert into public.organization_members (organization_id, user_id, membership_type, role_id) select ''' || v_b || ''', ''' || t.uid('loner') || ''', ''internal'', r.id from public.roles r where r.organization_id = ''' || t.fx('org_rbac') || ''' limit 1');

  -- Externo: alcance estrictamente limitado
  perform t.as_user('ext_a');
  perform t.eq('externo ve 1 organización (la suya)', t.count_of('select 1 from public.organizations'), 1::bigint);
  perform t.eq('externo no ve fases de otros proyectos', t.count_of('select 1 from public.project_phases where project_id = ''' || t.fx('p2') || ''''), 0::bigint);
  perform t.eq('externo no ve miembros de otros proyectos', t.count_of('select 1 from public.project_members where project_id = ''' || t.fx('p2') || ''''), 0::bigint);
  perform t.eq('externo no ve auditoría', t.count_of('select 1 from public.audit_log'), 0::bigint);
  perform t.eq('externo no ve invitaciones', t.count_of('select 1 from public.invitations'), 0::bigint);
  perform t.eq('externo ve a los miembros de su proyecto (pm_a)', t.count_of('select 1 from public.profiles where id = ''' || t.uid('pm_a') || ''''), 1::bigint);
  perform t.eq('externo NO ve el perfil de owner_a', t.count_of('select 1 from public.profiles where id = ''' || t.uid('owner_a') || ''''), 0::bigint);
  perform t.eq('externo NO ve el perfil de member_a', t.count_of('select 1 from public.profiles where id = ''' || t.uid('member_a') || ''''), 0::bigint);
  perform t.eq('externo no ve el panel de otros proyectos', (select coalesce(sum(projects),0) from public.project_dashboard where organization_id = t.fx('org_a')), 1::bigint);

  -- Sin sesión: ninguna tabla ni función de la API
  perform t.as_anon();
  for rec in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p','v') loop
    perform t.throws('anon no puede leer ' || rec.relname, format('select 1 from public.%I limit 1', rec.relname), '42501');
  end loop;
  for rec in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    perform t.ok('anon sin EXECUTE en ' || rec.sig, not has_function_privilege('anon', rec.sig, 'EXECUTE'));
  end loop;
  perform t.throws('anon no crea tablas', 'create table public.hack (x int)', '42501');
  perform t.as_user('owner_a');
  perform t.throws('authenticated no crea tablas en public', 'create table public.hack (x int)', '42501');
  perform t.throws('authenticated no crea esquemas', 'create schema hack', '42501');
  perform t.throws('authenticated no ejecuta funciones de private.audit_trigger', 'select private.audit_trigger()', '42501');

  -- service_role (servidor) sí ve todo: confirma que el aislamiento depende de RLS
  perform t.as_service();
  perform t.ok('service_role ve proyectos de ambas organizaciones', (select count(distinct organization_id) from public.projects) >= 2);
  perform t.reset();
end $$;
