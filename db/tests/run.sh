#!/usr/bin/env bash
# Ejecuta las migraciones y la batería de pruebas de la base de datos sobre una BD vacía.
# Uso:  db/tests/run.sh            (usa las variables PG* de libpq; necesita poder crear BDs)
# Variables: POS_TEST_DB (por defecto pos_test) · POS_ADMIN_DB (por defecto postgres)
# Sale con código distinto de 0 si alguna prueba falla o si algún SQL da error.
set -uo pipefail
cd "$(dirname "$0")"
DB="${POS_TEST_DB:-pos_test}"
ADMIN_DB="${POS_ADMIN_DB:-postgres}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

psql -qX -v ON_ERROR_STOP=1 -d "$ADMIN_DB" -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 2

run() {
  psql -qX -v ON_ERROR_STOP=1 -v VERBOSITY=terse -d "$DB" -f "$1" >>"$LOG" 2>&1 || {
    echo "ERROR de SQL en $1"; tail -n 15 "$LOG"; exit 2; }
}

run support/00_supabase_stub.sql
MIG_DIR="${POS_MIGRATIONS_DIR:-../migrations}"
for f in "$MIG_DIR"/*.sql; do run "$f"; done
run support/01_harness.sql
for f in [1-9]?_*.sql; do
  before=$(grep -c "PASS:" "$LOG" || true)
  run "$f"
  after=$(grep -c "PASS:" "$LOG" || true)
  printf '%-34s %4d pruebas OK\n' "$f" "$((after - before))"
done

pass=$(grep -c "NOTICE:  PASS:" "$LOG" || true)
fail=$(grep -c "NOTICE:  FAIL:" "$LOG" || true)
grep "NOTICE:  FAIL:" "$LOG" | sed 's/^.*NOTICE:  //' || true
echo "----"
echo "Total: $pass OK, $fail fallidas"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]
