# ADR-003 — El servidor es la fuente de verdad de las fechas calculadas

**Estado:** Propuesto · **Relacionado con:** RNF-03, RNF-04, US-021, US-025, US-061, US-066

## Contexto

Dashboard, "mis tareas" (US-025), salud del proyecto y alertas de atraso necesitan consultar fechas con SQL,
sin recalcular la red completa. Al mismo tiempo, la edición por arrastre en el Gantt necesita ver el impacto
de inmediato (US-066).

## Decisión propuesta

1. **Fuente de verdad en el servidor.** Cada cambio de actividades, dependencias, restricciones o calendario
   dispara un recálculo en el servidor con el paquete `schedule-engine`, y los resultados (fechas tempranas y
   tardías, holguras, indicador de crítica) **se guardan** en la base de datos.
2. **Escritura atómica mediante una función SQL (RPC).** La API de Supabase no ofrece transacciones de
   varias sentencias desde el cliente, así que el servidor llama a una función de PostgreSQL, p. ej.
   `apply_schedule(project_id, expected_version, rows)`, que actualiza todas las filas **o ninguna** y
   comprueba la versión esperada.
3. **Concurrencia optimista.** Cada proyecto tiene una versión de cronograma; si dos usuarios editan a la
   vez, el segundo recibe un conflicto y decide (política ya aceptada para el MVP).
4. **El cliente usa el mismo paquete solo para la vista previa** (`previewImpact`) mientras el usuario
   arrastra; la confirmación siempre pasa por el servidor.

## Consecuencias

- Consultas simples y rápidas sobre fechas ya calculadas.
- Dos ejecuciones del mismo código (cliente y servidor) no pueden divergir, porque es el mismo paquete puro.
- Medición preliminar: **32 ms** para 5 000 actividades y 9 846 dependencias de los cuatro tipos (Node 22, el
  entorno de desarrollo de esta sesión). RNF-03 pide < 1 s. Debe repetirse en el entorno real de despliegue
  (incluidos los límites de ejecución de las funciones de Vercel) antes de darlo por cumplido.
- Alternativa descartada: recalcular en cada lectura. Simplifica la escritura, pero obliga a cargar toda la red
  para mostrar una lista de tareas.

## Pendiente

Diseño exacto de la tabla de resultados y de la función `apply_schedule` (migraciones R2, POS-002 §6).
