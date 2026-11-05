# MVP: agente de cambios — 4 de noviembre de 2026

Este recorte solicitado por el responsable sustituye la prioridad de las siete tandas de docs/backlog-ia-expedientes.md para esta entrega. Tiempo disponible indicado: dos horas. Rama compartida actual; no publicar, crear PR ni fusionar sin autorización expresa.

## Implementado en este recorte

Agente de devoluciones deshabilitado en interfaz con etiqueta ES/EN Próximamente / Coming soon y bloqueo backend de apertura, mensajes y ejecuciones nuevas. El flujo manual de devolución permanece disponible. No borrar conversaciones ni documentos existentes. Agente de cambios conserva drawer y mascota; ayuda corta visible y tooltip explican la consulta documental que ya existe, sin prometer cálculo aún no implementado.

## Análisis

La base actual ya ofrece sesiones, historial, herramientas de resúmenes/pasajes, citas verificadas, elección explícita de fuentes listas y actividad real. Reutilizar worker → API → procesador → projects_private con filtros owner/client/project y versiones vigentes. No modificar Ensayos, su biblioteca ni los tenants.

Falta el asistente que produce campos de propuesta: hoy el agente es de consulta y el formulario de proposal-workspace.mjs recibe alcance, condiciones, descripción, importe y fecha manuales. Además, el agente contextual se monta en seguimiento con una revisión existente: el MVP debe aparecer también ANTES de crear la primera adenda, desde el pedido. No crear una revisión solo para abrir el agente.

Ampliación aprobada: el usuario también puede conversar y resolver preguntas sobre el pedido y sus adendas, con fuentes, antes y después de preparar la propuesta. Se reutiliza la consulta existente y se conservan las preguntas de seguimiento.

La nueva ejecución se vinculará al pedido autorizado y, si existe, a su revisión editable. Se reutilizan las herramientas de recuperación y el despachador; se añade contrato JSON de propuesta validado, sin cambiar el contrato de respuestas de consulta. Una solicitud pagada o revisión enviada se conserva para consulta. La aplicación revalida el estado antes de guardar con los comandos existentes.

## Plan aprobado — implementación en curso

1. **Preparar una propuesta (25 minutos).** Desde Revisar cambio / Preparar propuesta, agente compara el pedido con el acuerdo disponible y propone alcance adicional, exclusiones, condiciones y esfuerzo estimado con supuestos. Cada afirmación documental lleva fuente. Si falta el acuerdo o el pedido, pedirlo; no sustituirlos por supuestos.
2. **Revisar precio y plazo (20 minutos).** Usuario confirma tarifa y revisa el esfuerzo propuesto; backend calcula adicional en unidades menores con entradas validadas y moneda del formulario. Si faltan tarifa/esfuerzo, pedirlos, sin inventar precios de mercado. Fecha de entrega solo con disponibilidad/fecha revisada por el usuario. No presentar una estimación como precio aceptado.
3. **Usar propuesta (20 minutos).** Botón explícito completa el formulario existente con campos revisables. No guarda, envía ni cobra por sí solo. Revalidar pedido/revisión para impedir aplicar resultado obsoleto o cambiar un registro pagado. Conservar texto del usuario ante error.
4. **Verificación (35 minutos).** Contratos JSON, cálculo, fuentes ajenas y estado pagado/obsoleto; recorrido en app: pedido → agente → revisión → formulario → guardado explícito → PDF. Usuario valida una ejecución conectada, citas e importe; autorización de llamadas diagnósticas pagadas sigue separada. Reservar 20 minutos para corregir y preparar entrega.

Estimación de trabajo, no garantía de duración. Si una comprobación real falla, comunicarla y corregir el mismo recorrido; no ampliar funciones para aparentar una entrega completa.

## Fuera del MVP

Agente de devoluciones, renegociación con reducción de entregables, comparables de proyectos, precios de mercado, nuevos grafos Neo4j y cambios de modelos/proveedores. Quedan en backlog posterior. Se conservan las funciones manuales existentes y los arreglos documentales compartidos.

## Criterio de aceptación

En un pedido real de cambio, el usuario obtiene propuesta respaldada, confirma tarifa/esfuerzo, revisa el adicional calculado, aplica campos al formulario y decide guardarlos. Fuentes ausentes y errores permanecen visibles. Interfaz ES/EN, ayuda breve, mismo drawer/mascota; nada de porcentajes ficticios, simulaciones como respaldo ni acciones autónomas de Gmail/PayPal.

## Implementación y comprobaciones

Implementado: botón Preparar con Trato en preparación inicial y edición de borradores; chat previo a la primera adenda con fuentes, historial de turnos y preguntas sobre la propuesta generada; investigación documental y salida JSON validada para términos y esfuerzo estimado. Propuesta lista requiere evidencia original tanto del acuerdo como del pedido. Confirmar tarifa (incluido cero) y horas llama al cálculo decimal determinista del backend. Usar propuesta revalida fuentes/estado y completa campos del formulario local; no guarda ni envía, y deja la fecha para revisión humana. La vista previa de fuentes conserva el formulario. Errores preservan la pregunta y las operaciones inciertas conservan su clave.

API: POST /api/v1/ai/change-proposals, GET /api/v1/ai/change-proposals/{job_id}, POST /api/v1/ai/change-proposals/{job_id}/price. Se reutilizan ProjectAssistant y las herramientas de resúmenes/pasajes, junto con un contrato independiente de propuesta. Las consultas generales reciben change_proposal_job_id validado cuando se pregunta por el borrador generado. Cada consulta obtiene evidencia nueva; respuestas previas y borradores no sustituyen documentos. Se rechazan solicitudes enviadas, pagadas, cerradas y resultados obsoletos en herramientas, consulta y precio.

Pruebas: API 416 aprobadas; worker 187 ejecutadas (176 aprobadas y 11 omitidas), incluidas 11 de integración del MVP; tres pruebas Chromium del nuevo recorrido y tres pruebas unitarias específicas aprobadas. Sintaxis, 3167 traducciones ES/EN y diff --check aprobados. Se corrigió la expansión del esquema JSON para que sus referencias sigan siendo válidas dentro del despachador de herramientas. Los proveedores de pruebas son dobles explícitos; no se realizaron inferencias pagadas ni se enviaron correos o cobros para estas comprobaciones.

Estado: implementación local terminada, Trato reiniciado para validación del usuario. Pendiente una ejecución conectada completa del modelo con un acuerdo y un pedido de cambio realmente distintos, ambos disponibles. El pedido de prueba cuyo PDF contiene un acuerdo inicial debe producir evidencia insuficiente, no una propuesta ficticia de éxito. El historial previo a la primera adenda usa los trabajos Redis (24 horas); la conversación contextual de adendas existentes conserva el historial durable implementado. No se añadieron migraciones para ampliar ese alcance en este MVP. Sin commit, push, PR ni despliegue remoto.

Publicación de rama autorizada por el responsable antes de la validación E2E. Esta publicación no acredita el recorrido conectado ni autoriza crear o fusionar un PR. Las comprobaciones técnicas realizadas se mantienen separadas de la aceptación funcional pendiente.
