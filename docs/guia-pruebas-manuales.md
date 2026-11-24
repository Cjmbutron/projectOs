# Guía de pruebas manuales (entregas 10 a 34)

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

### Dependencias por actividad (entrega 31) — `/projects/<id>`, sección «Dependencias»
- [ ] Cada actividad aparece numerada («3. Nombre») y se abre para ver sus predecesoras y sucesoras.
- [ ] «Agregar predecesora» y «Agregar sucesora»: la lista no ofrece la propia actividad, las ya relacionadas ni las que crearían un ciclo.
- [ ] Cambia el tipo o el desfase de una dependencia y guarda; después de recalcular, las fechas cambian como corresponde.
- [ ] Tras agregar, cambiar o quitar, el panel de esa actividad sigue abierto.
- [ ] Como miembro sin permiso de edición, ves las dependencias pero no los formularios.

### Estilo oscuro y barra lateral (entrega 32) — todas las pantallas internas
- [ ] Barra lateral con Proyectos, Mis actividades, Recursos y Carga semanal; la sección actual aparece resaltada (en Carga semanal, solo ella).
- [ ] Cabecera con tu correo y «Salir»; «Salir» te devuelve a `/login`.
- [ ] En el móvil (o ventana estrecha) la barra se oculta y se abre con «Menú»; se cierra al navegar.
- [ ] Insignias de salud con texto (Verde/Ámbar/Rojo/Sin datos) legibles sobre el fondo oscuro.
- [ ] El Gantt se ve bien: barras, ruta crítica en rojo, dependencias, fines de semana y la barra seleccionada.
- [ ] Formularios: los campos se distinguen del fondo y el foco con teclado se ve (Tab).
- [ ] (Entrega 33) En `/projects`: tarjetas de Proyectos, En riesgo, Avance medio y Mis actividades vencidas; las cifras coinciden con la lista y con «Mis actividades».
- [ ] Mensajes de error y de éxito en recuadros; tablas con botones alineados; en móvil las tablas se desplazan lateralmente y ya no ocultan columnas.
- [ ] Anota cualquier texto ilegible, color que no se distinga o pantalla que se vea «sin estilo».

### Tablero Kanban (entrega 34) — `/projects/<id>/board`
- [ ] Las actividades aparecen en Sin iniciar, En curso y Terminada según su estado, con porcentaje, fechas y responsable.
- [ ] Arrastrar una tarjeta a otra columna cambia su estado; también con el selector «Mover» (sirve con teclado). Comprueba que el avance del proyecto se actualiza.
- [ ] «En curso» registra 1 % si venía de Sin iniciar y 99 % si venía de Terminada.
- [ ] Un hito no se puede mover a En curso (no aparece la opción).
- [ ] Como colaborador solo mueves tus actividades; las demás no se pueden arrastrar. En un proyecto cerrado nada se mueve.
- [ ] Vencidas y «Vence pronto» se ven con su insignia.

### Calendario y feriados (entrega 36) — `/projects/<id>/calendar` (enlace «Calendario →» en el proyecto)
- [ ] Se ve la lista de feriados y días trabajados del año; el selector de año cambia la lista.
- [ ] Agregar un feriado de un día con nombre: aparece en la lista. Sin nombre no se deja guardar.
- [ ] Agregar un rango (por ejemplo, de viernes a lunes): se guardan solo los días laborables; el mensaje dice cuántos se omitieron por caer en fin de semana.
- [ ] Agregar un «día trabajado excepcional» en un sábado: aparece con su insignia. En un día que ya es laborable se omite.
- [ ] Repetir una fecha ya registrada no la duplica (el mensaje dice cuántas ya estaban).
- [ ] «Feriados nacionales de Bolivia sugeridos»: revisa fechas y nombres contra el decreto del año, corrige las que difieran y guarda los marcados. Los que caen en fin de semana o ya existen vienen sin marcar.
- [ ] Después de guardar, el proyecto muestra el cronograma como desactualizado; al recalcular, las fechas saltan los feriados nuevos.
- [ ] Eliminar un día lo quita. Un colaborador sin permiso de cronograma ve el calendario pero no los formularios. En un proyecto cerrado todo queda en solo lectura.

### Búsqueda global (entrega 35) — cabecera, en cualquier pantalla
- [ ] Pulsa «/» fuera de un campo: el cursor va a la caja de búsqueda. Con 1 carácter dice «Escribe al menos 2 caracteres».
- [ ] Escribe parte del nombre o del código de un proyecto: aparece en «Proyectos». Escribe parte del nombre de una actividad: aparece en «Actividades» con el nombre de su proyecto.
- [ ] Flechas ↑ ↓ cambian el resultado resaltado, Enter lo abre, Escape cierra el panel (y una segunda vez vacía la caja).
- [ ] Un proyecto abre su pantalla; una actividad abre su proyecto con el panel de dependencias de esa actividad desplegado.
- [ ] Busca `%` o `_` solos o dentro de un texto: se toman como caracteres normales, no como comodín.
- [ ] Con otro usuario (p. ej. un externo o de otra organización) no aparecen proyectos que no puede leer; un proyecto en la papelera o archivado no aparece.
- [ ] En el móvil el panel ocupa el ancho de la pantalla y no aparece barra de desplazamiento horizontal.

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
