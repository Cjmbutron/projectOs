#!/usr/bin/env bash
# Genera docs/POS-002-R1-modelo-de-datos.md a partir del esquema REAL (migraciones aplicadas).
# Uso: db/tools/gen_dictionary.sh > docs/POS-002-R1-modelo-de-datos.md
# Requiere una BD con las migraciones aplicadas (por defecto la que deja db/tests/run.sh: pos_test).
set -euo pipefail
DB="${POS_TEST_DB:-pos_test}"
q() { psql -qXAt -d "$DB" -c "$1"; }

cat <<'HDR'
# POS-002 · Modelo de datos R1 (generado)

> Generado automáticamente desde las migraciones por `db/tools/gen_dictionary.sh`. **No editar a mano.**
> Alcance R1: identidad, organizaciones, roles y permisos, portafolios/programas/proyectos/fases,
> invitaciones, auditoría. Validado en PostgreSQL 16 con un reemplazo mínimo de Supabase (ver `db/README.md`).

HDR

echo "## Matriz de permisos por rol"
echo
echo "### Roles de organización"
echo
echo "| Rol | Permisos |"
echo "|---|---|"
q "select '| **' || r.key || '** | ' || coalesce(string_agg('\`' || rp.permission_code || '\`', ', ' order by rp.permission_code), '(ninguno)') || ' |'
   from public.roles r left join public.role_permissions rp on rp.role_id = r.id
   where r.is_system and r.scope = 'organization' group by r.key order by r.key"
echo
echo "### Roles de proyecto"
echo
echo "| Rol | Permisos | Asignable a externos |"
echo "|---|---|---|"
q "select '| **' || r.key || '** | ' || coalesce(string_agg('\`' || rp.permission_code || '\`', ', ' order by rp.permission_code), '(ninguno)') || ' | ' || case when r.external_assignable then 'sí' else 'no' end || ' |'
   from public.roles r left join public.role_permissions rp on rp.role_id = r.id
   where r.is_system and r.scope = 'project' group by r.key, r.external_assignable order by r.key"
echo
echo "### Catálogo de permisos"
echo
echo "| Código | Ámbito | Descripción |"
echo "|---|---|---|"
q "select '| \`' || code || '\` | ' || scope || ' | ' || description || ' |' from public.permissions order by scope, code"
echo
echo "## Transiciones de estado de proyecto"
echo
echo "| Desde | Hacia | Permiso requerido | Solo por reapertura |"
echo "|---|---|---|---|"
q "select '| ' || from_status || ' | ' || to_status || ' | \`' || coalesce(required_permission,'-') || '\` | ' || case when needs_reopen then 'sí' else 'no' end || ' |'
   from public.project_status_transitions order by 1"
echo
echo "## Tablas"
for t in $(q "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1"); do
  echo
  echo "### \`$t\`"
  d=$(q "select coalesce(obj_description('public.$t'::regclass),'')")
  [ -n "$d" ] && { echo; echo "$d"; }
  echo
  echo "| Columna | Tipo | Nulo | Por defecto |"
  echo "|---|---|---|---|"
  q "select '| \`' || column_name || '\` | ' || data_type || ' | ' || case when is_nullable='YES' then 'sí' else 'no' end || ' | ' || coalesce('\`' || replace(column_default,'|','\\|') || '\`','') || ' |'
     from information_schema.columns where table_schema='public' and table_name='$t' order by ordinal_position"
done
echo
echo "## Funciones de la API (RPC)"
echo
echo "| Función | Ejecutable por |"
echo "|---|---|"
q "select '| \`' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')\` | ' ||
          case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'usuarios autenticados' else 'solo servidor (service_role)' end || ' |'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by p.proname"
echo
echo "## Políticas RLS"
echo
echo "| Tabla | Política | Operación | Rol |"
echo "|---|---|---|---|"
q "select '| \`' || tablename || '\` | ' || policyname || ' | ' || cmd || ' | ' || array_to_string(roles, ',') || ' |'
   from pg_policies where schemaname = 'public' order by tablename, policyname"
