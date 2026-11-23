#!/usr/bin/env bash
# Respaldo lógico de la base de datos (ADR-006, opción B). Uso:
#   DATABASE_URL='postgresql://...' [BACKUP_DIR=./backups] [KEEP=8] [BACKUP_PASSPHRASE=...] scripts/backup.sh
# - Usa la cadena de conexión DIRECTA o del pooler en modo sesión (no el pooler en modo transacción).
# - Con BACKUP_PASSPHRASE el archivo se cifra con gpg (AES256) y termina en .dump.gz.gpg.
# - Conserva los KEEP respaldos más recientes (por defecto 8 = dos meses si es semanal).
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL}"
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP:-8}"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "KEEP debe ser un entero positivo" >&2; exit 2; }
mkdir -p "$DIR"; umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/project-os-$STAMP.dump.gz"
# Formato plano comprimido; excluye esquemas administrados por Supabase (se recrean solos).
pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public --schema=private \
  | gzip -9 > "$OUT"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT.gpg" "$OUT"
  rm -f "$OUT"; OUT="$OUT.gpg"
fi
[ -s "$OUT" ] || { echo "Respaldo vacío: $OUT" >&2; exit 1; }
# Rotación
ls -1t "$DIR"/project-os-*.dump.gz* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
echo "Respaldo listo: $OUT ($(du -h "$OUT" | cut -f1))"
