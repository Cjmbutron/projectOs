-- =============================================================================
-- 2500 · Ausencias de recursos (R3, parte 2)
--
-- Una ausencia (vacaciones, licencia, feriado personal) es un rango de fechas de un recurso. Reduce su
-- CAPACIDAD semanal: capacidad = capacidad diaria × (5 − días de lunes a viernes ausentes de esa semana).
-- Las horas asignadas NO cambian (el cronograma no se mueve): si hay trabajo en días de ausencia, la
-- semana queda sobreasignada, que es justo la alerta buscada. Varias ausencias que se cruzan no suman dos
-- veces el mismo día. Permisos: leer = miembros internos; crear/editar/borrar = `resource.manage`.
-- =============================================================================
create table public.resource_absences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  resource_id     uuid not null,
  start_date      date not null,
  end_date        date not null,
  reason          text check (reason is null or char_length(reason) <= 200),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 365),
  foreign key (resource_id, organization_id) references public.resources (id, organization_id) on delete cascade
);
create index resource_absences_resource_idx on public.resource_absences (resource_id, start_date);
select private.harden_table('public.resource_absences');
create trigger resource_absences_audit after insert or update or delete on public.resource_absences
  for each row execute function private.audit_trigger();

grant select on public.resource_absences to authenticated;
grant insert (organization_id, resource_id, start_date, end_date, reason) on public.resource_absences to authenticated;
grant update (start_date, end_date, reason) on public.resource_absences to authenticated;
grant delete on public.resource_absences to authenticated;
create policy resource_absences_read on public.resource_absences for select to authenticated
  using (private.is_internal_member(organization_id));
create policy resource_absences_insert on public.resource_absences for insert to authenticated
  with check (private.has_org_permission(organization_id, 'resource.manage'));
create policy resource_absences_update on public.resource_absences for update to authenticated
  using (private.has_org_permission(organization_id, 'resource.manage'))
  with check (private.has_org_permission(organization_id, 'resource.manage'));
create policy resource_absences_delete on public.resource_absences for delete to authenticated
  using (private.has_org_permission(organization_id, 'resource.manage'));

-- ---------------------------------------------------------------------------
-- resource_load: misma firma y mismas reglas que en 2300, con la capacidad descontando ausencias.
-- ---------------------------------------------------------------------------
create or replace function public.resource_load(p_org uuid, p_from date, p_to date)
returns table (resource_id uuid, week_start date, hours numeric, capacity_hours numeric, overallocated boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.is_internal_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  if p_to - p_from > 372 then
    raise exception 'range_too_large' using errcode = 'P0001';
  end if;
  return query
  with days as (
    select ar.resource_id as rid, r.daily_hours, ar.allocation_percent, g.day::date as day
    from public.activity_resources ar
    join public.resources r on r.id = ar.resource_id and r.organization_id = p_org
    join public.activities a on a.id = ar.activity_id and a.project_id = ar.project_id
    join public.projects p on p.id = ar.project_id
    left join public.project_schedules s on s.project_id = ar.project_id
    cross join lateral generate_series(greatest(a.early_start, p_from), least(a.early_finish, p_to), interval '1 day') g(day)
    where ar.organization_id = p_org
      and p.deleted_at is null and p.status <> 'cancelled'
      and a.early_start is not null and a.early_finish is not null
      and (exists (select 1 from public.project_calendar_days c where c.project_id = ar.project_id and c.day = g.day::date and c.kind = 'working')
           or (extract(dow from g.day)::smallint = any (coalesce(s.working_weekdays, '{1,2,3,4,5}'::smallint[]))
               and not exists (select 1 from public.project_calendar_days c where c.project_id = ar.project_id and c.day = g.day::date and c.kind = 'holiday')))
  ),
  weekly as (
    select d.rid, date_trunc('week', d.day)::date as wk, d.daily_hours,
           sum(d.allocation_percent / 100.0 * d.daily_hours) as h
    from days d
    group by d.rid, date_trunc('week', d.day)::date, d.daily_hours
  ),
  absent as (   -- días distintos de lunes a viernes con ausencia, por recurso y semana
    select x.rid, date_trunc('week', x.day)::date as wk, count(*) as n
    from (
      select distinct ab.resource_id as rid, g.day::date as day
      from public.resource_absences ab
      join (select distinct w0.rid, w0.wk from weekly w0) wk0 on wk0.rid = ab.resource_id
      cross join lateral generate_series(greatest(ab.start_date, wk0.wk), least(ab.end_date, wk0.wk + 4), interval '1 day') g(day)
      where ab.organization_id = p_org
    ) x
    group by x.rid, date_trunc('week', x.day)::date
  )
  select w.rid, w.wk, round(w.h, 2),
         round(w.daily_hours * (5 - coalesce(ab.n, 0)), 2),
         (round(w.h, 2) > round(w.daily_hours * (5 - coalesce(ab.n, 0)), 2))
  from weekly w
  left join absent ab on ab.rid = w.rid and ab.wk = w.wk
  order by w.rid, w.wk;
end $$;
