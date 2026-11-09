# Recuperación interna de documentos

Utilidad de mantenimiento para un operador de Trato. No se expone al usuario ni cambia acuerdos, propuestas, aceptaciones o pagos. No sube originales otra vez ni altera el tipo de documento para superar una validación.

```bash
repos/trato-worker/.venv/bin/python scripts/reprocess-project-files.py \
  --owner UUID_DEL_PROPIETARIO --project UUID_DEL_PROYECTO
```

Sin opciones de escritura solo inspecciona. Usa la configuración privada de trato-api de este checkout, comprueba el propietario del proyecto y consulta las fuentes canónicas y los recibos del índice. No imprime claves, correos, preguntas ni contenido documental.

Para poner en cola el procesamiento pendiente mediante el flujo existente:

```bash
repos/trato-worker/.venv/bin/python scripts/reprocess-project-files.py \
  --owner UUID_DEL_PROPIETARIO --project UUID_DEL_PROYECTO --apply
```

`--document UUID` puede repetirse para delimitar una recuperación. Deben pertenecer al proyecto. El modelo es el configurado para ese propietario; no se sustituye por otro.

Los archivos ya preparados y los trabajos activos se conservan. Si hubo un fallo confirmado y se desea un nuevo intento, `--apply --retry-failed` crea una ejecución nueva. Es una acción explícita del operador; no es un bucle automático de inferencia. Un rechazo o una petición de aclaración no se convierte en aprobación ni se relanza silenciosamente.

Si el trabajo de la generación actual figura como procesado pero falta un recibo vigente del índice, `--apply` crea un trabajo nuevo del mismo flujo para recuperar la publicación. El flujo conserva sus validaciones y reutiliza los artefactos vigentes.

Si falta extracción, la utilidad devuelve `EXTRACTION_REQUIRED` sin encolar parcialmente el resto. Primero debe recuperarse la lectura mediante `POST /api/v1/documents/{id}/retry` con la sesión del propietario. Para una reparación administrativa puntual se puede ejecutar la función existente `queue_document` en una transacción de mantenimiento de Supabase, con el propietario del proyecto comprobado y establecido como contexto local de la transacción. Nunca crear una extracción ficticia, fabricar segmentos ni modificar auth.users. Al terminar, el publicador y el worker normales procesan la lectura; la recepción del resultado enlaza con `process_file`. Ejecutar nuevamente la inspección después.

La utilidad no garantiza que un documento supere su tratamiento semántico. Conserva y muestra sus estados reales. Consultar los trabajos de proceso y sus fases para diagnosticar la causa. No reintentar la pregunta del asistente como sustituto de reparar una fuente pendiente.

## Contratos del clasificador

El propósito lo determina el backend. Cuando el agente devuelve relevance=supported, detected_category debe coincidir con expected_category. El esquema enviado al modelo explicita la categoría esperada para el propósito actual y el prompt pide verificar la coherencia antes de responder. La validación en código permanece activa. Una contradicción registra un aviso interno con file_id, propósito, categoría esperada, categoría devuelta y relevancia; no registra el texto del documento ni credenciales.

El tratamiento semántico también se reutiliza por la misma fuente, propósito, idioma, modelo y versión del prompt. Antes de usarlo se validan de nuevo el contrato, la cobertura y las citas. Un artefacto inválido falla; no dispara un análisis alternativo. Esto evita que un reprocesamiento secuencial intente sobrescribir un análisis válido con otra redacción del modelo. Las escrituras simultáneas con resultados diferentes siguen rechazándose y requieren revisión o recuperación explícita.

Para una pregunta referida a un documento identificado en el catálogo, el asistente consulta directamente su resumen o sus pasajes por document_ids. No se excluyen silenciosamente archivos de una búsqueda global ni se transforma una fuente pendiente en evidencia válida.
