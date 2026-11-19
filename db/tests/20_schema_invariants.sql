-- Invariantes estructurales de seguridad: se comprueban sobre el catálogo, no sobre datos.
do $$
declare
  rec record;
  v_bad text;
begin
  perform t.reset();

  -- RLS activado y forzado en TODAS las tablas de public
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not (c.relrowsecurity and c.relforcerowsecurity);
  perform t.ok('RLS activado y forzado en todas las tablas de public' || coalesce(' — faltan: ' || v_bad, ''), v_bad is null);

  -- anon no tiene NINGÚN privilegio sobre tablas/vistas de public
  select string_agg(c.relname || ':' || p, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace,
       unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where n.nspname = 'public' and c.relkind in ('r','p','v')
    and has_table_privilege('anon', c.oid, p);
  perform t.ok('anon sin privilegios sobre tablas y vistas' || coalesce(' — ' || v_bad, ''), v_bad is null);

  select string_agg(c.relname || '.' || a.attname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r','p','v')
    and (has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
      or has_column_privilege('anon', c.oid, a.attnum, 'UPDATE')
      or has_column_privilege('anon', c.oid, a.attnum, 'INSERT'));
  perform t.ok('anon sin privilegios por columna' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Ninguna función de public/private es ejecutable por anon (ni por PUBLIC)
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform t.ok('anon no ejecuta ninguna función' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Funciones solo para service_role
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('purge_trashed_projects','login_lock_until','record_login_attempt','purge_login_attempts')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform t.ok('authenticated no ejecuta funciones exclusivas de service_role' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Todas las SECURITY DEFINER fijan search_path vacío
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef
    and not coalesce(p.proconfig @> array['search_path=""'], false);
  perform t.ok('toda función SECURITY DEFINER fija search_path vacío' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Ninguna función de la aplicación deja search_path por defecto (también las INVOKER de private/public)
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and not coalesce(p.proconfig @> array['search_path=""'], false);
  perform t.ok('toda función de la aplicación fija search_path' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Vistas: security_invoker
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  perform t.ok('toda vista de public usa security_invoker' || coalesce(' — ' || v_bad, ''), v_bad is null);

  -- Tablas sin ninguna escritura directa para authenticated (solo por funciones)
  for rec in select unnest(array['organization_members','invitations','project_members','audit_log',
      'legal_acceptances','login_attempts','project_status_transitions','permissions']) as tbl loop
    perform t.ok('authenticated sin INSERT/UPDATE/DELETE directo en ' || rec.tbl,
      not (has_table_privilege('authenticated', 'public.' || rec.tbl, 'INSERT')
        or has_table_privilege('authenticated', 'public.' || rec.tbl, 'UPDATE')
        or has_table_privilege('authenticated', 'public.' || rec.tbl, 'DELETE')
        or has_table_privilege('authenticated', 'public.' || rec.tbl, 'TRUNCATE')));
  end loop;
  perform t.ok('authenticated no lee login_attempts', not has_table_privilege('authenticated', 'public.login_attempts', 'SELECT'));
  perform t.ok('authenticated no lee invitations.token_hash',
    not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT'));
  perform t.ok('authenticated sí lee otras columnas de invitations',
    has_column_privilege('authenticated', 'public.invitations', 'email', 'SELECT'));

  -- Columnas de projects que NUNCA se pueden escribir directamente
  for rec in select unnest(array['organization_id','portfolio_id','program_id','code','methodology','status',
      'health','progress_percent','status_changed_at','archived_at','deleted_at','created_by','created_at','id']) as col loop
    perform t.ok('projects.' || rec.col || ' no es actualizable por authenticated',
      not has_column_privilege('authenticated', 'public.projects', rec.col, 'UPDATE'));
  end loop;
  perform t.ok('projects no admite INSERT directo', not has_table_privilege('authenticated', 'public.projects', 'INSERT'));
  perform t.ok('projects no admite DELETE directo', not has_table_privilege('authenticated', 'public.projects', 'DELETE'));
  perform t.ok('roles.is_system no es insertable', not has_column_privilege('authenticated', 'public.roles', 'is_system', 'INSERT'));
  perform t.ok('roles.is_system no es actualizable', not has_column_privilege('authenticated', 'public.roles', 'is_system', 'UPDATE'));

  -- Nadie de la API crea objetos en public
  perform t.ok('authenticated no puede crear en public', not has_schema_privilege('authenticated', 'public', 'CREATE'));
  perform t.ok('anon no puede crear en public', not has_schema_privilege('anon', 'public', 'CREATE'));
  perform t.ok('anon no usa el esquema private', not has_schema_privilege('anon', 'private', 'USAGE'));

  -- Catálogo mínimo sembrado
  perform t.eq('8 roles de organización de sistema', (select count(*) from public.roles where is_system and scope = 'organization'), 8::bigint);
  perform t.eq('5 roles de proyecto de sistema', (select count(*) from public.roles where is_system and scope = 'project'), 5::bigint);
  perform t.eq('20 transiciones de estado', (select count(*) from public.project_status_transitions), 20::bigint);
  perform t.eq('solo owner tiene org.ownership.manage',
    (select string_agg(r.key, ',' order by r.key) from public.role_permissions rp join public.roles r on r.id = rp.role_id
      where rp.permission_code = 'org.ownership.manage'), 'owner');
end $$;
