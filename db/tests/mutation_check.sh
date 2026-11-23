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
mutate "externos ven proyectos de visibilidad organización" 1200_schedule_core.sql \
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

# ---- R2: cronograma ----
mutate "apply_schedule ignora la versión (sin bloqueo optimista)" 1400_schedule_api.sql \
  "if v_sched.schedule_version <> p_expected_version then" "if false then"
mutate "apply_schedule sin comprobar permiso del actor" 1400_schedule_api.sql \
  "if p_actor is null or not private.user_can_project(p_actor, p_project, 'schedule.edit') then" "if false then"
mutate "apply_schedule ejecutable por usuarios" 1400_schedule_api.sql \
  "grant execute on function public.apply_schedule(uuid, integer, uuid, jsonb, jsonb) to service_role;" "grant execute on function public.apply_schedule(uuid, integer, uuid, jsonb, jsonb) to authenticated, service_role;"
mutate "avance sin comprobar permiso" 1400_schedule_api.sql \
  "if not coalesce(private.has_project_permission(v_act.project_id, 'schedule.edit')" "if false and coalesce(private.has_project_permission(v_act.project_id, 'schedule.edit')"
mutate "línea base sin exigir cronograma al día" 1400_schedule_api.sql \
  "if v_sched.computed_version is distinct from v_sched.schedule_version then" "if false then"
mutate "sin guardia de ciclos" 1200_schedule_core.sql \
  "create trigger dependencies_cycle_guard before insert on public.activity_dependencies
  for each row execute function private.dependencies_cycle_guard();" "-- sin guardia"
mutate "la duración no sube la versión" 1200_schedule_core.sql \
  "create trigger activities_bump_duration after update of duration on public.activities
  for each row when (old.duration is distinct from new.duration)
  execute function private.bump_schedule_trigger();" "-- sin bump"
mutate "actividades editables en proyecto cerrado" 1200_schedule_core.sql \
  "  perform private.assert_project_writable(v_project);
  if tg_op = 'DELETE' then
    return old;
  end if;" "  if tg_op = 'DELETE' then
    return old;
  end if;"
mutate "papelera visible para miembros (datos hijos)" 1200_schedule_core.sql \
  "      and (p.deleted_at is null or private.has_project_permission(p.id, 'project.delete'))
" ""
mutate "línea base modificable" 1300_baselines.sql \
  "create trigger baselines_immutable before update or delete on public.baselines
  for each row execute function private.baseline_immutable();" "-- sin bloqueo"
mutate "actividades: inserción sin permiso" 1500_schedule_rls.sql \
  "create policy activities_insert on public.activities for insert to authenticated
  with check (private.has_project_permission(project_id, 'schedule.edit'));" "create policy activities_insert on public.activities for insert to authenticated
  with check (true);"
mutate "fechas calculadas escribibles por usuarios" 1500_schedule_rls.sql \
  "grant update (phase_id, name, description, duration, assignee_id, sort_order) on public.activities to authenticated;" "grant update (early_start, phase_id, name, description, duration, assignee_id, sort_order) on public.activities to authenticated;"
mutate "dependencias legibles por cualquier usuario" 1500_schedule_rls.sql \
  "create policy dependencies_read on public.activity_dependencies for select to authenticated
  using (private.can_read_project(project_id));" "create policy dependencies_read on public.activity_dependencies for select to authenticated
  using (true);"
mutate "líneas base legibles por cualquier usuario" 1500_schedule_rls.sql \
  "create policy baselines_read on public.baselines for select to authenticated
  using (private.can_read_project(project_id));" "create policy baselines_read on public.baselines for select to authenticated
  using (true);"

mutate "avance: sin coalesce externo (NULL salta el rechazo)" 1400_schedule_api.sql \
  "if not coalesce(private.has_project_permission(v_act.project_id, 'schedule.edit')
          or (coalesce(v_act.assignee_id = v_uid, false)" "if not (private.has_project_permission(v_act.project_id, 'schedule.edit')
          or (v_act.assignee_id = v_uid"
mutate "guardia de ciclos con privilegios elevados (filtra el grafo)" 1200_schedule_core.sql \
  "create function private.dependencies_cycle_guard() returns trigger
language plpgsql set search_path = ''" "create function private.dependencies_cycle_guard() returns trigger
language plpgsql security definer set search_path = ''"

mutate "import: función con privilegios elevados (salta RLS)" 1700_import_activities.sql \
  "language plpgsql security invoker set search_path = ''" "language plpgsql security definer set search_path = ''"
mutate "import: sin comprobar permiso de edición" 1700_import_activities.sql \
  "if not public.can_edit_schedule(p_project) then" "if false then"
mutate "import: sin límite de filas" 1700_import_activities.sql \
  "jsonb_array_length(p_rows) > 1000" "jsonb_array_length(p_rows) > 100000"
mutate "import: permite autodependencia" 1700_import_activities.sql \
  "if v_pref = v_ref then" "if false then"
mutate "import: acepta ref repetido" 1700_import_activities.sql \
  "if v_ids ? v_ref then" "if false then"
mutate "import: acepta duración decimal" 1700_import_activities.sql \
  "(v_row ->> 'duration') !~ '^[0-9]{1,5}\$'" "false"

mutate "wbs: sin comprobar scope.edit" 1800_wbs_deliverables.sql \
  "if not private.can_read_project(p_project) or not private.has_project_permission(p_project, 'scope.edit') then" "if not private.can_read_project(p_project) then"
mutate "wbs: permite mover bajo un descendiente" 1800_wbs_deliverables.sql \
  "if p_parent = p_node or exists (" "if false and exists ("
mutate "wbs: permite borrar nodos con hijos" 1800_wbs_deliverables.sql \
  "if exists (select 1 from public.wbs_nodes where parent_id = p_node) then" "if false then"
mutate "wbs: sin límite de profundidad" 1800_wbs_deliverables.sql \
  "if v_depth > 10 then" "if v_depth > 1000 then"
mutate "wbs: FK de padre en cascada (borra subárboles)" 1800_wbs_deliverables.sql \
  "on delete restrict" "on delete cascade"
mutate "wbs: el código se puede editar a mano" 1800_wbs_deliverables.sql \
  "grant update (name, description) on public.wbs_nodes" "grant update (name, description, code) on public.wbs_nodes"
mutate "wbs: se edita en proyecto cerrado" 1800_wbs_deliverables.sql \
  "create function private.wbs_direct_guard() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));" "create function private.wbs_direct_guard() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  null;"
mutate "entregables: cualquiera con scope.edit cambia la revisión" 1800_wbs_deliverables.sql \
  "      if new.review_status <> old.review_status
         and not private.has_project_permission(new.project_id, 'scope.review') then" "      if false then"
mutate "entregables: se crea ya aceptado sin scope.review" 1800_wbs_deliverables.sql \
  "if tg_op = 'INSERT' and tg_table_name = 'deliverables' and new.review_status <> 'pending'" "if false and new.review_status <> 'pending'"
mutate "wbs: recodificación sin reordenar hermanos" 1800_wbs_deliverables.sql \
  "update public.wbs_nodes set position = position * 2 where project_id = p_project and parent_id is not distinct from p_parent;" "null;"

mutate "requisitos: se aprueban sin entregable" 1900_requirements_traceability.sql \
  "r.id = v_id and r.status in ('approved', 'implemented', 'verified')" "r.id = v_id and r.status in ('approved')"
mutate "requisitos: quitar el último vínculo no se comprueba" 1900_requirements_traceability.sql \
  "create constraint trigger requirement_links_coverage after delete on public.requirement_deliverables
  deferrable initially immediate for each row execute function private.requirement_coverage_check();" "select 1;"
mutate "requisitos: el código se repite (sin cerrojo ni máximo)" 1900_requirements_traceability.sql \
  "select coalesce(max(seq), 0) + 1 into new.seq from public.requirements where project_id = new.project_id;" "new.seq := 1;"
mutate "requisitos: seq editable" 1900_requirements_traceability.sql \
  "       or new.seq <> old.seq then" "       or false then"
mutate "requisitos: lectura abierta a cualquiera" 1900_requirements_traceability.sql \
  "create policy requirements_read on public.requirements for select to authenticated
  using (private.can_read_project(project_id));" "create policy requirements_read on public.requirements for select to authenticated
  using (true);"
mutate "requisitos: se escriben sin scope.edit" 1900_requirements_traceability.sql \
  "create policy requirements_insert on public.requirements for insert to authenticated
  with check (private.has_project_permission(project_id, 'scope.edit'));" "create policy requirements_insert on public.requirements for insert to authenticated
  with check (true);"
mutate "trazabilidad: la vista salta RLS" 1900_requirements_traceability.sql \
  "create view public.requirement_traceability
with (security_invoker = true) as" "create view public.requirement_traceability
with (security_invoker = false) as"
mutate "trazabilidad: cuenta entregables no aceptados como aceptados" 1900_requirements_traceability.sql \
  "where l.requirement_id = r.id and d.review_status = 'accepted')" "where l.requirement_id = r.id)"
mutate "requisitos: se editan en proyecto cerrado" 1900_requirements_traceability.sql \
  "create function private.requirement_before() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));" "create function private.requirement_before() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  null;"

mutate "charter: sin compuerta draft → proposed" 2000_project_charter.sql \
  "if old.status = 'draft' and new.status = 'proposed' then" "if false then"
mutate "charter: objetivos de cualquier longitud" 2000_project_charter.sql \
  "coalesce(char_length(btrim(c.objectives)), 0) < 10" "coalesce(char_length(btrim(c.objectives)), 0) < 0"
mutate "charter: alcance de cualquier longitud" 2000_project_charter.sql \
  "coalesce(char_length(btrim(c.scope)), 0) < 10" "coalesce(char_length(btrim(c.scope)), 0) < 0"
mutate "charter: no exige stakeholders" 2000_project_charter.sql \
  "case when not exists (select 1 from public.project_stakeholders s" "case when false and not exists (select 1 from public.project_stakeholders s"
mutate "charter: editable tras aprobar" 2000_project_charter.sql \
  "v_status not in ('draft', 'proposed')" "v_status not in ('draft', 'proposed', 'approved')"
mutate "charter: stakeholder interno de otra organización" 2000_project_charter.sql \
  "if tg_op <> 'DELETE' and new.user_id is not null and not exists (" "if false and not exists ("
mutate "charter: lectura abierta" 2000_project_charter.sql \
  "create policy charters_read on public.project_charters for select to authenticated
  using (private.can_read_project(project_id));" "create policy charters_read on public.project_charters for select to authenticated
  using (true);"
mutate "charter: se escribe sin project.update" 2000_project_charter.sql \
  "create policy charters_insert on public.project_charters for insert to authenticated
  with check (private.has_project_permission(project_id, 'project.update'));" "create policy charters_insert on public.project_charters for insert to authenticated
  with check (true);"
mutate "stakeholders: se editan en proyecto cerrado" 2000_project_charter.sql \
  "create function private.stakeholder_guard() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  perform private.assert_project_writable(coalesce(new.project_id, old.project_id));" "create function private.stakeholder_guard() returns trigger
language plpgsql security definer set search_path = ''
as \$\$
begin
  null;"
mutate "charter_status revela proyectos ajenos" 2000_project_charter.sql \
  "  if not private.can_read_project(p_project) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  v_missing :=" "  v_missing :="
mutate "stakeholders: escritura abierta" 2000_project_charter.sql \
  "create policy stakeholders_insert on public.project_stakeholders for insert to authenticated
  with check (private.has_project_permission(project_id, 'project.update'));" "create policy stakeholders_insert on public.project_stakeholders for insert to authenticated
  with check (true);"

echo "----"
echo "Mutaciones: $total · sobrevivientes: $survivors"
[ "$survivors" -eq 0 ]
