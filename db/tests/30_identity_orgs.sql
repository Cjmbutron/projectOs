do $$
declare
  v_org uuid;
  v_c   uuid;
begin
  -- ---- Perfiles y consentimiento legal ----
  perform t.reset();
  perform t.eq('alta crea perfil automáticamente', (select count(*) from public.profiles where id = t.uid('owner_a')), 1::bigint);
  perform t.eq('alta registra 2 aceptaciones legales (términos y privacidad)',
    (select count(*) from public.legal_acceptances where user_id = t.uid('owner_a')), 2::bigint);

  perform t.as_user('owner_a');
  perform t.eq('un usuario lee su propio perfil', t.count_of('select 1 from public.profiles where id = ''' || t.uid('owner_a') || ''''), 1::bigint);
  perform t.eq('actualiza su propio perfil', t.affected('update public.profiles set display_name = ''Dueña A'' where id = auth.uid()'), 1::bigint);
  perform t.eq('no puede actualizar el perfil de otro',
    t.affected('update public.profiles set display_name = ''X'' where id = ''' || t.uid('admin_a') || ''''), 0::bigint);
  perform t.throws('no puede cambiar el id del perfil', 'update public.profiles set id = gen_random_uuid() where id = auth.uid()', '42501');
  perform t.throws('zona horaria inválida rechazada', 'update public.profiles set timezone = ''Mars/Olympus'' where id = auth.uid()');
  perform t.throws('idioma inválido rechazado', 'update public.profiles set locale = ''fr'' where id = auth.uid()');
  perform t.lives('zona horaria válida aceptada', 'update public.profiles set timezone = ''America/La_Paz'' where id = auth.uid()');
  perform t.eq('aceptaciones legales: solo las propias', t.count_of('select 1 from public.legal_acceptances'), 2::bigint);
  perform t.throws('no se escribe legal_acceptances directamente',
    'insert into public.legal_acceptances (user_id, document, version) values (auth.uid(), ''terms'', ''x'')', '42501');
  perform t.lives('record_legal_acceptance registra nueva versión', 'select public.record_legal_acceptance(''terms'', ''2027-01'')');
  perform t.lives('record_legal_acceptance es idempotente', 'select public.record_legal_acceptance(''terms'', ''2027-01'')');
  perform t.eq('quedan 3 aceptaciones', t.count_of('select 1 from public.legal_acceptances'), 3::bigint);
  perform t.throws('documento legal inválido', 'select public.record_legal_acceptance(''cookies'', ''1'')');

  perform t.as_anon();
  perform t.throws('anon no lee perfiles', 'select * from public.profiles', '42501');
  perform t.throws('anon no crea organizaciones', 'select public.create_organization(''X'', ''USD'')', '42501');

  -- ---- Creación de organizaciones ----
  perform t.as_user('unverified');
  perform t.throws('correo sin verificar no crea organización', 'select public.create_organization(''Z'', ''USD'')', 'email_not_verified');
  perform t.as_user('loner');
  perform t.throws('moneda inválida rechazada', 'select public.create_organization(''Gamma'', ''usd1'')');
  perform t.throws('nombre vacío rechazado', 'select public.create_organization(''   '', ''USD'')');
  v_org := public.create_organization('  Gamma  ', 'bob');
  perform t.ok('creación válida (moneda en minúsculas se normaliza)', v_org is not null);
  perform t.eq('nombre sin espacios sobrantes', t.val('select name from public.organizations where id = ''' || v_org || ''''), 'Gamma');
  perform t.eq('moneda normalizada a mayúsculas', t.val('select reference_currency from public.organizations where id = ''' || v_org || ''''), 'BOB');
  perform t.eq('el creador es owner', t.val('select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.organization_id = ''' || v_org || ''' and m.user_id = auth.uid()'), 'owner');
  perform t.reset();
  perform t.fx_set('org_gamma', v_org);

  perform t.as_user('member_a');
  perform t.eq('un miembro ve solo su organización', t.count_of('select 1 from public.organizations'), 1::bigint);
  perform t.eq('member no edita la organización',
    t.affected('update public.organizations set name = ''Hack'' where id = ''' || t.fx('org_a') || ''''), 0::bigint);
  perform t.as_user('loner');
  perform t.eq('loner ve solo su Gamma', t.count_of('select 1 from public.organizations'), 1::bigint);
  perform t.as_user('admin_a');
  perform t.eq('admin edita la organización',
    t.affected('update public.organizations set name = ''Alpha SA'' where id = ''' || t.fx('org_a') || ''''), 1::bigint);
  perform t.throws('no se puede cambiar created_by', 'update public.organizations set created_by = auth.uid()', '42501');
  perform t.throws('no se borran organizaciones', 'delete from public.organizations', '42501');
  perform t.throws('no se insertan organizaciones directamente', 'insert into public.organizations (name, reference_currency) values (''X'',''USD'')', '42501');
  perform t.as_user('owner_a');
  perform t.lives('restaura nombre', 'update public.organizations set name = ''Alpha'' where id = ''' || t.fx('org_a') || '''');

  -- ---- MFA obligatorio (RNF-01 / US-055) en una organización propia de esta prueba ----
  perform t.as_user('owner_a');
  v_c := public.create_organization('MfaCo', 'USD');
  perform t.reset();
  perform t.fx_set('org_mfa', v_c);
  perform t.join('org_mfa', 'owner_a', 'member_a', 'member');
  perform t.join('org_mfa', 'owner_a', 'admin_a', 'admin');

  perform t.as_user('owner_a', 'aal1');
  perform t.throws('activar MFA exige sesión con MFA (aal2)',
    'update public.organizations set mfa_required = true where id = ''' || v_c || '''', 'mfa_session_required');
  perform t.as_user('owner_a', 'aal2');
  perform t.eq('con aal2 sí se activa MFA',
    t.affected('update public.organizations set mfa_required = true where id = ''' || v_c || ''''), 1::bigint);

  perform t.as_user('member_a', 'aal1');
  perform t.eq('sin MFA: sigue viendo la organización', t.count_of('select 1 from public.organizations where id = ''' || v_c || ''''), 1::bigint);
  perform t.eq('sin MFA: ve su propia membresía', t.count_of('select 1 from public.organization_members where organization_id = ''' || v_c || ''' and user_id = auth.uid()'), 1::bigint);
  perform t.eq('sin MFA: NO ve a los demás miembros', t.count_of('select 1 from public.organization_members where organization_id = ''' || v_c || ''' and user_id <> auth.uid()'), 0::bigint);
  perform t.eq('sin MFA: has_org_permission = false', t.val('private.has_org_permission(''' || v_c || ''', ''org.members.read'')'), 'false');
  perform t.as_user('member_a', 'aal2');
  perform t.ok('con MFA: ve a los demás miembros', t.count_of('select 1 from public.organization_members where organization_id = ''' || v_c || '''') >= 3);

  perform t.as_user('admin_a', 'aal1');
  perform t.throws('admin sin MFA no puede invitar', 'select * from public.invite_member(''' || v_c || ''', ''x@test.local'', private.role_id(''organization'',''member''))', 'forbidden');
  perform t.throws('admin sin MFA no puede crear proyectos',
    'select public.create_project(''' || v_c || ''', ''M-1'', ''Proyecto MFA'', auth.uid(), ''predictive'')', 'forbidden');
  perform t.eq('admin sin MFA no edita la organización',
    t.affected('update public.organizations set name = ''X'' where id = ''' || v_c || ''''), 0::bigint);
  perform t.as_user('admin_a', 'aal2');
  perform t.lives('admin con MFA sí crea proyectos',
    'select public.create_project(''' || v_c || ''', ''M-1'', ''Proyecto MFA'', auth.uid(), ''predictive'')');

  perform t.as_user('owner_a', 'aal2');
  perform t.eq('con aal2 se puede desactivar MFA',
    t.affected('update public.organizations set mfa_required = false where id = ''' || v_c || ''''), 1::bigint);
  perform t.as_user('member_a', 'aal1');
  perform t.ok('sin MFA exigido, aal1 basta', t.count_of('select 1 from public.organization_members where organization_id = ''' || v_c || '''') >= 3);
  perform t.reset();
end $$;

-- can_edit_schedule respeta el MFA exigido por la organización
do $$
declare
  v_c uuid; v_p uuid;
begin
  perform t.as_user('owner_a', 'aal2');
  v_c := public.create_organization('MfaSched', 'USD');
  v_p := public.create_project(v_c, 'MS-1', 'Proyecto con MFA', t.uid('owner_a'), 'predictive');
  perform t.as_user('owner_a', 'aal1');
  perform t.eq('sin MFA exigido, aal1 puede editar', public.can_edit_schedule(v_p), true);
  perform t.as_user('owner_a', 'aal2');
  update public.organizations set mfa_required = true where id = v_c;
  perform t.as_user('owner_a', 'aal1');
  perform t.eq('con MFA exigido y sesión aal1: no puede editar', public.can_edit_schedule(v_p), false);
  perform t.as_user('owner_a', 'aal2');
  perform t.eq('con aal2: sí puede', public.can_edit_schedule(v_p), true);
  perform t.reset();
end $$;
