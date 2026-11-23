# @project-os/web
Variables: ver `.env.example` (`SUPABASE_SERVICE_ROLE_KEY` solo en servidor).
`npm run dev -w @project-os/web` · `npm test -w @project-os/web` · `npm run build -w @project-os/web`
Lógica testeable en `lib/` (login con bloqueo, registro, recálculo, CSRF, redirección segura); las rutas en `app/api` solo conectan dependencias.

## Importación CSV (US-071)
Columnas: `id`, `nombre`, `duracion` (días hábiles, entero), `predecesoras` (opcional). Delimitador `,` o `;` (autodetectado), UTF-8 con o sin BOM.
Predecesoras: `1|3SS+2|4FF-1` → tipo opcional (FS por defecto) y desfase opcional. Máximo 1000 filas y 1 MB. Los errores se informan con su número de línea; la base de datos importa todo o nada.

## WBS y entregables
`/projects/:id/wbs`: árbol con código automático (subir, bajar, sangrar, quitar sangría, renombrar, borrar) y entregables con estados de elaboración y revisión independientes.

## Requisitos y trazabilidad
`/projects/:id/requirements`: requisitos con código automático, estado, vínculos con entregables y cobertura (entregables, aceptados, actividades). Las actividades se vinculan a un nodo de la WBS desde la pantalla del proyecto.

## Gantt (US-021, solo lectura)
`/projects/:id/gantt`: SVG propio con barras, hitos, dependencias FS/SS/FF/SF y ruta crítica; tabla equivalente debajo. Falta edición por arrastre y virtualización (ver ADR-007, actualización).

## Project Charter (US-014)
`/projects/:id/charter`: charter, stakeholders y botones de estado (someter a aprobación, aprobar, devolver a borrador). La base de datos impone la compuerta: sin objetivos, alcance y un stakeholder no se puede someter.
