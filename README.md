# Project OS

Plataforma de gestión de proyectos. Definición del producto: **POS-001 v1.2** (12-nov-2026).

## Estructura

```
project-os/
├── docs/adr/                    Decisiones de arquitectura (ADR-001 a 007)
├── packages/
│   └── schedule-engine/         Motor de cronograma (TypeScript puro) — ver su README
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

## Estado real del Sprint 0

POS-001 v1.2 §2 declara como "hecho y probado" el esquema `db/` (128 pruebas de aislamiento) y el motor
`engine/`. **Ese material no estaba disponible y se está reconstruyendo desde cero.** Estado actual:

| Entregable | Estado |
|---|---|
| Estructura del repositorio, ADR y CI | Hecho (este directorio) |
| Motor de cronograma | **Hecho y probado** (`packages/schedule-engine`, 88 pruebas) |
| Esquema de base de datos R1, RLS, auditoría y pruebas de aislamiento | **Pendiente** (paso 3) |
| Prueba contra un proyecto Supabase real | **Pendiente** |
| Aplicación web | Pendiente |
| Diseño UX/UI | Pendiente (requiere diseñador) |

Las cifras de POS-001 que dependían de ese material (128 pruebas de RLS; 5 000 actividades en ~170 ms) deben
leerse como **metas**, no como resultados. La medición real del motor está en el README del paquete.
