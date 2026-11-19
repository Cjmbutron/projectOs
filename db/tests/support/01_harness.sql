-- =============================================================================
-- Arnés de pruebas (solo pruebas). Esquema t.
--  t.as_user(nombre, aal) / t.as_anon() / t.as_service() / t.reset(): cambian de identidad
--  igual que PostgREST: fijan request.jwt.claims y el rol de base de datos.
--  t.ok / t.eq / t.throws / t.lives / t.count_of / t.affected: aserciones (avisan PASS/FAIL).
-- =============================================================================
create schema t;
grant usage on schema t to public;

create function t.uid(p_name text) returns uuid language sql immutable
as $$ select md5('pos-test-user:' || p_name)::uuid $$;

create function t.as_user(p_name text, p_aal text default 'aal1') returns void
language plpgsql as $$
begin
  perform t.reset();
  perform set_config('request.jwt.claims',
    json_build_object('sub', t.uid(p_name), 'role', 'authenticated', 'aal', p_aal)::text, false);
  set role authenticated;
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  perform t.reset();
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  set role anon;
end $$;

create function t.as_service() returns void language plpgsql as $$
begin
  perform t.reset();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
end $$;

create function t.reset() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', false);
end $$;

create function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'PASS: %', p_name;
  else raise notice 'FAIL: %', p_name; end if;
end $$;

create function t.eq(p_name text, p_actual anyelement, p_expected anyelement) returns void
language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then raise notice 'PASS: %', p_name;
  else raise notice 'FAIL: % (obtenido %, esperado %)', p_name, p_actual, p_expected; end if;
end $$;

-- Ejecuta p_sql con la identidad actual; debe fallar. p_expect: SQLSTATE exacto o texto
-- contenido en el mensaje.
create function t.throws(p_name text, p_sql text, p_expect text default null) returns void
language plpgsql as $$
declare
  v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_expect is null or v_state = p_expect or position(lower(p_expect) in lower(v_msg)) > 0 then
      raise notice 'PASS: %', p_name;
    else
      raise notice 'FAIL: % (error inesperado [%] %; esperado %)', p_name, v_state, v_msg, p_expect;
    end if;
    return;
  end;
  raise notice 'FAIL: % (no produjo error)', p_name;
end $$;

create function t.lives(p_name text, p_sql text) returns void language plpgsql as $$
declare
  v_state text; v_msg text;
begin
  execute p_sql;
  raise notice 'PASS: %', p_name;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  raise notice 'FAIL: % (error [%] %)', p_name, v_state, v_msg;
end $$;

create function t.count_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from (%s) x', p_sql) into v;
  return v;
end $$;

-- Filas afectadas por un INSERT/UPDATE/DELETE (con RLS, 0 = silenciosamente filtrado).
create function t.affected(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end $$;

-- Valor escalar como texto.
create function t.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select (%s)::text', p_sql) into v;
  return v;
end $$;

-- Identificadores de fixtures (se escriben como superusuario).
create table t.fx (key text primary key, id uuid not null);
grant select on t.fx to public;
create function t.fx(p_key text) returns uuid language sql stable as
$$ select id from t.fx where key = p_key $$;
create function t.fx_set(p_key text, p_id uuid) returns void
language sql security definer as
$$ insert into t.fx values (p_key, p_id) on conflict (key) do update set id = excluded.id $$;

create function t.mk_user(p_name text, p_verified boolean default true) returns void
language sql security definer as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  values (t.uid(p_name), p_name || '@test.local',
          case when p_verified then now() end,
          '{"terms_version":"2026-11","privacy_version":"2026-11"}'::jsonb)
$$;

-- Incorpora a p_user a la organización p_org_key mediante invitación real (invitar + aceptar).
create function t.join(p_org_key text, p_inviter text, p_user text, p_role_key text,
                       p_type text default 'internal', p_project_key text default null,
                       p_project_role_key text default null) returns void
language plpgsql as $$
declare
  v_token text;
begin
  perform t.as_user(p_inviter);
  select i.token into v_token from public.invite_member(
    t.fx(p_org_key), p_user || '@test.local',
    private.role_id('organization', p_role_key), p_type,
    case when p_project_key is null then null else t.fx(p_project_key) end,
    case when p_project_role_key is null then null else private.role_id('project', p_project_role_key) end) i;
  perform t.as_user(p_user);
  perform public.accept_invitation(v_token);
  perform t.reset();
end $$;
