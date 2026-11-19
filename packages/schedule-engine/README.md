# @project-os/schedule-engine

Motor de cronograma de Project OS (POS-001 · EP-06 · US-019…024, 065, 066). TypeScript puro: sin base de
datos, sin red, sin reloj, sin React. Ver [ADR-002](../../docs/adr/002-motor-de-cronograma.md).

```bash
npm test          # 88 pruebas
npm run typecheck
```

## Uso

```ts
import { computeSchedule, MON_FRI_CALENDAR } from '@project-os/schedule-engine';

const result = computeSchedule({
  projectStart: '2026-11-02',
  calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-11-03'] },
  activities: [
    { id: 'A', duration: 3 },
    { id: 'B', duration: 2 },
    { id: 'HITO', duration: 0 },
  ],
  dependencies: [
    { predecessorId: 'A', successorId: 'B', type: 'FS' },
    { predecessorId: 'B', successorId: 'HITO', type: 'FS', lag: 0 },
  ],
});
// result.activities[i] → earlyStart/earlyFinish/lateStart/lateFinish, totalFloat, freeFloat, critical
// result.criticalActivityIds, result.projectFinish, result.warnings
```

| Función | Para qué |
|---|---|
| `computeSchedule(input)` | Calcula fechas, holguras y ruta crítica. Lanza `ScheduleError` / `CycleError` si la entrada es inválida o hay ciclos. |
| `findCycleForNewDependency(existentes, nueva)` | Antes de guardar una dependencia: devuelve la ruta del ciclo que crearía o `null` (US-020). |
| `createBaseline` / `compareToBaseline` | Línea base inmutable y versionada, y comparación planificado vs. actual (US-024). |
| `previewImpact(input, cambios)` | Impacto de un cambio antes de confirmarlo: actividades afectadas y variación del fin (US-066). |
| `WorkCalendar` | Calendario laboral: día laborable, siguiente laborable, días laborables entre fechas. |

## Modelo y convenciones (revisar: son decisiones de negocio)

1. **Eje de días laborables.** El día laborable `k` ocupa `[k, k+1)`. Una actividad de duración `d` que empieza
   en `es` termina en `es + d`. Las cuatro dependencias (FS, SS, FF, SF) con desfase `lag` son aritmética entera.
2. **Duraciones y desfases** son **enteros en días laborables** del calendario del proyecto. Un desfase
   negativo es un adelanto. No hay horas ni desfases en días corridos.
3. **Inicio:** si `projectStart` no es laborable, el cronograma arranca el siguiente día laborable. Nada
   empieza antes del inicio, aunque un adelanto lo pidiera.
4. **Hitos** (duración 0) **ocurren al final de un día laborable**: un hito tras una tarea que termina el
   viernes cae el viernes. Sus restricciones de fecha se leen como "fin de ese día". Un hito sin predecesoras
   cae en el primer día del proyecto.
5. **Las dependencias siempre se respetan.** Una restricción que no se puede cumplir **no mueve** la
   actividad: produce **holgura negativa** y una advertencia (`CONSTRAINT_VIOLATED`, `NEGATIVE_FLOAT`).
   Esto difiere de la restricción "forzada" de MS Project, que sí mueve la actividad y deja holgura negativa
   en las predecesoras.
6. **Restricciones:** SNET, SNLT, FNET, FNLT, MSO, MFO. Una actividad puede tener **varias, una por tipo**
   (un sprint impone `SNET` + `FNLT`, POS-001 §6.3). Una fecha no laborable se resuelve así: los límites
   inferiores usan el siguiente día laborable y los superiores el anterior; `MSO`/`MFO` en un día no laborable
   no se pueden cumplir.
7. **Una sola dependencia por par** (predecesora, sucesora), sea cual sea su tipo.
8. **Ruta crítica:** actividades con holgura total ≤ 0. Toda actividad precede implícitamente al fin del
   proyecto. La holgura libre se calcula contra la fecha temprana real de las sucesoras (y puede superar a la
   total cuando una restricción propia recorta la total).
9. **Líneas base** congeladas en profundidad; el motor no lee el reloj (`capturedAt` lo aporta quien llama).
   Las variaciones se miden en días laborables.
10. **Fechas** `AAAA-MM-DD` entre 1900 y 2200; sin horas ni zonas horarias.

## Qué cubren las pruebas y qué no

- Casos calculados a mano; 1 800 redes aleatorias y 300 calendarios aleatorios contra oráculos independientes;
  invarianza al orden de la entrada; 5 000 actividades y 9 846 dependencias en 32 ms (Node 22, entorno de
  desarrollo; RNF-03 pide < 1 s).
- **No cubierto todavía:** recursos y calendarios por recurso (R3), avance real y fechas reales (US-026,
  hoy el motor planifica pero no registra ejecución), horas, desfases en días corridos y fusos horarios.
