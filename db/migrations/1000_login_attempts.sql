-- =============================================================================
-- 1000 · Bloqueo de cuenta por intentos fallidos (RNF-01, US-003)
--
-- Supabase solo limita por IP; el bloqueo por cuenta lo aplica una ruta del servidor
-- (ADR-005) usando estas funciones con service_role. Nunca accesible desde el navegador.
-- Regla: 5 fallos dentro de 15 min → bloqueo de 15 min desde el 5.º fallo; mientras está
-- bloqueada, nuevos intentos NO se registran (no extienden ni levantan el bloqueo).
-- =============================================================================

create table public.login_attempts (
  id           bigint generated always as identity primary key,
  email        text not null check (email = lower(btrim(email))),
  attempted_at timestamptz not null default now(),
  succeeded    boolean not null
);
create index login_attempts_email_idx on public.login_attempts (email, attempted_at desc);

alter table public.login_attempts enable row level security;
alter table public.login_attempts force row level security;
revoke all on table public.login_attempts from public, anon, authenticated;

-- Devuelve el instante hasta el que la cuenta está bloqueada (NULL = no bloqueada).
create function public.login_lock_until(p_email text) returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_last_ok timestamptz;
  v_times timestamptz[];
  v_until timestamptz;
begin
  select max(a.attempted_at) into v_last_ok
  from public.login_attempts a where a.email = v_email and a.succeeded;

  select array_agg(a.attempted_at order by a.attempted_at) into v_times
  from public.login_attempts a
  where a.email = v_email and not a.succeeded
    and a.attempted_at > now() - interval '30 minutes'
    and (v_last_ok is null or a.attempted_at > v_last_ok);

  -- Bloqueo = 15 min tras el 5.º fallo de una ventana de 15 min.
  if v_times is not null and cardinality(v_times) >= 5 then
    for i in 5 .. cardinality(v_times) loop
      if v_times[i] - v_times[i - 4] <= interval '15 minutes'
         and v_times[i] + interval '15 minutes' > now() then
        v_until := v_times[i] + interval '15 minutes';
      end if;
    end loop;
  end if;
  return v_until;
end $$;

-- Registra un intento y devuelve el bloqueo vigente (NULL = no bloqueada).
-- Con la cuenta bloqueada NO se registra nada (ni fallos ni éxitos): ni se extiende el bloqueo
-- ni se puede levantar acertando la clave. La ruta del servidor debe consultar login_lock_until
-- ANTES de validar la contraseña.
create function public.record_login_attempt(p_email text, p_succeeded boolean)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_lock  timestamptz := public.login_lock_until(p_email);
begin
  if v_lock is not null then
    return v_lock;
  end if;
  insert into public.login_attempts (email, succeeded) values (v_email, p_succeeded);
  return public.login_lock_until(v_email);
end $$;

create function public.purge_login_attempts(p_older_than interval default interval '1 day')
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.login_attempts a where a.attempted_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.login_lock_until(text)', 'public.record_login_attempt(text, boolean)',
    'public.purge_login_attempts(interval)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
