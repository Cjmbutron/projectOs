-- =============================================================================
-- 2800 · Matriz RACI por entregable
--
-- Cada entregable del WBS puede tener, por cada miembro del proyecto, una de estas
-- combinaciones: R (Responsable: hace el trabajo), A (Aprobador/Accountable: responde por
-- el resultado), R+A, C (Consultado) o I (Informado). Reglas:
--  · Un entregable tiene como máximo UN aprobador (A).
--  · Solo miembros del proyecto; al salir del proyecto o borrarse el entregable, sus filas se van.
--  · Escribe quien edita el alcance (scope.edit: PM y líder técnico), solo con el proyecto abierto.
--    La escritura va solo por raci_set_cell(); la tabla se lee con RLS como los entregables.
--  · «Al menos un R» NO se exige en la base de datos (la interfaz avisa de lo que falta).
--  · Es independiente del campo «responsable» del entregable (no se sincronizan).
-- =============================================================================
create table public.raci_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  deliverable_id  uuid not null,
  user_id         uuid not null,
  role            text not null check (role in ('R', 'A', 'C', 'I')),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (deliverable_id, user_id, role),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (deliverable_id, project_id) references public.deliverables (id, project_id) on delete cascade,
  foreign key (project_id, user_id) references public.project_members (project_id, user_id) on delete cascade
);
create unique index raci_one_accountable_uq on public.raci_assignments (deliverable_id) where role = 'A';
create index raci_project_idx on public.raci_assignments (project_id);
create index raci_user_idx on public.raci_assignments (user_id);
select private.harden_table('public.raci_assignments');

create trigger raci_assignments_audit after insert or delete on public.raci_assignments
  for each row execute function private.audit_trigger();

grant select on public.raci_assignments to authenticated;
create policy raci_read on public.raci_assignments for select to authenticated
  using (private.can_read_project(project_id));

-- Fija los roles de UNA persona en UN entregable (reemplaza los que tenía). p_roles vacío = quitarla.
-- Combinaciones válidas: {}, {R}, {A}, {R,A}, {C}, {I}.
create function public.raci_set_cell(p_deliverable uuid, p_user uuid, p_roles text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
  v_org     uuid;
  v_roles   text[];
begin
  select project_id, organization_id into v_project, v_org from public.deliverables where id = p_deliverable;
  if v_project is null then
    -- Sin sesión o sin acceso: mismo mensaje que cualquier otro entregable inexistente
    perform private.require_auth();
    raise exception 'raci_deliverable_not_found' using errcode = 'P0001';
  end if;
  perform private.wbs_authorize(v_project);
  if not exists (select 1 from public.project_members where project_id = v_project and user_id = p_user) then
    raise exception 'raci_not_member' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_roles from unnest(coalesce(p_roles, '{}')) as x;
  if v_roles not in ('{}', '{R}', '{A}', '{A,R}', '{C}', '{I}') then
    raise exception 'invalid_raci' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('raci:' || p_deliverable::text, 0));
  if 'A' = any (v_roles) and exists (
       select 1 from public.raci_assignments where deliverable_id = p_deliverable and role = 'A' and user_id <> p_user) then
    raise exception 'raci_accountable_taken' using errcode = 'P0001';
  end if;
  delete from public.raci_assignments where deliverable_id = p_deliverable and user_id = p_user and role <> all (v_roles);
  insert into public.raci_assignments (organization_id, project_id, deliverable_id, user_id, role)
  select v_org, v_project, p_deliverable, p_user, x from unnest(v_roles) as x
  on conflict (deliverable_id, user_id, role) do nothing;
end $$;
revoke all on function public.raci_set_cell(uuid, uuid, text[]) from public, anon;
grant execute on function public.raci_set_cell(uuid, uuid, text[]) to authenticated, service_role;

-- Para la interfaz: ¿puede esta persona editar el alcance (y por tanto la matriz) de este proyecto?
-- Solo informa; la base de datos vuelve a comprobar al escribir.
create function public.can_edit_scope(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.can_read_project(p_project) and private.has_project_permission(p_project, 'scope.edit'), false)
$$;
revoke all on function public.can_edit_scope(uuid) from public, anon;
grant execute on function public.can_edit_scope(uuid) to authenticated, service_role;
