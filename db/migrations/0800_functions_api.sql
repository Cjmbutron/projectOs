-- =============================================================================
-- 0800 · Funciones de negocio (API)
--
-- Todo cambio de membresías, invitaciones, estados y ubicación de proyectos pasa por estas
-- funciones: un único punto de control con permiso, validación y auditoría. Las tablas
-- no admiten esas escrituras directas (ver 0900).
--
-- Errores: 28000 no autenticado · 42501 sin permiso · P0001 regla de negocio · P0002 no existe.
-- El texto del error es un código estable en snake_case.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
create function public.create_organization(p_name text, p_currency text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
  v_org uuid;
begin
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;
  insert into public.organizations (name, reference_currency, created_by)
  values (btrim(p_name), upper(btrim(p_currency)), v_uid)
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, membership_type, role_id, invited_by)
  values (v_org, v_uid, 'internal', private.role_id('organization', 'owner'), v_uid);
  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------
create function public.invite_member(
  p_org uuid, p_email text, p_role uuid,
  p_membership_type text default 'internal',
  p_project uuid default null, p_project_role uuid default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := private.require_auth();
  v_email   text := lower(btrim(p_email));
  v_role    public.roles%rowtype;
  v_prole   public.roles%rowtype;
  v_token   text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if not private.has_org_permission(p_org, 'org.members.invite') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_membership_type not in ('internal', 'external') then
    raise exception 'invalid_membership_type' using errcode = 'P0001';
  end if;

  select * into v_role from public.roles r where r.id = p_role;
  if not found or v_role.scope <> 'organization'
     or (v_role.organization_id is not null and v_role.organization_id <> p_org) then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  if p_membership_type = 'external' and not (v_role.is_system and v_role.key = 'guest') then
    raise exception 'external_requires_guest_role' using errcode = 'P0001';
  end if;
  if p_membership_type = 'internal' and v_role.is_system and v_role.key = 'guest' then
    raise exception 'internal_cannot_be_guest' using errcode = 'P0001';
  end if;
  if private.role_is_owner(p_role) and not private.is_org_owner(p_org) then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;

  if p_project is not null or p_project_role is not null then
    if p_membership_type <> 'external' or p_project is null or p_project_role is null then
      raise exception 'invalid_project_assignment' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.projects pr where pr.id = p_project and pr.organization_id = p_org) then
      raise exception 'project_not_found' using errcode = 'P0002';
    end if;
    if not private.has_project_permission(p_project, 'project.manage_members') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v_prole from public.roles r where r.id = p_project_role;
    if not found or v_prole.scope <> 'project' or not v_prole.external_assignable
       or (v_prole.organization_id is not null and v_prole.organization_id <> p_org) then
      raise exception 'role_not_assignable_to_external' using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1 from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  -- Una sola invitación pendiente por correo: la nueva reemplaza a la anterior.
  update public.invitations i
     set revoked_at = now()
   where i.organization_id = p_org and i.email = v_email
     and i.accepted_at is null and i.revoked_at is null;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations
    (organization_id, email, role_id, membership_type, project_id, project_role_id, token_hash, expires_at, invited_by)
  values
    (p_org, v_email, p_role, p_membership_type, p_project, p_project_role,
     sha256(convert_to(v_token, 'UTF8')), v_expires, v_uid)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end $$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
begin
  perform private.require_auth();
  select * into v_inv from public.invitations i where i.id = p_invitation for update;
  if not found or not private.has_org_permission(v_inv.organization_id, 'org.members.invite') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'invitation_not_pending' using errcode = 'P0001';
  end if;
  update public.invitations i set revoked_at = now() where i.id = p_invitation;
end $$;

-- Acepta con el token recibido. Exige correo verificado y coincidente con el invitado.
-- Todos los fallos del token devuelven el mismo error (no se revela por qué).
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_auth();
  v_user  auth.users%rowtype;
  v_inv   public.invitations%rowtype;
begin
  select * into v_user from auth.users u where u.id = v_uid;
  if v_user.email_confirmed_at is null then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations i
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() or lower(v_user.email) is distinct from v_inv.email then
    raise exception 'invalid_or_expired_invitation' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organization_members m
             where m.organization_id = v_inv.organization_id and m.user_id = v_uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.organization_members (organization_id, user_id, membership_type, role_id, invited_by)
  values (v_inv.organization_id, v_uid, v_inv.membership_type, v_inv.role_id, v_inv.invited_by);

  -- Un externo entra al proyecto indicado (si todavía admite cambios).
  if v_inv.project_id is not null and private.project_is_writable(v_inv.project_id) then
    insert into public.project_members (organization_id, project_id, user_id, role_id, added_by)
    values (v_inv.organization_id, v_inv.project_id, v_uid, v_inv.project_role_id, v_inv.invited_by);
  end if;

  update public.invitations i set accepted_at = now(), accepted_by = v_uid where i.id = v_inv.id;
  return v_inv.organization_id;
end $$;

-- ---------------------------------------------------------------------------
-- Miembros de la organización
-- ---------------------------------------------------------------------------
create function public.change_member_role(p_org uuid, p_user uuid, p_role uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
begin
  perform private.require_auth();
  if not private.has_org_permission(p_org, 'org.members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_member from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- Solo un owner otorga o retira el rol de owner.
  if (private.role_is_owner(v_member.role_id) or private.role_is_owner(p_role))
     and not private.is_org_owner(p_org) then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;
  update public.organization_members m set role_id = p_role where m.id = v_member.id;
end $$;

create function public.set_member_status(p_org uuid, p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
begin
  perform private.require_auth();
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not private.has_org_permission(p_org, 'org.members.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_member from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if private.role_is_owner(v_member.role_id) and not private.is_org_owner(p_org) then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;
  update public.organization_members m
     set status = p_status,
         suspended_at = case when p_status = 'suspended' then coalesce(m.suspended_at, now()) else null end
   where m.id = v_member.id;
end $$;

-- ---------------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------------
create function public.create_project(
  p_org uuid, p_code text, p_name text, p_responsible uuid, p_methodology text,
  p_profile text default 'standard', p_currency text default null, p_description text default null,
  p_portfolio uuid default null, p_program uuid default null,
  p_visibility text default 'organization',
  p_planned_start date default null, p_planned_end date default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org_currency text;
  v_portfolio    uuid := p_portfolio;
  v_prog         public.programs%rowtype;
  v_id           uuid;
begin
  perform private.require_auth();
  if not private.has_org_permission(p_org, 'project.create') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_program is not null then
    select * into v_prog from public.programs g where g.id = p_program and g.organization_id = p_org;
    if not found then
      raise exception 'program_not_found' using errcode = 'P0002';
    end if;
    if v_portfolio is not null and v_portfolio is distinct from v_prog.portfolio_id then
      raise exception 'portfolio_mismatch' using errcode = 'P0001';
    end if;
    v_portfolio := v_prog.portfolio_id;
  end if;
  -- Ubicar un proyecto en un portafolio o programa es una decisión de gobierno.
  if (v_portfolio is not null or p_program is not null)
     and not (private.has_org_permission(p_org, 'portfolio.manage')
              or private.has_org_permission(p_org, 'program.manage')) then
    raise exception 'forbidden' using errcode = '42501',
      hint = 'Se requiere portfolio.manage o program.manage para ubicar el proyecto.';
  end if;

  select o.reference_currency into v_org_currency from public.organizations o where o.id = p_org;

  insert into public.projects
    (organization_id, portfolio_id, program_id, code, name, description, responsible_id,
     methodology, complexity_profile, currency, visibility, planned_start, planned_end)
  values
    (p_org, v_portfolio, p_program, btrim(p_code), btrim(p_name), p_description, p_responsible,
     p_methodology, coalesce(p_profile, 'standard'), coalesce(upper(btrim(p_currency)), v_org_currency),
     coalesce(p_visibility, 'organization'), p_planned_start, p_planned_end)
  returning id into v_id;

  -- La persona responsable queda como Project Manager del proyecto.
  insert into public.project_members (organization_id, project_id, user_id, role_id)
  values (p_org, v_id, p_responsible, private.role_id('project', 'project_manager'));
  return v_id;
end $$;

create function public.change_project_status(p_project uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_rule    public.project_status_transitions%rowtype;
begin
  perform private.require_auth();
  select * into v_project from public.projects p where p.id = p_project for update;
  if not found or not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  select * into v_rule from public.project_status_transitions t
  where t.from_status = v_project.status and t.to_status = p_status;
  if not found then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> %s', v_project.status, p_status);
  end if;
  if v_rule.needs_reopen then
    raise exception 'use_reopen_project' using errcode = 'P0001';
  end if;
  if not private.has_project_permission(p_project, v_rule.required_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.set_audit_context('status_change', p_reason);
  update public.projects p set status = p_status where p.id = p_project;
  perform private.set_audit_context(null, null);
end $$;

-- Reabrir un proyecto cerrado (closed → closing): permiso de organización y motivo obligatorio.
create function public.reopen_project(p_project uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  perform private.require_auth();
  select * into v_project from public.projects p where p.id = p_project for update;
  if not found or not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_org_permission(v_project.organization_id, 'project.reopen') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v_project.status <> 'closed' then
    raise exception 'invalid_transition' using errcode = 'P0001',
      detail = format('%s -> closing', v_project.status);
  end if;
  perform private.set_audit_context('reopen', btrim(p_reason));
  update public.projects p set status = 'closing' where p.id = p_project;
  perform private.set_audit_context(null, null);
end $$;

-- Ubicar un proyecto en un portafolio y/o programa (US-058).
create function public.move_project(p_project uuid, p_portfolio uuid, p_program uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project   public.projects%rowtype;
  v_prog      public.programs%rowtype;
  v_portfolio uuid := p_portfolio;
begin
  perform private.require_auth();
  select * into v_project from public.projects p where p.id = p_project for update;
  if not found or not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not (private.has_org_permission(v_project.organization_id, 'portfolio.manage')
          or private.has_org_permission(v_project.organization_id, 'program.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.assert_project_writable(p_project);

  if p_program is not null then
    select * into v_prog from public.programs g
    where g.id = p_program and g.organization_id = v_project.organization_id;
    if not found then
      raise exception 'program_not_found' using errcode = 'P0002';
    end if;
    if v_portfolio is not null and v_portfolio is distinct from v_prog.portfolio_id then
      raise exception 'portfolio_mismatch' using errcode = 'P0001';
    end if;
    v_portfolio := v_prog.portfolio_id;
  end if;
  update public.projects p set portfolio_id = v_portfolio, program_id = p_program where p.id = p_project;
end $$;

create function public.archive_project(p_project uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.update') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.projects p
     set archived_at = case when p_archived then coalesce(p.archived_at, now()) else null end
   where p.id = p_project;
end $$;

-- Papelera: el proyecto se oculta y se purga a los 30 días (restaurable mientras tanto).
create function public.trash_project(p_project uuid, p_trashed boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not exists (select 1 from public.projects p where p.id = p_project)
     or not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.projects p
     set deleted_at = case when p_trashed then coalesce(p.deleted_at, now()) else null end
   where p.id = p_project;
end $$;

-- ---------------------------------------------------------------------------
-- Miembros de proyecto
-- ---------------------------------------------------------------------------
create function public.add_project_member(p_project uuid, p_user uuid, p_role uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  perform private.require_auth();
  select p.organization_id into v_org from public.projects p where p.id = p_project;
  if v_org is null or not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.manage_members') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members m
                 where m.organization_id = v_org and m.user_id = p_user and m.status = 'active') then
    raise exception 'member_not_active' using errcode = 'P0001';
  end if;
  insert into public.project_members (organization_id, project_id, user_id, role_id)
  values (v_org, p_project, p_user, p_role)
  returning id into v_id;
  return v_id;
end $$;

create function public.change_project_member_role(p_project uuid, p_user uuid, p_role uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.manage_members') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.project_members pm set role_id = p_role where pm.project_id = p_project and pm.user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end $$;

create function public.remove_project_member(p_project uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.manage_members') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.project_members pm where pm.project_id = p_project and pm.user_id = p_user;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
end $$;

-- Reordena las fases: debe recibirse exactamente el conjunto de fases del proyecto.
create function public.reorder_project_phases(p_project uuid, p_phase_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected int;
  v_given    int := coalesce(cardinality(p_phase_ids), 0);
begin
  perform private.require_auth();
  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.has_project_permission(p_project, 'project.update') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_expected from public.project_phases f where f.project_id = p_project;
  if v_given <> v_expected
     or (select count(distinct x) from unnest(p_phase_ids) as x) <> v_given
     or exists (select 1 from unnest(p_phase_ids) as x
                where not exists (select 1 from public.project_phases f where f.id = x and f.project_id = p_project)) then
    raise exception 'phase_set_mismatch' using errcode = 'P0001';
  end if;
  update public.project_phases f
     set position = u.ord::int
    from unnest(p_phase_ids) with ordinality as u(id, ord)
   where f.id = u.id and f.project_id = p_project;
end $$;

-- ---------------------------------------------------------------------------
-- Perfil / legal
-- ---------------------------------------------------------------------------
create function public.record_legal_acceptance(p_document text, p_version text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
begin
  insert into public.legal_acceptances (user_id, document, version)
  values (v_uid, p_document, p_version)
  on conflict (user_id, document, version) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Mantenimiento (solo service_role)
-- ---------------------------------------------------------------------------
create function public.purge_trashed_projects(p_older_than interval default interval '30 days')
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.projects p where p.deleted_at is not null and p.deleted_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: nada para PUBLIC ni anon; cada función, solo a quien corresponde.
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_organization(text, text)',
    'public.invite_member(uuid, text, uuid, text, uuid, uuid)',
    'public.revoke_invitation(uuid)',
    'public.accept_invitation(text)',
    'public.change_member_role(uuid, uuid, uuid)',
    'public.set_member_status(uuid, uuid, text)',
    'public.create_project(uuid, text, text, uuid, text, text, text, text, uuid, uuid, text, date, date)',
    'public.change_project_status(uuid, text, text)',
    'public.reopen_project(uuid, text)',
    'public.move_project(uuid, uuid, uuid)',
    'public.archive_project(uuid, boolean)',
    'public.trash_project(uuid, boolean)',
    'public.add_project_member(uuid, uuid, uuid)',
    'public.change_project_member_role(uuid, uuid, uuid)',
    'public.remove_project_member(uuid, uuid)',
    'public.reorder_project_phases(uuid, uuid[])',
    'public.record_legal_acceptance(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

revoke all on function public.purge_trashed_projects(interval) from public, anon, authenticated;
grant execute on function public.purge_trashed_projects(interval) to service_role;
