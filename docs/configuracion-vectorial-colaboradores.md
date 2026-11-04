# Configuracion vectorial para colaboradores

1 noviembre 2026. Este lote agrega configuracion; no rota las claves anteriores de Gmail, PayPal, Supabase, Gemini, Redis o Neo4j. Un pull no copia archivos `.env` ni credenciales privadas. No sustituir el entorno completo de un colaborador por el de otra persona.

## Que cambia al actualizar codigo

En `repos/trato-file-processor/.env`:

```dotenv
WEAVIATE_URL=URL_PRIVADA_DEL_CLUSTER_COMPARTIDO
WEAVIATE_API_KEY=CLAVE_PROPIA_DEL_COLABORADOR
TRATO_VECTOR_SEARCH_ENABLED=true
```

En `repos/trato-api/.env`:

```dotenv
TRATO_VECTOR_SEARCH_ENABLED=true
```

Conservar FILE_PROCESSOR_URL y FILE_PROCESSOR_TOKEN existentes en API y el mismo FILE_PROCESSOR_TOKEN en procesador. El worker conserva TRATO_API_URL y TRATO_WORKER_TOKEN; no necesita claves de Weaviate. No cambiar las claves de Gmail, PayPal, Supabase o Gemini por esta integracion.

Actualizar las dependencias fijadas del procesador: `repos/trato-file-processor/.venv/bin/python -m pip install -r repos/trato-file-processor/requirements.lock.txt`, desde la raiz. El SDK Weaviate pertenece al procesador, no al backend ni al worker. Reiniciar solo los servicios propios de Trato para cargar variables nuevas, respetando los puertos documentados y sin detener QAMAQ.

La clave `trato-companero-dev` existente es administrativa: no requiere otra invitacion por tenant, pero permite acceso directo a todo el cluster. Los permisos de Trato siguen en su backend; una clave administrativa no queda limitada por esos filtros. Compartir la clave por un canal privado, nunca por Git ni documentacion publica.

## Tenants acordados

- `projects_private`: compartido fisicamente; el backend obliga propietario, cliente, proyecto y generaciones autorizadas en cada operacion. Compartir tenant no concede acceso a todos los proyectos.
- `reputation_public`: reservado para experiencias publicadas y consentimiento vigente, con identificadores comunitarios propios. No copiar contratos privados aqui. La proyeccion de textos publicados esta conectada por outbox y cola; no incluye adjuntos privados.
- Tercer tenant libre, sin crear.

Las cinco guias de Ensayos se leen completas desde su biblioteca autorizada, fuera de Weaviate. Ahora se incluyen en `repos/trato-api/resources/rehearsal-sources/` para que el pull las entregue al colaborador. Ejecutar `scripts/configure-rehearsal-sources.py --configure` con el Python del procesador para validar las cinco y seleccionar su ruta local absoluta en API .env. Un archivo ausente debe producir un error visible, sin sustituirlo por otra fuente.

## Configurador opcional y comprobaciones

El archivo privado `.local/weaviate/connection.env` puede contener exclusivamente la URL y la clave propia. `scripts/configure-vector.py` verifica la coleccion y agrega las variables anteriores sin imprimirlas ni sobrescribir configuraciones diferentes. No hace inferencias ni indexa documentos. `--provision` es una accion administrativa explicita para crear/verificar la coleccion y los dos tenants acordados; una instalacion colaboradora normal no necesita repetirla.

Con el recorrido completo (`--with-worker`, pump/ingesta y consumidor IA habilitados), se encola indexacion despues de confirmar una extraccion nueva. Los flags no inician un backfill masivo de archivos existentes. La consulta y los reintentos siguen siendo explicitos; una fuente pendiente o una generacion parcial no se presenta como indice completo. Las pruebas conjuntas desde la interfaz siguen pendientes por acuerdo con Sebastian. No se publica este lote sin autorizacion nueva.


## Cierre del lote de procesamiento y reputacion (1 noviembre 2026)

El esquema compartido ya fue actualizado y validado con los campos comunitarios `community_client_id`, `review_id` y `review_version`. No crear otra coleccion ni regenerar el indice. Esta comprobacion administrativa no indexo archivos, no genero embeddings y no llamo a Gemini.

Antes de activar el procesamiento completo, comprobar que Supabase contiene la migracion exacta `20261101212324_file_processing_and_public_vector_sources.sql`. Ya esta aplicada en trato-dev; no volver a aplicarla ni reparar el historial arbitrariamente. Crea opciones/artefactos privados y outbox/recibos de reputacion compartidos.

Para activar expresamente el tratamiento y resumen de nuevas extracciones, agregar `TRATO_FILE_PROCESSING_ENABLED=true` tanto en API como en worker. El valor de ejemplo es false: descargar codigo no activa inferencias. Requiere consumidor IA, pump e ingesta propios de Trato. Si este modo falla, no pasa automaticamente a indexacion sin tratamiento. Los servicios locales existentes deben reiniciarse de forma coordinada; no ejecutar consumidores contra pendientes reales durante comprobaciones aisladas.

No cambia ninguna clave existente. La clave denominada `trato-companero-dev` en el panel se guarda como `WEAVIATE_API_KEY` en el procesador; `TRATO_COMPANERO_DEV` no es una variable que lea el codigo. La URL y clave guardadas en `.local/weaviate/connection.env` se copian al entorno del procesador mediante `repos/trato-file-processor/.venv/bin/python scripts/configure-vector.py`. El comando normal valida el esquema; no necesita `--provision` en otra instalacion una vez preparado el cluster compartido. Conservar los tokens internos propios existentes.

`TRATO_GEMINI_API_KEY` pertenece exclusivamente a la configuracion del modelo. La autenticacion Vertex mediante JSON sigue su configuracion previa y puede dejar esa variable vacia. Ninguna credencial Gemini reemplaza la clave Weaviate.

Estado de publicacion: este lote permanece local, sin push/PR/merge. Confirmar su integracion antes de pedir a un colaborador que ejecute estos pasos sobre main.
