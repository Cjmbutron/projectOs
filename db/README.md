# Base de datos (PostgreSQL / Supabase) — R1

Migraciones SQL puras y ordenadas en `migrations/`; pruebas en `tests/`. Modelo y permisos:
[`docs/POS-002-R1-modelo-de-datos.md`](../docs/POS-002-R1-modelo-de-datos.md) (generado desde el esquema real).

## Cómo se organiza

| Migración | Contenido |
|---|---|
| `0100` | Esquema `private` y utilidades (`current_aal`, `touch_updated_at`) |
| `0200` | Perfiles y aceptación legal (términos/privacidad con versión y fecha) |
| `0300` | Organizaciones, catálogo de permisos, roles (sistema y personalizados), membresías, protección del último owner |
| `0400` | Portafolios, programas, proyectos, tabla de transiciones de estado, fases, miembros de proyecto |
| `0500` | Invitaciones (solo hash del token, caducidad 7 días) |
| `0600` | Bitácora de auditoría inmutable |
| `0700` | Funciones de seguridad usadas por RLS (`can_access_org`, `has_org_permission`, `can_read_project`…) |
| `0800` | Funciones de negocio (API): crear organización, invitar/aceptar, cambiar estado, reabrir, mover, archivar, papelera… |
| `0900` | RLS en todas las tablas + privilegios por columna |
| `1000` | Bloqueo de cuenta por intentos fallidos (solo `service_role`) |
| `1100` | Vista de panel (`security_invoker`) |

## Principios de seguridad

1. **Negar por defecto.** RLS activado y *forzado* en todas las tablas; se revocan los privilegios que Supabase concede por defecto a `anon` y `authenticated`. `anon` no puede leer ni ejecutar nada.
2. **Escrituras sensibles solo por funciones.** Membresías, invitaciones, estado, ubicación, archivo y papelera de proyectos no admiten `INSERT/UPDATE/DELETE` directo.
3. **Aislamiento entre organizaciones en dos capas:** políticas RLS y claves foráneas compuestas `(id, organization_id)`.
4. **MFA** exigible por organización (claim `aal` del JWT): sin MFA solo se ve la propia organización y la propia membresía.
5. **Auditoría inmutable**: no admite UPDATE/DELETE/TRUNCATE ni del propietario; nunca registra `token_hash`.
6. Funciones `SECURITY DEFINER` con `search_path` vacío; nada ejecutable por `anon`.

## Ejecutar las pruebas

Requiere PostgreSQL 15+ (por `security_invoker` en vistas) con permiso para crear bases de datos; probado solo en 16.

```bash
db/tests/run.sh              # aplica migraciones sobre una BD vacía y ejecuta toda la batería
db/tests/mutation_check.sh   # introduce 24 defectos deliberados; todos deben ser detectados
db/tools/gen_dictionary.sh > docs/POS-002-R1-modelo-de-datos.md   # regenera el diccionario
```

Estado actual: **447 pruebas, 0 fallos; 24/24 mutaciones detectadas.**

## Limitaciones conocidas (leer antes de confiar)

- Las pruebas corren contra PostgreSQL 16 con `tests/support/00_supabase_stub.sql`, un **reemplazo mínimo** de lo que Supabase provee (`auth.users`, `auth.uid()`, roles, privilegios por defecto). **No es Supabase.** Falta repetir la batería en un proyecto Supabase real (staging) — pendiente, requiere sus cuentas.
- El trigger sobre `auth.users` (alta de perfil) debe verificarse en Supabase real: allí los triggers sobre `auth` los crea el rol `postgres`.
- El bloqueo por intentos (1000) depende de que la ruta del servidor consulte `login_lock_until` **antes** de validar la contraseña (ADR-005).
- Aún no existen tablas de actividades, dependencias ni líneas base (R2).

## Decisiones tomadas al construir R1 (a incorporar en POS-001 v1.3)

- Ubicar un proyecto en un portafolio/programa requiere `portfolio.manage` o `program.manage`.
- Visibilidad por defecto `organization` (A-9); el creador siempre ve su proyecto; quien tiene `project.read_all` ve todos.
- Reabrir un proyecto cerrado (`closed → closing`) exige el permiso de organización `project.reopen` y un motivo; queda auditado.
- Los roles externos (`contributor`, `client_stakeholder`, `viewer`) solo tienen lectura; un externo debe ser `guest` en la organización.
- Aprobar (`proposed → approved`) exige `project.approve`, separado de cambiar estado.
- Solo un owner otorga o retira el rol owner; siempre queda al menos un owner activo.
