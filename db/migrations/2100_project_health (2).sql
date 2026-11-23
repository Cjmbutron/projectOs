-- =============================================================================
-- 2100 · Salud del proyecto (verde / ámbar / rojo)
--
-- La salud es un indicador CALCULADO (nadie la edita): atraso del fin del proyecto respecto
-- de la última línea base, en días laborables del calendario del proyecto.
--     verde  : atraso ≤ health_amber_days
--     ámbar  : health_amber_days < atraso ≤ health_red_days
--     rojo   : atraso > health_red_days
--     unknown: sin línea base o sin fechas calculadas
-- Los umbrales son de la organización (valores iniciales confirmados por el usuario: 2 y 5).
-- Se recalcula sola cuando cambian las
-- fechas calculadas, se crea una línea base o cambian los umbrales.
-- =============================================================================
alter table public.organizations
  add column health_amber_days integer not null default 2 check (health_amber_days between 0 and 3650),
  add column health_red_days   integer not null default 5 check (health_red_days between 0 and 3650),
  add constraint organizations_health_thresholds check (health_red_days >= health_amber_days);
grant update (health_amber_days, health_red_days) on public.organizations to authenticated;

-- Días laborables con signo entre dos fechas del proyecto: días laborables en (desde, hasta].
-- Para fechas que son días laborables coincide con la diferencia que calcula el motor.
create function private.working_days_between(p_project uuid, p_from date, p_to date) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_weekdays smallint[];
  v_lo date := least(p_from, p_to);
  v_hi date := greatest(p_from, p_to);
  v_n integer;
begin
  if v_hi - v_lo > 36600 then
    raise exception 'date_range_too_large' using errcode = 'P0001';
  end if;
  select working_weekdays into v_weekdays from public.project_schedules where project_id = p_project;
  if v_weekdays is null then
    v_weekdays := '{1,2,3,4,5}';
  end if;
  select count(*) into v_n
  from generate_series(v_lo + 1, v_hi, interval '1 day') g(day)
  where exists (select 1 from public.project_calendar_days c where c.project_id = p_project and c.day = g.day::date and c.kind = 'working')
     or (extract(dow from g.day)::smallint = any (v_weekdays)
         and not exists (select 1 from public.project_calendar_days c where c.project_id = p_project and c.day = g.day::date and c.kind = 'holiday'));
  return case when p_to >= p_from then v_n else -v_n end;
end $$;
revoke all on function private.working_days_between(uuid, date, date) from public, anon, authenticated;

create function private.refresh_project_health(p_project uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_finish date;
  v_base_finish date;
  v_amber integer;
  v_red integer;
  v_variance integer;
  v_health text := 'unknown';
begin
  select s.computed_finish into v_finish from public.project_schedules s where s.project_id = p_project;
  select b.project_finish into v_base_finish from public.baselines b where b.project_id = p_project order by b.version desc limit 1;
  select o.health_amber_days, o.health_red_days into v_amber, v_red
  from public.projects p join public.organizations o on o.id = p.organization_id where p.id = p_project;
  if v_amber is null then
    return;   -- proyecto inexistente (p. ej. purga en curso)
  end if;
  if v_finish is not null and v_base_finish is not null then
    v_variance := private.working_days_between(p_project, v_base_finish, v_finish);
    v_health := case when v_variance <= v_amber then 'green' when v_variance <= v_red then 'amber' else 'red' end;
  end if;
  update public.projects set health = v_health where id = p_project and health is distinct from v_health;
end $$;
revoke all on function private.refresh_project_health(uuid) from public, anon, authenticated;

create function private.health_after_schedule() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.refresh_project_health(new.project_id);
  return null;
end $$;
revoke all on function private.health_after_schedule() from public, anon, authenticated;
create trigger project_schedules_health after insert or update of computed_finish on public.project_schedules
  for each row execute function private.health_after_schedule();

create function private.health_after_baseline() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.refresh_project_health(new.project_id);
  return null;
end $$;
revoke all on function private.health_after_baseline() from public, anon, authenticated;
create trigger baselines_health after insert on public.baselines
  for each row execute function private.health_after_baseline();

create function private.health_after_thresholds() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.health_amber_days is distinct from old.health_amber_days or new.health_red_days is distinct from old.health_red_days then
    for v_id in select p.id from public.projects p where p.organization_id = new.id loop
      perform private.refresh_project_health(v_id);
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.health_after_thresholds() from public, anon, authenticated;
create trigger organizations_health after update of health_amber_days, health_red_days on public.organizations
  for each row execute function private.health_after_thresholds();
