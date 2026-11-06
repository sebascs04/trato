# Auditoría de entradas y procesamiento de archivos

29/10/2026. Revisión estática del código local. No se modifican handlers, permisos ni rutas como parte de esta auditoría. «Conectado» describe una ruta implementada; no implica una prueba real de cada recorrido en esta revisión.

## Conclusión

Ya existe una base genérica: los documentos del proyecto viajan en un evento `thread`, con `workflow=ingest_document`, contexto de propietario/cliente/proyecto y `payload.kind`. Sin embargo, no todas las entradas utilizan esa ruta ni existe todavía el procesamiento común completo con resumen y Weaviate.

El endpoint de documentos recibe `kind` desde el cliente HTTP, lo valida contra una lista permitida y autoriza el proyecto. No deduce ese tipo exclusivamente del apartado del backend. Luego, el backend/SQL construye el evento desde el documento persistido: el workflow y los IDs de contexto no los decide el modelo.

## Inventario de entradas

| Entrada funcional | Marca/contrato actual | Procesamiento actual |
| --- | --- | --- |
| Acuerdo inicial, incluido el modal de preparación | `kind=initial_agreement` | Endpoint común de documentos → original privado → thread/outbox → worker/FP → extracción. |
| Pedido nuevo de un cliente | `kind=email_request` | Mismo endpoint y worker. La base aplica la regla de un pedido abierto por proyecto. |
| Respuesta del cliente pidiendo ajustes a una adenda | `kind=reference`, luego `feedback_document_id` al crear revisión | Intenta subir por el endpoint común. Hay una incompatibilidad de respuesta descrita abajo. No tiene un purpose independiente de otras referencias. |
| Documentación de referencia genérica | `kind=reference`, valor predeterminado del API | Permitida por el endpoint, aunque no aparece como una acción general separada en la pantalla principal actual. |
| PDF devuelto como respaldo de aceptación de una adenda | `kind=addendum`, endpoint `returned-pdf` ligado a propuesta/revisión | El backend exige la revisión vigente y envío previo. Reserva y guarda el original; esta ruta no encola extracción. La aceptación es otra operación de revisión explícita. |
| Adenda PDF generada por Trato | `kind=addendum`, artefacto ligado a revisión | Es una salida generada, no una subida genérica. Guarda el PDF y su hash, vinculado a los términos estructurados. No reextrae el texto. |
| Evidencia de entrega | `kind=delivery` | Categoría admitida por el API y por el payload del worker; no se encontró una acción dedicada de subida en la interfaz oficial revisada. |
| Archivos de respaldo de Reputación | Bucket/tabla de adjuntos propios, ligados a experiencia y proyecto privado | Ruta independiente con reserva, hash, límites, publicación consentida y acceso. No crea el thread de ingesta del proyecto ni extrae, resume o indexa esos PDF. |
| Guías de formación de Ensayos | Biblioteca administrada con IDs/hash y `workflow=rehearsal_feedback` en las tools | Textos incorporados a archivos de biblioteca. El worker solicita su lectura autorizada al backend/FP. No es una subida de usuario por el endpoint de documentos ni un índice Weaviate. |
| Devoluciones | `workflow=manage_refund`, `mode=simulation` en el recorrido revisado | Recorrido de simulación con fuentes de ejemplo y ajustes. No se encontró una entrada de archivos real de devoluciones en las rutas API revisadas. No confundir el ensayo de una devolución con una devolución real. |

El plan de inicio reutiliza `initial_agreement` para sus archivos: no introduce otro tipo de documento. Las conversaciones de Ensayos se envían como mensajes JSON y su evaluación usa una cola específica; no son archivos ni el contrato común de ingesta `thread`. Gmail y PayPal manejan envíos/estados mediante sus servicios, no una ingesta general de correos o archivos entrantes.

## Hallazgos

### 1. Incompatibilidad concreta al incorporar feedback para una revisión

`proposal-workspace.mjs` sube el PDF de ajustes mediante `/projects/{id}/documents` y después lee `upload.document.id`. El endpoint devuelve como data el resultado de la cola (`thread_id`, `status`), no `document`. Por tanto, con ese contrato la subida puede quedar guardada y la creación de la revisión fallar al intentar obtener su ID.

Referencias: `proposal-workspace.mjs:203`, `proposal-workspace.mjs:204`, `business_routes.py:151`, `business_routes.py:153`. El modal nuevo de preparación no tiene ese problema: tras subir, vuelve a consultar los documentos del proyecto. No se aplica una corrección aquí para no cruzar el recorrido contractual del compañero.

### 2. El tipo ya existe, pero no activa actualmente validaciones semánticas reales

El worker conectado acepta `kind` pero su rama de ingesta solo ejecuta `extract_text` y devuelve `relevance_status=not_evaluated`. No comprueba todavía si el contenido es realmente un acuerdo, un pedido o información ajena al proyecto.

La validación de pertinencia y `chunk_segments` que aparecen en `ingestion.py` pertenecen al modo de simulación. No confundirlos con el worker conectado, que conserva segmentos extraídos por página.

### 3. Entradas separadas y tipos reutilizados

`reference` mezcla referencia general y feedback de revisión. `addendum` mezcla PDF generado, documento subido genéricamente y PDF devuelto por el cliente; el vínculo y las validaciones de la ruta especializada aportan la distinción de negocio. Etiquetar un PDF `addendum` no lo convierte por sí solo en una adenda aceptada ni confirma un pago.

`ready` en un adjunto de Reputación significa disponibilidad de la subida, no texto extraído, resumen revisado o vectores listos. El flujo común necesita estados separados por etapa para no equiparar esos resultados.

El campo `scope` de una experiencia de Reputación es una puntuación de respeto del alcance, no un ámbito de permisos. No reutilizar ese nombre/valor como autorización del nuevo procesador.

### 4. El pipeline completo propuesto sigue pendiente

No se encontró una conexión Weaviate configurada ni un indexador de reseñas/respaldos. La extracción real no genera todavía un resumen documental. Los segmentos guardados no demuestran embeddings ni búsqueda híbrida implementados.

El inventario completo, los resúmenes con procedencia y los estados de disponibilidad tendrán que acompañar a la búsqueda: un documento ausente del top-k no es una prueba de ausencia de una cláusula o antecedente.

### 5. Formatos y reparto actuales

El procesador reutilizable conoce PDF y DOCX. El endpoint conectado de documentos acepta PDF y responde `PDF_CONVERSION_REQUIRED` a Word; esta auditoría no encontró una conversión automática activada por esa ruta.

La ingesta conectada actual llama del worker directamente al FP después de obtener el original del backend. Las tools nuevas de la biblioteca sí usan worker → backend → FP → backend → worker. Unificar ese reparto requiere una migración explícita; no queda hecho por añadir un flag.

## Propuesta de normalización, todavía no aplicada

Conservar el evento `thread` y un workflow común de procesamiento de archivos. Usar un `purpose` validado por el backend que pueda distinguir `initial_agreement`, `change_request`, `revision_feedback`, `accepted_addendum`, `delivery_evidence`, `reputation_evidence` y `training_material`. Para devoluciones se definiría `refund_request` o `refund_evidence` al conectar su entrada real. Son nombres propuestos, no enums habilitados hoy ni un cambio de los contratos existentes.

El purpose selecciona un handler o política registrada. No es un booleano que desactive permisos ni una instrucción del documento. Los contextos privados de proyecto, comunidad publicada y biblioteca administrada conservan reglas de acceso diferentes.

Compartir almacenamiento, validación técnica, extracción reutilizable, resumen con referencias, chunking e indexación según la política explícita del workflow. Un PDF generado desde términos canónicos puede reutilizar esos datos; un respaldo de aceptación no debe perder su validez de archivo por carecer de texto seleccionable. Los pasos exigidos y los fallos se declaran, sin cambiar de ruta como respaldo automático.

El resumen no reemplaza el original y su caché necesita hash, parser, selección autorizada de apartados, prompt/modelo e idioma. Se mantienen localizadores, referencias y verificación contra la fuente vigente. Antes de compartir o recuperar evidencia de Reputación se revalida publicación y consentimiento; compartir una ficha no publica proyectos privados.

P1 coincidió en el pipeline común con handlers por propósito y señaló preservar la lectura completa obligatoria de las cinco guías de Ensayos hasta que se autorice cambiar esa política.

## Referencias de código revisadas

- `repos/trato-api/trato_api/business_routes.py:129`: entrada común y validación de kind.
- `repos/trato-api/supabase/migrations/20261026204903_async_document_threads.sql:54`: construcción del evento desde los datos persistidos.
- `repos/trato-worker/trato_worker/connected.py:165`: extracción conectada y resultado sin evaluación semántica.
- `repos/trato-worker/trato_worker/ingestion.py:83`: pertinencia simulada.
- `proposal-workspace.mjs:203`: feedback de revisión y contrato esperado.
- `repos/trato-api/trato_api/proposals/routes.py:99`: PDF devuelto.
- `repos/trato-api/trato_api/proposals/pdf.py:90`: PDF generado y vínculo contractual.
- `repos/trato-api/trato_api/reputation_evidence.py:23`: subida independiente de respaldos.
- `repos/trato-api/trato_api/agent_tools.py:130`: tools limitadas a la biblioteca administrada.
- `simulation-threads.mjs:39`: devolución en modo explícito de simulación.
