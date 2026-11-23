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
db/tests/mutation_check.sh   # introduce 76 defectos deliberados; todos deben ser detectados
db/tools/gen_dictionary.sh > docs/POS-002-modelo-de-datos.md   # regenera el diccionario
```

Estado actual: **1101 pruebas, 0 fallos; 114/114 mutaciones detectadas** (112 en la corrida completa tras la 2300; las 2 de la 2400 se corrieron aparte).

## Limitaciones conocidas (leer antes de confiar)

- Las pruebas corren contra PostgreSQL 16 con `tests/support/00_supabase_stub.sql`, un **reemplazo mínimo** de lo que Supabase provee (`auth.users`, `auth.uid()`, roles, privilegios por defecto). **No es Supabase.** Falta repetir la batería en un proyecto Supabase real (staging) — pendiente, requiere sus cuentas.
- El trigger sobre `auth.users` (alta de perfil) debe verificarse en Supabase real: allí los triggers sobre `auth` los crea el rol `postgres`.
- El bloqueo por intentos (1000) depende de que la ruta del servidor consulte `login_lock_until` **antes** de validar la contraseña (ADR-005).
- `apply_schedule` solo lo ejecuta `service_role`: el servidor autentica a la persona (incluido el MFA, que la función no evalúa), calcula con `schedule-engine` y pasa `p_actor`; la base de datos vuelve a comprobar `schedule.edit` para ese actor. La base valida forma, pertenencia y coherencia mínima de los resultados, **no** recalcula el CPM (eso es del motor).
- La salud del proyecto (`health`) **no** se calcula todavía: falta definir umbrales (pendiente de decisión). El progreso sí (promedio de % ponderado por duración).
- Si se quita a una persona del proyecto o se suspende, sus actividades conservan el `assignee_id` (no se reasignan solas).
- La guardia de ciclos es recursiva por inserción: con importaciones de miles de dependencias conviene medir (el motor igualmente valida el lote antes).
- Pendiente: vincular requisitos con entregables y actividades con nodos de la WBS (trazabilidad), recursos (R3).

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

### 1600 · Lectura para el servidor y autorización de la ruta de recálculo
- `get_schedule_snapshot(project)` (solo `service_role`): entrada completa del motor en un JSON.
- `can_edit_schedule(project)` (usuarios autenticados): la ruta `/api/projects/:id/recalculate` la llama **con la sesión de la persona**, de modo que membresía, permiso `schedule.edit`, proyecto abierto y la obligación de MFA las decide la base de datos, no la aplicación.

### 1700 · Importación de actividades (US-071)
`import_activities(project, rows jsonb)`: **SECURITY INVOKER** (cada insert pasa por RLS y concesiones de la persona; la comprobación `can_edit_schedule` añade MFA y proyecto abierto). Atómica: un error en cualquier fila no deja nada. Límite 1000 filas; valida referencias, tipos, desfases y ciclos.

### 1800 · WBS y entregables (US-016, US-017)
- `wbs_nodes`: código jerárquico automático (1, 1.1, 1.1.2) y posición mantenidos por el sistema; solo `name`/`description` se editan directamente. `wbs_add_node`, `wbs_move_node`, `wbs_delete_node` recodifican y validan (sin ciclos, sin borrar nodos con hijos, máximo 10 niveles y 5000 nodos).
- Contrato de `wbs_move_node(nodo, padre, posición)`: inserta **antes** del hermano que hoy ocupa esa posición; `null`/`< 1` = al final. La interfaz lo usa así (bajar = i+3, subir = i, desangrar = posición del padre + 1).
- `deliverables`: estados independientes de elaboración y revisión. Cambiar la revisión exige `scope.review` (solo PM); `scope.edit` (PM y team_lead) elabora.

### 1900 · Requisitos y trazabilidad (US-015)
- `requirements`: código `REQ-001` automático por proyecto (con cerrojo), descripción, origen y estado. Un requisito `approved`/`implemented`/`verified` debe tener ≥ 1 entregable; se comprueba al final de cada sentencia (tampoco se puede quitar su último vínculo ni borrar el único entregable que lo cubre).
- `requirement_deliverables`: vínculo requisito ↔ entregable del mismo proyecto.
- `activities.wbs_node_id`: vincula una actividad con un nodo de la WBS.
- Vista `requirement_traceability` (security_invoker): entregables, entregables aceptados y actividades alcanzadas vía nodo de la WBS por requisito.
- Escritura con `scope.edit` (PM y team_lead). Aprobar/rechazar requisitos exige `scope.review` desde la migración 2200.

### 2000 · Project Charter y stakeholders (US-014)
- `project_charters` (objetivos, alcance, fuera de alcance, criterios de éxito, supuestos, restricciones) y `project_stakeholders` (nombre, rol, influencia, interés, usuario interno opcional).
- **Compuerta:** `draft → proposed` exige objetivos y alcance (≥ 10 caracteres cada uno) y ≥ 1 stakeholder; la impone un disparador sobre `projects`, así que no se puede saltar con un UPDATE directo. `charter_status(proyecto)` informa qué falta.
- El charter se edita solo en `draft`/`proposed` (`charter_locked` después); los stakeholders se editan mientras el proyecto no esté cerrado o cancelado.
- Escritura con `project.update` (PM). Nota para las pruebas: `support/01_harness.sql` crea un charter completo automáticamente en cada proyecto de prueba, salvo con `set t.no_auto_charter = 'on'` (código solo de pruebas).

### 2100 · Salud del proyecto (US-020)
- `projects.health` (`green`/`amber`/`red`/`unknown`) lo calcula solo la base de datos; nadie puede escribirlo (42501).
- Regla: atraso del fin calculado (`project_schedules.computed_finish`) respecto del `project_finish` de la **última** línea base, en **días laborables** del proyecto (calendario y feriados/excepciones incluidos). Verde si atraso ≤ umbral ámbar, ámbar si ≤ umbral rojo, rojo si mayor; adelantos cuentan como verde. Sin línea base o sin fecha calculada: `unknown`.
- Umbrales por organización: `organizations.health_amber_days` (2) y `health_red_days` (5), con rojo ≥ ámbar, 0–3650; los cambia owner/admin y se recalculan todos los proyectos. Valores por defecto confirmados por el usuario.
- Se recalcula al aplicar un cálculo de cronograma, crear una línea base o cambiar los umbrales.

### 2200 · Aprobación de requisitos (separación de funciones)
- Crear un requisito en un estado distinto de `proposed`, aprobarlo, rechazarlo, reabrirlo o devolverlo a propuesto exige `scope.review` (solo PM).
- Con solo `scope.edit` (team_lead): registrar y editar requisitos en `proposed`, y mover uno ya aprobado entre `approved`, `implemented` y `verified`.

### 2300 · Recursos (R3, parte 1)
- **Recursos de la organización** (`resources`): personas o equipos, capacidad diaria en horas (por defecto 8, hasta 24), opcionalmente vinculados a un miembro interno activo (solo personas; un miembro, un recurso). Nombre único por organización sin distinguir mayúsculas. Se desactivan (`active = false`); no se borran si tienen asignaciones.
- **Quién gestiona:** permiso `resource.manage` (owner, admin y project_manager de organización). **Quién ve:** cualquier miembro interno activo; los externos no ven recursos.
- **Asignación** (`activity_resources`): una actividad puede tener varios recursos, cada uno con 1–100 % de dedicación; exige `schedule.edit` en el proyecto y un recurso activo. Es independiente del responsable de la actividad y **no mueve el cronograma**.
- **Carga semanal** `resource_load(org, desde, hasta)`: horas por recurso y semana ISO = dedicación × capacidad diaria × días laborables del proyecto de cada actividad (calendario, feriados y días extra incluidos) dentro del rango; capacidad semanal = capacidad diaria × 5; sobreasignado si horas > capacidad. Máximo 372 días por consulta. Excluye proyectos en la papelera o cancelados y actividades sin fechas calculadas.
- **Decisión de seguridad a revisar:** la función es `SECURITY DEFINER` y suma **todos** los proyectos de la organización, aunque quien consulta no pueda abrirlos, porque una sobreasignación solo es real con el total. Devuelve únicamente horas por recurso y semana, nunca nombres de proyectos ni actividades. Cualquier miembro interno puede consultarla.
- **Fuera de este mínimo:** nivelación automática, costos, ausencias o calendarios por recurso, recursos de material.

### 2400 · ¿Puede gestionar recursos?
`can_manage_resources(org)`: devuelve verdadero para quien tiene `resource.manage`. Solo sirve para mostrar u ocultar formularios; la autorización real es la RLS de `resources`.
