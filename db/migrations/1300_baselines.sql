-- =============================================================================
-- 1300 · Líneas base (US-024)
-- Instantánea INMUTABLE del cronograma. Un cambio produce otra versión.
-- Se crean solo con create_baseline (1400) a partir de fechas ya calculadas por el servidor.
-- =============================================================================

create table public.baselines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  version         integer not null check (version >= 1),
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  project_start   date not null,
  project_finish  date not null,
  captured_at     timestamptz not null default now(),
  captured_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  unique (project_id, version),
  unique (id, project_id),
  constraint baselines_dates check (project_finish >= project_start),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
select private.harden_table('public.baselines');

create table public.baseline_activities (
  baseline_id     uuid not null,
  organization_id uuid not null,
  project_id      uuid not null,
  activity_id     uuid not null,          -- sin FK: la actividad puede borrarse; la línea base la conserva
  name            text not null,
  start_date      date not null,
  finish_date     date not null,
  duration        integer not null check (duration >= 0),
  primary key (baseline_id, activity_id),
  constraint baseline_activities_dates check (finish_date >= start_date),
  foreign key (baseline_id, project_id) references public.baselines (id, project_id) on delete cascade,
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
select private.harden_table('public.baseline_activities');

-- Inmutables: ni UPDATE ni DELETE (salvo la cascada al purgar el proyecto entero).
create function private.baseline_immutable() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;
  raise exception 'baseline_is_immutable' using errcode = '42501';
end $$;
revoke all on function private.baseline_immutable() from public, anon, authenticated;

create trigger baselines_immutable before update or delete on public.baselines
  for each row execute function private.baseline_immutable();
create trigger baseline_activities_immutable before update or delete on public.baseline_activities
  for each row execute function private.baseline_immutable();
create trigger baselines_no_truncate before truncate on public.baselines
  for each statement execute function private.baseline_immutable();
create trigger baseline_activities_no_truncate before truncate on public.baseline_activities
  for each statement execute function private.baseline_immutable();

create trigger baselines_audit after insert or update or delete on public.baselines
  for each row execute function private.audit_trigger();
