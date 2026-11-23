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

## Actualización (20-nov-2026): primera versión propia, solo lectura

Mientras el spike no se haga, se construyó un **Gantt propio de solo lectura** (SVG generado en el servidor, sin
dependencias externas, por lo que no hay licencia que verificar) en `apps/web/lib/gantt/layout.ts` (geometría pura,
probada) y `apps/web/components/GanttChart.tsx`. Cubre del criterio 3: barras, hitos, los cuatro tipos de
dependencia con ruta ortogonal y resalte de ruta crítica; del criterio 6: no calcula fechas, solo dibuja las del
motor; del criterio 5: `role="img"` con descripción, `<title>` por barra y una tabla equivalente debajo.

**Medido:** la geometría de 5 000 actividades y 4 999 dependencias se calcula en ≈ 17 ms (Node, no navegador).
**No medido:** el rendimiento del DOM en navegador (≈ 20 000 nodos SVG con 5 000 actividades; probablemente haga
falta virtualización de filas), la edición por arrastre (criterio 2), la accesibilidad completa por teclado y el
uso táctil. El spike sigue pendiente para decidir si la edición se construye sobre este Gantt o con un componente
externo; esta versión no cierra la decisión.

## Actualización (21-nov-2026): medición en navegador y arrastre sobre el Gantt propio

**Medición** (Chromium sin interfaz de Playwright, una sola máquina de la nube con render por software; red de actividades en cadena con dependencias FS y 1 enlace por actividad; se mide con `requestAnimationFrame`):

| Actividades | Nodos SVG | HTML (KB) | Layout (ms) | Render servidor (ms) | Carga hasta pintar (ms) | Scroll | Arrastre de 1 barra + 3 enlaces |
|---|---|---|---|---|---|---|---|
| 500 | 3 252 | 243 | 3,5 | 61 | 131 | 16,5 ms/cuadro | 16,6 ms/cuadro |
| 2 000 | 12 966 | 994 | 7,5 | 144 | 153 | 16,6 ms/cuadro | 16,6 ms/cuadro |
| 5 000 | 32 410 | 2 523 | 32 | 173 | 341 | 16,6 ms/cuadro | 16,5 ms/cuadro |

(16,6 ms = 60 cuadros/s, el tope de la pantalla.) Quitar los nodos fuera de la vista (virtualización simulada: ≈ 7 600 nodos con 5 000 actividades) no cambió los cuadros por segundo en esta máquina.

**Lectura honesta:** con 5 000 actividades el Gantt SVG propio se desplaza y arrastra a 60 cuadros/s **en esta máquina**; el HTML de 2,5 MB y la carga de 341 ms sí son el costo visible. **No** se midió en un portátil modesto, en móvil ni con el navegador real (extensiones, otras pestañas), y el arrastre medido muta solo la barra y 3 enlaces, no recalcula todo. Para el MVP (RNF-03/04) no se justifica todavía virtualizar ni cambiar de componente; **volver a medir en el equipo más lento de los usuarios** antes de decidir R3.

**Decisión de este avance:** se construye la edición sobre el Gantt propio (no se evaluaron componentes externos). Arrastrar una barra —con puntero o con flechas + Enter— fija la restricción **«no empezar antes de» (SNET)** de la actividad con la fecha de destino y dispara el recálculo del motor. Consecuencias que se asumen:
- Solo puede **retrasar**; no adelanta una actividad más allá de lo que permiten sus dependencias (el motor manda).
- No se redimensiona (cambiar duración) ni se crean dependencias arrastrando: pendientes.
- Los enlaces no se redibujan durante el arrastre (sí tras recalcular); no hay vista previa de impacto (`previewImpact`) todavía.
- Comprobado en navegador con el componente real y las acciones simuladas (arrastre, teclado, Escape, arrastre de 0 días); **no** probado contra Supabase real.

### Complemento (21-nov-2026): redimensionar barras
- Arrastrar el **borde derecho** de una barra (o Mayús + flechas con la barra enfocada) cambia la **duración**, expresada en días laborables: el cliente cuenta los laborables entre el inicio y el nuevo fin con el calendario del proyecto (días de semana laborables, feriados y días extra) y guarda `activities.duration`; el motor recalcula las fechas. Los hitos no se redimensionan. Si el nuevo fin no cambia los días laborables (p. ej. cae en fin de semana), no se guarda nada.
- Sigue pendiente la **vista previa de impacto** (`previewImpact`) y crear dependencias arrastrando.
- Comprobado en Chromium con el componente real y acciones simuladas (redimensionado con puntero, con teclado, Escape, hito, sin cambio laborable); no contra Supabase real.
