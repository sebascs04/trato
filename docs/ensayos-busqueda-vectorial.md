# Ensayos: investigación de referencias y evaluación

Decisión del responsable del proyecto, 3 de noviembre de 2026: sustituir la lectura completa obligatoria en el contexto del modelo por recuperación de evidencia con Weaviate. Biblioteca autorizada y versionada por el backend; sin MCP ni credenciales vectoriales en el worker.

## Dos nodos de LangGraph

1. `research_reference_evidence`: el mismo modelo fijado en el trabajo recibe conversación completa, acuerdo/solicitud, idioma, catálogo de documentos y herramientas. Identifica aspectos relevantes (alcance, precio, plazos, comunicación, opciones o compromisos), formula consultas focalizadas y pide contexto cuando lo necesita. Finaliza con JSON de aspectos y turnos cubiertos; debe haber realizado una búsqueda real mediante la herramienta. No se fuerzan autores distintos ni aspectos ajenos al caso.
2. `evaluate_conversation`: recibe conversación, notas de investigación y exclusivamente pasajes originales recuperados/verificados. Genera JSON de feedback por respuesta, identifica evidencia de la conversación y selecciona referencias literales. No hay un presupuesto artificial de palabras citadas o de cantidad de citas por hallazgo.

Ambos nodos usan el proveedor/modelo fijado en el trabajo. El protocolo de herramientas reutiliza run_tool_agent. Sus cotas de contexto y operaciones son controles técnicos de ejecución; no recortan resultados ni activan otro proveedor.

## Herramientas

- `search_reference_passages`: busca por significado y palabras clave en la biblioteca autorizada, con fusión híbrida 70/30 y contexto vecino. `description` y `when_to_use` están en inglés y son genéricos.
- `read_reference_context`: obtiene el pasaje original y segmentos cercanos de un documento autorizado. Mantiene autor, título, enlace y página/sección.

Circuito: worker → API → file processor → Weaviate → API → worker. La API determina scope/versiones/archivos y conteos esperados; el modelo no elige tenant. Comprueba cada fragmento devuelto contra los offsets y texto del documento canónico antes de entregar el contexto. El worker comprueba hashes, metadatos y referencias del resultado. Se rechazan fuentes desconocidas, cambios de ámbito e índices parciales. Si no hay evidencia relevante, el modelo debe declarar evidencia insuficiente; un fallo técnico no se transforma en ausencia de evidencia ni en una lectura completa alternativa.

## Tenant e índice

Colección compartida TratoSourceChunks. Tenant fijo references_shared, separado de projects_private y reputation_public. Usa la misma identidad Snowflake de embeddings configurada; Weaviate SDK y clave permanecen en el file processor. No se inventan owner/client/project para la biblioteca compartida ni se mezclan sus permisos con documentos privados. Devoluciones privadas siguen en projects_private.

Solo se indexan las selecciones aprobadas del manifiesto, conservando exclusiones documentadas de Seven Elements. Los originales permanecen como fuente de validación. No se descargan ni incorporan otros materiales automáticamente.

Acciones administrativas explícitas:

```bash
cd repos/trato-file-processor
.venv/bin/python -m file_processor.reference_vectors --provision
cd ../..
repos/trato-file-processor/.venv/bin/python scripts/index-rehearsal-references.py --index
```

El primer comando verifica la colección existente y crea únicamente el tenant de referencias. El segundo valida la biblioteca por el lector del procesador, indexa y guarda en Redis el recibo completo por scope. El backend envía expected_chunks derivados de ese recibo, nunca del modelo; el procesador verifica conteos antes y después de consultar. Una versión nueva del manifiesto necesita su propio índice/recibo. Un error no activa backfill, otro tenant ni búsqueda alternativa. No hay nuevas variables de entorno: se reutilizan manifiesto, credenciales API↔FP, Redis y configuración vectorial existente. Redis debe conservar este recibo junto con el resto de datos persistentes.

## Rutas y entrega a colaboradores

API interna, solo worker: GET /internal/reference-tools/catalog y POST /internal/reference-tools/execute. FP interno, token del procesador: POST /v1/references/index y /v1/references/search. El agente no dispone de la operación index.

Reiniciar exclusivamente API, FP y consumidor de Ensayos de Trato tras comprobar ausencia de trabajos activos. Nunca tocar otros proyectos locales. La primera carga de la biblioteca genera sus embeddings con el proveedor existente; no ejecuta Gemini. Las pruebas con dobles comprueban contratos, autorización, alcance, contexto y citas; el responsable del proyecto verifica la calidad del flujo desde la interfaz. Un índice preparado no equivale a una evaluación real terminada.

Trazas del worker: evaluation_started (retrieval_mode=hybrid_weaviate), research_completed (conteos de consultas/herramientas/aspectos), guides_loaded (solo fuentes recuperadas), references_selected, citations_resolved y evaluation_validated/evaluation_failed. No se imprimen consultas derivadas de conversaciones, mensajes ni credenciales. Las evaluaciones anteriores permanecen intactas.

## Estado local comprobado, 3 de noviembre de 2026

references_shared fue creado explícitamente en la colección existente. La biblioteca aprobada quedó indexada: 5 fuentes, 140 chunks, misma identidad de embeddings; el recibo fue guardado en Redis solo después del resultado completo. Se verificaron por HTTP autenticado el catálogo de herramientas, una búsqueda real que recuperó 6 segmentos de 2 documentos y la lectura de contexto original (3 segmentos). Esta comprobación no ejecutó un ensayo ni hizo llamadas a Gemini.

Servicios API/FP y consumidor de Ensayos recargados únicamente en Trato, con verificación previa de ausencia de trabajos activos. La web local conserva su puerto5173. Verificaciones: API260 pruebas correctas, FP36 correctas, worker146 con11omisiones (entorno conjunto para pruebas de integración), UI14 pruebas de contratos correctas y npmcheck ES/EN2711pares. No se realizaron pruebas desde la interfaz ni publicación, PR, merge o despliegue. La calidad del nuevo recorrido con el modelo corresponde a la siguiente prueba del responsable del proyecto.

Para colaboradores: el tenant e índice están en el cluster compartido, pero el recibo del catálogo está en el Redis de cada instalación. Conservarlo al migrar/restaurar ese Redis. Una instalación sin recibo falla visiblemente y debe completar el procedimiento administrativo; no genera índices durante una pregunta del usuario. No copiar credenciales de otra instalación ni interpretar la indexación como un análisis de usuario ya completado.

## Presentación de fuentes, ajuste posterior del 3 de noviembre

el responsable del proyecto pidió ocultar los extractos literales en la interfaz. Se mantiene la explicación «En qué se basa esta recomendación» con un enlace discreto por documento, sin tarjetas de citas, autor repetido ni localizadores de cada extracto. Las citas originales siguen en el JSON del resultado y se verifican contra los pasajes recuperados. No cambia la investigación, no se elimina evidencia del resultado guardado y no hace falta ejecutar otra evaluación para aplicar este cambio visual.

Control temporal: retirado por completo tras la prueba del responsable del proyecto del 3 de noviembre. Se eliminaron botón, handler, flag temporal de la vista, estilos y traducciones. La conversación y su análisis guardados se conservan.
