# Devoluciones: recorrido simulado con evidencia y fuentes PayPal

26 de octubre de 2026. Autorizado por Sebastian para probar el flujo mientras no hay agente conectado. No ejecuta devoluciones reales o sandbox, no envía correos, no firma documentos ni escribe estados financieros de Supabase. Los datos del proyecto del ejemplo no proceden del proyecto conectado que esté abierto.

## Acceso y recorrido

En un proyecto: Devoluciones → Probar flujo de devolución → Comenzar recorrido. La simulación se elige expresamente y nunca sustituye un error del módulo conectado.

1. Registrar el caso de ejemplo y revisar solicitud, acuerdo, trabajo y pago original.
2. Examinar el análisis preparado, sus fuentes y las condiciones de PayPal. Si falta valorar el trabajo, pedir aclaración; no inventarlo. Si se supera el plazo documentado del ejemplo, bloquear esta vía con `REFUND_WINDOW_EXCEEDED`, no clasificar el documento como ajeno ni resolver derechos contractuales.
3. Revisar el valor del trabajo y las condiciones. El cálculo usa enteros en centavos: `máximo(pago original − trabajo reconocido − reembolsos anteriores, 0)`. Nunca supera el remanente de la captura. Es un escenario revisable, no un cálculo universal de un derecho legal.
4. Guardar la propuesta. Editar antes de enviar conserva v1 y añade instantáneas internas. Tras el envío, sólo ajustes del cliente respaldados por su respuesta permiten v2. Cada versión requiere envío y aceptación propios.
5. Tras la aceptación, autorizar por separado la devolución del importe de esa versión. Con importe cero se cierra sin crear una devolución.
6. Probar resultado `PENDING`, `COMPLETED` o `FAILED`. Pendiente no completa. El fallo queda visible sin reintento financiero alternativo. Finalizar conserva el pago original y la propuesta en consulta.

La simulación puede cerrarse y continuar desde su checkpoint. No hay retroceso para modificar un paso confirmado: sólo la edición del borrador pendiente o una nueva versión tras feedback.

## Respaldo separado

- **Documentos del proyecto:** acuerdo, correo de cancelación y reconocimiento del trabajo, todos ficticios y explícitos. Aclaraciones y feedback se conservan como texto de ejemplo; no se afirma que exista PDF o firma auténticos.
- **Fuentes oficiales PayPal:** archivo `repos/trato-worker/trato_worker/data/paypal_refund_sources.json`, con URL, ámbito, resumen y fecha de consulta. Cada instantánea conserva la referencia utilizada; no se presenta un enlace como aceptación contractual.

Referencias verificadas el 26/10/2026:

- [Refund a payment — Payments API v2](https://developer.paypal.com/checkout/refund-payment): captura original, devolución total/parcial y remanente máximo.
- [PayPal Perú — Cómo emitir un reembolso](https://www.paypal.com/pe/cshelp/article/how-do-i-issue-a-refund-help101): condiciones locales para el ejemplo de bienes/servicios, plazo y tratamiento de las comisiones originales. No generalizar a otros países/productos.
- [Refund — estados de la respuesta](https://developer.paypal.com/api/payments/v2/definitions/refund/): diferenciar resultado pendiente de completado y fallido.

Los ejemplos muestran USD300 pagados, USD10 de comisión ficticia y USD200 de trabajo reconocido: se propone devolver USD100, dejando USD190 del neto de ese cobro. USD10 no representa una tarifa de PayPal. La comisión se muestra como costo del vendedor; no se descuenta automáticamente de la devolución al cliente. No se calcula saldo global de la cuenta, tipo de cambio ni fecha de abono.

## Estándar técnico

Se añade `manage_refund` al registro genérico de `ThreadWorker`, con el mismo sobre `thread`, `schema_version=1`, `mode=simulation`, IDs de contexto, `start/get/resume`, `event_id`, `interrupt_id` vigente, validación Pydantic y checkpoints LangGraph/SQLite. La única etapa LangChain es un `RunnableLambda` determinista del ejemplo; no se llama a Gemini ni se presenta como inferencia.

`refund_flow.py` implementa el grafo y la validación de cada pausa. Se reutilizan dispatcher, deduplicación, aislamiento y persistencia. El handler conectado sigue admitiendo únicamente la ingesta real; este flujo no se registra allí ni cambia sus streams.

Para la vista local, `/api/simulation/threads` es una pasarela de simulación genérica con allowlist inicial de `manage_refund`. Devuelve 202 y un identificador consultable; lanza la CLI existente `trato_worker.ingest --mode simulation --transport stdio` en un proceso worker separado. El HTTP no ejecuta el grafo. Es una elección explícita de stdio para esta prueba aislada, no un transporte de respaldo de Redis. No se usan credenciales de proveedores ni JWT del usuario en el proceso simulado.

La cookie local HttpOnly/SameSite separa sesiones. El servidor deriva el propietario y fija el contexto ficticio; no acepta identidad de negocio aportada por el navegador. La operación se consulta sólo desde esa sesión. No sirve como autenticación multiusuario de producción. Los checkpoints viven en `.local/simulation/refund-threads.sqlite`, no en Supabase; los estados de operaciones HTTP son efímeros y después de reiniciar web se debe consultar el recorrido persistido. El navegador conserva únicamente thread/escenario en sessionStorage.

Errores de worker, validación o transporte son visibles. Una respuesta incierta exige consultar el checkpoint antes de repetir una acción. No hay respuestas inventadas ni llamadas financieras automáticas.

## Límites de integración pendientes

- Registrar solicitudes reales y referencias a capturas/retornos previos con autorización y bloqueo transaccional.
- Conectar el análisis real con los prompts RCPTF y salidas JSON validadas; recuperar evidencia real del proyecto.
- Verificar país/producto, captura, moneda, importe remanente y estado actual desde el backend conectado.
- Generar PDF exacto del cierre y registrar envío/aceptación de cada revisión usando los contratos de negocio reales.
- Integrar ejecución idempotente y conciliación de reembolsos PayPal sandbox, con aprobación explícita y credenciales del servidor.
- Proyectar sólo hitos confirmados al historial único del proyecto. La simulación actual no escribe en él.

El flujo no arbitra disputas, determina derechos legales ni modifica la solicitud pagada original.

## Validación

- 10 pruebas unitarias nuevas del flujo: importes/comisiones, devolución parcial anterior, datos faltantes, plazo excedido, revisiones, pausas obsoletas, aislamiento, persistencia/reentrega, importe cero y resultado fallido.
- Suite del worker: 62 pruebas descubiertas, 56 aprobadas y 6 de Redis omitidas por requerir su entorno específico. No se modificó el transporte Redis ni se usó el de QAMAQ.
- Pruebas Chromium con la pasarela y el worker locales reales: recorrido completo, resultado pendiente/fallido, reanudación, versiones, servicio indisponible, aislamiento de sesión y separación entre estado real/simulado. Las API de negocio se doblan explícitamente en las pruebas del navegador; no hay cargos, correos o reembolsos reales.
