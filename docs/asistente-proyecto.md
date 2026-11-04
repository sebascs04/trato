# Asistente del proyecto y resúmenes buscables

Implementación local del 2 de noviembre de 2026. Sin despliegue ni pruebas de inferencia real.

## Recorrido

1. La subida conserva el documento y su extracción mediante el thread existente. El procesamiento posterior usa el propósito autorizado por el backend.
2. El worker ejecuta el flujo común: validación según propósito, chunks, resumen y publicación del índice. El resumen canónico queda en file_processing_artifacts.
3. File processor escribe un registro de resumen en TratoSourceChunks, tenant projects_private. Usa segment_id=document_summary y una generación derivada de la generación original y del fingerprint del resumen. Conserva modelo de embeddings, dimensiones y esquema actuales.
4. Las búsquedas originales excluyen el marcador y conservan su generación original. Las búsquedas de resúmenes usan únicamente el marcador y su generación derivada. No se mezcla un resumen con una cita literal del documento.
5. En Proyecto → Asistente, el usuario pregunta. Para documentos antiguos existe Preparar documento, una acción explícita que reutiliza el flujo; no hay backfill automático.
6. El backend publica un trabajo project_assistant con thread y contexto autorizado. El worker lee el catálogo y elige search_document_summaries, read_document_summary o search_document_text mediante el dispatcher genérico.
7. La respuesta JSON se valida contra las fuentes devueltas. El backend vuelve a comprobar propiedad, proyecto, generación y fingerprint del resumen antes de exponerla. La interfaz distingue resumen procesado y texto original y permite abrir el documento.

## Permisos y contratos

El modelo no elige propietario, cliente, proyecto ni tenant. Cada tool incluye description y when_to_use genéricos en inglés. El prompt canónico sigue ROLE, CONTEXT, PRE-TASK CHECKLIST, TASK y FORMAT; output_language admite es y en. No existen herramientas de cobro, correo ni edición en este asistente.

Las llamadas internas requieren token del worker y lease de ejecución activo. La respuesta no acredita pagos ni aceptaciones. Un fallo de herramienta falla el trabajo; no activa otro modelo ni datos simulados. Las conversaciones locales guardan IDs de trabajos y sus respuestas se recuperan con autorización; el TTL de trabajos sigue siendo el existente de 24 horas.

## Ejecución y validación

Arranque local: python3 scripts/dev-polyrepo.py --with-worker. Puertos definidos en local-ports.json. TRATO_FILE_PROCESSING_ENABLED=true en la configuración privada de API y worker; las claves se conservan solo en sus archivos privados.

Se verificaron contratos de resumen, selección de tools, aislamiento de proyecto, lease, citas y generaciones con dobles explícitos; también sintaxis y traducciones ES/EN. Las comprobaciones HTTP locales verificaron recursos 200 y rutas sin credenciales 401. No se han ejecutado consultas reales a Gemini ni escrituras de documentos de prueba en Weaviate. La prueba real de extremo a extremo queda pendiente.

## Compatibilidad de instalación

Este lote no incorpora variables de entorno, roles IAM, permisos de base de datos ni migraciones nuevos. Reutiliza las tablas de artefactos y la colección existentes. Los ejemplos de API y worker ya incluyen TRATO_FILE_PROCESSING_ENABLED=false, TRATO_AI_WORKFLOWS_ENABLED=false y TRATO_WORKER_TOKEN; la instalación debe habilitar explícitamente los flujos y configurar el token compartido, Redis, Gemini y la conexión vectorial según sus guías existentes. No se cambian los valores predeterminados de los ejemplos.

Las credenciales de Weaviate siguen exclusivamente en file processor. La activación local de FILE_PROCESSING no reemplaza URLs ni claves. El configurador vectorial debe conservar el ajuste independiente de false a true sin sobrescribir credenciales. Los documentos antiguos solo se preparan por acción explícita, sin backfill automático.
