# ADR-001 — Monolito modular: Next.js + TypeScript + Supabase + Vercel

**Estado:** Aceptado (stack confirmado por Cristhian el 18-nov-2026) · **Relacionado con:** POS-001 §12.3, R-03, R-07

## Contexto

POS-001 supone PostgreSQL con RLS, Supabase y Vercel. El desarrollo lo realiza Claude y la revisión la hace
una persona, por lo que conviene un código base pequeño, tipado y con pruebas automáticas fuertes. El
aislamiento entre organizaciones (RNF-02, R-04) debe garantizarlo la base de datos y no depender de que la
aplicación se acuerde de filtrar.

## Decisión

- **Un solo repositorio y un solo despliegue** (monolito modular), con `npm workspaces`.
- **Aplicación web:** Next.js (App Router) + TypeScript estricto + Tailwind + shadcn/ui.
- **Datos y autenticación:** Supabase (PostgreSQL, Auth, Storage). El aislamiento por organización se impone
  con RLS y claves foráneas compuestas, no con filtros en el código de la aplicación.
- **Dominio sin dependencias de infraestructura:** la lógica de negocio compleja vive en paquetes puros bajo
  `packages/` (primero `schedule-engine`), sin importar Next.js, React ni Supabase. Así se prueba aislada y se
  puede mover de lugar de ejecución (ADR-003).
- **Pruebas:** Vitest (unitarias y de dominio), pruebas de RLS contra PostgreSQL (carpeta `db/`, aún por crear)
  y Playwright (E2E, desde el primer flujo completo).

## Consecuencias

- Menos piezas que operar; un único pipeline.
- Acoplamiento a Supabase/Vercel: se mitiga manteniendo el dominio en paquetes puros (R-07) y las migraciones
  como SQL versionado y portable.
- Next.js, Supabase y Vercel evolucionan rápido: **antes de escribir la aplicación** hay que fijar versiones y
  revisar la documentación vigente de cada una (no se asume nada de memoria).

## Fuera de alcance de este ADR

Elección del componente Gantt (ADR-007), región y respaldo (ADR-006), autenticación (ADR-005).
