do $$
declare
  v_org uuid; v_role uuid; v_token text; v_tok2 text; v_tok3 text; v_inv uuid; v_inv2 uuid; v_custom uuid;
  r record;
begin
  -- Organización propia de esta prueba (para poder mutar roles/miembros sin afectar fixtures)
  perform t.as_user('owner_a');
  v_org := public.create_organization('RbacCo', 'USD');
  perform t.reset();
  perform t.fx_set('org_rbac', v_org);
  perform t.join('org_rbac', 'owner_a', 'admin_a', 'admin');
  perform t.join('org_rbac', 'owner_a', 'member_a', 'member');
  perform t.join('org_rbac', 'owner_a', 'pm_a', 'project_manager');

  -- ---- Catálogos ----
  perform t.as_anon();
  perform t.throws('anon no lee permissions', 'select * from public.permissions', '42501');
  perform t.throws('anon no lee roles', 'select * from public.roles', '42501');
  perform t.as_user('loner');
  perform t.eq('cualquier usuario ve los 13 roles de sistema', t.count_of('select 1 from public.roles'), 13::bigint);
  perform t.ok('catálogo de permisos legible', t.count_of('select 1 from public.permissions') >= 20);

  -- ---- Roles de sistema inmutables ----
  perform t.as_user('owner_a');
  perform t.eq('owner no edita roles de sistema', t.affected('update public.roles set name = ''Hack'' where is_system'), 0::bigint);
  perform t.eq('owner no borra roles de sistema', t.affected('delete from public.roles where is_system'), 0::bigint);
  perform t.throws('no se inserta rol de sistema (columna is_system)',
    'insert into public.roles (organization_id, scope, key, name, is_system) values (''' || v_org || ''', ''organization'', ''x'', ''X'', true)', '42501');
  perform t.throws('no se añaden permisos a rol de sistema',
    'insert into public.role_permissions select r.id, ''audit.read'' from public.roles r where r.is_system and r.key = ''member''');
  perform t.eq('no se quitan permisos de roles de sistema',
    t.affected('delete from public.role_permissions rp using public.roles r where r.id = rp.role_id and r.is_system'), 0::bigint);

  -- ---- Roles personalizados ----
  perform t.as_user('admin_a');
  insert into public.roles (organization_id, scope, name, description) values (v_org, 'organization', 'Analista', 'Solo lectura de portafolios') returning id into v_custom;
  perform t.ok('admin crea rol personalizado', v_custom is not null);
  perform t.lives('admin asigna permiso permitido', 'insert into public.role_permissions values (''' || v_custom || ''', ''portfolio.read'')');
  perform t.throws('no se concede org.ownership.manage a rol personalizado',
    'insert into public.role_permissions values (''' || v_custom || ''', ''org.ownership.manage'')');
  perform t.throws('no se mezclan permisos de proyecto en rol de organización',
    'insert into public.role_permissions values (''' || v_custom || ''', ''project.update'')');
  perform t.throws('nombre de rol repetido (sin importar mayúsculas)',
    'insert into public.roles (organization_id, scope, name) values (''' || v_org || ''', ''organization'', ''ANALISTA'')');
  perform t.throws('admin no crea roles en otra organización',
    'insert into public.roles (organization_id, scope, name) values (''' || t.fx('org_b') || ''', ''organization'', ''Intruso'')', '42501');
  perform t.as_user('member_a');
  perform t.throws('member no crea roles', 'insert into public.roles (organization_id, scope, name) values (''' || v_org || ''', ''organization'', ''Otro'')', '42501');
  perform t.eq('member ve el rol personalizado de su organización', t.count_of('select 1 from public.roles where id = ''' || v_custom || ''''), 1::bigint);
  perform t.as_user('owner_b');
  perform t.eq('otra organización NO ve el rol personalizado', t.count_of('select 1 from public.roles where id = ''' || v_custom || ''''), 0::bigint);
  perform t.eq('otra organización NO ve sus permisos', t.count_of('select 1 from public.role_permissions where role_id = ''' || v_custom || ''''), 0::bigint);
  perform t.eq('otra organización no puede borrarlo', t.affected('delete from public.roles where id = ''' || v_custom || ''''), 0::bigint);

  -- ---- Cambio de rol de miembro ----
  perform t.as_user('member_a');
  perform t.throws('member no cambia roles', 'select public.change_member_role(''' || v_org || ''', ''' || t.uid('pm_a') || ''', ''' || v_custom || ''')', 'forbidden');
  perform t.as_user('admin_a');
  perform t.lives('admin asigna rol personalizado', 'select public.change_member_role(''' || v_org || ''', ''' || t.uid('member_a') || ''', ''' || v_custom || ''')');
  perform t.as_user('member_a');
  perform t.ok('el rol personalizado concede portfolio.read', private.has_org_permission(v_org, 'portfolio.read'));
  perform t.ok('y no concede org.members.read', not private.has_org_permission(v_org, 'org.members.read'));
  perform t.as_user('admin_a');
  perform t.throws('no se borra un rol en uso', 'delete from public.roles where id = ''' || v_custom || '''');
  perform t.throws('admin no otorga owner', 'select public.change_member_role(''' || v_org || ''', ''' || t.uid('pm_a') || ''', private.role_id(''organization'',''owner''))', 'only_owner_can_change_owner');
  perform t.throws('rol de proyecto no vale como rol de organización',
    'select public.change_member_role(''' || v_org || ''', ''' || t.uid('pm_a') || ''', private.role_id(''project'',''project_manager''))');
  perform t.throws('miembro inexistente', 'select public.change_member_role(''' || v_org || ''', gen_random_uuid(), private.role_id(''organization'',''member''))', 'member_not_found');

  -- ---- Propiedad: último owner ----
  perform t.as_user('owner_a');
  perform t.throws('el único owner no puede degradarse',
    'select public.change_member_role(''' || v_org || ''', auth.uid(), private.role_id(''organization'',''admin''))', 'last_owner');
  perform t.throws('el único owner no puede suspenderse', 'select public.set_member_status(''' || v_org || ''', auth.uid(), ''suspended'')', 'last_owner');
  perform t.lives('owner promueve a admin_a a owner', 'select public.change_member_role(''' || v_org || ''', ''' || t.uid('admin_a') || ''', private.role_id(''organization'',''owner''))');
  perform t.as_user('admin_a');
  perform t.lives('con dos owners, uno puede degradarse a sí mismo', 'select public.change_member_role(''' || v_org || ''', auth.uid(), private.role_id(''organization'',''admin''))');
  perform t.as_user('owner_a');
  perform t.throws('de nuevo único owner: protegido', 'select public.change_member_role(''' || v_org || ''', auth.uid(), private.role_id(''organization'',''member''))', 'last_owner');

  -- ---- Suspensión ----
  perform t.as_user('admin_a');
  perform t.lives('admin suspende a pm_a', 'select public.set_member_status(''' || v_org || ''', ''' || t.uid('pm_a') || ''', ''suspended'')');
  perform t.as_user('pm_a');
  perform t.eq('suspendido: no ve la organización', t.count_of('select 1 from public.organizations where id = ''' || v_org || ''''), 0::bigint);
  perform t.throws('suspendido: no crea proyectos', 'select public.create_project(''' || v_org || ''', ''S-1'', ''Proyecto S'', auth.uid(), ''predictive'')', 'forbidden');
  perform t.as_user('admin_a');
  perform t.throws('admin no suspende a un owner', 'select public.set_member_status(''' || v_org || ''', ''' || t.uid('owner_a') || ''', ''suspended'')', 'only_owner_can_change_owner');
  perform t.throws('estado inválido', 'select public.set_member_status(''' || v_org || ''', ''' || t.uid('pm_a') || ''', ''banned'')', 'invalid_status');
  perform t.lives('reactiva a pm_a', 'select public.set_member_status(''' || v_org || ''', ''' || t.uid('pm_a') || ''', ''active'')');
  perform t.as_user('pm_a');
  perform t.eq('reactivado: vuelve a ver la organización', t.count_of('select 1 from public.organizations where id = ''' || v_org || ''''), 1::bigint);

  -- ---- Lectura de miembros ----
  perform t.as_user('ext_a');
  perform t.eq('un externo solo ve su propia membresía en la organización A',
    t.count_of('select 1 from public.organization_members where organization_id = ''' || t.fx('org_a') || ''''), 1::bigint);
  perform t.as_user('member_a');
  perform t.ok('un miembro ve a los demás de su organización', t.count_of('select 1 from public.organization_members where organization_id = ''' || t.fx('org_a') || '''') >= 6);
  perform t.as_user('loner');
  perform t.eq('un ajeno no ve miembros de A', t.count_of('select 1 from public.organization_members where organization_id = ''' || t.fx('org_a') || ''''), 0::bigint);
  perform t.as_user('owner_a');
  perform t.throws('no hay INSERT directo en organization_members', 'insert into public.organization_members (organization_id, user_id, membership_type, role_id) values (''' || v_org || ''', gen_random_uuid(), ''internal'', private.role_id(''organization'',''member''))', '42501');
  perform t.throws('no hay UPDATE directo en organization_members', 'update public.organization_members set role_id = private.role_id(''organization'',''owner'')', '42501');
  perform t.throws('no hay DELETE directo en organization_members', 'delete from public.organization_members', '42501');

  -- ---- Invitaciones ----
  perform t.as_user('pm_a');
  perform t.throws('sin org.members.invite no se invita', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', private.role_id(''organization'',''member''))', 'forbidden');
  perform t.as_user('admin_a');
  perform t.throws('correo mal formado', 'select * from public.invite_member(''' || v_org || ''', ''no-es-correo'', private.role_id(''organization'',''member''))');
  perform t.throws('ya es miembro', 'select * from public.invite_member(''' || v_org || ''', ''pm_a@test.local'', private.role_id(''organization'',''member''))', 'already_member');
  perform t.throws('admin no invita como owner', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', private.role_id(''organization'',''owner''))', 'only_owner_can_change_owner');
  perform t.throws('rol de otra organización inválido', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', ''' || private.role_id('project','project_manager') || ''')', 'invalid_role');
  perform t.throws('externo exige rol guest', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', private.role_id(''organization'',''member''), ''external'')', 'external_requires_guest_role');
  perform t.throws('interno no puede ser guest', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', private.role_id(''organization'',''guest''))', 'internal_cannot_be_guest');
  perform t.throws('asignación de proyecto solo para externos', 'select * from public.invite_member(''' || v_org || ''', ''nuevo@test.local'', private.role_id(''organization'',''member''), ''internal'', ''' || t.fx('p1') || ''', private.role_id(''project'',''contributor''))', 'invalid_project_assignment');

  select i.invitation_id, i.token into v_inv, v_token from public.invite_member(v_org, 'Nuevo@Test.Local ', private.role_id('organization','member')) i;
  perform t.ok('invitación creada; token de 64 caracteres', length(v_token) = 64);
  perform t.reset();
  perform t.ok('solo se guarda el hash del token', (select token_hash = sha256(convert_to(v_token,'UTF8')) and token_hash <> convert_to(v_token,'UTF8') from public.invitations where id = v_inv));
  perform t.eq('correo normalizado a minúsculas', (select email from public.invitations where id = v_inv), 'nuevo@test.local');
  perform t.ok('caduca en ~7 días', (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from public.invitations where id = v_inv));

  perform t.as_user('admin_a');
  perform t.eq('admin lee invitaciones', t.count_of('select 1 from public.invitations where accepted_at is null and organization_id = ''' || v_org || ''''), 1::bigint);
  perform t.throws('nadie lee token_hash', 'select token_hash from public.invitations', '42501');
  perform t.throws('ni con select *', 'select * from public.invitations', '42501');
  perform t.as_user('member_a');
  perform t.eq('member no ve invitaciones', t.count_of('select id from public.invitations'), 0::bigint);

  -- Reemplazo: una nueva invitación revoca la anterior
  perform t.as_user('admin_a');
  select i.invitation_id, i.token into v_inv2, v_tok2 from public.invite_member(v_org, 'nuevo@test.local', private.role_id('organization','auditor')) i;
  perform t.reset();
  perform t.ok('la invitación anterior queda revocada', (select revoked_at is not null from public.invitations where id = v_inv));
  perform t.eq('solo una pendiente por correo', (select count(*) from public.invitations where organization_id = v_org and email = 'nuevo@test.local' and accepted_at is null and revoked_at is null), 1::bigint);

  -- Aceptación
  perform t.mk_user('nuevo');
  perform t.as_user('nuevo');
  perform t.throws('token revocado', 'select public.accept_invitation(''' || v_token || ''')', 'invalid_or_expired_invitation');
  perform t.throws('token inventado', 'select public.accept_invitation(''abc'')', 'invalid_or_expired_invitation');
  perform t.throws('token nulo', 'select public.accept_invitation(null)', 'invalid_or_expired_invitation');
  perform t.as_user('loner');
  perform t.throws('otra persona no puede usar el token (correo distinto)', 'select public.accept_invitation(''' || v_tok2 || ''')', 'invalid_or_expired_invitation');
  perform t.as_anon();
  perform t.throws('anon no acepta invitaciones', 'select public.accept_invitation(''' || v_tok2 || ''')', '42501');
  perform t.as_user('nuevo');
  perform t.eq('acepta y recibe la org', public.accept_invitation(v_tok2), v_org);
  perform t.eq('con el rol invitado (auditor)', t.val('select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.organization_id = ''' || v_org || ''' and m.user_id = auth.uid()'), 'auditor');
  perform t.throws('el token es de un solo uso', 'select public.accept_invitation(''' || v_tok2 || ''')', 'invalid_or_expired_invitation');

  -- Caducidad, correo no verificado, revocación explícita
  perform t.mk_user('tarde'); perform t.mk_user('sinverificar', false); perform t.mk_user('revocado');
  perform t.as_user('admin_a');
  select token into v_token from public.invite_member(v_org, 'tarde@test.local', private.role_id('organization','member'));
  select token into v_tok2 from public.invite_member(v_org, 'sinverificar@test.local', private.role_id('organization','member'));
  select invitation_id, token into v_inv, v_tok3 from public.invite_member(v_org, 'revocado@test.local', private.role_id('organization','member'));
  perform t.reset();
  update public.invitations set expires_at = now() - interval '1 second' where email = 'tarde@test.local';
  perform t.as_user('tarde');
  perform t.throws('invitación caducada', 'select public.accept_invitation(''' || v_token || ''')', 'invalid_or_expired_invitation');
  perform t.as_user('sinverificar');
  perform t.throws('correo sin verificar no acepta', 'select public.accept_invitation(''' || v_tok2 || ''')', 'email_not_verified');
  perform t.as_user('admin_a');
  perform t.lives('admin revoca invitación', 'select public.revoke_invitation(''' || v_inv || ''')');
  perform t.throws('no se revoca dos veces', 'select public.revoke_invitation(''' || v_inv || ''')', 'invitation_not_pending');
  perform t.as_user('member_a');
  perform t.throws('member no revoca', 'select public.revoke_invitation(''' || v_inv || ''')', 'forbidden');
  perform t.as_user('owner_b');
  perform t.throws('otra organización no revoca', 'select public.revoke_invitation(''' || v_inv || ''')', 'forbidden');
  perform t.reset();
end $$;
