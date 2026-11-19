# ADR-004 — Entornos (local, staging, producción) y CI

**Estado:** Propuesto · **Relacionado con:** §12.1 de POS-001, RNF-02, RNF-12

## Contexto

El código lo genera Claude; lo que permite confiar en él son las pruebas automáticas y una revisión humana
enfocada. POS-001 pide repetir las pruebas de aislamiento contra Supabase real.

## Decisión propuesta

- **Local:** Supabase CLI levanta una instancia de desarrollo con las migraciones del repositorio.
- **Staging y producción:** proyectos de Supabase **separados**. Las ramas de base de datos (branching) no
  están incluidas en el plan Free según la página de precios (verificado el 18-nov-2026), así que no se
  cuenta con ellas para staging.
- **Migraciones:** SQL versionado en el repositorio, aplicado por el pipeline; nunca cambios manuales en la
  consola sobre staging o producción.
- **CI (GitHub Actions)**, en cada PR: `typecheck` y pruebas. Hoy ejecuta las del motor
  (`.github/workflows/ci.yml`); se irán añadiendo, **cuando existan**, las pruebas de RLS contra una base de
  datos real y los E2E con Playwright.
- **Regla de "hecho" (DoD de POS-001 §9):** una historia que toca datos no se cierra sin pruebas de RLS.

## Consecuencias

- La validación de RLS "contra Supabase real" pasa a ser permanente y automática en lugar de una prueba
  manual única.
- Requiere un repositorio en GitHub y credenciales de Supabase/Vercel (a partir del paso 3 del plan).
- Un segundo proyecto de Supabase para staging puede tener costo según el plan: confirmarlo al contratar.
