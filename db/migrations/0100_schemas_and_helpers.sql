-- =============================================================================
-- 0100 · Esquema privado, utilidades comunes
-- Convenciones de todo el esquema (ver db/README.md):
--   * Tablas de negocio en `public` (expuestas por la API) con RLS activo.
--   * Funciones auxiliares de seguridad en `private` (no expuesto por la API).
--   * Toda función SECURITY DEFINER fija `search_path = ''` y califica sus objetos.
--   * Se revocan los privilegios por defecto de Supabase y se concede lo mínimo.
-- =============================================================================

create schema if not exists private;
comment on schema private is 'Funciones auxiliares de seguridad. No debe exponerse por la API.';
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Nivel de aseguramiento de la sesión (Supabase lo incluye en el JWT: aal1 | aal2).
create function private.current_aal() returns text
language sql stable set search_path = ''
as $$ select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1') $$;

revoke all on function private.current_aal() from public, anon;
grant execute on function private.current_aal() to authenticated, service_role;

-- Mantiene updated_at.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
