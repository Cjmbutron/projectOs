# ADR-006 — Región de datos y respaldo

**Estado:** Propuesto — **requiere una decisión de presupuesto (A-2)** · **Relacionado con:** A-4, R-13, RNF-05, RNF-10

## Contexto y hechos verificados (18-nov-2026)

- **Región:** [South America (São Paulo), `sa-east-1`](https://supabase.com/docs/guides/platform/regions)
  está disponible como región específica. La región elegida determina dónde se almacenan los datos
  principales; Supabase aclara que es un control de ubicación de datos, **no una prueba de cumplimiento
  normativo**. No se midió la latencia desde Bolivia: la elección se basa en cercanía geográfica.
- **Respaldo:** el plan Free no incluye copias automáticas ni recuperación a un punto en el tiempo (PITR).
  Con copias diarias el peor caso es perder hasta 24 horas de datos. PITR es un complemento de pago:
  [**US$ 100 al mes por 7 días de retención**](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)
  (US$ 200 por 14, US$ 400 por 28), no cubierto por el tope de gasto, y se cobra por proyecto. El plan Pro
  parte de US$ 25 al mes por organización más el cómputo.
- **RNF-10** (RPO ≤ 1 h, RTO ≤ 4 h) **solo se cumple con PITR** (o con volcados lógicos propios frecuentes).

## Opciones

| Opción | RPO real | Costo adicional | Comentario |
|---|---|---|---|
| A. Pro + PITR (7 días) | Minutos | ≈ US$ 100/mes | Cumple RNF-10; operación simple. |
| B. Pro con copias diarias | Hasta 24 h | Ninguno extra | Aceptable para un piloto sin datos críticos; **incumple RNF-10**. |
| C. Pro + volcado lógico horario a almacenamiento externo | ≈ 1 h | Operación propia | Más piezas que mantener y probar. |

## Recomendación

- **Desarrollo y staging:** plan Free, región São Paulo, sin datos reales.
- **Primer piloto con usuarios reales:** opción **B**, declarando explícitamente que RNF-10 queda diferido, o
  **A** si el presupuesto lo permite.
- **Antes de cobrar o de guardar datos de clientes que no se puedan rehacer:** opción **A**, y un simulacro de
  restauración (RNF-10 pide uno por trimestre).

## Decisión que necesita una persona

Elegir A, B o C para el piloto y el presupuesto mensual disponible. Los precios se deben reconfirmar al
contratar.
