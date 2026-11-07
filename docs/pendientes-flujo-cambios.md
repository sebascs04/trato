# Flujo de cambios: estado y pendientes

6 de noviembre de 2026. Nota de traspaso para continuar el rediseño del flujo de cambios (adendas) en otro chat.

## Hecho en este lote

- **Preparar propuesta:** TeTrato espera a que el PDF del pedido esté leído antes de redactar. Si la lectura anterior falló, al abrir «Preparar propuesta» se relanza una vez el mismo reprocesamiento de Documentos (`POST /projects/{p}/documents/{id}/process`). Si vuelve a fallar se muestra el error real (por ejemplo, 429 de Vertex), sin redactar sin el pedido.
- **Pasos del modal:** 4 pasos (propuesta de TeTrato → alcance y condiciones → precio y fecha → revisión). El adicional se calcula solo al pulsar «Continuar» en «Precio y fecha» si hay tarifa y horas.
- **Fecha de entrega:** no se admiten fechas pasadas, ni en el formulario (`min`) ni en el backend (`Terms.deadline`, calendario de Lima).
- **Análisis por versión:** al crear la propuesta se guarda en `proposal_revision_ai` lo que propuso TeTrato (alcance, condiciones, detalle, horas, razonamiento y citas).
  - «✨ Análisis de TeTrato» abre el panel lateral derecho.
  - Cada campo editado muestra «Ver comparación», que abre un modal flotante a dos columnas: a la izquierda lo propuesto, a la derecha lo guardado, con las palabras quitadas y añadidas marcadas.
  - Las fuentes citadas se agrupan por documento y abren la vista previa del PDF.
  - El veredicto («Cambio sustancial») se ve como una línea en el panel; «Ver revisión» abre el texto completo en un modal flotante.
- **Revisión de la edición:** el worker `change_review` dice si la edición es sustancial (JSON validado).
  - El trabajo es determinista por versión, términos guardados, idioma y modelo, así que reabrir el análisis retoma el mismo trabajo en vez de lanzar otro.
  - Solo «Reintentar» envía una clave nueva.
  - El veredicto queda guardado y ligado a la huella de los términos.
- **Asistente único:** TeTrato flotante con la misma conversación del proyecto. Lee el estado del proyecto (`read_project_status`: pedidos, versiones, envíos, aceptaciones, pagos y cierres) y recibe el pedido que se está mirando (`focus_request_id`). Está oculto en Asistente y en Devoluciones.
- **Pago inicial y de adenda:** cualquier cuenta comprador de PayPal Sandbox puede pagar; se verifican orden, importe, comercio, moneda y captura.

Migraciones aplicadas en Supabase: `20261106171356`, `20261106174949`, `20261106200000` y `20261106210000`.

## Falta probar en la interfaz (en este orden)

1. **Enviar la adenda:** desde la ficha, «Enviar adenda →». Revisar el destinatario, el mensaje y el PDF, y enviar por Gmail. Comprobar el estado y el historial.
2. **El cliente pide ajustes → v2:** «Registrar ajustes del cliente» con su PDF o respuesta de Gmail y notas.
   - v2 exige un envío y una aceptación propios.
   - **Pendiente de diseño:** v2 no tiene «Análisis de TeTrato». Definir cómo se ve la IA en una versión nacida de ajustes del cliente (¿TeTrato propone v2 a partir de la respuesta? ¿se compara v1 → v2?).
3. **El cliente acepta:** registrar la aceptación de esa misma versión. Con adicional: «Abrir pago de prueba», pagar en Sandbox y «Verificar pago». La solicitud pagada queda de solo consulta.
4. **El cliente rechaza:** «Cerrar pedido» con motivo. Comprobar que el proyecto queda libre para un pedido nuevo y que TeTrato prepara la propuesta del nuevo pedido desde cero.
5. **Memoria del asistente:** preguntar a TeTrato (el flotante, con el pedido abierto) por el estado del cambio, la versión vigente, si está pagado o qué pidió el cliente. Comprobar que responde con citas del estado y que la conversación se conserva entre pestañas.
Historial y mapa ya están cerrados: no son un pendiente. Durante los pasos anteriores basta con comprobar de pasada que aparecen los hitos nuevos (envío, aceptación, pago o cierre).

## Lote del 6–7 de noviembre (local, sin publicar)

- **Inventario de documentos con consultas agrupadas** (`Repository.extractions`, `summary_artifacts`, `VectorReceipts.get_many`): 14,3 s → 2,5 s en un proyecto de 8 documentos, mismo resultado. `/sources?file_ids=` para sondear solo los PDF pendientes.
- **Cambios dentro del plan:**
  - Al registrar un pedido se pregunta por la etapa o por «trabajo nuevo». Se guarda en `change_request_plan_placements` (migración `20261107020000`), una sola vez.
  - `/proposals` añade `additional_minor`, `plan_placement` y `plan_stage_position`. `/request-status` añade `open_request`.
  - El historial muestra la etapa en el subtítulo de cada pedido.
  - El mapa une el pedido con su etapa o con el plan (migración `20261107030000`, `projection_version` sigue en 2).
  - La vista del plan con subpuntos y la edición de etapas son de la sesión del plan (migración `20261107010000`).
- **Reutilización:** reabrir «Preparar propuesta» o los ajustes con las mismas entradas recupera el análisis anterior. La subida del PDF de ajustes es idempotente por versión, sha y nombre de archivo.
- **v2:** el adicional se recalcula con la tarifa, sin heredar el de la v1. La comparación v1/v2 va a dos columnas, solo con los campos cambiados. Los campos de ajustes se bloquean mientras TeTrato analiza.
- **Pendiente:** hasta desplegar Cloud, su worker puede regenerar un mapa sin las flechas de ubicación, porque comparte la cola.

## En pausa (después de cerrar el diseño)

- Retomar en vez de relanzar en todos los procesos de IA o de generación del flujo de cambios, como ya hace la propuesta de TeTrato (`rememberDraft` al lanzar y `reuseDraft` al volver). Revisar:
  - el análisis de respuestas de Gmail (`change-reply-assistant.mjs`, ids aleatorios en las líneas ~126 y ~151);
  - guardar la adenda (clave `proposalForm.key` aleatoria por formulario);
  - el envío y el pago.
  Propuesta de TeTrato, revisión de ediciones (`change_review`) y PDF de ajustes ya están cubiertos.

## Problemas conocidos

- **429 de Vertex (límite por minuto, no de saldo):** el worker no reintenta por diseño (sin fallbacks). Propuesta pendiente de autorización: reintentar la misma petición, con el mismo modelo y proveedor, hasta 3 veces con espera (5, 15 y 30 s) solo ante un 429.
- **Revisiones anteriores:** las creadas antes de este lote no tienen análisis guardado y muestran «Esta versión no se preparó con TeTrato».
- **Pruebas de navegador:** `tests/browser/proposals.spec.cjs` está actualizado, pero no se pudo ejecutar en el entorno local (Chromium no arranca).
- **Ejecución de pruebas de la API:** necesitan `PYTHONPATH=../trato-file-processor` con el entorno del file processor.
