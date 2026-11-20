# Base de datos (PostgreSQL / Supabase) — R1 + R2

Migraciones SQL puras y ordenadas en `migrations/`; pruebas en `tests/`. Modelo y permisos:
[`docs/POS-002-modelo-de-datos.md`](../docs/POS-002-modelo-de-datos.md) (generado desde el esquema real).

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
| `1200` | **R2** · Cronograma: ajustes/calendario, actividades, restricciones, dependencias (guardia anti-ciclos), versión optimista, permisos `schedule.edit`/`schedule.baseline` |
| `1300` | **R2** · Líneas base inmutables |
| `1400` | **R2** · `apply_schedule` (solo servidor), avance de actividades y progreso del proyecto, `create_baseline` |
| `1500` | **R2** · RLS y privilegios del cronograma |

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
db/tests/mutation_check.sh   # introduce 40 defectos deliberados; todos deben ser detectados
db/tools/gen_dictionary.sh > docs/POS-002-modelo-de-datos.md   # regenera el diccionario
```

Estado actual: **732 pruebas, 0 fallos; 40/40 mutaciones detectadas.**

## Limitaciones conocidas (leer antes de confiar)

- Las pruebas corren contra PostgreSQL 16 con `tests/support/00_supabase_stub.sql`, un **reemplazo mínimo** de lo que Supabase provee (`auth.users`, `auth.uid()`, roles, privilegios por defecto). **No es Supabase.** Falta repetir la batería en un proyecto Supabase real (staging) — pendiente, requiere sus cuentas.
- El trigger sobre `auth.users` (alta de perfil) debe verificarse en Supabase real: allí los triggers sobre `auth` los crea el rol `postgres`.
- El bloqueo por intentos (1000) depende de que la ruta del servidor consulte `login_lock_until` **antes** de validar la contraseña (ADR-005).
- `apply_schedule` solo lo ejecuta `service_role`: el servidor autentica a la persona (incluido el MFA, que la función no evalúa), calcula con `schedule-engine` y pasa `p_actor`; la base de datos vuelve a comprobar `schedule.edit` para ese actor. La base valida forma, pertenencia y coherencia mínima de los resultados, **no** recalcula el CPM (eso es del motor).
- La salud del proyecto (`health`) **no** se calcula todavía: falta definir umbrales (pendiente de decisión). El progreso sí (promedio de % ponderado por duración).
- Si se quita a una persona del proyecto o se suspende, sus actividades conservan el `assignee_id` (no se reasignan solas).
- La guardia de ciclos es recursiva por inserción: con importaciones de miles de dependencias conviene medir (el motor igualmente valida el lote antes).
- Falta la importación CSV de actividades (US-071) y la jerarquía WBS/trazabilidad: van en R3.

## Decisiones tomadas al construir R1 y R2 (a incorporar en POS-001 v1.3)

- Ubicar un proyecto en un portafolio/programa requiere `portfolio.manage` o `program.manage`.
- Visibilidad por defecto `organization` (A-9); el creador siempre ve su proyecto; quien tiene `project.read_all` ve todos.
- Reabrir un proyecto cerrado (`closed → closing`) exige el permiso de organización `project.reopen` y un motivo; queda auditado.
- Los roles externos (`contributor`, `client_stakeholder`, `viewer`) solo tienen lectura; un externo debe ser `guest` en la organización.
- Aprobar (`proposed → approved`) exige `project.approve`, separado de cambiar estado.
- Solo un owner otorga o retira el rol owner; siempre queda al menos un owner activo.
- (R2) Editar el cronograma exige `schedule.edit` (PM y team_lead; owner/admin por `project.manage_all`); crear líneas base, `schedule.baseline` (solo PM). Los contributors reportan avance **solo de sus actividades asignadas**; los externos nunca escriben.
- (R2) Las fechas calculadas solo las escribe `apply_schedule`; cada cambio de entradas sube `schedule_version` y un cálculo con versión vieja falla con `schedule_conflict` (SQLSTATE 40001).
- (R2) Una línea base solo se crea con el cronograma al día (`schedule_not_current` si no) y es inmutable; sobrevive al borrado de actividades y se elimina solo con la purga del proyecto.
- (R2) Un proyecto en la papelera oculta también sus fases, miembros, actividades y cronograma a quien no pueda restaurarlo.
