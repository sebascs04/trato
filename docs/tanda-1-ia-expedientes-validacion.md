# Tanda 1 — registro de validación

Estado: implementación en revisión; integración real y aceptación del usuario pendientes. Este registro distingue las comprobaciones técnicas de la conversación real con proveedores.

## Preparación comprobada

- La configuración privada existe para API, worker y procesador. Se comprobó solo presencia, sin imprimir credenciales.
- La conexión vectorial está habilitada en API y procesador; URL y clave de Weaviate están presentes solo en el procesador.
- El worker tiene proveedor Gemini explícito, backend Vertex y modelo configurado. Esto no confirma cuota ni una respuesta real.
- Al inspeccionar, API y worker no tenían las variables `TRATO_AI_WORKFLOWS_ENABLED` y `TRATO_FILE_PROCESSING_ENABLED`. La prueba conectada necesita revisar y habilitar los interruptores correspondientes; no interpretar su ausencia como permiso para sustituir el flujo por una simulación.
- Los puertos oficiales son web 5173, API 8100, procesador 8101 y Redis propio 6380. No usar Redis 6379 de otro proyecto.
- Hay una CLI Supabase de Windows previamente instalada; la aplicación de la nueva migración debe ejecutarse desde la carpeta canónica de API, con revisión previa de migraciones pendientes. No se registra ninguna migración aplicada por este análisis.

## Pruebas de código e integración técnica

El acta final debe consignar comando, recuento y resultado de las suites de API, worker, frontend y navegador. Los tests con modelos/almacenamiento simulados explícitos verifican contratos, aislamiento, idempotencia y recuperación; no acreditan inferencia ni recuperación vectorial reales.

El navegador de prueba de `tests/browser/case-assistant.spec.cjs` usa el módulo real y respuestas HTTP dobladas explícitamente. Debe comprobar restauración de mensajes, reintento con la misma clave, apertura de la fuente y rechazo de una respuesta tardía de otro expediente. No es la prueba de proveedor real.

## Recorrido real por validar

1. Comprobar migración de sesiones/mensajes y RLS en Supabase. Registrar versión aplicada y prueba de que una identidad diferente no accede a sesión/mensajes ajenos.
2. Arrancar únicamente servicios propios de Trato con puertos documentados, tras revisar listeners y contenedores. No reiniciar servicios ajenos ni cambiar puerto automáticamente.
3. Entrar a Trato con la sesión autorizada del usuario. Abrir un cambio o devolución existente con documentos privados permitidos para la prueba.
4. Abrir el asistente. Confirmar ID de expediente/revisión y actividad solo mientras exista trabajo en cola o ejecución.
5. Formular una pregunta sustentada por un pasaje original del proyecto. Confirmar que el worker consulta el procesador/Weaviate en `projects_private`, con filtros de propietario/cliente/proyecto y fuentes vigentes.
6. Comprobar respuesta de Gemini real, pasaje literal, localizador y apertura del documento correcto. Registrar modelo efectivo y IDs técnicos, sin copiar contenido privado al repositorio.
7. Preguntar por un dato ausente; comprobar insuficiencia explícita, sin inventar precio, aceptación ni información contractual.
8. Recargar la app; comprobar conversación persistida. Verificar por separado que el historial permanece disponible cuando el trabajo técnico ya no está en Redis, sin eliminar datos reales para simular el TTL.
9. Cambiar de expediente/proyecto y comprobar que no aparecen mensajes del anterior. Comprobar revisión obsoleta sin alterar una revisión enviada o pagada.
10. Confirmar que ningún paso produjo envío Gmail, aceptación, cobro ni reembolso. Registrar errores reales visibles si proveedor o fuente no está disponible.

Cierre: el usuario valida el recorrido y se registra su aceptación antes de iniciar tanda 2. Un bloqueo de entorno o de autenticación deja esta validación pendiente, no aprobada.

## Limitaciones de herramientas observadas

El intento de iniciar Computer Use mediante `node_repl` falló antes de ejecutar JavaScript con `sandboxCwd is not a local file URI`. No se accedió a la sesión del navegador ni se extrajeron tokens o almacenamiento de autenticación. Si persiste, la prueba real desde la app requiere resolver ese acceso o que el usuario recorra los pasos; las pruebas HTTP con dobles no la reemplazan.

## Resultados de ejecución de la tanda

- API: 365 pruebas aprobadas. Worker: 139 pruebas ejecutadas, 11 omitidas explícitamente. Frontend: 94 pruebas aprobadas. Paridad ES/EN: 3.076 claves verificadas. Recuentos comunicados por el coordinador después de integrar los cambios del checkout compartido.
- Se habilitaron los interruptores privados de IA/procesamiento de API y worker con respaldo local en `.local/tanda1-env-backup`. No se publican valores ni credenciales. El supervisor propio de Trato fue reiniciado por el coordinador con autorización del usuario; este agente no inició otra instancia.
- Supabase real: el primer dry run enumeró únicamente `20261104010000_case_assistant_sessions.sql`; se aplicó con `--linked --skip-vault`. El dry run posterior confirmó la base actualizada.
- La primera prueba SQL detectó privilegios DML heredados de los defaults de Supabase para `authenticated`; RLS bloqueaba la actualización por falta de política, pero faltaba restringir explícitamente los grants. Se añadió y aplicó separadamente `20261104010100_case_assistant_table_privileges.sql`, sin reescribir la migración ya aplicada.
- El test canónico `repos/trato-api/supabase/tests/case_assistant.sql`, con su include de fixture expandido en un archivo local ignorado, se ejecutó sobre Supabase real mediante la CLI existente. Salida 0 y rollback final. Verifica aislamiento entre usuarios y cliente eliminado; rechazo de mutación directa; idempotencia de sesiones/mensajes; una pregunta pendiente; resultado durable e inmutable; sesión de devolución sin revisión inicial y rechazo de resultado sobre revisión obsoleta. Todos los registros sintéticos fueron transaccionales y no se conservaron. No hubo llamadas a Gmail, PayPal, Gemini ni Weaviate en esa prueba SQL.
- Sigue pendiente el recorrido real de la app con Gemini/Weaviate y la aceptación del usuario. El usuario recibió instrucciones para la prueba manual por la limitación de Computer Use descrita arriba. No se marca la tanda cerrada por aprobar suites o migraciones.

## Comprobación final tras la actualización concurrente de main

El checkout compartido incorporó el PR #11 durante el lote (HEAD 4574ba4). Se conservaron esos cambios y se repitieron las comprobaciones afectadas:

- API: 365 pruebas aprobadas.
- Worker: 152 ejecutadas, 141 aprobadas y 11 omitidas por requisitos de entorno. Entorno de pruebas combinado con dependencias existentes de API/procesador mediante PYTHONPATH; no cambia el transporte de producción.
- Frontend: 94 pruebas aprobadas; sintaxis y 3076 claves ES/EN emparejadas comprobadas.
- Chromium: 5 pruebas aprobadas (2 del panel y 3 de guardado/recarga de devolución, con API doblada explícitamente). Las tres pruebas existentes se adaptaron a navegar a la etapa Propuesta antes de consultar el historial: guardar lleva a Revisar y enviar. Conservan las comprobaciones de importes y snapshot y ahora comprueban la entrada al asistente.
- Para ejecutar Chromium se descargaron su runtime y libasound2 en /tmp, sin instalación global ni cambios de dependencias del producto. Comando: LD_LIBRARY_PATH=/tmp/trato-browser-libs/usr/lib/x86_64-linux-gnu PLAYWRIGHT_BROWSERS_PATH=/tmp/trato-playwright node node_modules/@playwright/test/cli.js test --config=playwright.config.cjs tests/browser/case-assistant.spec.cjs tests/browser/refunds-connected.spec.cjs --grep 'connected proposal .* saves and reloads exact snapshot|case assistant retries|delayed session'. No se declara aprobada la suite completa de navegador.

La app quedó reiniciada en sus puertos oficiales tras autorización expresa, usando el supervisor --with-worker. El usuario indicó que probará el recorrido desde su sesión; aún no comunicó el resultado. No se acredita una conversación real Gemini/Weaviate ni aceptación final. La tanda 2 sigue pendiente. Cambios locales sin commit ni push de implementación por este chat.

## Ajuste de diseño — 4 de noviembre de 2026

Solicitud del usuario: simplificar la presentación para personas no técnicas, reutilizar el agente visual de Ensayos y abrir un panel lateral derecho con fondo atenuado. Se siguieron diseno-local-integracion.md, ux-documentos-y-envios.md e investigacion-ux-trato-2026-10-25.md.

La entrada se llama Agente de cambios o Agente de devoluciones. El diálogo nativo muestra mascota, mensajes breves, fuentes bajo demanda y compositor fijo; móvil a ancho completo. Cerrar con botón, Escape o fondo conserva conversación y borrador y devuelve foco al disparador. El documento se abre por encima del agente sin perder el diálogo de devolución inferior. Se reutilizan renderAIActivity, la mascota de Ensayos y sus helpers de teclado/scroll.

Solo presentación, textos y pruebas de interfaz: restore/send/poll y validadores se conservaron; sin cambios de API, worker, permisos, modelos ni persistencia por este ajuste. Verificado por comparación del bloque de ejecución con el snapshot anterior.

Validación: npm run check, 3086 claves ES/EN, 94 pruebas frontend y 10 Chromium aprobados (7 del agente y 3 regresiones de devolución). Chromium usa API doblada explícitamente; no acredita una conversación con proveedores reales. Capturas de escritorio/móvil en .local/browser-tests/case-agent-desktop.png y case-agent-mobile.png; inspección visual realizada. Cambios sin commit ni push.

## Unificación visual del agente del proyecto — 4 de noviembre de 2026

A solicitud del usuario, el Asistente del proyecto utiliza ahora el mismo panel lateral, mascota y estructura conversacional que los agentes de cambios/devoluciones. agent-panel.mjs concentra presentación y ciclo de vida del diálogo nativo: apertura, fondo, foco, cierre y scroll. La pestaña presenta una invitación breve y acceso directo a Documentos. Las citas y la preparación siguen disponibles bajo demanda; los textos evitan explicar herramientas internas.

Se siguieron diseno-local-integracion.md y ux-documentos-y-envios.md. No se modificaron API, worker, modelos ni persistencia (hashes de los archivos Python comparados antes/después); AIJobClient y rutas de consultas/preparación se conservaron. Nuevo recurso servido por allowlist explícita, con comprobación HTTP 200. Se reinició solo Trato sin trabajos activos para servir el módulo.

Verificación: 94 pruebas frontend; 7 Chromium del agente de cambios/devoluciones y 5 del agente del proyecto aprobadas; sintaxis y paridad de 3097 claves ES/EN. Incluyen escritorio/móvil, foco, borrador, petición incierta sin duplicados, citas, recarga, preparación explícita y aislamiento al cambiar proyecto/usuario. APIs dobladas explícitamente, sin inferencias ni preparación real de documentos durante estas pruebas. Capturas inspeccionadas en .local/browser-tests/project-agent-desktop.png y project-agent-mobile.png. Sin commit ni push.

## Preparación documental: rechazo de esquema y mensajes — 4 de noviembre de 2026

El error registrado FILE_PIPELINE_FAILED se producía en treatment, después de autorizar y extraer texto. Se confirmó mediante las llamadas de diagnóstico expresamente autorizadas: prueba sintética corta con respuesta no parseable; reproducción del análisis original con GoogleInvalidRequestError (rechazo HTTP 400 según el SDK instalado); verificación posterior sobre el mismo documento/modelo con el contrato corregido. Los intentos de arranque sin Redis no ejecutaron inferencia.

Tratamiento y resumen usan ahora referencias cortas en el esquema del proveedor y un catálogo de pasajes en los datos de entrada. El host resuelve cada referencia a su segmento/chunk y cita literal, rechaza referencias ajenas/campos adicionales y conserva los contratos externos de artefactos. No se cambió modelo, proveedor, transporte, políticas de pertinencia ni validación de citas. Referencia técnica: [documentación oficial de salida estructurada](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output), que describe rechazos 400 por complejidad de esquemas/enumeraciones. No se implementó una vía alternativa ante el error.

Verificación real del tratamiento corregido: JSON válido, tres referencias originales resueltas, decisión needs_clarification. Consumo registrado por el proveedor: 7346 tokens de entrada y 3067 de salida (10413 total). La comprobación fue diagnóstica: no guardó artefactos ni indexó documentos. Este resultado no acredita un resumen ni una indexación completados. Los fallos antiguos se conservan; una nueva preparación explícita usa el contrato corregido.

La interfaz distingue error de preparación, consulta de estados y resultado incierto. Evita repetir una misma causa conocida; los fallos independientes se muestran diferenciados. Un documento que requiere aclaración/revisión muestra el motivo real escapado y permanece pendiente; no se transforma en éxito. Los registros técnicos del modelo conservan código y motivos seguros (tipo, estado HTTP o fin de respuesta), sin prompts, documentos, credenciales ni mensajes completos del proveedor.

Pruebas: worker 161 ejecutadas, 150 aprobadas y 11 omitidas; 98 frontend aprobadas; sintaxis y 3108 claves ES/EN aprobadas. Seis pruebas específicas del contrato compacto cubren emparejamiento de citas, referencias falsas/campos adicionales, map/reduce y ausencia de reinferencia. Las tres pruebas Chromium de mensajes de preparación pasaron antes del cierre; el nuevo caso de aviso de aclaración queda añadido para futura ejecución (runtime temporal no disponible tras reanudar). Trato volvió a iniciarse en sus puertos propios y con el worker actualizado. Sin commit ni push de este arreglo.

## Avisos de preparación visibles por documento — 4 de noviembre de 2026

El usuario no veía actividad ni resultado al preparar. La información se colocaba al final de la lista y la sección de documentos tenía su propio scroll dentro del chat; al repintarse volvía al principio. Ahora cada archivo muestra el trabajo real en cola/en curso con ai-activity compacto, y su resultado, error o motivo de aclaración junto a la acción. Se mantiene la lista durante una actualización de estados. Solo el chat del panel desplaza; se conserva el foco del documento concreto y se revela su aviso al iniciar, sin desplazar la página ni saltar a otro archivo.

Los resultados locales se vinculan al ID de trabajo y generación original; se descartan al cambiar la fuente y nunca sustituyen la confirmación del backend para mostrar Listo. Los resultados de varios archivos se conservan durante la sesión del panel. Una preparación ya pendiente puede consultarse al volver a pulsar Preparar sin enviar otro POST. source_pending se presenta como Lectura pendiente, no como actividad de IA; FILE_REVIEW_REQUIRED sin motivo detallado se muestra como Requiere revisión.

Verificación: 99 pruebas frontend y 22 Chromium aprobadas, sintaxis y 3112 claves ES/EN. Los casos con 24 documentos comprueban que actividad y resultado queden en viewport para éxito, aclaración y fallo, que cerrar/reabrir conserve feedback y que se recupere un trabajo pendiente sin duplicarlo. Cambios de presentación y pruebas; sin nuevas inferencias ni preparación real de documentos durante estas comprobaciones. No se declara preparado un documento por corregir su interfaz. Sin commit ni push.

## Corrección del bloqueo semántico de referencias y contexto de devolución

La lectura autorizada del documento que terminó en aclaración confirmó `kind=reference`, sin filas vinculadas en refund_artifacts, refund_sources, refund_acceptances, refund_feedback ni opciones de preparación. Por tanto, ese intento concreto no se resolvía únicamente añadiendo un vínculo de devolución: su función documental era referencia del proyecto. Se amplió el criterio de supporting_reference para admitir correspondencia y propuestas de alcance, cierre o devolución como material del proyecto, sin convertirlas en acuerdos aceptados o pagos confirmados. El agente sigue decidiendo pertinencia con JSON y evidencia literal; no se fuerza una respuesta de éxito ni se reclasifica según el texto.

Para documentos realmente vinculados, la API resuelve propósito y contexto desde sus relaciones autorizadas con el expediente. Consulta el registro vigente project_received_payments (incluidos pagos iniciales), verifica pertenencia de todos los pagos del cierre y conserva snapshot cuando hay una relación única. Rechaza casos ambiguos, pagos sin verificación y opciones incompatibles. Los acuerdos iniciales y pedidos reutilizados como respaldo conservan su propósito original. El trayecto vectorial y el tenant projects_private permanecen sin cambios. No se modificaron documentos, aceptaciones, importes, opciones guardadas ni migraciones.

La huella del tratamiento incluye ahora los criterios efectivos, además del prompt, para conservar los artefactos anteriores y permitir un nuevo análisis sin colisionar con su clave. No se borraron resultados previos ni se lanzó una reinferencia automática.

Validación de código: API 381 pruebas aprobadas (incluidas 16 nuevas del contexto de devoluciones); worker 163 ejecutadas, 152 aprobadas y 11 omitidas. Las pruebas de modelo usan dobles explícitos; no acreditan la respuesta del proveedor real. Se comprobaron criterios enviados, citas resueltas y cambio de huella tras revisar criterios. diff --check sin incidencias. La primera ejecución del worker carecía de fastapi en su entorno de pruebas; se repitió con las dependencias ya existentes del procesador. Las suites con integración local se ejecutaron con permiso de sockets.

Se reinició únicamente el supervisor autorizado de Trato tras comprobar ausencia de preparaciones activas: web 5173, API 8100 y procesador 8101 responden HTTP 200; worker IA disponible en Redis propio 6380. No se encolaron preparaciones reales, no hubo nuevas llamadas al modelo ni escrituras vectoriales. Un PDF vinculado consultado aún carece de extracción; no se declara preparado. Pendiente: el usuario reintenta preparar el documento bloqueado desde la app y valida su resultado, después la consulta con citas. Tanda 1 continúa sin validación E2E. Sin commit, push ni PR.

## Bloqueo real en Retención por Trabajo: contrato y coordinación de indexación

Los dos intentos recientes del documento de retención fallaron en authorize: el contexto de devolución incluía snapshot_id, pero FileManifest del worker aún lo rechazaba como binding desconocido. Este desajuste fue introducido al conectar el contexto de devolución; las pruebas unitarias aisladas de API no detectaron el contrato completo. Se añadió el binding al contrato del worker, limitado a los propósitos de devolución y con refund_case_id obligatorio. La validación del expediente/snapshot por propietario y proyecto sigue en API. Un manifiesto inválido devuelve ahora FILE_MANIFEST_INVALID en lugar de un fallo genérico.

Se validó en memoria el manifiesto del intento real fallido con sus metadatos autorizados (sin modelo, guardado ni indexación): válido con payment_id, refund_case_id y snapshot_id. La nueva prueba de integración recorre contexto API → autorización HTTP → FileManifest worker → pipeline → finalización para una devolución con snapshot; comprueba también rechazo fuera de su expediente. Se mantienen las comprobaciones backend del vínculo real con su snapshot.

Otro intento llegó a index y terminó en TOOL_SERVICE_UNAVAILABLE. Su recibo real acabó ready con seis objetos y summary_fingerprint: la API siguió guardando después de que el worker agotara sus 30 segundos. Se asignó una espera de 480 segundos solo a index_file_chunks, coherente con las dos operaciones del procesador de hasta 180 segundos y menor que la recuperación del lease de 600 segundos. BackendToolClient admite ahora los overrides de timeout en el cliente HTTP, corrigiendo también los overrides existentes que se enviaban incorrectamente al método stream. Las herramientas normales conservan 30 segundos; conexión limitada a cinco. Un timeout sigue siendo fallo visible, sin reintento ni proveedor alternativo.

La UI presenta el estado documental Listo cuando el inventario backend lo confirma para la misma generación, aunque persista el trabajo anterior fallido por espera. No cambia su historial ni inventa éxito del trabajo. Mientras no haya confirmación backend, el error permanece visible. Regresión Chromium: error inicial → confirmación tardía → retirada de alerta, trabajo aún failed y exactamente un POST.

Verificación: worker 169 ejecutadas, 158 aprobadas y 11 omitidas; Chromium project-agent 16 aprobadas; sintaxis y paridad de 3112 claves ES/EN aprobadas. Cuatro pruebas del transporte validan límites por operación y conservación del fallo sin reintento. Modelos y APIs de pruebas usan dobles explícitos; las únicas consultas conectadas fueron lecturas de estados, recibos y metadatos. No hubo nuevas inferencias ni generación de embeddings para diagnosticar. Se reinició únicamente el supervisor autorizado de Trato tras verificar ausencia de trabajos IA activos. Pendiente: nueva preparación explícita del documento de retención y posterior consulta real; tanda 1 aún sin aprobación E2E. Sin commit, push ni PR.

## Consulta explícita de documentos preparados con expediente incompleto

El último intento del agente de expediente devolvió VECTOR_INDEX_INCOMPLETE. La lectura autorizada de estados del proyecto afectado confirmó diez archivos: cuatro con resumen e índice listos, cuatro sin extracción disponible y dos con error/revisión. La consulta sin selección incluía los diez y abortaba antes de recuperar pasajes en Weaviate. Este fallo concreto no demostraba corrupción del archivo ni falta de una conexión MCP. Se había indicado al usuario continuar sin haber resuelto este requisito de la búsqueda; esa indicación fue prematura.

Se incorpora elección explícita de fuentes mediante document_ids en la pregunta de proyecto o mensaje de expediente. La interfaz ofrece los documentos listos y muestra incluidos/excluidos; requiere una acción del usuario antes de enviar una pregunta limitada a esas fuentes. No reenvía automáticamente la pregunta fallida ni filtra silenciosamente documentos pendientes. La petición original sin selección conserva la validación completa.

La API autoriza y fija los IDs por propietario/proyecto en source_document_ids. Catálogo, lectura de resumen, búsqueda de resúmenes, búsqueda original y validación de citas respetan esa elección. El modelo no puede ampliarla; el worker verifica que el catálogo coincida exactamente con el alcance autorizado. Los documentos obligatorios excluidos se registran como contexto faltante y el prompt exige señalar evidencia insuficiente cuando la pregunta la requiera. Los registros del expediente y su revisión conservan sus controles. La recuperación utiliza el mismo procesador y tenant projects_private; no se añade un proveedor o transporte alternativo.

Ambas búsquedas informan los IDs elegidos y cobertura parcial; revalidan fuentes y resúmenes tras recuperar resultados. La elección se conserva en el resultado archivado y se revalida sin depender de Redis. Una misma clave de reintento no puede cambiar sus fuentes: una nueva elección para una consulta fallida confirmada requiere un nuevo trabajo; las peticiones inciertas conservan su payload y clave.

Verificación de código de esta corrección: API 399 pruebas aprobadas. Worker 173 ejecutadas (162 aprobadas, 11 omitidas), más una prueba nueva de integración HTTP API → worker → gateway vectorial aprobada. Esta prueba usa un proyecto mixto, busca primero resúmenes y después texto, valida una cita original del documento elegido y conserva pendiente el archivo excluido; la consulta sin elección sigue fallando. Todos los modelos y almacenamientos de estas pruebas son dobles explícitos. Las únicas lecturas conectadas fueron estados de trabajos e inventario; no hubo nuevas inferencias ni embeddings diagnósticos. La respuesta real con las fuentes elegidas continúa pendiente de validación del usuario. Sin commit, push ni PR.

Cierre de comprobaciones de esta corrección: 26 pruebas Chromium aprobadas entre agente del proyecto y agente contextual, incluidas selección explícita sin POST de inferencia, reintento con nueva clave al cambiar el alcance tras fallo confirmado, conservación de clave/payload incierto y alcance de respuestas históricas tras recargar. Sintaxis, comprobaciones unitarias de interfaz y paridad de 3121 claves ES/EN aprobadas. La elección de fuentes y los nombres incluidos/excluidos se presentan en el panel compartido; un indicador corto queda en cada respuesta limitada. Se reinició únicamente Trato después de confirmar ausencia de trabajos activos, para cargar API/worker/interfaz. El usuario deberá elegir las cuatro fuentes listas y enviar su pregunta: no se ejecutó esa inferencia en su nombre. Tanda 1 sigue pendiente de la respuesta conectada y su comprobación contra los originales.

## Causas de los seis pendientes y recuperación del original

La revisión conectada por propietario/proyecto confirmó que cuatro documentos (PDF de devolución, dos aceptaciones y una adenda) tenían extracción queued pero worker_thread_id nulo y ningún resultado de preparación. No habían iniciado su lectura; no constituían cuatro fallos de Weaviate. El PDF de devolución se generaba y vinculaba sin queue_document en su ruta HTTP actual: omisión general que podía repetirse en otros proyectos. Las aceptaciones/adendas históricas conservaban el mismo estado sin hilo; las rutas actuales de aceptación sí encolan, por lo que no se atribuye su estado histórico a una causa no probada.

Los otros dos archivos tienen extracción y worker de lectura listos. El pedido “Añadir un nuevo modulo de pago” terminó needs_clarification: el contenido identifica un acuerdo y no un pedido adicional. Permanece para revisión de su clasificación; no se cambió el pedido ni su original. El acuerdo Sandbox terminó rejected porque el modelo juzgó su validez real: se corrigió el criterio del agente para evaluar términos y rol documental, manteniendo su condición ficticia y sin acreditar contrato, aceptación ni pago. El criterio cambia su huella de tratamiento; no se borra ni sobreescribe el rechazo previo. No se ha ejecutado una inferencia real que confirme el nuevo resultado.

La ruta de PDF de devolución ahora solicita lectura después de vincular el original, tanto para creación como para repetición del mismo artefacto. Conserva opciones previas y guarda idioma solo si faltaba. El inventario informa lectura no solicitada, encolada o fallida con metadata sin texto adicional; ya no equipara todo a una espera opaca. El endpoint de reintento tolera extracción ausente y comunica un error explícito si figura ready sin segmentos, sin simular éxito ni aplicar OCR/otro transporte.

Verificación backend: 411 pruebas API aprobadas; worker 175 ejecutadas, 164 aprobadas y 11 omitidas. Se probaron PDF nuevo/existente, fallo de cola y repetición sin regeneración, estados de lectura y reintentos. El nuevo caso del criterio Sandbox usa doble explícito, cita original conservada y ninguna afirmación de autenticidad. Las únicas operaciones conectadas fueron lecturas de metadata y motivos ya guardados; no se modificaron originales, aceptaciones, revisiones o pagos y no se encolaron recuperaciones reales desde consola. El flujo existente after_extraction inicia preparación IA al terminar la lectura; se mantiene esa lógica y el reintento se solicita desde la app, sin añadir otra llamada /process automática en la interfaz.

La recuperación en interfaz usa el endpoint de reintento sobre el mismo ID de documento; no sube archivos ni añade un POST /process. Bloquea duplicados cuando existe un hilo de lectura conocido y conserva el seguimiento tras cerrar, recargar o iniciar otra conversación. Mantiene la espera hasta que el backend confirme disponibilidad o revisión/error; después de la lectura presenta confirmación pendiente sin simular una ejecución del modelo. La mascota solo acompaña una actividad confirmada. Un archivo sin texto extraído permanece en revisión, sin botón que prometa una recuperación inexistente. La prueba Chromium completa de ambos agentes aprobó 31 casos y las comprobaciones unitarias de lectura 10; paridad ES/EN de 3132 claves aprobada. No se relanzaron trabajos reales ni se marcaron documentos como listos por corregir su interfaz.

Las dos comprobaciones Chromium específicas finales (hilo ya existente y conservación del seguimiento entre conversaciones) también pasaron. Se reinició solo Trato tras verificar ausencia de trabajos activos para cargar los cambios generales. Los cuatro históricos siguen requiriendo una acción explícita Preparar documento y el acuerdo Sandbox una nueva preparación; el pedido que contiene un acuerdo permanece pendiente de aclarar su clasificación. No se declara completada ninguna de esas cinco recuperaciones ni se aprueba la tanda 1 por el resultado de las pruebas técnicas. Sin commit, push ni PR.
