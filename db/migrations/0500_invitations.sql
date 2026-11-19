-- =============================================================================
-- 0500 · Invitaciones
-- US-005 · token de un solo uso, caducidad 7 días, solo se guarda el hash.
-- Las invitaciones se crean y aceptan únicamente mediante funciones (migración 0800).
-- =============================================================================

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null check (
                    email = lower(btrim(email)) and char_length(email) <= 254
                    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_id         uuid not null references public.roles (id) on delete restrict,
  membership_type text not null check (membership_type in ('internal', 'external')),
  project_id      uuid,
  project_role_id uuid references public.roles (id) on delete restrict,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles (id) on delete set null,
  revoked_at      timestamptz,
  invited_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint invitations_project_pair check ((project_id is null) = (project_role_id is null)),
  constraint invitations_project_only_external check (project_id is null or membership_type = 'external'),
  constraint invitations_state check (not (accepted_at is not null and revoked_at is not null)),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
comment on column public.invitations.token_hash is 'SHA-256 del token. El token en claro solo se devuelve una vez, al invitar.';

-- Una sola invitación pendiente por correo y organización.
create unique index invitations_pending_uk on public.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_org_idx on public.invitations (organization_id);
