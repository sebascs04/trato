# Notas para ti, Flores

Actualizado: 1 noviembre 2026. Lote preparado localmente; confirmar publicacion/merge antes de asumir que main ya lo contiene. No se cambiaron ni rotaron tus credenciales. No recrear el cluster o la coleccion Weaviate compartidos.

## Weaviate

Tu URL y clave propias se conservan en `.local/weaviate/connection.env`, fuera de Git. Tras actualizar dependencias fijadas del procesador, ejecutar desde la raiz `repos/trato-file-processor/.venv/bin/python scripts/configure-vector.py`. Valida el esquema existente y coloca la configuracion en el procesador y el flag en API. El worker no recibe claves Weaviate. `TRATO_GEMINI_API_KEY` es otra integracion; Vertex puede autenticar mediante tu JSON previo. Mas detalle en `configuracion-vectorial-colaboradores.md`.

## Cinco guias del evaluador

Ya vienen en `repos/trato-api/resources/rehearsal-sources/`. No hace falta pedir archivos privados a Sebas. Desde la raiz, ejecutar `repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py --configure`. Comprueba hashes/contratos, configura la ruta propia de API y no consume Gemini. No omite ninguna de las cinco; Slavik se limita a Commitment/Conclusion.

## Procesamiento y devoluciones: punto de integracion

La migracion `20261101212324_file_processing_and_public_vector_sources.sql` ya esta aplicada en trato-dev y coincide con el archivo local. No repetirla ni reparar el historial para saltar versiones. Consultar `correspondencia-migraciones.md`.

El recorrido es worker → backend → file processor → backend → worker. El backend fija proposito y vinculos segun la entrada; el documento no puede cambiar sus permisos. `TRATO_FILE_PROCESSING_ENABLED=true` en API y worker activa deliberadamente tratamiento/resumen/indice; no hay sustitucion silenciosa si falla. Los ejemplos lo dejan desactivado hasta configurar el entorno.

Para tu flujo monetario, conectar los documentos reales a `refund_request`/`refund_evidence`, comprobando propietario, cliente, proyecto, pago original verificado y expediente real. Los handlers estan registrados, pero no existe aun adaptador del expediente de tu implementacion en este lote. Si se pasa un `refund_case_id` sin repositorio conectado, falla `FILE_REFUND_CASE_CONTEXT_NOT_CONFIGURED`. No inventar el expediente ni saltar ese control. La lectura documental no autoriza una devolucion ni mueve dinero.

Conservar un historial de negocio unico y el pago original inmutable; los datos tecnicos del proveedor quedan en el registro de pago. Avisar a P1 antes de editar `file_processing.py`, contratos o esquema compartido para acordar el adaptador. No tocar los flujos del otro en paralelo.

## Pruebas y publicacion

Comprobados contratos API/worker/FP, aislamiento, citas, generaciones obsoletas y retirada de reputacion con dobles de proveedores; esquema Weaviate real validado sin generar embeddings. Falta prueba conjunta UI/Gemini de conversaciones, evaluacion, procesamiento y busqueda. No tomar estas comprobaciones como evidencia de calidad real del modelo. Publicacion en una rama compartida, con responsable unico; PR y merge solo por autorizacion explicita de Sebas.
