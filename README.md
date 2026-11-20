# Project OS

Plataforma de gestión de proyectos. Definición del producto: **POS-001 v1.2** (12-nov-2026).

## Estructura

```
project-os/
├── docs/adr/                    Decisiones de arquitectura (ADR-001 a 007)
├── docs/POS-002-modelo-de-datos.md      Modelo, permisos y políticas (generado)
├── db/                          Migraciones SQL y pruebas de seguridad — ver db/README.md
├── packages/
│   ├── schedule-engine/         Motor de cronograma (TypeScript puro) — ver su README
│   └── schedule-service/        Lee entradas → motor → apply_schedule (con reintento por conflicto)
├── .github/workflows/ci.yml     Typecheck y pruebas en cada PR
├── tsconfig.base.json
└── package.json                 npm workspaces
```

## Cómo ejecutar

Requiere Node 22.12 o superior (lo exige Vitest 5; `.nvmrc` indica 22).

```bash
npm ci
npm run typecheck
npm test
```

Base de datos (PostgreSQL 15+): `db/tests/run.sh` — ver `db/README.md`.

Integración motor ↔ base de datos (tras `db/tests/run.sh`):
`POS_DB_URL=postgresql://usuario@/pos_test?host=/var/run/postgresql npm test -w @project-os/schedule-service` (sin `POS_DB_URL` esas 8 pruebas se omiten).

## Estado real del Sprint 0

POS-001 v1.2 §2 declara como "hecho y probado" el esquema `db/` (128 pruebas de aislamiento) y el motor
`engine/`. **Ese material no estaba disponible y se está reconstruyendo desde cero.** Estado actual:

| Entregable | Estado |
|---|---|
| Estructura del repositorio, ADR y CI | Hecho (este directorio) |
| Motor de cronograma | **Hecho y probado** (`packages/schedule-engine`, 88 pruebas) |
| Esquema de base de datos R1 + R2 (cronograma, líneas base), RLS, auditoría y pruebas de aislamiento | **Hecho y probado en PostgreSQL 16 con reemplazo de Supabase** (`db/`, R1 + R2, 732 pruebas, 40/40 mutaciones detectadas) |
| Servicio de recálculo (`schedule-service`): 11 pruebas unitarias + 8 de integración contra PostgreSQL real | **Hecho y probado** |
| Prueba contra un proyecto Supabase real | **Pendiente** (necesita tus cuentas) |
| Aplicación web | Pendiente |
| Diseño UX/UI | Pendiente (requiere diseñador) |

Las cifras de POS-001 que dependían de ese material (128 pruebas de RLS; 5 000 actividades en ~170 ms) deben
leerse como **metas**, no como resultados. La medición real del motor está en el README del paquete.

## Aplicación web (`apps/web`)
Next.js 16 + Supabase. Pantallas: login/registro (bloqueo por cuenta), organización, proyectos, actividades con fechas calculadas y botón «Recalcular».
Configuración: copiar `apps/web/.env.example` a `.env.local` con las claves de un proyecto Supabase tras aplicar `db/migrations/` en orden.
Estado honesto: compila, tipa y pasa 83 pruebas de la lógica de rutas, importación CSV, dependencias, WBS, requisitos y Gantt; el arranque sin sesión se verificó por HTTP. **Las pantallas autenticadas aún no se han ejecutado contra un Supabase real.**
