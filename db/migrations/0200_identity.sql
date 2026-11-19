-- =============================================================================
-- 0200 · Identidad: perfiles y aceptación de términos
-- US-001 (registro, consentimiento legal) · US-063 (perfil, idioma)
-- El correo vive solo en auth.users y no se edita desde aquí.
-- =============================================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  locale       text not null default 'es' check (locale in ('es', 'en')),
  timezone     text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Perfil de cada persona usuaria (1:1 con auth.users). Sin correo.';

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create function private.profiles_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023', detail = new.timezone;
  end if;
  return new;
end $$;
revoke all on function private.profiles_guard() from public, anon, authenticated;

create trigger profiles_guard before insert or update of timezone on public.profiles
  for each row execute function private.profiles_guard();

-- Evidencia de consentimiento (términos y política de privacidad) con versión y fecha.
create table public.legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy')),
  version     text not null check (char_length(version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);
comment on table public.legal_acceptances is 'Aceptación de documentos legales por persona, con versión y fecha.';

-- Al crearse un usuario en auth.users se crea su perfil. Si el registro trae
-- terms_version / privacy_version en los metadatos, se registra la aceptación.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name   text;
  v_locale text;
begin
  v_name := nullif(btrim(coalesce(v_meta ->> 'display_name', v_meta ->> 'full_name', '')), '');
  if v_name is null then
    v_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  v_name   := left(coalesce(v_name, 'Usuario'), 120);
  v_locale := case when v_meta ->> 'locale' in ('es', 'en') then v_meta ->> 'locale' else 'es' end;

  insert into public.profiles (id, display_name, locale) values (new.id, v_name, v_locale);

  if nullif(v_meta ->> 'terms_version', '') is not null then
    insert into public.legal_acceptances (user_id, document, version)
    values (new.id, 'terms', left(v_meta ->> 'terms_version', 32));
  end if;
  if nullif(v_meta ->> 'privacy_version', '') is not null then
    insert into public.legal_acceptances (user_id, document, version)
    values (new.id, 'privacy', left(v_meta ->> 'privacy_version', 32));
  end if;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
