# Referencias compartidas: contrato del file processor

El file processor ejecuta la indexación y recuperación de la biblioteca que autoriza el backend. El worker no selecciona tenants, credenciales ni archivos ajenos. Esta implementación utiliza el tercer tenant `references_shared` en la colección existente `TratoSourceChunks`, con el mismo perfil de embeddings; no crea otra colección.

## Preparación explícita

Con la configuración privada habitual del file processor, desde `repos/trato-file-processor`:

```bash
.venv/bin/python -m file_processor.reference_vectors --provision
```

Este comando valida primero el esquema existente y crea únicamente el tenant si falta. Las rutas de indexación y consulta no lo crean automáticamente. Coordinar la operación y la recarga de servicios sin interrumpir trabajos. No ejecutar este comando como recuperación automática de errores.

El backend prepara solo las secciones aprobadas de las cinco fuentes y utiliza el script raíz `scripts/index-rehearsal-references.py --index`. En particular, la selección aprobada de Slavik conserva Commitment/Conclusion de la página 3 y excluye 5f. El processor recibe esa selección; no conoce ni amplía por su cuenta el contenido aprobado.

## Rutas internas

Ambas requieren el token de servicio del processor en `Authorization: Bearer ...` y `TRATO_VECTOR_SEARCH_ENABLED=true`. No aceptan JWT del usuario ni un tenant en el cuerpo. Respuestas JSON con `Cache-Control: no-store`.

`POST /v1/references/index` recibe:

- `scope_id`: SHA-256 de la biblioteca autorizada.
- `files`: entre uno y cinco objetos con `file_id` UUID canónico, `text_sha256` y `segments`.
- Cada segmento conserva `segment_id`, `text` y `locator` original. El hash del archivo se verifica contra los textos unidos con dos saltos de línea.

Devuelve `data` con `scope_id`, `files_indexed`, `chunks`, `file_chunks` por UUID y `embedding_identity`. Se preparan todos los archivos antes de escribir. Una escritura parcial del proveedor genera error; no acredita una biblioteca completa. Los reintentos conservan IDs deterministas. El backend guarda su recibo privado únicamente tras el éxito completo.

`POST /v1/references/search` recibe `scope_id`, `file_ids`, `expected_chunks` del recibo del backend, `query`, `limit` (1–20, por defecto 6) y `neighbor_count` (0–2, por defecto 1). Las claves de `expected_chunks` deben coincidir exactamente con `file_ids`; el modelo no aporta esos conteos.

La consulta híbrida combina texto y vectores con alpha 0.7, comprueba conteos antes y después y filtra siempre biblioteca, archivos y perfil. Devuelve `data.scope_id` y `data.hits`, cada uno con `file_id`, `segment_id`, `text`, `start_char`, `end_char`, `text_sha256` y `score`.

Los offsets son puntos de código Unicode relativos al segmento original. El contexto vecino permanece en el mismo archivo, segmento, biblioteca, perfil y tenant; solo se unen fragmentos contiguos o solapados cuyo texto coincide. Un contexto inconsistente falla de forma visible. Las citas, atribuciones y correspondencia con los originales las valida después el backend.

## Verificación

Desde el directorio del file processor:

```bash
.venv/bin/python -m unittest discover -s tests
```

La verificación aislada del 3 de noviembre de 2026 pasó 36 pruebas, incluidas 10 de referencias: autenticación, filtros, conteos, offsets, integridad, límites, errores de proveedor y ausencia de creación automática de tenants. No acredita ejecución real de Gemini, provisión del clúster ni una evaluación completa desde la interfaz.
