# Plan inicial, entregables y cobros

Implementación local del 5 de noviembre de 2026. No publicada ni desplegada en este lote.

El plan confirmado se conserva en `project_start_plans` y `project_start_stages`. TeTrato dispone de `read_project_plan`: el backend fija propietario y proyecto, devuelve evidencia del plan guardado y revalida su huella antes de aceptar la respuesta. El plan no se mezcla con los chunks del PDF ni equivale a aceptación del cliente. `completed_at` corresponde solo al plan inicial.

Durante la creación, si las etapas editadas difieren de la propuesta original se solicita una revisión con JSON validado. El modelo mantiene exactamente las etapas confirmadas y evalúa `material_change`; los cambios de redacción o puntuación sin diferencia de significado no cuentan como cambios sustanciales. El backend exige una revisión del mismo trabajo original y de las mismas etapas antes de crear el proyecto. Se conserva `original_proposal` con fuente, etapas y explicación originales y la referencia a la revisión. No se presenta una edición del freelancer como aceptación del cliente. La comprobación semántica real queda para la prueba manual del modelo; los tests comprueban los contratos y el vínculo exacto.

Cada etapa tiene su propio checkout. No se solicitan anticipos: se adjunta primero un PDF de entrega y conformidad, con `kind=delivery`, `purpose=delivery_evidence` y `stage_position`. La reserva vincula documento y etapa en la misma transacción. La ingesta habitual conserva texto, resumen, chunks, vectores y eventos; el documento aparece en Documentos bajo entregables del plan y en el mapa como fuente del proyecto. El contexto específico de la etapa se pasa al tratamiento por `reference_context.case_description`; la posición estructural no se introduce como un UUID ficticio en los contratos del worker.

El backend deriva el importe y la condición del plan, verifica el respaldo, su generación y recibo de indexación vigente, y exige el pago verificado de todas las etapas anteriores. La base de datos repite las comprobaciones de orden, importe, propietario y vínculo con la evidencia bajo bloqueo del proyecto. El checkout reutiliza la validación de PayPal y sus claves idempotentes: abrir o cancelar el checkout no confirma el pago. Las capturas confirmadas se conservan en `project_received_payments` con origen `initial`, compatible con las devoluciones existentes. No se modificó la lógica de cambios ni devoluciones.

El correo de cobro reutiliza la plantilla de Trato con mascota. El usuario revisa destinatario, asunto y cuerpo y confirma antes del envío. El enlace público contiene el token de ese checkout; no expone el PDF privado. No se enviaron correos ni se ejecutaron pagos para validar el código.

Al completarse todas las etapas, se registra `project_start_plans.completed_at`, sin cambiar `projects.status`: las solicitudes y devoluciones permanecen independientes. Resumen muestra el contador en Acuerdo inicial. Plan de trabajo muestra el estado por etapa, sin repetir el contador.

## Migraciones aplicadas en Supabase

- `20261106033727_plan_stage_payments.sql`: cobros por etapa, evidencia vinculada y progreso autorizado.
- `20261106034544_plan_stage_completion_guard.sql`: evita una ambigüedad de nombres SQL en el cierre.
- `20261106034701_plan_original_proposal.sql`: conserva la propuesta original al confirmar.
- `20261106035928_plan_unlinked_payment_guard.sql`: detiene cobros nuevos cuando existen cobros iniciales anteriores sin conciliar con las etapas.

Conservan los registros anteriores. No vincular cobros históricos a una etapa por coincidencia de importe ni reescribir sus condiciones automáticamente. Los planes antiguos conservan el texto confirmado, aunque se hubieran generado antes de la regla de no anticipos.

## Verificación

Pruebas unitarias y de contrato de API, worker y frontend, paridad ES/EN y sintaxis. El test SQL `repos/trato-api/supabase/tests/plan_stage_payments.sql` verifica etapas, importes, evidencia, idempotencia y cierre mediante fixtures y recibos ficticios dentro de una transacción con rollback. Esto no acredita un E2E real de PayPal ni la calidad semántica de Gemini. Los avisos de seguridad de Supabase permanecen sin nuevos hallazgos respecto al estado previo.

Pendiente del usuario: recorrer en local una etapa con PDF real de prueba, revisar el correo, pagar con la cuenta Sandbox y verificar la actualización; probar preguntas a TeTrato y la revisión de una edición significativa. Después, probar creación de proyecto en marcha. La promoción de Trato como gestión de proyectos para freelancers queda para la presentación de la página de inicio, mostrando este recorrido real.

### Ajuste del modal de entrega

Se retiraron «Ver documentos», «Actualizar estado» y «Condiciones del cobro». Sin respaldo seleccionado y procesado, preparar el cobro queda deshabilitado y el backend rechaza la ausencia del documento. La lectura del estado del respaldo y del checkout es automática mientras ese modal está abierto; no crea órdenes ni ejecuta pagos. El correo de pago permanece sujeto a revisión y envío explícito. Reintentar aparece solo ante un error real. Los documentos de Gmail o conversaciones se adjuntan en PDF, conforme al formato estándar actual.

### Clasificación del respaldo de entrega

La conversación de cierre de una etapa es `delivery_evidence`, aunque contenga aceptación o conformidad. No debe confundirse con `acceptance_evidence` de una adenda ni exigir adjuntar el código, diseño o capturas del trabajo como condición para leer esa conversación. El criterio de entrega conserva la exigencia de contenido explícito de cierre y conformidad y la verificación de citas. El caso ficticio 10 de Café Aurora permitió detectar esta confusión en una ejecución real del modelo; el mismo documento se reprocesó de forma explícita tras corregir el criterio, conservando el resultado anterior para auditoría. No es un reintento automático de documentos rechazados.

El worker continúa fuera del modal. «Continuar trabajando» cierra la vista sin cancelar el trabajo; abrirla después consulta de nuevo los documentos y su estado. Esto no habilita cobros mientras el respaldo siga pendiente.

### Retirar un respaldo antes del cobro

`20261106042505_retire_plan_delivery_evidence.sql` añade el retiro de fuentes mediante `documents.deleted_at`, limitado por `plan_evidence_backend` a documentos `delivery` asociados a una etapa. No permite retirar respaldos cuando ya existe un checkout de esa etapa ni cuando el documento respalda una propuesta. Los originales y eventos se conservan para auditoría, pero se excluyen de Documentos, catálogo del asistente, inventario vectorial, vistas previas y proyección del grafo. El retiro es una acción explícita del usuario; un documento aceptado no se elimina automáticamente ni debe subirse de nuevo tras un reprocesamiento.

El file processor ejecuta `remove-file` en `projects_private` con los cuatro filtros obligatorios owner/client/project/file. Elimina chunks y resumen de todas las generaciones del archivo y comprueba que no queden objetos. El backend usa el mismo bloqueo que la indexación; esta vuelve a validar la fuente después de adquirirlo, para que una ejecución atrasada no restaure los vectores retirados. La revocación de la fuente se confirma antes de intentar la purga. Si la purga falla o coincide con una indexación activa, la limpieza queda persistida como pendiente y se ofrece reintentar; nunca se reactiva la fuente como recuperación.

Las pruebas SQL con rollback comprueban retiro, exclusión del grafo, estado pendiente y protección ante checkout. Pruebas del procesador comprueban que se eliminan resumen y chunks, sin afectar otro propietario, cliente, proyecto, archivo ni tenant. No se retiró ni eliminó automáticamente el documento real de prueba que el usuario tenía procesado.


### Separación de ingesta entre entornos (5 noviembre 2026)

Aplicar primero la migración `20261106044003_isolate_ingestion_runtime.sql`. El supervisor `scripts/dev-polyrepo.py --with-worker` genera una identidad privada persistente en `.local/runtime/ingestion-scope` y pasa el mismo `TRATO_RUNTIME_SCOPE` a API y publicador. No copiar esa identidad a otro equipo ni asumir que un pull distribuye archivos privados. Para arranque manual configurar el mismo valor exclusivo en ambos procesos. Cloud legacy sin valor solo reclama ingestas sin scope; no reclama las locales con scope, incluso con su código anterior. No cambia tenants ni permisos owner/client/project. Los documentos previos mantienen su entorno original; no reasignarlos masivamente. Reiniciar únicamente servicios Trato sin trabajos activos.
