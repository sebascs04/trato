# Ingesta conectada y simulación de Gemini

Implementación del 26 de octubre de 2026. Esta entrega conecta extracción PDF por una cola real; la pertinencia semántica sigue sin evaluar. No interpreta un documento extraído como acuerdo aceptado, firma o pago.

## Recorrido conectado

1. `POST /api/v1/projects/{id}/documents` autoriza al usuario/proyecto, valida PDF y guarda el original privado. Conserva la reserva/idempotencia y el bloqueo de un pedido abierto por proyecto que ya impone `reserve_document`.
2. `queue_document` registra `worker_threads` y `thread_outbox` en la misma transacción, después de confirmar que existe el original. La reserva del documento y la subida a Storage son pasos previos, no una transacción distribuida de tres sistemas. Un fallo entre ellos conserva el documento y permite reintentar; no se afirma que Redis lo recibió.
3. La API responde 202 con `thread_id` y estado. No espera al file processor. `POST /documents/{id}/retry` vuelve a encolar desde el original, sin crear otra solicitud; no sustituye un trabajo ya activo.
4. Un único publicador en `trato_api.thread_runner` toma la outbox con lease, publica el sobre genérico `thread` y marca publicación después de Redis. Si se repite la publicación, conserva el identificador de la orden. Las órdenes publicadas cuyo trabajo lleva más de 120 segundos sin avanzar pueden publicarse otra vez para recuperar interrupciones.
5. El mismo consumidor `RedisTransport` sirve a worker conectado y simulado, pero usa streams y grupos distintos. El modo conectado sólo admite el flujo real registrado `ingest_document` en esta entrega; futuros handlers amplían ese registro/validación sin otro transporte o publicador por proceso.
6. `ConnectedWorker` reclama el trabajo contra el backend. La orden debe coincidir exactamente con la outbox persistida, incluido propietario/cliente/proyecto/documento/extracción/hash. Una lease vigente impide ejecutar dos consumidores concurrentes.
7. Con el token interno del worker y la lease, obtiene el PDF por `/internal/threads/{id}/original`. El backend usa acceso de servidor a Storage, verifica tamaño/hash y proyecto activo. Ningún JWT de usuario, ruta privada ni clave de servidor viaja en Redis. El token del file processor se usa sólo al llamar a ese servicio.
8. LangGraph y una etapa LangChain ejecutan la extracción HTTP real contra el file processor. Publican fases `reading_original` y `extracting_text`, y resultado o error. El resultado conectado indica `relevance_status=not_evaluated`; no existe una respuesta semántica de demostración como respaldo.
9. El consumidor backend verifica contexto, causalidad, lease e idempotencia en una transacción. Guarda los segmentos con el RPC de dominio existente y registra el evento consumido antes del ACK. Resultados atrasados no reemplazan el intento vigente ni documentos listos. Un cliente archivado no recibe nuevas escrituras.
10. La web consulta sólo documentos pendientes del proyecto activo, sin recargar actividad, propuestas o historial en cada consulta. No solapa peticiones; termina al no haber pendientes, cambiar proyecto, salir de sesión o fallar la consulta. No ofrece reintentar mientras el trabajo está activo. El historial de negocio existente no se sustituye por eventos técnicos del worker.

## Procesos, datos y puertos

- Tablas `worker_threads`, `thread_outbox`, `thread_inbox`; migración `20261026204903_async_document_threads.sql`, creada con CLI y aplicada en Supabase.
- Threads visibles sólo al propietario y proyecto activo, con columnas limitadas. Outbox/inbox sin permisos de usuario ni políticas de acceso de usuario por diseño; sólo funciones de servidor. El linter informa RLS sin políticas en esas dos tablas, coherente con su uso cerrado. No abrirlas para suprimir ese aviso.
- Streams conectados `trato:connected:thread:commands`, `trato:connected:thread:events`. Los inválidos se apartan sin exponer su contenido en `trato:connected:thread:rejected-events`.
- Streams de demostración conservan el prefijo `trato:simulation`. Ninguna indisponibilidad conecta ambos modos.
- Redis propio local en 6380, loopback, contraseña privada, AOF y `noeviction`; archivo `.local/redis/redis.conf` y datos ignorados. AOF cada segundo no equivale a garantía de pérdida cero ni sustituye copias de seguridad. Redis no comparte procesos, archivos ni recursos con otros proyectos.
- API 8100, file processor 8101, web 5173. El worker y el publicador/consumidor backend no abren otro puerto HTTP.

Configuración inicial privada, sin imprimir credenciales ni activar IA:

```bash
python3 scripts/configure-ingestion.py
python3 scripts/dev-polyrepo.py --with-worker
```

El configurador no reemplaza credenciales existentes. El supervisor comprueba puertos, inicia Redis sólo con `--with-worker` y termina únicamente sus propios hijos. Sin el publicador/worker activos, los trabajos permanecen pendientes; la API no cambia a extracción inline. Los errores de transporte conservan pendientes y se registran con códigos sanitizados; no activan otro proveedor o transporte.

## Gemini, no OpenAI

Sebastian aclaró que OpenAI fue una confusión; el proveedor acordado sigue siendo Gemini en Google Cloud. Se retiró el adaptador OpenAI que se había preparado y nunca se utilizó para llamadas reales.

`trato_worker/gemini_simulation.py` usa el SDK Google Gen AI instalado, configurado explícitamente para Vertex con proyecto/modelo de prueba y credencial ficticia. Su HTTP pasa obligatoriamente por `httpx.MockTransport`. Esto comprueba la serialización real de `generateContent`, `systemInstruction`, `contents`, `generationConfig.responseMimeType=application/json` y `responseJsonSchema`, así como la lectura de candidates, finishReason, bloqueos y usageMetadata. El proyecto/modelo ficticios no representan recursos activados ni disponibilidad comercial.

```bash
cd repos/trato-worker
PYTHONPATH=. .venv/bin/python examples/gemini-contract.py
```

La salida incluye el request de prueba y el resultado JSON, etiquetados `simulation`; no contiene documentos reales ni secretos. La prueba bloquea sockets para acreditar que no se llama a Google. Un fallo, bloqueo, salida truncada, JSON inválido o cita inventada falla visiblemente, sin otra respuesta de respaldo.

`analysis.py` ya usa la plantilla RCPTF `prompts/compare-sources.json` para su esquema simple actual, manteniendo validación de citas y revisión humana. La plantilla enriquecida `analyze-change.json` v3 sigue preparada para la futura conexión del análisis por elementos/feedback; no se presenta como un grafo real ya conectado a IA. La simulación del ciclo de cambios sigue explícita e independiente.

Referencias oficiales revisadas: [generateContent de Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent), [respuesta y candidatos](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse), [Storage y acceso de servidor](https://supabase.com/docs/guides/storage/security/access-control), [recuperación de mensajes Redis](https://redis.io/docs/latest/commands/xautoclaim/).

## Límites de esta entrega

La subida conectada exige PDF; DOCX devuelve `PDF_CONVERSION_REQUIRED` antes de reservar registros. No se ha implementado la conversión Word→PDF ni su modal. El file processor conserva la lectura DOCX interna/preview para compatibilidad, pero la nueva ingesta de proyecto usa PDF.

No se activaron Gemini/Google Cloud ni embeddings/Weaviate. El usuario puede consultar texto real; sólo el agente conectado podrá determinar pertinencia real. No se generaron adendas, correos ni cobros reales durante esta entrega.

Validación de datos mediante SQL local y Supabase real con `ROLLBACK`, sin dejar usuarios/documentos de prueba. La prueba de PDF real llamó al procesador HTTP de 8101 con un archivo de `data/pdfs`, usando dobles explícitos sólo para claim/Storage y sin guardar datos del usuario. No equivale a una subida completa autenticada desde la cuenta del usuario en el navegador.
