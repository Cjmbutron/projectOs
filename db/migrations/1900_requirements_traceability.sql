-- =============================================================================
-- 1900 · Requisitos y trazabilidad (US-015)
--
-- Cadena: requisito → entregable → nodo de la WBS ← actividad.
--  · Requisito: código REQ-001 automático por proyecto, descripción, origen, estado.
--  · Un requisito aprobado (o más avanzado) debe estar vinculado a ≥ 1 entregable; se comprueba
--    al final de cada sentencia, de modo que tampoco se puede quitar su último vínculo.
--  · activities.wbs_node_id vincula una actividad con un nodo de la WBS.
--  · La vista requirement_traceability resume la cobertura (security_invoker: respeta RLS).
-- =============================================================================
alter table public.activities add column wbs_node_id uuid;
alter table public.activities add foreign key (wbs_node_id, project_id)
  references public.wbs_nodes (id, project_id) on delete set null (wbs_node_id);
create index activities_wbs_node_idx on public.activities (wbs_node_id);
grant insert (wbs_node_id) on public.activities to authenticated;
grant update (wbs_node_id) on public.activities to authenticated;

create table public.requirements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  seq             integer not null default 0,
  code            text generated always as ('REQ-' || lpad(seq::text, 3, '0')) stored,
  description     text not null check (char_length(btrim(description)) between 1 and 4000),
  source          text not null check (char_length(btrim(source)) between 1 and 200),
  status          text not null default 'proposed' check (status in ('proposed', 'approved', 'implemented', 'verified', 'rejected')),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, seq),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
select private.harden_table('public.requirements');

create table public.requirement_deliverables (
  requirement_id  uuid not null,
  deliverable_id  uuid not null,
  organization_id uuid not null,
  project_id      uuid not null,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (requirement_id, deliverable_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (requirement_id, project_id) references public.requirements (id, project_id) on delete cascade,
  foreign key (deliverable_id, project_id) references public.deliverables (id, project_id) on delete cascade
);
create index requirement_deliverables_deliverable_idx on public.requirement_deliverables (deliverable_id);
select private.harden_table('public.requirement_deliverables');

-- Código secuencial por proyecto (con cerrojo: dos altas simultáneas no repiten número)
create function private.requirement_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('req:' || new.project_id::text, 0));
    select coalesce(max(seq), 0) + 1 into new.seq from public.requirements where project_id = new.project_id;
  elsif tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id
       or new.seq <> old.seq then
      raise exception 'immutable_column' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.requirement_before() from public, anon, authenticated;
create trigger requirements_before before insert or update or delete on public.requirements
  for each row execute function private.requirement_before();

create function private.requirement_link_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));
  return coalesce(new, old);
end $$;
revoke all on function private.requirement_link_guard() from public, anon, authenticated;
create trigger requirement_deliverables_guard before insert or delete on public.requirement_deliverables
  for each row execute function private.requirement_link_guard();

-- Regla "aprobado ⇒ ≥ 1 entregable", evaluada al final de la sentencia.
create function private.requirement_coverage_check() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := case tg_table_name when 'requirements' then (to_jsonb(coalesce(new, old)) ->> 'id')::uuid
                                  else (to_jsonb(coalesce(new, old)) ->> 'requirement_id')::uuid end;
begin
  if exists (select 1 from public.requirements r
             where r.id = v_id and r.status in ('approved', 'implemented', 'verified')
               and not exists (select 1 from public.requirement_deliverables l where l.requirement_id = r.id)) then
    raise exception 'requirement_needs_deliverable' using errcode = 'P0001';
  end if;
  return null;
end $$;
revoke all on function private.requirement_coverage_check() from public, anon, authenticated;
create constraint trigger requirements_coverage after insert or update of status on public.requirements
  deferrable initially immediate for each row execute function private.requirement_coverage_check();
create constraint trigger requirement_links_coverage after delete on public.requirement_deliverables
  deferrable initially immediate for each row execute function private.requirement_coverage_check();

create trigger requirements_audit after insert or update or delete on public.requirements
  for each row execute function private.audit_trigger();
create trigger requirement_deliverables_audit after insert or delete on public.requirement_deliverables
  for each row execute function private.audit_trigger();

-- RLS
grant select on public.requirements, public.requirement_deliverables to authenticated;
grant insert (organization_id, project_id, description, source, status) on public.requirements to authenticated;
grant update (description, source, status) on public.requirements to authenticated;
grant delete on public.requirements to authenticated;
grant insert (organization_id, project_id, requirement_id, deliverable_id), delete on public.requirement_deliverables to authenticated;

create policy requirements_read on public.requirements for select to authenticated
  using (private.can_read_project(project_id));
create policy requirements_insert on public.requirements for insert to authenticated
  with check (private.has_project_permission(project_id, 'scope.edit'));
create policy requirements_update on public.requirements for update to authenticated
  using (private.has_project_permission(project_id, 'scope.edit'))
  with check (private.has_project_permission(project_id, 'scope.edit'));
create policy requirements_delete on public.requirements for delete to authenticated
  using (private.has_project_permission(project_id, 'scope.edit'));
create policy req_links_read on public.requirement_deliverables for select to authenticated
  using (private.can_read_project(project_id));
create policy req_links_insert on public.requirement_deliverables for insert to authenticated
  with check (private.has_project_permission(project_id, 'scope.edit'));
create policy req_links_delete on public.requirement_deliverables for delete to authenticated
  using (private.has_project_permission(project_id, 'scope.edit'));

-- Cobertura requisito → entregable → nodo → actividad
create view public.requirement_traceability
with (security_invoker = true) as
select r.project_id, r.id as requirement_id, r.code, r.description, r.source, r.status,
       (select count(*) from public.requirement_deliverables l where l.requirement_id = r.id)::int as deliverables,
       (select count(*) from public.requirement_deliverables l join public.deliverables d on d.id = l.deliverable_id
         where l.requirement_id = r.id and d.review_status = 'accepted')::int as deliverables_accepted,
       (select count(distinct a.id) from public.requirement_deliverables l
          join public.deliverables d on d.id = l.deliverable_id
          join public.activities a on a.wbs_node_id = d.wbs_node_id
         where l.requirement_id = r.id)::int as activities
from public.requirements r;
revoke all on public.requirement_traceability from public, anon, authenticated;
grant select on public.requirement_traceability to authenticated;
