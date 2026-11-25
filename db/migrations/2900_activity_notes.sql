-- =============================================================================
-- 2900 · Notas en las actividades (se ven en las tarjetas del tablero Kanban)
--
-- Una actividad puede tener varias notas de texto (1–2 000 caracteres), cada una con autor y fecha.
-- Son comentarios INTERNOS del equipo:
--  · Las leen solo miembros internos activos de la organización con acceso al proyecto (también un visor
--    interno); un cliente o un externo (invitado) no las ve, porque pueden contener opiniones del equipo.
--    Escribir además exige schedule.edit o un rol PM / líder técnico / colaborador en el proyecto.
--  · Cada quien edita y borra SUS notas; quien tiene schedule.edit (PM, líder técnico) borra cualquiera.
--  · En un proyecto cerrado o cancelado las notas quedan en solo lectura.
--  · Al borrar la actividad se borran sus notas; si el autor se elimina, la nota queda sin autor.
-- =============================================================================
create table public.activity_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  activity_id     uuid not null,
  author_id       uuid references public.profiles (id) on delete set null default auth.uid(),
  body            text not null check (body ~ '\S' and char_length(body) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (activity_id, project_id) references public.activities (id, project_id) on delete cascade
);
create index activity_notes_activity_idx on public.activity_notes (activity_id, created_at);
create index activity_notes_project_idx on public.activity_notes (project_id);
select private.harden_table('public.activity_notes');

create trigger activity_notes_touch before update on public.activity_notes
  for each row execute function private.touch_updated_at();
create trigger activity_notes_audit after insert or update or delete on public.activity_notes
  for each row execute function private.audit_trigger();

-- ¿Miembro interno activo de la organización del proyecto, con acceso de lectura al proyecto?
create function private.can_read_notes(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.can_read_project(p_project), false) and exists (
    select 1 from public.projects p
    join public.organization_members m
      on m.organization_id = p.organization_id and m.user_id = auth.uid()
     and m.status = 'active' and m.membership_type = 'internal'
    where p.id = p_project and p.deleted_at is null)
$$;
revoke all on function private.can_read_notes(uuid) from public, anon, authenticated;

-- ¿Puede escribir notas? Lector interno + (schedule.edit o rol PM / líder técnico / colaborador en el proyecto).
create function private.can_write_notes(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_notes(p_project) and (
    coalesce(private.has_project_permission(p_project, 'schedule.edit'), false)
    or exists (
      select 1 from public.project_members pm
      join public.roles r on r.id = pm.role_id and r.is_system and r.scope = 'project'
       and r.key in ('project_manager', 'team_lead', 'contributor')
      where pm.project_id = p_project and pm.user_id = auth.uid()))
$$;
revoke all on function private.can_write_notes(uuid) from public, anon, authenticated;
grant execute on function private.can_read_notes(uuid), private.can_write_notes(uuid) to authenticated;

grant select on public.activity_notes to authenticated;
grant insert (organization_id, project_id, activity_id, body) on public.activity_notes to authenticated;
grant update (body) on public.activity_notes to authenticated;
grant delete on public.activity_notes to authenticated;

create policy activity_notes_read on public.activity_notes for select to authenticated
  using (private.can_read_notes(project_id));
create policy activity_notes_insert on public.activity_notes for insert to authenticated
  with check (private.can_write_notes(project_id) and author_id = auth.uid() and private.project_is_writable(project_id));
create policy activity_notes_update on public.activity_notes for update to authenticated
  using (author_id = auth.uid() and private.can_write_notes(project_id) and private.project_is_writable(project_id))
  with check (author_id = auth.uid() and private.can_write_notes(project_id) and private.project_is_writable(project_id));
create policy activity_notes_delete on public.activity_notes for delete to authenticated
  using (private.project_is_writable(project_id) and private.can_read_notes(project_id)
         and ((author_id = auth.uid() and private.can_write_notes(project_id))
              or coalesce(private.has_project_permission(project_id, 'schedule.edit'), false)));

-- Para la interfaz: ¿puede quien consulta escribir notas? (la decisión real la toma RLS)
create function public.can_write_notes(p_project uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.can_write_notes(p_project), false) $$;
revoke all on function public.can_write_notes(uuid) from public, anon;
grant execute on function public.can_write_notes(uuid) to authenticated, service_role;
