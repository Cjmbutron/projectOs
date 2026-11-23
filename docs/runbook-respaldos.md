# Respaldos (ADR-006, opción B: pg_dump programado)

Decisión del usuario (20-nov-2026): respaldo lógico programado con `pg_dump`.

## Hacer un respaldo
```bash
DATABASE_URL='postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres' \
BACKUP_DIR=$HOME/respaldos-project-os KEEP=8 BACKUP_PASSPHRASE='frase-larga' \
scripts/backup.sh
```
- Usa la conexión directa (o el pooler en modo **sesión**), nunca el modo transacción.
- Respalda solo los esquemas `public` y `private`; `auth` lo administra Supabase (los usuarios NO van en este respaldo: ver límites).
- Con `BACKUP_PASSPHRASE` el archivo se cifra (gpg AES256). Guarda la frase fuera del respaldo.
- Conserva los `KEEP` más recientes.

## Programarlo (semanal, en una máquina tuya)
`crontab -e`: `0 3 * * 0 DATABASE_URL=... BACKUP_DIR=... BACKUP_PASSPHRASE=... /ruta/scripts/backup.sh >> /ruta/backup.log 2>&1`
Copia luego la carpeta a un disco o nube distinta de la máquina que respalda.

## Restaurar
1. Crea un proyecto Supabase nuevo (o limpia el de pruebas) y aplica **solo** el respaldo; los roles `authenticated`/`anon` y el esquema `auth` ya existen allí.
2. `gpg -d archivo.dump.gz.gpg | gunzip | psql "$DATABASE_URL"` (sin `gpg` si no lo cifraste).
3. Los usuarios (`auth.users`) deben existir con los mismos UUID para que membresías y auditoría enlacen: ver límites.

## Límites que debes conocer
- **El respaldo no incluye `auth.users`.** Si el proyecto Supabase se pierde, los usuarios deberán recrearse (mismos UUID) o volver a registrarse y reasignarse. Si necesitas incluirlos, añade `--schema=auth` en el script y restaura en un proyecto Supabase con permisos de superusuario (a evaluar con un respaldo real).
- Probado: respaldo, cifrado/descifrado y rotación (en PostgreSQL local con el reemplazo de Supabase). Una restauración **completa** en una base limpia genera errores de roles/esquema `auth` inexistentes; la restauración real en Supabase aún no se ha probado: haz una prueba de restauración en un proyecto de pruebas antes de confiar en el respaldo.
- Un respaldo sin prueba de restauración no es un respaldo.
