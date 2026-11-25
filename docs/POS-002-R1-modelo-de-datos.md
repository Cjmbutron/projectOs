# POS-002 · Modelo de datos R1 + R2 (generado)

> Generado automáticamente desde las migraciones por `db/tools/gen_dictionary.sh`. **No editar a mano.**
> Alcance: R1 (identidad, organizaciones, roles y permisos, portafolios/programas/proyectos/fases,
> invitaciones, auditoría) y R2 (calendario, actividades, restricciones, dependencias, cálculo guardado,
> avance y líneas base). Validado en PostgreSQL 16 con un reemplazo mínimo de Supabase (ver `db/README.md`).

## Matriz de permisos por rol

### Roles de organización

| Rol | Permisos |
|---|---|
| **admin** | `audit.read`, `org.members.invite`, `org.members.manage`, `org.members.read`, `org.roles.manage`, `org.settings.manage`, `portfolio.manage`, `portfolio.read`, `program.manage`, `project.create`, `project.manage_all`, `project.read_all`, `project.reopen`, `resource.manage` |
| **auditor** | `audit.read`, `org.members.read`, `portfolio.read`, `project.read_all` |
| **guest** | (ninguno) |
| **member** | `org.members.read`, `portfolio.read` |
| **owner** | `audit.read`, `org.members.invite`, `org.members.manage`, `org.members.read`, `org.ownership.manage`, `org.roles.manage`, `org.settings.manage`, `portfolio.manage`, `portfolio.read`, `program.manage`, `project.create`, `project.manage_all`, `project.read_all`, `project.reopen`, `resource.manage` |
| **portfolio_manager** | `org.members.read`, `portfolio.manage`, `portfolio.read`, `program.manage`, `project.create` |
| **program_manager** | `org.members.read`, `portfolio.read`, `program.manage`, `project.create` |
| **project_manager** | `org.members.read`, `portfolio.read`, `project.create`, `resource.manage` |

### Roles de proyecto

| Rol | Permisos | Asignable a externos |
|---|---|---|
| **client_stakeholder** | `project.read` | sí |
| **contributor** | `project.read` | sí |
| **project_manager** | `project.approve`, `project.change_status`, `project.delete`, `project.manage_members`, `project.read`, `project.update`, `schedule.baseline`, `schedule.edit`, `scope.edit`, `scope.review` | no |
| **team_lead** | `project.read`, `schedule.edit`, `scope.edit` | no |
| **viewer** | `project.read` | sí |

### Catálogo de permisos

| Código | Ámbito | Descripción |
|---|---|---|
| `audit.read` | organization | Consultar la bitácora de auditoría |
| `org.members.invite` | organization | Invitar miembros internos y externos |
| `org.members.manage` | organization | Cambiar roles, suspender y reactivar miembros |
| `org.members.read` | organization | Ver la lista de miembros de la organización |
| `org.ownership.manage` | organization | Otorgar y retirar el rol de owner (solo plantilla owner) |
| `org.roles.manage` | organization | Crear y editar roles propios de la organización |
| `org.settings.manage` | organization | Editar nombre, moneda de referencia y MFA obligatorio de la organización |
| `portfolio.manage` | organization | Crear y editar portafolios |
| `portfolio.read` | organization | Ver portafolios y programas |
| `program.manage` | organization | Crear y editar programas y ubicar proyectos en ellos |
| `project.create` | organization | Crear proyectos |
| `project.manage_all` | organization | Actuar como gestor en cualquier proyecto de la organización |
| `project.read_all` | organization | Ver todos los proyectos, incluidos los privados |
| `project.reopen` | organization | Reabrir un proyecto cerrado (con motivo, queda en auditoría) |
| `resource.manage` | organization | Crear, editar y desactivar los recursos de la organización |
| `project.approve` | project | Aprobar el proyecto (proposed → approved) |
| `project.change_status` | project | Cambiar el estado del proyecto |
| `project.delete` | project | Enviar a la papelera y restaurar el proyecto |
| `project.manage_members` | project | Asignar miembros y roles del proyecto |
| `project.read` | project | Ver el proyecto |
| `project.update` | project | Editar datos del proyecto, fases y archivarlo |
| `schedule.baseline` | project | Crear líneas base del cronograma |
| `schedule.edit` | project | Editar actividades, dependencias, restricciones y calendario del cronograma |
| `scope.edit` | project | Editar la WBS y los entregables del proyecto |
| `scope.review` | project | Aceptar o rechazar entregables (estado de revisión) |

## Transiciones de estado de proyecto

| Desde | Hacia | Permiso requerido | Solo por reapertura |
|---|---|---|---|
| approved | cancelled | `project.change_status` | no |
| approved | planning | `project.change_status` | no |
| closed | closing | `project.change_status` | sí |
| closing | cancelled | `project.change_status` | no |
| closing | closed | `project.change_status` | no |
| closing | executing | `project.change_status` | no |
| draft | cancelled | `project.change_status` | no |
| draft | proposed | `project.change_status` | no |
| executing | cancelled | `project.change_status` | no |
| executing | closing | `project.change_status` | no |
| executing | on_hold | `project.change_status` | no |
| on_hold | cancelled | `project.change_status` | no |
| on_hold | executing | `project.change_status` | no |
| on_hold | planning | `project.change_status` | no |
| planning | cancelled | `project.change_status` | no |
| planning | executing | `project.change_status` | no |
| planning | on_hold | `project.change_status` | no |
| proposed | approved | `project.approve` | no |
| proposed | cancelled | `project.change_status` | no |
| proposed | draft | `project.change_status` | no |

## Tablas

### `activities`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `phase_id` | uuid | sí |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `duration` | integer | no | `1` |
| `is_milestone` | boolean | sí |  |
| `assignee_id` | uuid | sí |  |
| `status` | text | no | `'not_started'::text` |
| `percent_complete` | smallint | no | `0` |
| `sort_order` | integer | no | `0` |
| `early_start` | date | sí |  |
| `early_finish` | date | sí |  |
| `late_start` | date | sí |  |
| `late_finish` | date | sí |  |
| `total_float` | integer | sí |  |
| `free_float` | integer | sí |  |
| `is_critical` | boolean | sí |  |
| `violated_constraints` | ARRAY | no | `'{}'::text[]` |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `wbs_node_id` | uuid | sí |  |

### `activity_constraints`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `activity_id` | uuid | no |  |
| `type` | text | no |  |
| `date` | date | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

### `activity_dependencies`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `predecessor_id` | uuid | no |  |
| `successor_id` | uuid | no |  |
| `type` | text | no | `'FS'::text` |
| `lag` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |

### `activity_notes`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `activity_id` | uuid | no |  |
| `author_id` | uuid | sí | `auth.uid()` |
| `body` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `activity_resources`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `activity_id` | uuid | no |  |
| `resource_id` | uuid | no |  |
| `allocation_percent` | integer | no | `100` |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |

### `audit_log`

Bitácora inmutable. actor_id NULL = proceso del sistema.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no |  |
| `occurred_at` | timestamp with time zone | no | `now()` |
| `organization_id` | uuid | sí |  |
| `actor_id` | uuid | sí |  |
| `action` | text | no |  |
| `entity_table` | text | no |  |
| `entity_id` | text | sí |  |
| `old_values` | jsonb | sí |  |
| `new_values` | jsonb | sí |  |
| `reason` | text | sí |  |

### `baseline_activities`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `baseline_id` | uuid | no |  |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `activity_id` | uuid | no |  |
| `name` | text | no |  |
| `start_date` | date | no |  |
| `finish_date` | date | no |  |
| `duration` | integer | no |  |

### `baselines`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `version` | integer | no |  |
| `name` | text | no |  |
| `project_start` | date | no |  |
| `project_finish` | date | no |  |
| `captured_at` | timestamp with time zone | no | `now()` |
| `captured_by` | uuid | sí | `auth.uid()` |

### `deliverables`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `wbs_node_id` | uuid | sí |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `acceptance_criteria` | text | sí |  |
| `responsible_id` | uuid | sí |  |
| `authoring_status` | text | no | `'draft'::text` |
| `review_status` | text | no | `'pending'::text` |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `invitations`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `email` | text | no |  |
| `role_id` | uuid | no |  |
| `membership_type` | text | no |  |
| `project_id` | uuid | sí |  |
| `project_role_id` | uuid | sí |  |
| `token_hash` | bytea | no |  |
| `expires_at` | timestamp with time zone | no |  |
| `accepted_at` | timestamp with time zone | sí |  |
| `accepted_by` | uuid | sí |  |
| `revoked_at` | timestamp with time zone | sí |  |
| `invited_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |

### `legal_acceptances`

Aceptación de documentos legales por persona, con versión y fecha.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `user_id` | uuid | no |  |
| `document` | text | no |  |
| `version` | text | no |  |
| `accepted_at` | timestamp with time zone | no | `now()` |

### `login_attempts`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | bigint | no |  |
| `email` | text | no |  |
| `attempted_at` | timestamp with time zone | no | `now()` |
| `succeeded` | boolean | no |  |

### `organization_members`

Pertenencia de una persona a una organización, con rol y estado.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `membership_type` | text | no |  |
| `role_id` | uuid | no |  |
| `status` | text | no | `'active'::text` |
| `invited_by` | uuid | sí |  |
| `joined_at` | timestamp with time zone | no | `now()` |
| `suspended_at` | timestamp with time zone | sí |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `organizations`

Organización (inquilino). Todo dato de negocio cuelga de una.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `name` | text | no |  |
| `reference_currency` | text | no |  |
| `mfa_required` | boolean | no | `false` |
| `created_by` | uuid | sí |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `health_amber_days` | integer | no | `2` |
| `health_red_days` | integer | no | `5` |

### `permissions`

Catálogo cerrado de permisos. Los roles son conjuntos de estos códigos.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `code` | text | no |  |
| `scope` | text | no |  |
| `description` | text | no |  |

### `portfolios`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `responsible_id` | uuid | sí |  |
| `archived_at` | timestamp with time zone | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `profiles`

Perfil de cada persona usuaria (1:1 con auth.users). Sin correo.

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no |  |
| `display_name` | text | no |  |
| `locale` | text | no | `'es'::text` |
| `timezone` | text | no | `'UTC'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `programs`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `portfolio_id` | uuid | sí |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `responsible_id` | uuid | sí |  |
| `archived_at` | timestamp with time zone | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_calendar_days`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `day` | date | no |  |
| `kind` | text | no |  |
| `name` | text | sí |  |
| `created_at` | timestamp with time zone | no | `now()` |

### `project_charters`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `project_id` | uuid | no |  |
| `organization_id` | uuid | no |  |
| `objectives` | text | sí |  |
| `scope` | text | sí |  |
| `out_of_scope` | text | sí |  |
| `success_criteria` | text | sí |  |
| `assumptions` | text | sí |  |
| `constraints` | text | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_by` | uuid | sí |  |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_members`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `role_id` | uuid | no |  |
| `added_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_phases`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `position` | integer | no |  |
| `planned_start` | date | sí |  |
| `planned_end` | date | sí |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_schedules`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `project_id` | uuid | no |  |
| `organization_id` | uuid | no |  |
| `start_date` | date | sí |  |
| `working_weekdays` | ARRAY | no | `'{1,2,3,4,5}'::smallint[]` |
| `schedule_version` | integer | no | `0` |
| `computed_version` | integer | sí |  |
| `computed_at` | timestamp with time zone | sí |  |
| `computed_start` | date | sí |  |
| `computed_finish` | date | sí |  |
| `duration_days` | integer | sí |  |
| `warnings` | jsonb | no | `'[]'::jsonb` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_stakeholders`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `name` | text | no |  |
| `role` | text | sí |  |
| `user_id` | uuid | sí |  |
| `influence` | text | no | `'medium'::text` |
| `interest` | text | no | `'medium'::text` |
| `notes` | text | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `project_status_transitions`

Transiciones permitidas. needs_reopen: solo mediante reopen_project (permiso de organización, con motivo).

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `from_status` | text | no |  |
| `to_status` | text | no |  |
| `required_permission` | text | no | `'project.change_status'::text` |
| `needs_reopen` | boolean | no | `false` |

### `projects`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `portfolio_id` | uuid | sí |  |
| `program_id` | uuid | sí |  |
| `code` | text | no |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `responsible_id` | uuid | no |  |
| `methodology` | text | no |  |
| `complexity_profile` | text | no | `'standard'::text` |
| `currency` | text | no |  |
| `status` | text | no | `'draft'::text` |
| `health` | text | no | `'unknown'::text` |
| `progress_percent` | numeric | no | `0` |
| `priority` | smallint | no | `3` |
| `sort_order` | integer | no | `0` |
| `visibility` | text | no | `'organization'::text` |
| `planned_start` | date | sí |  |
| `planned_end` | date | sí |  |
| `status_changed_at` | timestamp with time zone | no | `now()` |
| `archived_at` | timestamp with time zone | sí |  |
| `deleted_at` | timestamp with time zone | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `raci_assignments`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `deliverable_id` | uuid | no |  |
| `user_id` | uuid | no |  |
| `role` | text | no |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |

### `requirement_deliverables`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `requirement_id` | uuid | no |  |
| `deliverable_id` | uuid | no |  |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |

### `requirements`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `seq` | integer | no | `0` |
| `code` | text | sí |  |
| `description` | text | no |  |
| `source` | text | no |  |
| `status` | text | no | `'proposed'::text` |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `resource_absences`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `resource_id` | uuid | no |  |
| `start_date` | date | no |  |
| `end_date` | date | no |  |
| `reason` | text | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |

### `resources`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `name` | text | no |  |
| `kind` | text | no | `'person'::text` |
| `user_id` | uuid | sí |  |
| `daily_hours` | numeric | no | `8` |
| `active` | boolean | no | `true` |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `role_permissions`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `role_id` | uuid | no |  |
| `permission_code` | text | no |  |

### `roles`

Roles. organization_id NULL = plantilla del sistema (inmutable).

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | sí |  |
| `scope` | text | no |  |
| `key` | text | sí |  |
| `name` | text | no |  |
| `description` | text | sí |  |
| `is_system` | boolean | no | `false` |
| `external_assignable` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

### `wbs_nodes`

| Columna | Tipo | Nulo | Por defecto |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `organization_id` | uuid | no |  |
| `project_id` | uuid | no |  |
| `parent_id` | uuid | sí |  |
| `position` | integer | no |  |
| `code` | text | no | `'?'::text` |
| `name` | text | no |  |
| `description` | text | sí |  |
| `created_by` | uuid | sí | `auth.uid()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

## Funciones de la API (RPC)

| Función | Ejecutable por |
|---|---|
| `accept_invitation(p_token text)` | usuarios autenticados |
| `add_project_member(p_project uuid, p_user uuid, p_role uuid)` | usuarios autenticados |
| `apply_schedule(p_project uuid, p_expected_version integer, p_actor uuid, p_results jsonb, p_summary jsonb)` | solo servidor (service_role) |
| `archive_project(p_project uuid, p_archived boolean)` | usuarios autenticados |
| `can_assign_resources(p_project uuid)` | usuarios autenticados |
| `can_edit_schedule(p_project uuid)` | usuarios autenticados |
| `can_edit_scope(p_project uuid)` | usuarios autenticados |
| `can_manage_resources(p_org uuid)` | usuarios autenticados |
| `can_write_notes(p_project uuid)` | usuarios autenticados |
| `change_member_role(p_org uuid, p_user uuid, p_role uuid)` | usuarios autenticados |
| `change_project_member_role(p_project uuid, p_user uuid, p_role uuid)` | usuarios autenticados |
| `change_project_status(p_project uuid, p_status text, p_reason text)` | usuarios autenticados |
| `charter_status(p_project uuid)` | usuarios autenticados |
| `create_baseline(p_project uuid, p_name text)` | usuarios autenticados |
| `create_organization(p_name text, p_currency text)` | usuarios autenticados |
| `create_project(p_org uuid, p_code text, p_name text, p_responsible uuid, p_methodology text, p_profile text, p_currency text, p_description text, p_portfolio uuid, p_program uuid, p_visibility text, p_planned_start date, p_planned_end date)` | usuarios autenticados |
| `get_schedule_snapshot(p_project uuid)` | solo servidor (service_role) |
| `import_activities(p_project uuid, p_rows jsonb)` | usuarios autenticados |
| `invite_member(p_org uuid, p_email text, p_role uuid, p_membership_type text, p_project uuid, p_project_role uuid)` | usuarios autenticados |
| `login_lock_until(p_email text)` | solo servidor (service_role) |
| `move_project(p_project uuid, p_portfolio uuid, p_program uuid)` | usuarios autenticados |
| `purge_login_attempts(p_older_than interval)` | solo servidor (service_role) |
| `purge_trashed_projects(p_older_than interval)` | solo servidor (service_role) |
| `raci_set_cell(p_deliverable uuid, p_user uuid, p_roles text[])` | usuarios autenticados |
| `record_legal_acceptance(p_document text, p_version text)` | usuarios autenticados |
| `record_login_attempt(p_email text, p_succeeded boolean)` | solo servidor (service_role) |
| `remove_project_member(p_project uuid, p_user uuid)` | usuarios autenticados |
| `reopen_project(p_project uuid, p_reason text)` | usuarios autenticados |
| `reorder_project_phases(p_project uuid, p_phase_ids uuid[])` | usuarios autenticados |
| `resource_load(p_org uuid, p_from date, p_to date)` | usuarios autenticados |
| `revoke_invitation(p_invitation uuid)` | usuarios autenticados |
| `set_member_status(p_org uuid, p_user uuid, p_status text)` | usuarios autenticados |
| `trash_project(p_project uuid, p_trashed boolean)` | usuarios autenticados |
| `update_activity_progress(p_activity uuid, p_percent integer)` | usuarios autenticados |
| `wbs_add_node(p_project uuid, p_parent uuid, p_name text, p_description text, p_position integer)` | usuarios autenticados |
| `wbs_delete_node(p_node uuid)` | usuarios autenticados |
| `wbs_move_node(p_node uuid, p_parent uuid, p_position integer)` | usuarios autenticados |

## Políticas RLS

| Tabla | Política | Operación | Rol |
|---|---|---|---|
| `activities` | activities_delete | DELETE | authenticated |
| `activities` | activities_insert | INSERT | authenticated |
| `activities` | activities_read | SELECT | authenticated |
| `activities` | activities_update | UPDATE | authenticated |
| `activity_constraints` | constraints_delete | DELETE | authenticated |
| `activity_constraints` | constraints_insert | INSERT | authenticated |
| `activity_constraints` | constraints_read | SELECT | authenticated |
| `activity_constraints` | constraints_update | UPDATE | authenticated |
| `activity_dependencies` | dependencies_delete | DELETE | authenticated |
| `activity_dependencies` | dependencies_insert | INSERT | authenticated |
| `activity_dependencies` | dependencies_read | SELECT | authenticated |
| `activity_dependencies` | dependencies_update | UPDATE | authenticated |
| `activity_notes` | activity_notes_delete | DELETE | authenticated |
| `activity_notes` | activity_notes_insert | INSERT | authenticated |
| `activity_notes` | activity_notes_read | SELECT | authenticated |
| `activity_notes` | activity_notes_update | UPDATE | authenticated |
| `activity_resources` | activity_resources_delete | DELETE | authenticated |
| `activity_resources` | activity_resources_insert | INSERT | authenticated |
| `activity_resources` | activity_resources_read | SELECT | authenticated |
| `activity_resources` | activity_resources_update | UPDATE | authenticated |
| `audit_log` | audit_read | SELECT | authenticated |
| `baseline_activities` | baseline_activities_read | SELECT | authenticated |
| `baselines` | baselines_read | SELECT | authenticated |
| `deliverables` | deliverables_delete | DELETE | authenticated |
| `deliverables` | deliverables_insert | INSERT | authenticated |
| `deliverables` | deliverables_read | SELECT | authenticated |
| `deliverables` | deliverables_update | UPDATE | authenticated |
| `invitations` | invitations_read | SELECT | authenticated |
| `legal_acceptances` | legal_read_own | SELECT | authenticated |
| `organization_members` | members_read | SELECT | authenticated |
| `organizations` | organizations_read | SELECT | authenticated |
| `organizations` | organizations_update | UPDATE | authenticated |
| `permissions` | permissions_read | SELECT | authenticated |
| `portfolios` | portfolios_insert | INSERT | authenticated |
| `portfolios` | portfolios_read | SELECT | authenticated |
| `portfolios` | portfolios_update | UPDATE | authenticated |
| `profiles` | profiles_read | SELECT | authenticated |
| `profiles` | profiles_update_own | UPDATE | authenticated |
| `programs` | programs_insert | INSERT | authenticated |
| `programs` | programs_read | SELECT | authenticated |
| `programs` | programs_update | UPDATE | authenticated |
| `project_calendar_days` | calendar_delete | DELETE | authenticated |
| `project_calendar_days` | calendar_insert | INSERT | authenticated |
| `project_calendar_days` | calendar_read | SELECT | authenticated |
| `project_calendar_days` | calendar_update | UPDATE | authenticated |
| `project_charters` | charters_insert | INSERT | authenticated |
| `project_charters` | charters_read | SELECT | authenticated |
| `project_charters` | charters_update | UPDATE | authenticated |
| `project_members` | project_members_read | SELECT | authenticated |
| `project_phases` | phases_delete | DELETE | authenticated |
| `project_phases` | phases_insert | INSERT | authenticated |
| `project_phases` | phases_read | SELECT | authenticated |
| `project_phases` | phases_update | UPDATE | authenticated |
| `project_schedules` | schedules_read | SELECT | authenticated |
| `project_schedules` | schedules_update | UPDATE | authenticated |
| `project_stakeholders` | stakeholders_delete | DELETE | authenticated |
| `project_stakeholders` | stakeholders_insert | INSERT | authenticated |
| `project_stakeholders` | stakeholders_read | SELECT | authenticated |
| `project_stakeholders` | stakeholders_update | UPDATE | authenticated |
| `project_status_transitions` | transitions_read | SELECT | authenticated |
| `projects` | projects_read | SELECT | authenticated |
| `projects` | projects_update | UPDATE | authenticated |
| `raci_assignments` | raci_read | SELECT | authenticated |
| `requirement_deliverables` | req_links_delete | DELETE | authenticated |
| `requirement_deliverables` | req_links_insert | INSERT | authenticated |
| `requirement_deliverables` | req_links_read | SELECT | authenticated |
| `requirements` | requirements_delete | DELETE | authenticated |
| `requirements` | requirements_insert | INSERT | authenticated |
| `requirements` | requirements_read | SELECT | authenticated |
| `requirements` | requirements_update | UPDATE | authenticated |
| `resource_absences` | resource_absences_delete | DELETE | authenticated |
| `resource_absences` | resource_absences_insert | INSERT | authenticated |
| `resource_absences` | resource_absences_read | SELECT | authenticated |
| `resource_absences` | resource_absences_update | UPDATE | authenticated |
| `resources` | resources_delete | DELETE | authenticated |
| `resources` | resources_insert | INSERT | authenticated |
| `resources` | resources_read | SELECT | authenticated |
| `resources` | resources_update | UPDATE | authenticated |
| `role_permissions` | role_permissions_delete | DELETE | authenticated |
| `role_permissions` | role_permissions_insert | INSERT | authenticated |
| `role_permissions` | role_permissions_read | SELECT | authenticated |
| `roles` | roles_delete | DELETE | authenticated |
| `roles` | roles_insert | INSERT | authenticated |
| `roles` | roles_read | SELECT | authenticated |
| `roles` | roles_update | UPDATE | authenticated |
| `wbs_nodes` | wbs_read | SELECT | authenticated |
| `wbs_nodes` | wbs_update | UPDATE | authenticated |
