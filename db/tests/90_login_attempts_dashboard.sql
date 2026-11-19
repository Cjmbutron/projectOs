do $$
declare
  v_total bigint; v_lock timestamptz; v_lock2 timestamptz; i int;
begin
  -- ---- Bloqueo de cuenta ----
  perform t.as_user('owner_a');
  perform t.throws('authenticated no usa login_lock_until', 'select public.login_lock_until(''x@test.local'')', '42501');
  perform t.throws('authenticated no usa record_login_attempt', 'select public.record_login_attempt(''x@test.local'', false)', '42501');
  perform t.throws('authenticated no lee login_attempts', 'select * from public.login_attempts', '42501');
  perform t.as_anon();
  perform t.throws('anon no usa record_login_attempt', 'select public.record_login_attempt(''x@test.local'', false)', '42501');

  perform t.as_service();
  for i in 1..4 loop v_lock := public.record_login_attempt('Victima@Test.Local ', false); end loop;
  perform t.ok('4 fallos: aún sin bloqueo', v_lock is null);
  v_lock := public.record_login_attempt('victima@test.local', false);
  perform t.ok('5.º fallo: bloqueada ~15 min', v_lock is not null and v_lock between now() + interval '14 minutes' and now() + interval '15 minutes 5 seconds');
  perform t.ok('login_lock_until coincide', public.login_lock_until('VICTIMA@test.local') = v_lock);
  v_lock2 := public.record_login_attempt('victima@test.local', false);
  perform t.ok('más fallos no extienden el bloqueo', v_lock2 = v_lock);
  v_lock2 := public.record_login_attempt('victima@test.local', true);
  perform t.ok('un acierto durante el bloqueo no lo levanta', v_lock2 = v_lock and public.login_lock_until('victima@test.local') = v_lock);
  perform t.eq('durante el bloqueo no se registran intentos', (select count(*) from public.login_attempts where email = 'victima@test.local'), 5::bigint);
  perform t.ok('otra cuenta no se ve afectada', public.login_lock_until('otra@test.local') is null);
  perform t.reset();
  update public.login_attempts set attempted_at = attempted_at - interval '16 minutes' where email = 'victima@test.local';
  perform t.as_service();
  perform t.ok('pasados 15 min el bloqueo expira', public.login_lock_until('victima@test.local') is null);

  -- Un acierto reinicia la cuenta
  for i in 1..4 loop perform public.record_login_attempt('reset@test.local', false); end loop;
  perform public.record_login_attempt('reset@test.local', true);
  for i in 1..4 loop v_lock := public.record_login_attempt('reset@test.local', false); end loop;
  perform t.ok('4 fallos + acierto + 4 fallos: sin bloqueo', v_lock is null);

  -- Fallos espaciados (fuera de la ventana de 15 min) no bloquean
  perform t.reset();
  insert into public.login_attempts (email, attempted_at, succeeded)
    select 'lento@test.local', now() - (g * interval '5 minutes'), false from generate_series(1, 5) g;
  perform t.as_service();
  perform t.ok('5 fallos en 25 min: sin bloqueo', public.login_lock_until('lento@test.local') is null);
  perform t.reset();
  insert into public.login_attempts (email, attempted_at, succeeded) values ('mixto@test.local', now() - interval '1 hour', false);
  perform t.as_service();
  perform t.eq('purge_login_attempts elimina antiguos (> 30 min)', public.purge_login_attempts(interval '30 minutes'), (select count(*) from public.login_attempts where attempted_at < now() - interval '30 minutes')::int + 0);
  perform t.reset();
  perform t.throws('correo debe estar normalizado en la tabla', 'insert into public.login_attempts (email, succeeded) values (''MAYUS@test.local'', false)', '23514');

  -- ---- Panel ----
  perform t.as_user('owner_a');
  select count(*) into v_total from public.projects where organization_id = t.fx('org_a') and archived_at is null and deleted_at is null;
  perform t.ok('owner ve el panel de A', (select coalesce(sum(projects),0) from public.project_dashboard where organization_id = t.fx('org_a')) >= 5);
  perform t.eq('el panel no cuenta archivados ni papelera',
    (select coalesce(sum(projects),0) from public.project_dashboard where organization_id = t.fx('org_a'))::bigint,
    (select count(*) from public.projects where organization_id = t.fx('org_a') and archived_at is null and deleted_at is null)::bigint);
  perform t.as_user('member_a');
  perform t.eq('el panel respeta la visibilidad (member no cuenta p2 privado)',
    (select coalesce(sum(projects),0) from public.project_dashboard where organization_id = t.fx('org_a'))::bigint,
    (select count(*) from public.projects where organization_id = t.fx('org_a') and archived_at is null and deleted_at is null)::bigint);
  perform t.ok('member ve menos proyectos que el owner', (select coalesce(sum(projects),0) from public.project_dashboard where organization_id = t.fx('org_a')) < v_total);
  perform t.as_anon();
  perform t.throws('anon no ve el panel', 'select * from public.project_dashboard', '42501');
  perform t.reset();
end $$;
