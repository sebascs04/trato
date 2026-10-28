# Documentos y envío sin pasos repetidos

Cambios solicitados por Sebastian el 27/10/2026.

- Archivos del proyecto se agrupa por `email_request`: pedido, adendas, respuestas del cliente y aceptaciones, con número de versión. Pedidos con actividad reciente primero; documentos recientes primero dentro de cada grupo. Acuerdo inicial y referencias generales permanecen aparte.
- La relación procede de las FK existentes de artifacts, acceptances y feedback hacia la revisión y su propuesta. `list_documents` añade `request_links` en la misma consulta de metadatos; no descarga textos ni carga cada versión con solicitudes adicionales. No hay migración, modificación de RLS ni dependencia de Neo4j.
- Un archivo sin relación registrada no se atribuye por título o fecha. Las adendas sin enlace permanecen visibles como tales. Los grupos empiezan plegados salvo el primero.
- Proyecto conserva una sola vista del acuerdo inicial, con sus fuentes y acción para añadir información. Se retiran el botón y el paso repetido «Revisar lo acordado»; el alias interno de esa vista dirige al acuerdo.
- Enviar adenda abre directamente el correo con destinatario, mensaje y PDF. El adjunto se despliega dentro de ese modal; no reemplaza el correo.
- El botón final de envío confirma la revisión de esa instantánea y después solicita el envío. Abrir o cancelar la vista previa no registra revisión ni envía mensajes. El servidor sigue exigiendo revisión para enviar y comprueba el digest del mensaje y PDF; permitir ver un borrador no permite enviarlo directamente saltándose la revisión.
- Preparar cobro ya abría directamente su correo; se conserva esa secuencia. Las aceptaciones, pagos y revisiones de negocio no cambian.

Validación: consulta PostgREST real con límite cero para verificar las FK; 123 pruebas de API aprobadas; 24 pruebas de interfaz conectada y 7 de propuestas aprobadas. Los correos y pagos de las pruebas usan dobles explícitos; no se enviaron correos ni se crearon cobros durante esta tarea.

## Auditoría de acciones combinables

Revisión ampliada del 27/10/2026. Se recorrieron los manejadores activos de clientes, proyectos, documentos, propuestas/versiones, correo, aceptación, cobros, conexión Gmail, checkout y devolución simulada; además, el panel de pago de la demostración histórica.

| Acción | Decisión de interfaz |
| --- | --- |
| Crear cliente | Guardar deja abierto el cliente creado; se elimina volver a buscarlo y abrirlo. |
| Crear proyecto | Ya guarda y abre el proyecto; se conserva. |
| Subir información inicial o un pedido | Una subida guarda el archivo y actualiza su vista; no se añade confirmación posterior. La lectura pendiente mantiene su estado real. |
| Consultar acuerdo inicial | Una sola pantalla; se retiró la revisión duplicada. |
| Revisar un pedido | Comparación de fuentes y preparación tienen objetivos distintos: leer el pedido frente a definir alcance/importe/fecha. Se conservan. |
| Preparar, editar o revisar adenda | El formulario ofrece **Guardar y enviar al cliente** con destinatario visible, o **Guardar borrador**. La primera acción guarda, genera PDF, registra revisión y envía sin otro modal. La segunda nunca envía. |
| Fallo al guardar/enviar | Se conserva el formulario y el error. Una versión guardada no se vuelve a crear al reintentar. Si se cambian campos después de guardarla, se exige consultar ese estado antes de alterarlo. No se anuncia envío si falla. |
| Destinatario cambiado | Si el backend devuelve un correo distinto del mostrado, se detiene antes de registrar revisión/enviar. No se reemplaza el destinatario silenciosamente. |
| Enviar adenda existente o cobro | Una vista de correo y una acción final. El adjunto se abre dentro de ella. Preparar cobro ya abre esa vista directamente. |
| Aceptación recibida | Se adjunta el PDF y se describen los resultados de revisión; el botón Guardar aceptación revisada expresa la confirmación. Se elimina la casilla redundante. No cobra automáticamente. |
| Versiones | Se elimina el selector cuando sólo existe v1. Con varias versiones, se cargan dentro del detalle, sin un modal intermedio. Elegir una versión sigue siendo una selección necesaria. |
| Cerrar un pedido | Motivo y detalle en un solo formulario. Su confirmación conserva la decisión de negocio explícita. |
| Eliminar cliente | Se conserva la confirmación que identifica al cliente y su alcance. No es una confirmación repetida del mismo formulario. |
| Gmail | Conectar/desconectar ya son acciones directas. El consentimiento de Google pertenece al proveedor. |
| Checkout PayPal | Se conserva la aprobación del comprador y la verificación posterior del backend. Volver del proveedor no se interpreta como pago. |
| Devolución simulada: propuesta | **Guardar y simular envío** encadena guardar/editar borrador y envío dentro del workflow actual, bajo una sola elección explícita. Guardar sin enviar sigue disponible. Si falla el primer comando, no se ejecuta el segundo. |
| Devolución: aceptación y autorización | Se conservan separadas: el cliente acepta condiciones; el freelancer autoriza devolver dinero. No se fusionan decisiones de actores distintos. |
| Pago de demostración histórica | Destinatario y correo aparecen juntos. Se retira la pantalla que sólo conducía a Revisar correo. No se conectó a servicios reales. |
| Historial, mapa y fuentes | Consulta bajo demanda, sin confirmaciones ni operaciones de negocio. |

No se envió ningún correo real ni se creó un cobro/reembolso durante estas verificaciones. Los handlers de Supabase, el worker y el flujo de cambios del compañero no se modificaron en esta ampliación: las acciones combinadas usan los endpoints y checkpoints existentes.
