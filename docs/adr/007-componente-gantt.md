# ADR-007 — Selección del componente Gantt mediante un spike

**Estado:** Propuesto · **Relacionado con:** A-10, R-12, US-021 (P0 del MVP), RNF-03, RNF-06/07

## Contexto

La vista Gantt (barras, dependencias, hitos, ruta crítica y edición por arrastre) es P0 del MVP y el mayor
riesgo de interfaz. Un componente inadecuado se descubre tarde y es costoso de cambiar. No se evaluó ningún
candidato todavía: **no se afirma aquí nada sobre sus licencias ni su rendimiento**.

## Decisión propuesta

Un **spike de una semana** al inicio del Sprint 1, con tres candidatos (de código abierto, comerciales o un
Gantt propio sobre SVG/canvas), usando como datos el generador de redes de
`packages/schedule-engine/test/performance.test.ts`.

**Criterios (cada uno puntuado y documentado):**

1. **Rendimiento:** 5 000 actividades (RNF-03/04) sin bloquear la interfaz; desplazamiento y zoom fluidos.
2. **Edición:** arrastrar y redimensionar barras con vista previa de impacto (`previewImpact`), y crear
   dependencias con rechazo de ciclos (`findCycleForNewDependency`).
3. **Dependencias de los cuatro tipos** con lags y adelantos; hitos; resaltado de ruta crítica.
4. **Licencia:** compatible con un producto comercial de código cerrado y con el modelo de negocio (A-7);
   costo por desarrollador o por despliegue. **Se verifica en la fuente oficial de cada candidato.**
5. **Accesibilidad (WCAG 2.2 AA) y uso en móvil/tablet** (RNF-06/07): navegación por teclado, lectores de
   pantalla, tamaño de los objetivos táctiles.
6. **Integración con el motor:** el componente solo **dibuja y emite eventos**; las fechas las calcula siempre
   `schedule-engine`. Un componente que imponga su propio cálculo de fechas se descarta o se usa solo como
   capa de dibujo.
7. **Mantenimiento:** actividad del proyecto, versión de React soportada, tamaño del bundle.

**Salida:** una tabla comparativa y una recomendación con los riesgos residuales, para decidir en una reunión.
