# Memoria del asistente por proyecto

Implementación local, 4 de noviembre de 2026. La comprobación técnica no sustituye la prueba manual con Gemini y documentos reales.

## Recorrido

1. La web consulta `GET /api/v1/projects/{project_id}/assistant/conversation`. Recupera los últimos 50 intercambios desde Supabase y permite cargar páginas anteriores. No necesita IDs del navegador ni conservar Redis para leer respuestas terminadas.
2. Al preguntar, la API valida usuario, cliente y proyecto. Obtiene el resumen, su posición de corte y todos los intercambios posteriores desde el backend de memoria. El cliente HTTP no puede elegir el resumen, los mensajes de contexto ni otro propietario.
3. Se encola el `thread` genérico con workflow `project_assistant`, un ID idempotente y ese snapshot. Redis sigue siendo el transporte y el registro temporal de ejecución.
4. El worker ejecuta LangGraph: `compact_conversation → consult_project → save_conversation`. El modelo y sus herramientas siguen usando el proveedor Gemini configurado, sin alternativas automáticas.
5. El primer nodo compacta cuando resumen y mensajes superan 32.000 bytes UTF-8 serializados. Es una cota conservadora del tamaño en tokens, no un recuento exacto del tokenizer ni un temporizador. No requiere otra API de conteo. Conserva hasta seis intercambios recientes exactos, resume los anteriores e incorpora el resumen anterior. Si todavía hay menos de tres intercambios, no compacta. El prompt mantiene decisiones, correcciones, cifras, referencias y asuntos abiertos, diferenciando sugerencias de hechos.
6. El agente recibe resumen, mensajes recientes, catálogo de documentos y herramientas. Además de las tres herramientas documentales existe `search_conversation_history`: consulta mensajes originales de este mismo proyecto, hasta la revisión del snapshot, por texto, con hasta ocho coincidencias. Esta búsqueda usa Supabase; no amplía el tenant de Weaviate.
7. Se validan el JSON y las citas documentales. Una respuesta exclusivamente sobre la conversación usa `answer_basis=conversation`; una afirmación documental usa `documents` y necesita evidencia literal de las herramientas. Un resumen de conversación no acredita un pago ni una aceptación.
8. Antes de comunicar éxito, la API valida y guarda respuesta, pregunta y resumen en una sola transacción. La revisión del proyecto debe coincidir con el snapshot; un conflicto simultáneo produce `AI_MEMORY_CONFLICT`, conservando lo anterior. Repetir el mismo trabajo no duplica el intercambio.

## Persistencia

- `project_assistant_turns`: preguntas y respuestas terminadas, con posición y fecha del servidor. Nunca se borran originales al compactar.
- `project_assistant_memory`: resumen, revisión y `summarized_through`, la posición hasta la que resume. La siguiente pregunta usa solo mensajes posteriores al corte.
- `project_assistant_checkpoints`: checkpoints reales de LangGraph y sus escrituras pendientes. `BackendCheckpointer` implementa `BaseCheckpointSaver`; el worker accede por API interna, sin credenciales de Supabase.
- El ID del checkpoint corresponde al trabajo de ejecución, no al proyecto entero. La conversación duradera corresponde a propietario y proyecto. Un hash liga el checkpoint al input exacto; no puede reutilizarse para una pregunta distinta.
- Resumir y responder ocurren en el worker. El backend decide IDs, contexto, límites y permisos. Weaviate sigue reservado para resúmenes y pasajes documentales.

Las tablas tienen RLS y no conceden acceso directo a anon/authenticated. La función `project_assistant_memory_backend` es SECURITY INVOKER y ejecutable solo por service_role. El backend valida JWT y alcance antes de invocarla; las rutas internas exigen token de worker y lease vigente. Ningún prompt puede elegir propietario o proyecto.

## Recuperación y errores

Un reinicio del worker puede recuperar un nodo ya terminado desde sus checkpoints. Si ya se guardó la respuesta, un reintento devuelve el registro existente. Si fallan el modelo, una herramienta, la compactación o la escritura, se muestra el error y no se reemplaza por un resumen inventado. Una compactación y su respuesta solo se hacen efectivas juntas al confirmar la transacción.

El historial nuevo no depende de la expiración de trabajos Redis. Los mensajes de versiones anteriores que solo existían en Redis/localStorage no se importan automáticamente ni se presentan como archivados. Los trabajos sin respuesta terminada siguen siendo ejecuciones pendientes/fallidas, no respuestas guardadas.

La compactación controla el contexto enviado al modelo, no borra almacenamiento. El historial y los checkpoints requieren una política de conservación y monitorización si crece el uso; este lote no elimina conversaciones ni activa otro servicio. No añade parámetros de entorno ni dependencias: reutiliza Supabase, Redis y la versión instalada de LangGraph.

## Verificación

Pruebas acotadas: aislamiento por propietario/proyecto, idempotencia, conflicto de revisión, conservación de originales, límite del resumen, rechazo de formato inválido, recuperación de grafo tras completar y tras fallar el commit, fingerprint de input, recuperación desde un navegador sin historial local y validación de fuentes. Las pruebas SQL usan transacción con rollback. No acreditan calidad semántica ni recorrido E2E con Gemini.
