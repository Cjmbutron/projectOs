#!/usr/bin/env bash
# Aplica db/migrations/*.sql en orden sobre una base de datos y recuerda cuáles ya aplicó.
# Uso:  DATABASE_URL='postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres' scripts/apply-migrations.sh [--list]
#   --list           solo muestra qué migraciones faltan, sin aplicar nada.
#   --baseline NNNN  si ya aplicaste migraciones a mano hasta la NNNN (p. ej. 1900), las registra SIN ejecutarlas
#                    y aplica solo las posteriores. Úsalo una sola vez, antes de la primera corrida.
# Cada migración corre en UNA transacción: si falla, no queda a medias y el script se detiene.
# Registro en el esquema `pos_meta` (fuera de `public`, no se expone por la API).
# Aviso: usa la conexión directa (puerto 5432), no el pooler en modo transacción.
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL con la cadena de conexión de Postgres}"
DIR="$(cd "$(dirname "$0")/../db/migrations" && pwd)"
psql_() { psql -X -q -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"; }

psql_ -c "create schema if not exists pos_meta;
          create table if not exists pos_meta.migrations (name text primary key, applied_at timestamptz not null default now());" >/dev/null

BASE=''
if [ "${1:-}" = "--baseline" ]; then
  BASE="${2:?Indica hasta qué migración ya está aplicada, p. ej. --baseline 1900}"
  [[ "$BASE" =~ ^[0-9]{4}$ ]] || { echo "El número debe tener 4 dígitos (p. ej. 1900)"; exit 2; }
fi
pending=0
for f in "$DIR"/*.sql; do
  name="$(basename "$f")"
  done_="$(psql_ -At -c "select 1 from pos_meta.migrations where name = '$name'")"
  if [ -n "$done_" ]; then echo "ya aplicada   $name"; continue; fi
  if [ -n "$BASE" ] && [ "${name:0:4}" -le "$BASE" ]; then
    psql_ -c "insert into pos_meta.migrations (name) values ('$name')" >/dev/null; echo "registrada    $name (sin ejecutar)"; continue
  fi
  pending=$((pending + 1))
  if [ "${1:-}" = "--list" ]; then echo "PENDIENTE     $name"; continue; fi
  echo "aplicando     $name"
  psql_ --single-transaction -f "$f" -c "insert into pos_meta.migrations (name) values ('$name')"
done
[ "$pending" -eq 0 ] && echo "Todo al día." || { [ "${1:-}" = "--list" ] && echo "$pending pendiente(s)." || echo "Listo: $pending migración(es) aplicada(s)."; }
