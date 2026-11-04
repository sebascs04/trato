# Preparación de la prueba integral de devoluciones

Fecha: 2 de noviembre de 2026, hora de Perú. Rama: `codex/devoluciones-reales`.

**Preparación técnica completada. Pendientes: confirmar comprador/buzón de prueba y cargar un documento desde la sesión del usuario. El recorrido financiero sigue sin ejecutarse.**

## Resultado por control del roadmap

| Control | Evidencia observada | Estado |
| --- | --- | --- |
| P0.1 — Supabase | La CLI Windows conservaba la sesión administrativa. Se recuperaron sin alterarlas las migraciones remotas `20261101154326_ai_initial_project_plans.sql` y `20261101212324_file_processing_and_public_vector_sources.sql`. El dry run enumeró exactamente las 11 migraciones de devoluciones; se aplicaron correctamente desde `repos/trato-api`. El dry run posterior respondió `Remote database is up to date`. Las RPC financieras y de webhook responden contra la base real. | Preparado |
| P0.2 — pendientes tanda 6 | 35 migraciones aplicadas a PostgreSQL temporal aislado, 17 grupos de conciliación aprobados, incluido retroceso del reloj. Comprobación adicional: consentimiento sobre intento anterior rechazado sin crear otro intento. Tras reiniciar con el esquema final, autorizaciones, operaciones, intentos, ejecuciones, comprobantes, aplicaciones, comprobaciones, consentimientos e incidencias conservaron exactamente sus valores. | Aprobado |
| P0.3 — configuración | Supabase y Auth respondieron HTTP 200. PayPal Sandbox aceptó las credenciales y permitió consultar/configurar su listener. El proveedor de devoluciones carga el ID dedicado. La configuración privada sigue excluida de Git. La correspondencia del merchant con la cuenta Business se contrastará en la cuenta del usuario y primera captura. | Conexiones preparadas; contraste de cuentas pendiente |
| P0.4 — cuentas | Hay dos usuarios confirmados en Supabase. El usuario confirmó que reutilizará sus cuentas y datos ya guardados de una prueba anterior. La coincidencia entre contacto y pagador se comprobará al vincular la captura inicial. | Cuentas disponibles según confirmación del usuario |
| P0.5 — servicios | Web 5173, API 8100 y procesador 8101 responden HTTP 200. Redis privado 7.4.9 en 6380 y procesos worker/resultados activos. Gateway 8102 y métricas del túnel 8103 en loopback. Docker no está disponible en esta distribución; no se iniciaron contenedores. | Preparado |
| P0.6 — Gmail/documentos | Token existente renovado; identidad confirmada contra Google; permisos de envío y lectura presentes. Tres PDFs ficticios preparados y uno extraído por el procesador real con texto y segmentos. No se enviaron correos. La carga, apertura y cita dentro de un proyecto desde la sesión del usuario siguen pendientes. | Integraciones preparadas; paso de interfaz pendiente |
| P0.7 — webhook | URL HTTPS temporal comprobada. Otras rutas de API devuelven 404. Listener creado en la misma app Sandbox, leído nuevamente y contrastado con las cuatro suscripciones exactas. ID en `PAYPAL_REFUND_WEBHOOK_ID` y API reiniciada para cargarlo. | Listener preparado; primer evento firmado real corresponde al recorrido integral |

Las pruebas de P0.2 usaron SQL temporal y un doble explícito de PayPal, separados de la aplicación conectada. No acreditan reembolsos Sandbox. La comprobación pública del listener usó una petición vacía rechazada con 422, únicamente para verificar conectividad; no se presenta como evento firmado válido ni registró evidencia financiera.

La comprobación real de las RPC fue de solo consulta: expediente inexistente rechazado con `REFUND_NOT_FOUND` y búsqueda de captura inexistente devolvió `found: false`. No se crearon expedientes ni cobros de prueba en Supabase. Las migraciones contienen las reglas de RLS y permisos ya comprobadas en SQL aislado; no se afirma haber recorrido todavía la interfaz con ambos propietarios contra la base compartida.

## Arranque y duración del listener

Aplicación: `http://localhost:5173/#clientes`.

El arranque habitual sigue siendo:

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

Se corrigió el supervisor para seleccionar la instalación privada de Redis y rechazar versiones incompatibles antes de arrancar. No se cambió el Redis 6379 del sistema ni sus datos.

El gateway admite exclusivamente POST a `/api/v1/refunds/webhooks/paypal`, con límite de 256 KiB. El túnel publica ese gateway, no la API completa. El binario oficial Cloudflare 2026.10.7 se descargó dentro de `.local/cloudflared` y se verificó contra el SHA-256 publicado por GitHub para esa versión.

El registro privado `.local/preparacion-webhook.json` contiene URL e ID actuales. No copiarlo a Git. La URL temporal funciona mientras permanezcan activos túnel, gateway y API; al reiniciar el túnel se debe actualizar el listener Sandbox existente con la URL nueva y comprobar de nuevo las suscripciones. [Cloudflare documenta los túneles temporales](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) y [PayPal documenta el registro y verificación de listeners](https://developer.paypal.com/api/rest/webhooks/rest/).

Suscripciones: `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.FAILED`, `PAYMENT.CAPTURE.REVERSED`. No se reutilizó el ID del checkout. La verificación postback de un evento genuino se validará al recibirlo durante el recorrido Sandbox; no se desactiva para aceptar eventos de demostración.

## Lo que falta hacer desde las cuentas del usuario

1. Confirmar el buzón accesible del cliente de prueba y la cuenta **Personal Sandbox** que utiliza ese mismo correo. Verificar también que la cuenta **Business Sandbox** pertenece a la app/merchant configurados. No compartir contraseñas por chat.
2. Abrir Trato, iniciar sesión y comprobar en el perfil que aparece el Gmail esperado, con lectura y envío disponibles.
3. Crear el proyecto de prueba del caso A, cargar los PDFs preparados, abrir el original y comprobar una cita seleccionable. Esto termina P0.6 y permite anotar el UUID real del proyecto.
4. Preparar la captura inicial Sandbox de USD 10 con `reference_id` y `custom_id` iguales a `initial-{UUID_REAL_DEL_PROYECTO}`. La implementación actual verifica/vincula una captura existente; todavía no crea un checkout inicial. Este paso pertenece a A2 y requiere la aprobación del comprador Sandbox.

La automatización de Windows no pudo inicializarse: el runtime devolvió `sandboxCwd is not a local file URI`. Por ello no se declara comprobada una sesión de navegador ni se manipularon diálogos de autenticación.

PDFs locales, excluidos de Git:

- `.local/prueba-integral-devoluciones/01-acuerdo-sandbox.pdf`: importes previstos y cláusula ficticia de penalidad de USD 3.
- `.local/prueba-integral-devoluciones/02-trabajo-reconocido-sandbox.pdf`: trabajo reconocido USD 9, retención total USD 12 y reparto previsto de devolución USD 6 + USD 12.
- `.local/prueba-integral-devoluciones/03-pedido-cierre-sandbox.pdf`: pedido ficticio para registrar el expediente.

Todos están marcados **PRUEBA SANDBOX**; no representan comunicaciones, cobros ni aceptaciones reales. No adjuntar como evidencia de aceptación de la propuesta final. La aceptación de prueba se registra sobre su versión exacta durante A7.

## Recursos y límites

PostgreSQL temporal y sus sesiones se cerraron después de registrar los resultados. Su runtime y datos sintéticos se eliminan tras esta acta. Los servicios necesarios para la prueba permanecen activos por petición del usuario. No hubo cobros, reembolsos, envíos Gmail, commits, push Git ni PR. Se modificó el esquema compartido únicamente mediante las 11 migraciones de devoluciones enumeradas y se creó el listener en PayPal Sandbox.

La carpeta temporal `.local/preparacion-supabase` fue eliminada por petición del usuario, después de comprobar que ambas migraciones remotas recuperadas permanecen idénticas en la carpeta canónica `repos/trato-api/supabase/migrations`.

El usuario autorizó cerrar todos los recursos propios de esta prueba al finalizar: supervisor y sus servicios, gateway, túnel y métricas; retirar el listener Sandbox dedicado y su configuración temporal; comprobar que los puertos de Trato queden libres. No ejecutar el cierre mientras la prueba siga en curso. Conservar historial financiero y migraciones; no intervenir servicios ajenos.

## Inventario de tablas creadas por las migraciones de devoluciones

Son 23 tablas en `public` y 2 en `private`. El esquema público no implica acceso anónimo: las migraciones establecen RLS y permisos por rol.

| Propósito | Tablas |
| --- | --- |
| Expediente, instantáneas, respaldo e historial | `refund_settlements`, `refund_snapshots`, `refund_sources`, `refund_events` |
| Cobros iniciales/adendas y reparto de liquidación | `project_received_payments`, `refund_settlement_payments` |
| PDF exacto, revisión, envío y respuesta documental | `refund_artifacts`, `refund_reviews`, `refund_deliveries`, `refund_client_responses`, `refund_acceptances`, `refund_feedback` |
| Comprobación y ejecución financiera autorizada | `refund_financial_checks`, `refund_financial_authorizations`, `refund_financial_operations`, `refund_financial_attempts`, `refund_financial_runs`, `refund_financial_observations` |
| Comprobantes, aplicación contable y recuperación | `refund_provider_receipts`, `refund_receipt_applications`, `refund_financial_incidents`, `refund_recovery_checks`, `refund_recovery_consents` |
| Registro interno de comandos y recepción de eventos | `private.refund_commands`, `private.refund_webhook_inbox` |

El identificador del listener dedicado se conserva en la configuración privada. Para consultar sus eventos: [Sandbox Webhooks Events](https://developer.paypal.com/dashboard/webhooks/sandbox), seleccionar la app utilizada por Trato y filtrar fecha/tipo. El registro del listener se consulta desde Apps & Credentials → Sandbox → app → Webhooks. Las consultas GET realizadas por Trato a la API de PayPal no son eventos de webhook. La prueba de conectividad vacía rechazada con 422 tampoco crea un evento en ese panel.

## Identidad del pagador para esta prueba Sandbox

Durante el recorrido el usuario confirmó que su Personal Sandbox usa el correo ficticio generado por PayPal, distinto del buzón de comunicaciones. Se añadió `TRATO_SANDBOX_INITIAL_PAYER_BINDINGS`, un JSON privado de UUID de propietario a correo de pagador, para configurar explícitamente esa identidad de prueba. No contiene valores públicos en el repositorio y se rechaza si `PAYPAL_ENVIRONMENT` no es `sandbox` o el formato es inválido. Un usuario sin correspondencia configurada conserva la comprobación contra el correo de contacto. No se sustituye una identidad por error ni se aceptan correos arbitrarios enviados por el navegador.

La correspondencia se configuró únicamente para el propietario confirmado del proyecto de prueba. El correo de contacto y Gmail no cambian. Siguen verificándose orden, captura completada, merchant, moneda y referencias exactas del proyecto. Cuatro pruebas específicas aprobaron: identidad configurada, aislamiento por propietario, rechazo de otro pagador/merchant y rechazo de configuración inválida o Live, además de las comprobaciones anteriores del pago inicial. El mensaje de error conserva traducción ES/EN.

Esta configuración es una herramienta explícita para ensayos Sandbox, no la implementación de un checkout inicial ni un mecanismo de identidad de pagadores Live. Al cerrar las pruebas se debe retirar también esta correspondencia privada. La vinculación final del cobro se confirma desde la sesión del usuario; el cambio por sí solo no registra otro pago ni ejecuta otro cobro.

## Resultado financiero del caso A — 3 de noviembre de 2026

El usuario ejecutó el reembolso desde la interfaz tras registrar la aceptación y autorización. Consultas posteriores de solo lectura confirmaron:

- PayPal Sandbox: reembolso identificador conservado en evidencia privada, USD 12, `COMPLETED`, contra la captura de la adenda.
- PayPal Sandbox: reembolso identificador conservado en evidencia privada, USD 6, `COMPLETED`, contra la captura inicial.
- Ambas operaciones e intentos en Trato: completados, un intento por operación.
- Resumen contable: USD 18 confirmados, USD 0 reservados, dos comprobantes y dos aplicaciones, cero incidencias.
- Expediente completado y proyecto cerrado.

Antes de ejecutar se reactivó el gateway y el túnel y se actualizó la URL del mismo listener Sandbox, conservando su ID y las cuatro suscripciones. El registro privado contiene la URL vigente. En la consulta inicial posterior a la ejecución, PayPal listó un evento de devolución y el túnel registró una respuesta HTTP 200 al webhook. Esto acredita una recepción atendida, pero todavía no la recepción individual de los dos eventos ni su deduplicación por reenvío. La revisión visual del historial tras recargar y los demás casos del roadmap siguen pendientes. No se presenta este resultado como aprobación de toda la prueba integral. Todos los importes financieros corresponden a Sandbox.

## Cierre de recursos — 3 de noviembre de 2026

Nota posterior: la aplicación se volvió a levantar por petición del usuario para revisar la UX y realizar el caso individual descrito al final. El listener temporal eliminado no se volvió a registrar para ese segundo caso.

Por petición del usuario se detuvieron supervisor, web, API, procesador, worker, consumidor de resultados, Redis privado, gateway y Cloudflare Tunnel. Se comprobó que todos sus procesos terminaron y que los puertos 5173, 6380 y 8100–8103 quedaron sin listeners. Los listeners ajenos en 6379 y DNS se conservaron.

Se eliminó el listener Sandbox dedicado y una consulta posterior confirmó HTTP 404. Se vació `PAYPAL_REFUND_WEBHOOK_ID` y se retiró la correspondencia Sandbox del propietario de este ensayo de la configuración privada. El registro local del listener quedó marcado como inactivo. No queda exposición por ese túnel. Las pruebas pendientes requerirán preparar un listener y arrancar los servicios nuevamente. Se conservaron documentos, migraciones e historial financiero.

## Segunda prueba manual — devolución individual de adenda

3 de noviembre de 2026. El usuario completó el recorrido con la nueva interfaz sobre Proyecto_1. Verificación posterior de solo consulta:

- Adenda: USD 120, orden identificador conservado en evidencia privada, captura identificador conservado en evidencia privada, verificadas contra PayPal Sandbox.
- Expediente `41bbff6c-44f8-44a1-a812-9a6466264302`: alcance `payment_only`, completado y asociado exclusivamente a esa adenda.
- Un intento y una operación completados. PayPal Sandbox confirma el reembolso identificador conservado en evidencia privada, USD 120, `COMPLETED`, contra la captura indicada.
- Resumen contable: USD 120 confirmados, USD 0 reservados, un comprobante, una aplicación y cero incidencias.
- Proyecto_1 conserva su estado previo `draft`; no quedó cerrado. El pago original permanece `completed` y la propuesta mantiene su bloqueo por pago (`locked_at`), sin reabrirse como borrador editable.

Quedan acreditados dos recorridos financieros manuales: cierre global parcial con inicial/adenda e individual total de adenda. No se acredita recepción ni deduplicación de webhooks con este segundo caso: se ejecutó con el listener temporal retirado. Esa comprobación técnica y las variantes no recorridas manualmente conservan sus límites de cobertura. No hubo dinero real ni ejecución adicional durante la verificación.
