-- =============================================================================
-- Reemplazo MÍNIMO de lo que Supabase provee. SOLO PARA PRUEBAS LOCALES / CI.
-- No forma parte de las migraciones: en Supabase real estos objetos ya existen.
--
-- Imita lo que importa para la seguridad:
--   * roles anon / authenticated / service_role (este último con BYPASSRLS)
--   * auth.users, auth.uid(), auth.jwt() leyendo request.jwt.claims (como PostgREST)
--   * los PRIVILEGIOS POR DEFECTO de Supabase en el esquema public (todo concedido a
--     anon/authenticated/service_role). Así se comprueba que las migraciones los revocan.
-- Limitación conocida: no es Supabase. La validación final debe repetirse en un proyecto real.
-- =============================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create function auth.role() returns text
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    ), ''
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
-- Como en Supabase: auth.users NO es accesible para anon/authenticated.

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
