# Para el responsable de cambios y devoluciones: vínculos de documentos desde la subida

5 de noviembre de 2026. Lote compartido `feature/trato-assistant-readiness-20261105`. Cambios locales; las migraciones indicadas están aplicadas en Supabase. Este documento no acredita push, PR, merge ni despliegue de este lote.

## Problema y cambio

Antes, varios recorridos reservaban y subían el PDF y asociaban después el documento al guardar una revisión, aceptación o artefacto. Si ese segundo paso fallaba o no se completaba, el archivo seguía en el proyecto, pero Documentos no encontraba su pedido/caso. No implica corrupción del PDF.

`Repository.reserve()` utiliza ahora `reserve_document_with_context`: la reserva y el contexto estructural se guardan en una misma transacción, **antes de subir los bytes a Storage**. `document_upload_contexts` conserva propósito, propietario/proyecto y los IDs normalizados de pedido, propuesta/revisión o devolución/instantánea/pago cuando ya existen. La base deriva los padres desde la revisión/caso autorizado; no acepta un propietario suministrado por el formulario.

Los IDs, claves foráneas compuestas y RLS impiden cruces entre proyectos/propietarios. Un reintento con la misma clave conserva el documento y su contexto; no puede reasignarlo. No se modifican las tablas de aceptación, propuestas enviadas, pagos ni devoluciones financieras por adjuntar un archivo. La asociación estructural funciona con la IA desactivada.

## Entradas auditadas

| Entrada | Contexto que se conoce | Resultado |
| --- | --- | --- |
| Acuerdo inicial de proyecto nuevo o en marcha | Propietario/proyecto y propósito `initial_agreement` | Reserva y contexto atómicos. El asistente de creación mantiene los originales locales hasta confirmar la creación. |
| Pedido nuevo | Propietario/proyecto, `change_request`, ID del propio documento como pedido | Contexto atómico; se conserva la regla de un pedido abierto por proyecto. |
| Ajustes manuales a una adenda | `addendum_adjustments`, revisión que recibió el cliente | Se deriva propuesta/pedido desde esa revisión, antes de subir el PDF. No hace falta que la siguiente revisión ya exista. |
| Adjuntos de respuesta Gmail de cambios | La importación usa el mismo endpoint con propósito y revisión | Conserva el contexto igual que la subida manual. La vista previa de un adjunto no lo importa. |
| PDF devuelto por el cliente | Ruta específica, `acceptance_evidence` y revisión | Se vincula antes de Storage; no registra por sí mismo una aceptación. Documentos lo presenta como PDF devuelto hasta la confirmación de negocio. |
| Adenda generada | `generated_addendum` y revisión | Se reserva con contexto antes del upload y del posterior attach_pdf. |
| Respaldo/solicitud de devolución desde su formulario | Caso/instantánea cuando existen; pago seleccionado y propósito cuando aún se prepara la solicitud | El modal recibe y envía esos IDs. Un archivo previo a la creación de un caso queda identificado como solicitud de devolución por completar. No se inventa un caso aún inexistente. |
| Propuesta PDF de devolución generada | Caso e instantánea | Contexto anterior a Storage y al attach_pdf financiero/documental. |
| Adjunto Gmail de devolución importado | Caso y la instantánea exacta de la respuesta original | Contexto anterior a Storage y a la lectura; no se cambia a la versión actual por conveniencia. |
| Referencia adicional | Proyecto; pedido si se suministra explícitamente | No se infieren relaciones por el título del PDF. Se retiró el botón genérico de Documentos; la acción contextual de devoluciones conserva sus IDs. |
| Evidencia de entrega | API admite `delivery`, propósito `delivery_evidence`, proyecto y pedido opcional autorizado | Mismo contrato de reserva. No se añadió una pantalla de entregas. |
| Respaldo de Reputación | Sistema separado: autor, proyecto y perfil de cliente desde attachment_reserve | Ya reserva antes de Storage. La asociación final a una experiencia ocurre al publicarla; los borradores no se exponen como evidencia publicada. No se movió al índice privado de proyectos. |
| Material de formación de Ensayos | Biblioteca administrada, IDs y versión del manifiesto | No es una subida de usuario ni pertenece a un proyecto privado. Conserva su autorización y tenant independiente. |

## Documentos y procesamiento

`list_documents` añade el contexto estructural sin esperar las relaciones finales de negocio. Los documentos siguen agrupados por el acuerdo inicial y por cada pedido/devolución. Cuando exista una aceptación formal se conserva esa relación; un PDF solo subido no se muestra como aceptación confirmada. Se incluyen las fuentes documentales de la solicitud de devolución, no solo los PDFs finales.

`purpose_context` consume el contexto estructural para el procesamiento y rechaza discrepancias con opciones de análisis existentes. Worker, procesador y Weaviate mantienen su recorrido y sus filtros de propietario/cliente/proyecto. No hay nombres de archivo usados como IDs ni se amplían permisos.

Se añade al archivo **No se pudo procesar · Reintentar** para fallos técnicos registrados por el flujo. El reintento es una acción explícita, usa el endpoint `/projects/{id}/documents/{file_id}/process` y el mismo cliente idempotente de trabajos. Rechazos y solicitudes de aclaración de contenido muestran revisión, sin botón que relance automáticamente la IA. La lectura fallida conserva su botón existente de reintentar lectura. El resultado nuevo sustituye el aviso fallido de ese archivo, sin alterar otros documentos.

No se activó un supervisor periódico. Si se implementa después: recuperar únicamente leases vencidos/interrupciones técnicas, respetar trabajos activos e idempotencia, tener intentos acotados y no repetir inferencias semánticas indefinidamente. Un original que nunca llegó a Storage requiere volver a aportar sus bytes, no inventarlos ni marcarlo leído.

## Migraciones y compatibilidad

- `20261105185720_document_upload_context.sql`: tabla, permisos/RLS y RPC de reserva con contexto.
- `20261105202746_document_context_binding_guards.sql`: restricciones de dominio entre propósitos e IDs.
- `20261105203149_document_context_indexes.sql`: índices de las claves foráneas del contexto.

Aplicar estas migraciones antes de arrancar el API actualizado en otro entorno. El RPC anterior queda para compatibilidad con el despliegue existente; no es la ruta utilizada por el nuevo `Repository.reserve`. No hay nuevos parámetros de entorno, credenciales ni dependencias.

## Verificación

Las pruebas SQL en `supabase/tests/document_upload_context.sql` ejecutan con el rol autenticado y hacen rollback: contexto anterior a Storage/nueva revisión, mismo documento en reintentos, rechazo de reasignación, rechazo de revisión de otro proyecto sin reserva parcial, bloqueo de escritura directa y aislamiento de otro propietario. Las pruebas de código verifican proyección temprana de ajustes, orden de operaciones y botón solo para fallos técnicos. El cierre del lote debe registrar los resultados finales; estas pruebas no equivalen a probar desde la interfaz un envío Gmail o un pago PayPal.

### Resultado técnico del lote

- API: 457 pruebas aprobadas.
- Worker: 196 pruebas ejecutadas, 185 aprobadas y 11 omitidas por sus condiciones de entorno.
- Frontend: 138 pruebas aprobadas y paridad de 3.306 claves ES/EN.
- SQL: pruebas transaccionales de contexto con rollback completadas con rol autenticado.
- Lectura real del repositorio actualizado contra Supabase: 8 documentos, contexto/estado de procesamiento proyectados correctamente.
- Revisión Supabase: sin hallazgos de seguridad del nuevo registro; índices de sus claves foráneas añadidos. Los índices nuevos aún sin uso figuran como información esperable.
- Se retiró la excepción de presentación que ocultaba el reintento de lectura para todos los documentos addendum; siguen pudiéndose abrir los originales y ahora se conserva su recuperación de lectura si falla.
- Trato local actualizado en sus puertos propios; sin cambios en otros proyectos locales. No se hizo push, PR, merge ni deploy de este lote, y no se envió correo ni se ejecutó un pago para verificarlo. La prueba manual del flujo completo queda para el usuario.

Orden visual confirmado con el responsable del proyecto: acuerdo inicial siempre primero; títulos de pedidos y devoluciones por fecha de registro, sin moverse al añadir archivos; documentos dentro de cada bloque del más reciente al más antiguo. Los bloques tienen separación visible.
