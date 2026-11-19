# Registro de decisiones de arquitectura (ADR)

Cada ADR documenta una decisión técnica, su contexto y sus consecuencias. Si una decisión cambia, no se
edita el ADR antiguo: se crea uno nuevo que lo reemplaza y se marca el anterior como *Reemplazado*.

Estados: **Aceptado** (confirmado y vigente) · **Propuesto** (recomendación pendiente de confirmar) ·
**Reemplazado**.

| ADR | Decisión | Estado |
|---|---|---|
| [001](001-stack-y-estructura.md) | Monolito modular: Next.js + TypeScript + Supabase + Vercel | Aceptado |
| [002](002-motor-de-cronograma.md) | El motor de cronograma es un paquete TypeScript puro | Aceptado (implementado) |
| [003](003-donde-corre-el-motor.md) | El servidor es la fuente de verdad de las fechas calculadas | Propuesto |
| [004](004-entornos-y-ci.md) | Entornos (local, staging, producción) y CI | Propuesto |
| [005](005-autenticacion-y-correo.md) | Autenticación, bloqueo por intentos y correo transaccional | Propuesto |
| [006](006-region-y-respaldo.md) | Región de datos y respaldo | Propuesto (requiere decisión de presupuesto) |
| [007](007-componente-gantt.md) | Selección del componente Gantt mediante un spike | Propuesto |

Los datos de precios y límites de Supabase citados en estos documentos se verificaron en su documentación
y página de precios el **18 de noviembre de 2026**. Cambian con frecuencia: confirmarlos antes de contratar.
