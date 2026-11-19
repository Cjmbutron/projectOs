# ADR-002 — El motor de cronograma es un paquete TypeScript puro

**Estado:** Aceptado e implementado en `packages/schedule-engine` · **Relacionado con:** R-09, R-12, RNF-03, US-019…024, 065, 066

## Contexto

El motor de cronograma es el mayor riesgo técnico (R-09) y el corazón del producto. POS-001 v1.2 lo daba por
"hecho y probado" en `engine/`, pero ese prototipo no existe en el material disponible: **se construyó desde
cero**. Debe poder extenderse en R3 (recursos) sin reescribirse.

## Decisión

Un paquete **TypeScript puro**, sin base de datos, sin red, sin reloj y sin React:

- Entrada: inicio del proyecto, calendario, actividades, dependencias y restricciones.
- Salida: fechas tempranas y tardías, holguras total y libre, ruta crítica y advertencias.
- Funciones deterministas: mismas entradas, mismo resultado, sin efectos laterales. El motor no lee la hora
  actual: quien lo llama aporta `capturedAt` al crear una línea base.
- Cálculo sobre un **eje de días laborables** con aritmética entera: el calendario se resuelve en una sola
  función monótona (`workingDaysBefore`) y todo lo demás (ordinales, siguiente laborable, diferencias) se
  deriva de ella en O(log h), sin recorrer días uno a uno.
- Convenciones de negocio documentadas en `packages/schedule-engine/README.md`.

## Cómo se verificó

88 pruebas, entre ellas: casos calculados a mano de los cuatro tipos de dependencia, lags y adelantos,
hitos, restricciones, calendarios con feriados y excepciones; **1 800 redes aleatorias y 300 calendarios
aleatorios** contra oráculos independientes (relajación iterativa en lugar de orden topológico, y recorrido
día por día en lugar de aritmética de conteo); invarianza al orden de la entrada; y 12 mutaciones deliberadas
del código, todas detectadas. Una mutación se escapó en el primer intento (las pruebas aleatorias con
restricciones usaban un calendario de 7 días, donde no existen fechas no laborables); eso llevó a añadir una
prueba aleatoria con lunes–viernes, feriados y restricciones sobre fines de semana.

## Consecuencias

- R3 (recursos) debe **extender** el motor (nuevas entradas de calendario por recurso), no reescribirlo.
- El motor no sabe nada de WBS, sprints ni usuarios: esos módulos le entregan actividades, dependencias y
  restricciones (p. ej. las fechas de un sprint llegan como `SNET` + `FNLT`, POS-001 §6.3).
- Lags y duraciones son en días laborables enteros. Duraciones en horas o lags en días corridos
  ("elapsed") **no están soportados**; si hacen falta habrá que ampliar el modelo.
