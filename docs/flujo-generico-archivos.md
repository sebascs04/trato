# Flujo común de archivos: núcleo implementado y contrato de integración

29/10/2026. Acuerdo de diseño en revisión con Sebastian. La base del worker y el chunker están implementados como módulos; esto no activa la ingesta conectada, Weaviate ni el agente de planificación. Conserva los contratos actuales hasta su migración explícita.

## Propósitos

| Entrada | Purpose propuesto |
| --- | --- |
| Acuerdo inicial | initial_agreement |
| Pedido nuevo | change_request |
| Ajustes solicitados a una adenda | addendum_adjustments, en lugar de revision_feedback |
| PDF devuelto como aceptación | acceptance_evidence |
| Adenda generada | generated_addendum |
| Respaldo de Reputación | reputation_evidence |
| Solicitud de devolución | refund_request |
| Respaldo de devolución | refund_evidence |
| Material de formación | training_material |

Referencia adicional y evidencia de entrega no tienen una acción dedicada en la interfaz oficial actual. El API admite reference/delivery y el antiguo panel técnico ofrece ambas opciones; reference se usa también internamente para ajustes de una adenda. Propuesta: no habilitar supporting_reference ni delivery_evidence como entradas activas del nuevo flujo hasta que se defina su uso concreto. Esto no elimina registros existentes ni cambia su kind.

## Procesamiento reutilizable y ramas

El backend asigna/valida purpose y contexto autorizado. Se conserva la llamada genérica thread; un handler registrado por propósito ejecuta las particularidades y vuelve a los pasos comunes. El contenido del archivo no puede seleccionar permisos, herramientas ni rutas arbitrarias.

Base común: original privado y metadatos → texto/segmentos canónicos → tratamiento particular cuando corresponda → chunks deterministas → resumen con referencias → embeddings e índice. Los estados de extracción, resumen e indexación son independientes. La configuración explícita de cada propósito define los pasos exigidos; no se fuerza reextraer un PDF generado desde términos canónicos ni se considera una aceptación real por haber leído un archivo.

## Resumen documental y recuperación

Cada documento tendrá un resumen breve, generado desde su texto autorizado, con referencias a los segmentos y páginas existentes. Se calcula una vez por fingerprint técnico y se conserva como derivado; no reemplaza el original ni demuestra que se hayan verificado las afirmaciones de su autor.

Un chunk podrá devolver juntos su texto, resumen del documento y metadatos. La representación vectorial y la búsqueda léxica del chunk se configuran sobre el fragmento correspondiente, sin incluir repetidamente el mismo resumen completo en todos los embeddings/BM25. El resumen funciona como contexto documental; su procedencia se vincula por document_id y hash/fingerprint.

Antes de buscar por similitud, una herramienta ofrece el inventario completo de documentos autorizados con sus resúmenes y estados, paginado sin perder entradas. Así el agente conoce los archivos que existen aunque no aparezcan en un top-k. Si el inventario/resúmenes exceden el contexto permitido, se comunica cobertura insuficiente; no se trunca silenciosamente ni se afirma lectura completa.

Recorrido del agente: consultar inventario/resúmenes del ámbito → formular preguntas específicas → recuperar chunks con los mismos filtros → consultar segmentos completos cuando la evidencia lo requiera → validar citas contra la fuente vigente → proponer al usuario. El resumen orienta las preguntas; no garantiza por sí mismo recuperar todas las cláusulas o hechos relevantes.

## Contexto y privacidad

- Fuentes privadas: propietario, cliente privado, proyecto y versión autorizados por el backend.
- Reputación publicada: ficha comunitaria canónica del cliente, experiencia, adjunto y versión/publicación vigente. No exponer IDs de proyectos privados ni IDs internos de autores al modelo o a otros freelancers por compartir una ficha.
- Biblioteca de formación: catálogo administrado, con permisos de herramientas propios. Las cinco guías de Ensayos siguen siendo lectura completa obligatoria hasta autorizar un cambio específico.

Resumen e índice respetan el mismo ámbito que el original. Retirar una experiencia revoca también sus resúmenes/chunks compartidos; antes de devolverlos se comprueba vigencia en la fuente de verdad, incluso si la eliminación física del índice sigue pendiente.

Supabase/Storage conserva los originales y resultados canónicos; Weaviate es una proyección reconstruible. No se acepta que ausencia en un resultado vectorial signifique ausencia de documento, cláusula o antecedente.


## Estado de implementación y verificación

Actualizado el 1 noviembre 2026: el consumidor `process_file` usa `BackendFileClient` y las rutas `/internal/file-processing/*` conectadas al trabajo activo y su lease. El backend resuelve proposito, contexto, fuente y generacion; el procesador sirve el texto preparado, fragmenta e indexa. Extraccion, tratamiento, chunks, resumen y outcome quedan como artefactos privados inmutables de Supabase. El resumen no sustituye el texto original ni se vectoriza como relleno.

La migracion aplicada es `20261101212324_file_processing_and_public_vector_sources.sql`. Activacion explicita API/worker mediante `TRATO_FILE_PROCESSING_ENABLED`; ejemplos false hasta preparar el entorno. No se cambia a otro modo si falla. Fuentes seleccionadas al subir acuerdo/pedido/referencia/entrega y PDFs de adenda/devolucion del cliente ya tienen entradas; no confundir PDF devuelto de aceptacion con devolucion monetaria. Los casos monetarios de Flores necesitan su productor y vinculo real de expediente; los adjuntos de reputacion quedan privados y fuera del indice publico.

Contrato verificado con grafo real, rutas HTTP en proceso y dobles de modelo/DB/vector: fuentes/citas, aislamiento, cambio de contexto, resultados obsoletos y material ajeno. No se han ejecutado documentos de usuario ni inferencia real en esta comprobacion. Ver `busqueda-vectorial-conectada.md` y `configuracion-vectorial-colaboradores.md` para alcance y configuracion actuales.

## Tratamiento por apartado

`file_pipeline/treatment.py` implementa un agente reusable con handlers registrados por propósito. `runtime.build_file_pipeline()` arma el grafo con un modelo JSON inyectado explícitamente; no elige proveedor por defecto ni arranca consumidores.

- Acuerdo inicial: identificar lo originalmente acordado; faltar precio o fecha no invalida por sí solo un acuerdo claro.
- Pedido nuevo: extraer lo solicitado. No afirmar que algo está fuera de alcance si falta la base autorizada para comparar.
- Ajustes a adenda: identificar los cambios solicitados, sin emitir otra versión automáticamente.
- Aceptación devuelta: identificar la respuesta; la lectura no confirma identidad, firma o conformidad legal.
- Adenda generada: identificar los términos recibidos; no inferir envío, aceptación o pago. La generación desde términos canónicos deberá tener una entrada autorizada que evite reextraer innecesariamente el PDF.
- Reputación: tratar los hechos como afirmaciones de su autor, con citas del respaldo; no etiquetar fraude ni predecir pagos.
- Devolución y respaldo: identificar solicitud/evidencia sin autorizar movimientos de dinero.
- Formación: identificar material de aprendizaje y mantenerlo separado de hechos de proyectos/clientes reales.

El modelo devuelve categoría, pertinencia, motivo, observaciones, preguntas y citas. El host valida citas/estructura y deriva `continue`, `needs_clarification` o `rejected`. Un resultado válido de tratamiento se conserva como artefacto canónico, incluso si rechaza o pausa el documento. El mensaje de cola solo incluye su resultado breve y recibos; los textos completos quedan detrás del backend autorizado.

Se envía todo el texto al tratamiento bajo un presupuesto explícito de entrada. Si no cabe, falla con `TREATMENT_CONTEXT_LIMIT` antes de llamar al modelo: no corta páginas ni lo convierte en un rechazo semántico. El resumen sí tiene map/reduce con cobertura completa de chunks y presupuesto máximo de llamadas. Una ampliación del tratamiento para documentos mayores requerirá una política explícita de cobertura, no resumen/truncación silenciosa.

Los esquemas de citas enumeran pasajes literales de la fuente y IDs existentes; el host vuelve a comprobarlos. Verificación con Qwen local propio de Trato (`qwen3:4b`, mismo perfil GPU/contexto de Ensayos, sin modificarlo): un primer ensayo detectó una cita no literal y falló visiblemente. Tras restringir el esquema a pasajes exactos, el acuerdo inicial continuó y una receta ajena fue rechazada. Estos dos casos prueban inferencia real de pertinencia, no calibración general ni una ingesta conectada a Weaviate.

## Espacio vectorial y límites

Perfil único en `file_pipeline/embeddings.py`:

- Proveedor previsto: Weaviate Embeddings, disponible en el clúster Free propio.
- Modelo: `Snowflake/snowflake-arctic-embed-l-v2.0`, multilingüe, 1024 dimensiones, distancia coseno.
- Entrada vectorial/léxica del chunk: solamente `chunk_text`. Resumen, nombres y permisos son metadatos, no texto repetido dentro de cada embedding.
- El catálogo documental conserva los resúmenes y estados independientemente del top-k. La proyección describe un registro documental y sus chunks; el indexador definitivo debe resolver el registro documental sin inventar un vector de relleno ni vectorizar todos sus metadatos.
- Misma configuración/modelo/dimensiones y versión de entrada para documentos y consultas. Comparar el perfil de la colección contra el esperado; cualquier diferencia impide consultar o escribir. Cambiar de modelo exige reindexación explícita.
- Máximo conservador de 4096 bytes UTF-8 por texto de embedding. La documentación indica truncación del lado del proveedor al exceder su ventana; Trato la evita rechazando entradas mayores antes del envío.
- Chunk común: 800 caracteres Unicode, solapamiento de 100, máximo 512 chunks. Los offsets apuntan al texto original y se exige cobertura completa del material.

`trato_api/file_index_policy.py` prepara la política de capacidad: máximo 100.000 objetos con reserva de seguridad de 1.000; cuenta un resumen y cada chunk, además de reservas en curso; lotes de hasta 200 chunks. El backend deberá aplicar esta política sobre un contador/reservas bajo bloqueo, no confiar en conteos enviados por el worker ni descontar generaciones antiguas cuya eliminación no confirmó. Esta política aún no está montada en un indexador conectado.

Una cuota diaria agotada es `VECTOR_QUOTA_EXCEEDED`; autenticación y disponibilidad tienen errores separados. No se reemplaza proveedor ni se reintenta automáticamente. Los artefactos anteriores permanecen y la fase de índice conserva error; un lote incompleto no acredita éxito. La cuota exacta de solicitudes depende también de las consultas y otros procesos del clúster, así que no se promete ausencia total de errores de cuota.

Fuentes oficiales verificadas 29/10/2026:

- https://docs.weaviate.io/cloud/embeddings/models
- https://docs.weaviate.io/cloud/embeddings
- https://docs.weaviate.io/cloud/manage-clusters/create
