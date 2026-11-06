# Plan inicial y entregables en el mapa del proyecto

Implementación del 6 de noviembre de 2026. Supabase conserva la autoridad sobre el plan, los documentos y los pagos; Neo4j es una proyección consultable, reconstruida mediante el trabajo existente `sync_project_graph`.

## Recorrido representado

- Proyecto → Tiene como plan inicial → Plan inicial.
- Plan inicial → Incluye el entregable → Cada etapa confirmada.
- Entregable → Tiene respaldo de entrega → Documento original vinculado a esa etapa.
- Entregable → Tiene pago confirmado → Pago verificado y registrado.
- Pago confirmado → Se respalda en la entrega → Documento exacto utilizado al preparar el cobro.

Los nodos del plan muestran su estado propio. El detalle de cada entregable conserva su título, trabajo previsto, importe y condición de cobro. Los PDFs se abren por sus identificadores originales mediante la ruta privada existente. Un respaldo adjunto se presenta como documento vinculado; esa relación no equivale por sí sola a una firma verificada.

El filtro del mapa permite elegir el recorrido del plan inicial además de las solicitudes de cambio. Los colores agrupan recorridos, sin calificar clientes ni convertirlos en estados de pago. Se reutilizan el árbol de disposición, el cálculo de puertos exclusivos y el posicionamiento de etiquetas existentes. Las conexiones entrantes y salientes de cada tarjeta tienen puntos independientes.

## Snapshot y permisos

La migración `20261106171356_project_plan_graph_snapshot.sql` amplía `private.graph_snapshot(uuid,uuid)` conservando su versión y los campos anteriores. Añade los arrays `project_start_plans`, `project_start_stages`, `plan_stage_evidence` y `plan_stage_payments`. Cada consulta nueva exige el propietario y proyecto recibidos, y un proyecto y cliente activos. Las fuentes retiradas quedan excluidas.

La función mantiene `SECURITY INVOKER`, `search_path` vacío y ejecución revocada para `PUBLIC`, `anon` y `authenticated`. El acceso sigue pasando por el comando autorizado del grafo. No se expone un endpoint SQL público nuevo ni se copian tokens, enlaces de checkout, correos de pagadores, IDs de captura o credenciales a Neo4j.

Un pago de etapa solo se incluye cuando el checkout está `completed`, tiene fecha de pago y coincide con `project_received_payments`: propietario, proyecto, orden, captura, merchant, moneda e importe. El worker exige el respaldo vinculado a la misma etapa y el identificador del registro verificado; una incoherencia produce error. No transforma abrir un enlace, aprobar un checkout, enviar un correo o adjuntar un archivo en pago confirmado.

Las etapas tienen claves deterministas compuestas por proyecto y posición. Las sustituciones de la proyección siguen siendo atómicas y acotadas por propietario, proyecto y generación; no modifican registros financieros. La fecha `project_start_plans.completed_at` marca únicamente el fin del plan inicial. No escribe `projects.status` ni bloquea los recorridos independientes de cambios o devoluciones.

## Actualización y verificación

No hay variables de entorno ni dependencias nuevas. Al desplegar el worker y la interfaz, el flujo normal de sincronización detecta el nuevo contenido del snapshot y prepara una generación nueva. Un mapa antiguo no acredita que la proyección nueva haya terminado. No se ejecuta una sincronización masiva por aplicar la migración.

Comprobaciones realizadas:

- SQL transaccional con rollback en `supabase/tests/project_plan_graph.sql`: plan, etapas y documentos; exclusión de pagos pendientes; pagos verificados; privacidad; propietario; retiro de documentos; cierre del plan separado del proyecto; revocación de permisos públicos.
- Regresión SQL `supabase/tests/project_graph_threads.sql` con rollback: comando autorizado, aislamiento, deduplicación, generaciones y detección de mapa obsoleto.
- Diez pruebas de proyección Python, incluidas escritura Neo4j con doble de driver, relaciones y rechazo de evidencia o pagos inconsistentes.
- Nueve pruebas Node de presentación: se conservan adendas/aceptaciones, el plan es un recorrido independiente y cada conexión nueva mantiene puertos exclusivos.
- Sintaxis y paridad ES/EN comprobadas. No se realizaron pruebas de navegador, inferencias, envíos de correo ni operaciones de PayPal.

Estas comprobaciones no equivalen a una nueva escritura real en Neo4j ni a una revisión visual completa. La migración está aplicada en el entorno compartido; el código y la interfaz permanecen en el lote local hasta su publicación autorizada.

## Sincronización explícita de un proyecto real

El 6 de noviembre se solicitó sincronizar un proyecto existente cuyo primer entregable ya tenía pago verificado. La ejecución administrativa pasó por `public.project_graph` con propietario y proyecto autorizados y reclamó el envelope canónico mediante `thread_backend(claim)` dentro de la misma transacción. Después ejecutó `ConnectedWorker.sync_graph` local con su lease vigente, obtuvo la entrada autorizada por HTTP y registró el resultado por el backend normal. No se eligieron a mano generación, snapshot ni hash.

Esta coordinación evita que un consumidor cloud todavía anterior capture ese trabajo de proyección. El filtro de entorno del relay solo separa actualmente `ingest_document`; `sync_project_graph` sigue siendo global. Antes de una sincronización administrativa hay que coordinar quién consume, sin detener servicios ajenos ni marcar un mapa como actualizado por tener únicamente un job terminado. La versión nueva del worker debe publicarse de forma coordinada para que los consumidores produzcan el mismo contrato.

Una lectura real anterior mediante `GraphReader` confirmó un plan, tres entregables, dos documentos y un pago de etapa completado por USD 180, con las relaciones nuevas y la generación/hash exactos. Posteriormente un consumidor cloud anterior sustituyó esa proyección sin incluir el plan. Esa lectura histórica no acredita el estado actual; la publicación debe ejecutar la regeneración versionada descrita abajo y comprobarla de nuevo. No se ejecutaron cobros, correos, inferencias ni cambios de negocio. Los IDs, el envelope, el resultado y los recibos quedan exclusivamente en el directorio privado de operación. La revisión visual del mapa sigue pendiente del usuario.

## Versión del proyector y carga por selección

La migración pendiente `20261106233000_graph_projection_version.sql` mantiene `schema_version: 1` y añade `projection_version: 2` al snapshot canónico. El hash cambia aunque los datos del proyecto sean iguales. Por eso el comando normal reconoce como obsoleto un trabajo anterior ya terminado y crea una generación nueva, sin modificar snapshots anteriores, pagos ni eventos. La migración sustituye solo la función privada; no añade tablas ni columnas.

El worker requiere exactamente esa versión y los cuatro arrays del plan. La raíz Neo4j conserva `projection_version: 2`; el lector exige ese marcador junto con propietario, proyecto, generación y hash. Un consumidor antiguo que ignore el plan no puede producir una raíz que el lector nuevo acepte. Una versión ausente o desconocida falla de forma visible.

Orden de despliegue: actualizar todos los consumidores de `sync_project_graph`, aplicar la migración de función y solicitar la sincronización normal. Comprobar después el estado canónico y leer la generación resultante, incluido el plan si existe. No basta con que el trabajo diga `ready`. Esta migración se ha preparado, no aplicado, durante el lote de publicación.

El mapa abre el proyecto completo. Cada cambio del selector solicita por HTTP `GET /graph?scope=plan` o `GET /graph?scope=change&request_id=…`; volver al proyecto completo también consulta el servidor. La selección no escribe ni vuelve a sincronizar Neo4j. El backend usa consultas Cypher fijas con caminos acotados y un timeout efectivo de quince segundos. Conserva el catálogo de recorridos en todas las respuestas. La interfaz mantiene ese selector durante espera/error, valida el alcance y la generación y descarta respuestas tardías.

La prueba SQL `supabase/tests/graph_projection_version.sql`, preparada para ejecutarse tras la migración, verifica mediante fixtures con rollback la invalidación de la generación antigua, la deduplicación del nuevo comando, la conservación del snapshot anterior y el aislamiento del propietario. No ejecuta Neo4j ni publica mensajes. Las pruebas unitarias del worker y API comprueban el rechazo de versiones desconocidas y la exigencia del marcador al leer; las pruebas Node cubren peticiones exactas, navegación durante una espera, errores sin sustitución de alcance y rechazo de respuestas ajenas u obsoletas.
