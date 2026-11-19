#!/usr/bin/env bash
# Prueba de mutación de la seguridad: introduce defectos deliberados en una copia de las
# migraciones y exige que la batería de pruebas FALLE en cada uno. Si algún defecto
# "sobrevive" (la batería sigue en verde), faltan pruebas.
# Uso: db/tests/mutation_check.sh
set -uo pipefail
cd "$(dirname "$0")"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export POS_TEST_DB="${POS_TEST_DB:-pos_mut}"
survivors=0; total=0

mutate() {   # mutate "<descripción>" <archivo> "<texto original>" "<texto nuevo>"
  local desc="$1" file="$2" old="$3" new="$4"
  rm -rf "$WORK/m"; mkdir "$WORK/m"; cp ../migrations/*.sql "$WORK/m/"
  python3 - "$WORK/m/$file" "$old" "$new" <<'PY' || { echo "NO APLICABLE: $desc"; survivors=$((survivors+1)); return; }
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
if s.count(old) != 1:
    sys.exit(f"el texto aparece {s.count(old)} veces")
open(p, "w").write(s.replace(old, new))
PY
  total=$((total+1))
  if POS_MIGRATIONS_DIR="$WORK/m" ./run.sh >/dev/null 2>&1; then
    echo "SOBREVIVIÓ  $desc"; survivors=$((survivors+1))
  else
    echo "detectado   $desc"
  fi
}

mutate "projects_read sin control de acceso" 0900_rls_and_grants.sql \
  "using (private.can_read_project(id)
         and (deleted_at is null" "using (true
         and (deleted_at is null"
mutate "members_read abierto a todos" 0900_rls_and_grants.sql \
  "using (user_id = auth.uid() or private.has_org_permission(organization_id, 'org.members.read'));" "using (true);"
mutate "organizations_update sin permiso" 0900_rls_and_grants.sql \
  "using (private.has_org_permission(id, 'org.settings.manage'))
  with check" "using (private.is_active_member(id))
  with check"
mutate "audit_read abierto a miembros" 0900_rls_and_grants.sql \
  "using (organization_id is not null and private.has_org_permission(organization_id, 'audit.read'));" "using (private.is_active_member(organization_id));"
mutate "no se revocan privilegios a anon" 0900_rls_and_grants.sql \
  "execute format('revoke all on table public.%I from public, anon, authenticated', t);" "null;"
mutate "RLS no forzado" 0900_rls_and_grants.sql \
  "execute format('alter table public.%I force row level security', t);" "null;"
mutate "token_hash legible" 0900_rls_and_grants.sql \
  "grant select (id, organization_id, email, role_id, membership_type, project_id, project_role_id,
              expires_at, accepted_at, accepted_by, revoked_at, invited_by, created_at)" "grant select"
mutate "status de proyectos escribible" 0900_rls_and_grants.sql \
  "grant update (name, description, responsible_id, complexity_profile, priority, sort_order," "grant update (status, name, description, responsible_id, complexity_profile, priority, sort_order,"
mutate "MFA no se exige" 0700_security_helpers.sql \
  "as \$\$ select private.is_active_member(p_org) and private.mfa_satisfied(p_org) \$\$;" "as \$\$ select private.is_active_member(p_org) \$\$;"
mutate "externos ven proyectos de visibilidad organización" 0700_security_helpers.sql \
  "and m.status = 'active' and m.membership_type = 'internal'))" "and m.status = 'active'))"
mutate "has_org_permission ignora la organización" 0700_security_helpers.sql \
  "where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and rp.permission_code = p_code)" "where m.user_id = auth.uid()
      and m.status = 'active' and rp.permission_code = p_code)"
mutate "accept_invitation no valida el correo" 0800_functions_api.sql \
  "or v_inv.expires_at <= now() or lower(v_user.email) is distinct from v_inv.email then" "or v_inv.expires_at <= now() then"
mutate "accept_invitation no valida caducidad" 0800_functions_api.sql \
  "or v_inv.expires_at <= now() or lower(v_user.email)" "or lower(v_user.email)"
mutate "admin puede otorgar owner al invitar" 0800_functions_api.sql \
  "if private.role_is_owner(p_role) and not private.is_org_owner(p_org) then
    raise exception 'only_owner_can_change_owner' using errcode = '42501';
  end if;

  if p_project" "if p_project"
mutate "change_project_status sin permiso" 0800_functions_api.sql \
  "if not private.has_project_permission(p_project, v_rule.required_permission) then" "if false then"
mutate "reopen_project sin motivo" 0800_functions_api.sql \
  "if nullif(btrim(coalesce(p_reason, '')), '') is null then" "if false then"
mutate "create_organization sin correo verificado" 0800_functions_api.sql \
  "if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then" "if false then"
mutate "transición extra draft→approved" 0400_portfolios_programs_projects.sql \
  "  ('proposed',  'approved',  'project.approve',       false)," "  ('draft', 'approved', 'project.change_status', false),
  ('proposed',  'approved',  'project.approve',       false),"
mutate "aprobar sin project.approve" 0400_portfolios_programs_projects.sql \
  "  ('proposed',  'approved',  'project.approve',       false)," "  ('proposed',  'approved',  'project.change_status', false),"
mutate "sin protección del último owner" 0300_organizations_and_rbac.sql \
  "create trigger organization_members_last_owner before update or delete on public.organization_members
  for each row execute function private.protect_last_owner();" "-- sin protección"
mutate "auditoría actualizable" 0600_audit.sql \
  "create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.audit_immutable();" "-- sin bloqueo"
mutate "auditoría guarda token_hash" 0600_audit.sql \
  "as \$\$ select p_values - 'token_hash' \$\$;" "as \$\$ select p_values \$\$;"
mutate "login: un acierto levanta el bloqueo" 1000_login_attempts.sql \
  "  if v_lock is not null then
    return v_lock;
  end if;" "  if v_lock is not null and not p_succeeded then
    return v_lock;
  end if;"
mutate "panel sin security_invoker" 1100_dashboard.sql \
  "with (security_invoker = true) as" "as"

echo "----"
echo "Mutaciones: $total · sobrevivientes: $survivors"
[ "$survivors" -eq 0 ]
