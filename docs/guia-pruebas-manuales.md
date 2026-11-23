# Guía de pruebas manuales (entregas 10 a 29)

Para probar en **tu Supabase real** lo que hasta ahora solo se probó con un reemplazo local. Marca cada punto y
anota lo que falle (pantalla, qué hiciste, mensaje exacto). Con eso se corrige rápido.

## 0. Preparación
1. Aplica las migraciones que falten: `DATABASE_URL='…' scripts/apply-migrations.sh --list` (muestra pendientes).
   Si ya aplicaste a mano hasta la 1900, una sola vez: `… scripts/apply-migrations.sh --baseline 1900`; después `… scripts/apply-migrations.sh`.
   Usa la conexión directa (puerto 5432).
2. `apps/web/.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `npm ci && npm run dev -w apps/web`.
3. Ten **dos usuarios** en la misma organización (uno owner/PM y otro miembro) y, si puedes, un tercero invitado externo.

## 1. Gantt (entregas 10, 16–18) — `/projects/<id>/gantt`
- [ ] Se ven las barras, la ruta crítica y las dependencias.
- [ ] Arrastrar una barra a la derecha: se recalcula y la actividad queda con «no empezar antes de». Hacia la izquierda no debe adelantarla.
- [ ] Redimensionar una barra cambia su duración en días laborables (con el ratón y con Mayús+flechas).
- [ ] «Crear dependencia»: elige predecesora y sucesora, prueba FS/SS/FF/SF; un ciclo debe rechazarse con mensaje.
- [ ] Como miembro sin permiso de edición, el Gantt es de solo lectura.

## 2. Charter, línea base, salud, requisitos (entregas 11–14)
- [ ] `/charter`: no pasa de borrador a propuesto sin objetivos, alcance y al menos un stakeholder.
- [ ] `/baseline`: crear línea base con el cronograma al día; comparar planificado vs. actual.
- [ ] Lista de proyectos: insignia verde/ámbar/rojo (umbrales 2/5 días) y «Sin datos» sin línea base. Mueve una actividad para provocar atraso y recalcula.
- [ ] `/requirements`: el team_lead registra pero **no** aprueba; solo el PM aprueba o rechaza.

## 3. Avance y Mis actividades (entregas 19–20)
- [ ] En el proyecto, registra avance de una actividad (0–100; un hito solo 0 o 100). Cambia el estado y el avance del proyecto.
- [ ] Como responsable de una actividad (sin permiso de edición) puedes reportar **solo** en las tuyas.
- [ ] `/mis-actividades`: ves tus actividades de todos los proyectos, con plazo vencido/próximo, y puedes registrar avance.

## 4. Recursos (entregas 21–29) — `/resources`, `/resources/load`
- [ ] Owner, admin y PM crean/editan/desactivan recursos; un miembro común solo los ve. Un externo no los ve.
- [ ] Vincular una persona a un miembro (el selector no ofrece quien ya está vinculado). Un equipo no admite miembro.
- [ ] En el proyecto: asignar un recurso con % de dedicación. Cualquier miembro interno del proyecto (PM, líder técnico, colaborador) asigna en cualquier actividad; un lector o cliente/stakeholder no.
- [ ] `/resources/load`: horas / capacidad por semana. Asigna más de 100 % a la vez y comprueba «Sobreasignado» (texto, no solo color), y que en la pantalla del proyecto aparezca el aviso de sobreasignación con enlace a la carga semanal.
- [ ] Registra una ausencia de 2 días hábiles: la capacidad de esa semana baja en 2 días de jornada. Una ausencia en fin de semana no cambia nada.
- [ ] Un recurso con asignaciones no se puede eliminar (solo desactivar).

## 5. Seguridad (con el usuario externo y el de otra organización)
- [ ] El externo no ve recursos ni la carga; no puede asignar ni editar.
- [ ] Un usuario de otra organización no ve nada de la tuya.
- [ ] Sin sesión, cualquier ruta redirige a `/login`.

## 6. Qué reportar
Para cada fallo: ruta, pasos, resultado esperado vs. obtenido y el texto del error. Si el error es de base de datos,
copia el mensaje de la consola del navegador o del terminal de `npm run dev`.
