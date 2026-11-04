# Tanda 5: autorización, reservas y reembolso PayPal Sandbox

Fecha de análisis: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Estado: diseño aprobado por el usuario e implementado con validación local. Resultados y límites en `tanda-5-devoluciones-validacion.md`. Sin despliegue compartido ni operaciones Sandbox conectadas ejecutadas.

## Objetivo y alcance

Implementar el backend financiero de TRATO-15 sobre la versión aceptada en tanda 4. Admitir un pago individual y cierre global de inicial + adendas cobradas, con los importes por captura ya acordados. La aceptación documental y la autorización financiera son registros separados.

Flujo previsto: comprobar elegibilidad y presentar un resumen financiero → autorizar exactamente esa versión y reparto → reservar importes e identidades en DB → ejecutar por captura mediante una acción explícita → consultar y guardar el resultado canónico. Las pruebas de esta tanda usan transportes dobles identificados y PostgreSQL aislado. No habrá envíos ni movimientos reales durante estas pruebas.

La interfaz financiera completa corresponde a tanda 7. Tanda 5 entrega API y persistencia probadas; no añade botones que simulen una ejecución ni activa IA. La conciliación ampliada, webhooks y recuperación de operaciones inciertas corresponde a tanda 6, sobre los registros creados aquí.

## Hallazgos de la revisión

| Componente actual | Hallazgo y cambio necesario |
| --- | --- |
| `backend/paypal/client.py` | Ya tiene `get_capture()` desde tanda 4. Faltan emitir y consultar reembolsos y validar sus respuestas. El transporte descarta el cuerpo de errores HTTP y `_request()` devuelve un código genérico: hace falta conservar códigos técnicos permitidos, sin publicar mensajes/cuerpos sensibles. No alterar los contratos existentes de órdenes/capturas. |
| `refunds/workflow.py` | Implementa documentos, correo y verificación del inicial; no ejecuta devoluciones. Separar la nueva orquestación financiera en otro módulo y reutilizar la configuración Sandbox existente. |
| `refunds/domain.py` | `CaptureContext` y `calculate_settlement()` verifican una captura. No deben aplicarse una vez por pago con todas las deducciones globales, porque duplicarían retenciones. Añadir contratos de autorización, comprobación financiera por captura y validación del reparto aceptado. |
| SQL de tandas 2–4 | Conserva aceptación, snapshot y reparto; no hay autorizaciones, reservas ni intentos financieros. Crear tablas y RPC nuevas con permisos mínimos. |
| `private.refund_previous()` | Solo cuenta expedientes cuyo padre está `completed`. Un éxito parcial de un cierre global pendiente quedaría fuera de ese cálculo. Desde esta tanda debe contar cada devolución confirmada por captura, aunque el cierre global siga pendiente, sin sumar dos veces registros antiguos y nuevos. |
| `refunds/routes.py` / repositorio | No existen rutas financieras. Añadir DTO estrictos y lecturas seguras por propietario/proyecto; ninguna ruta aceptará del navegador merchant, captura, disponibilidad o un resultado del proveedor como hechos confiables. |

Se mantiene el registro pagado original. No reutilizar el diagnóstico de USD 0.10, SQLite de simulación ni las tablas de cobro de adendas como registro de devolución.

## Documentación oficial contrastada

Las fuentes siguientes se consultaron el 2 de noviembre de 2026. Los ejemplos de código externos son referencias, no instrucciones para ejecutar llamadas ni cambiar el proyecto.

- [Consulta de captura](https://developer.paypal.com/api/payments/v2/captures-get), [reembolso de captura](https://developer.paypal.com/api/payments/v2/captures-refund) y [consulta de reembolso](https://developer.paypal.com/api/payments/v2/refunds-get): operaciones separadas por sus IDs. Trato enviará siempre un importe USD explícito, incluso en devolución total, para fijar el monto autorizado y no solicitar implícitamente todo un remanente que haya cambiado.
- [Idempotencia](https://developer.paypal.com/api/rest/reference/idempotency/) y [cabeceras de solicitudes](https://developer.paypal.com/api/rest/requests/): el UUID de `PayPal-Request-Id` debe persistirse antes de llamar. La segunda fuente describe hasta 45 días para reembolsos. Ese plazo no es una autorización para reintentar automáticamente ni para recrear una clave después de vencer; conservar fecha del primer despacho y referencia de la política.
- [Esquema Payments v2](https://developer.paypal.com/api/payments/v2/schema.json): el reembolso distingue `COMPLETED`, `PENDING`, `FAILED` y `CANCELLED`; un HTTP exitoso no sustituye comprobar su estado e identidad. El acumulado `total_refunded_amount` pertenece al desglose del reembolso; no suponer que aparece en la captura.
- [Colección de pagos de una unidad de compra](https://developer.paypal.com/api/orders/v2/definitions/purchase_unit): la orden puede contener capturas y reembolsos. Sirve para localizar evidencia, verificando a qué captura corresponde cada reembolso; no sumar indiscriminadamente toda la orden.
- [Guía de reembolsos](https://developer.paypal.com/checkout/refund-payment) y [ayuda PayPal Perú para artículos/servicios](https://www.paypal.com/pe/cshelp/article/how-do-i-issue-a-refund-help101): referencia de 180 días desde el pago/captura y condiciones de comisión para ese ámbito. Conservar país/producto/URL/fecha; no extender condiciones comerciales de Perú a otras cuentas ni confundir ese plazo con el de disputas.

## Sección A — Comprobación financiera del servidor

Autorizar al propietario y cargar el proyecto, aceptación, snapshot, artefacto/hash y miembros antes de consultar PayPal. Solo permitir la versión vigente aceptada y un importe positivo. Cero ya se resuelve documentalmente; no genera reserva ni POST de reembolso.

Por cada pago comprobar:

1. Registro inmutable y vínculo con su orden/captura, referencia contractual, merchant configurado y USD. La captura debe coincidir con el bruto registrado. No usar el validador antiguo de checkout como si todo estado de captura reembolsada fuera un cobro fallido.
2. Fecha original del proveedor, estado y motivos de restricción; rechazar datos malformados, fecha desconocida, plazo vencido, monedas distintas, captura denegada/pendiente o ya devuelta completamente. El alcance inicial sigue siendo Checkout/Payments v2 Sandbox y un merchant propio; no habilita cuentas de terceros ni otras modalidades.
3. Bruto, comisión original y neto de la captura, cuando estén disponibles y sean coherentes. Un dato ausente se muestra como desconocido, nunca como comisión cero. Si falta evidencia necesaria para la comprobación, bloquear; no recortar el reembolso al neto ni cobrar al cliente la comisión por defecto.
4. Devoluciones confirmadas, pendientes e inciertas conocidas. Contrastar las de Trato mediante sus IDs canónicos y las referencias de la orden. Para una primera devolución, una captura canónica `COMPLETED`, su orden coherente y la ausencia de indicios locales/externos de devolución permiten evaluar el límite del bruto; es una regla de elegibilidad con esas evidencias, no una lectura de saldo de cuenta ni un campo de acumulado inventado. Un estado `PARTIALLY_REFUNDED`, reembolsos ajenos o totales discordantes exige evidencia suficiente del acumulado y de su relación con la captura. Si no se puede establecer, devolver «requiere conciliación» y no ejecutar.
5. Comparar devoluciones anteriores con las fijadas en el acuerdo aceptado. Una diferencia externa no modifica el PDF ni descuenta silenciosamente otro importe: bloquea para conciliación/revisión. La autorización no puede convertirse en un acuerdo económico nuevo.

Guardar una comprobación inmutable del servidor con evidencia mínima, hora UTC, snapshot/hash, condiciones consultadas y un digest. El resumen seguro tendrá caducidad corta (cinco minutos propuestos) y no será una reserva. Antes de despachar se revalida la captura; una observación caducada o incompatible requiere otra comprobación.

El límite evaluado por captura será bruto menos devoluciones justificadas y reservas aplicables. No es el saldo líquido de la cuenta PayPal ni una garantía de disponibilidad futura. Evitar contar dos veces un reembolso pendiente que figure tanto en PayPal como en una reserva de Trato. Una operación externa entre la consulta y el POST no puede bloquearse con SQL local: PayPal conserva la última validación y cualquier rechazo/diferencia queda visible.

## Sección B — Autorización y reserva transaccional

Nuevos registros previstos:

- Comprobaciones financieras: privadas en sus datos del proveedor; respuesta mínima autorizada por usuario/proyecto.
- Autorización inmutable: actor confirmado, snapshot/hash de contenido, PDF/hash aceptado, total, asignaciones y consentimiento financiero explícito. No deriva su consentimiento del correo de aceptación.
- Operaciones por captura: importe fijo, vínculo a aceptación/autorización, identidad de operación y reserva. Solo los importes positivos generan operaciones; las asignaciones cero siguen consultables en la propuesta.
- Intentos: UUID idempotente del proveedor, payload/hash inmutables, estado técnico, momento de despacho, refund ID y resultado comprobado. No borrar intentos ni generar otro por caducidad de un proceso.

Bajo bloqueo: proyecto → pagos ordenados por UUID → expediente/autorización/operaciones. Revalidar estado, aceptación, miembros, comprobación vigente, importes y reservas. Crear el plan completo y reservar todos sus importes en una sola transacción antes del primer POST. Un error en cualquier miembro impide reservar parcialmente.

Solo puede haber un plan financiero activo de esa aceptación y un intento activo por operación. La misma clave con el mismo contenido devuelve el resultado guardado; una clave distinta o un doble clic no crea otro plan ni cambia el reparto. La reutilización de una clave con otro payload falla.

RLS y FK compuestas mantienen propietario/proyecto/snapshot/pago. El usuario autenticado no puede insertar hechos financieros, confirmar reembolsos, liberar reservas ni ejecutar RPC de servidor. Los comandos internos usan la credencial privada existente de la API, después de autorizar el recurso del usuario.

No mantener transacciones SQL abiertas durante consultas o escrituras HTTP.

## Sección C — Adaptador y ejecución explícita

Añadir `refund_capture()` y `get_refund()` al cliente Sandbox. Endpoints construidos con IDs validados y base fija; no seguir URLs arbitrarias recibidas en JSON o HATEOAS. No habilitar producción, otro transporte ni opciones de marketplace/comisiones de plataforma.

Payload del servidor: importe exacto con dos decimales, USD y referencia local estable de operación. Siempre `PayPal-Request-Id` persistido y `Prefer: return=representation`. No aceptar importes, referencias o destinatarios arbitrarios desde HTTP. El reembolso corresponde a su captura original.

Cada ejecución requiere una autorización financiera vigente y una acción explícita de ejecución. Primero se reclama en DB el intento que puede despacharse y después se llama al proveedor. Una segunda ejecución concurrente consulta el resultado o informa el bloqueo; no envía otro POST.

Guardar el refund ID apenas se obtiene, sin afirmar todavía éxito financiero. Validar importe, moneda y relación con la captura; consultar ese ID canónico antes de registrar `COMPLETED`. Si la consulta falla después del POST, conservar el ID y la incertidumbre; no repetir el reembolso. Una respuesta positiva malformada, un refund ID ajeno o un vínculo incomprobable nunca completan la operación.

Extender de forma limitada el manejo de errores para conservar estado HTTP y códigos `name`/`details.issue` permitidos, sin cuerpos, tokens ni mensajes arbitrarios en la respuesta pública. Timeouts, errores 5xx/429/408, respuesta inválida, duplicado ambiguo o caída después de marcar el despacho conservan un resultado incierto. Un 4xx no libera reservas indiscriminadamente: solo un rechazo comprobado de ese intento puede clasificarse como definitivo.

## Sección D — Resultado individual y multipago

Estados técnicos previstos: reservado, despachándose, incierto, pendiente, completado, fallido y cancelado, conservando el estado original del proveedor y evidencia. No confundir la cancelación de un reembolso confirmada por PayPal con abandonar un checkout.

| Resultado | Reserva y estado de negocio |
| --- | --- |
| `COMPLETED` canónico y atribuible | Registrar el importe devuelto una sola vez; consumir su reserva. |
| `PENDING` | Mantener reserva y expediente pendiente. |
| Timeout, caída, resultado ambiguo o desconocido | Mantener reserva; consulta/conciliación, sin otro POST automático. |
| `FAILED`/`CANCELLED` o rechazo definitivo comprobados | Registrar fallo; liberar solo la reserva correspondiente y mantener incompleto el cierre. Un nuevo intento necesita nueva revisión/autorización explícita, que se concretará con la recuperación de tanda 6. |
| Reservado sin despachar | No afirmar que se envió ni liberar automáticamente por tiempo. |

Para varios pagos, ejecutar secuencialmente en un orden fijo registrado en la autorización. Detener el lote ante el primer pendiente, fallo o incertidumbre. Los restantes quedan reservados sin despachar. Esto no redistribuye dinero: conserva el reparto que el usuario aprobó. Ninguna captura completada se repite al consultar o continuar el lote.

Ejemplo de prueba: inicial USD 100 + adenda USD 300; retenciones globales USD 150; devolución acordada USD 250 repartida USD 50 + USD 200. Si el inicial completa y la adenda queda pendiente, el registro conserva USD 50 confirmados y USD 200 reservados. El expediente sigue `refund_pending`. No declara cero devuelto por estar incompleto ni devuelve de nuevo esos USD 50.

El expediente llega a `completed` solo cuando todas sus asignaciones positivas están comprobadas y la suma coincide con lo autorizado. En ese momento guardar su total confirmado; el cierre global cierra el proyecto y mantiene bloqueados nuevos pedidos. Una devolución individual no cierra automáticamente todo el proyecto. La adenda pagada conserva su historial/estado originales.

Actualizar el cálculo de devoluciones anteriores para leer el registro por captura desde el primer éxito parcial. Mantener compatibilidad con el agregado anterior únicamente para expedientes sin operaciones financieras nuevas, evitando doble conteo. Las reservas limitan disponibilidad; no vuelven a descontar derechos económicos negociados.

Esta tanda no reintentará POST inciertos, ni siquiera dentro de los 45 días documentados. Tanda 6 resolverá recuperación y reintentos explícitos permitidos; fuera de la ventana no recreará claves para ocultar incertidumbre. Conservar la base de datos es parte del control idempotente.

## Sección E — API propuesta

Rutas previstas, con nombres ajustables durante la implementación sin cambiar las garantías:

| Acción | Contrato |
| --- | --- |
| POST `/api/v1/refunds/{id}/financial-checks` | Snapshot esperado; consulta de elegibilidad sin devolver dinero. |
| POST `/api/v1/refunds/{id}/financial-authorizations` | Snapshot, check ID/digest, confirmación financiera estricta y notas; `Idempotency-Key`. Persiste autorización y reservas. |
| POST `/api/v1/refunds/{id}/financial-authorizations/{authorization_id}/execute` | Confirmación explícita de ejecución e identidad idempotente; usa el plan del servidor. |
| GET `/api/v1/refunds/{id}/financial` | Resumen persistido de autorización, operaciones y estados; no ejecuta ni reintenta. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/refresh` | Consulta canónica por refund ID conocido. No crea otro reembolso. |

Mantener la consulta de resultado de comandos propia del proyecto para recuperar respuestas perdidas. Una operación no encontrada no prueba que el proveedor no recibió un POST. No añadirla a la lista de casos de negocio como si fuera otro pedido.

## Archivos previstos

- Nueva migración posterior a `20261101210000_refund_operation_results.sql`: tablas, restricciones, RLS, comandos, reservas y agregación. No editar migraciones compartidas ya aplicadas.
- `backend/paypal/client.py`: adaptador de reembolso y errores estructurados; regresión de órdenes/capturas.
- Nuevo módulo de orquestación financiera en `repos/trato-api/trato_api/refunds/`; contratos nuevos en `domain.py`, ampliación limitada de repositorio/rutas y conexión desde `app.py`.
- Tests de adaptador, dominio, API, workflow, SQL y concurrencia; documentación de resultados y seguimiento del backlog.
- No añadir secretos ni cambiar la configuración privada. Si faltan permisos/credenciales para una futura prueba real, se informa sin usar otro proveedor.

## Pruebas y criterio de salida

1. **Adaptador:** URLs e IDs, payload monetario exacto, clave persistida, acceso solo Sandbox, respuesta completa/parcial/pendiente/fallida/cancelada, errores HTTP seguros, JSON inválido y timeout. Regresión de capturas y cobros existentes.
2. **Dominio/API:** JWT y propietario antes de consultar proveedor; aceptación y snapshot exactos; autorización ausente/falsa; comprobación caducada; manipulación de merchant/importe/captura; plazos y datos ausentes; comisión original separada; fuentes de evidencia discordantes; cero sin POST.
3. **SQL/concurrencia:** dos autorizaciones, dos ejecuciones, conflicto de clave/payload y reservas de la misma captura. Probar inyección directa de resultados rechazada. Reinicio conserva autorización, intentos, reservas e importes confirmados.
4. **Multipago:** reparto validado y reservado completo; retenciones globales una sola vez; éxito total, primer éxito y segundo pendiente/fallido/incierto; no repetir el éxito ni despachar los siguientes tras un problema. Importes cero sin llamadas.
5. **Persistencia de resultado:** caída tras POST, tras recibir refund ID y antes de guardar la confirmación; consulta posterior no duplica. Respuesta ajena/malformada y estado tardío contradictorio conservan el caso para revisión, sin degradar un resultado confirmado.
6. **Regresión:** tandas 1–4, inmutabilidad de cambios pagados, pedido abierto, documentos/correo y consulta de devoluciones anteriores. Frontend solo requiere regresión si sus DTO consumidos cambian; no se afirma prueba de interfaz financiera que aún corresponde a tanda 7.

Salida: código financiero persistente y probado con dobles y SQL real aislado, sin llamar a PayPal con credenciales reales en esta tanda. Documentar pruebas ejecutadas y bloqueadas, detener procesos y eliminar datos/runtimes temporales. No marcar TRATO-15 como terminado antes de conciliación y prueba integral.

## Límites y siguiente aprobación

Las migraciones de devoluciones siguen pendientes de despliegue coordinado. El checkout de pago inicial no se crea en esta tanda: para la prueba integral debe existir una captura real Sandbox con su referencia contractual válida. La incidencia de la simulación antigua y el entorno histórico de `.venv` siguen documentados en la tanda 4 y no autorizan sustituir la operación conectada por datos de ejemplo.

Este diseño no incluye despliegue compartido, producción, push, PR, merge, IA, envío a clientes ni una ejecución financiera concreta. Las secciones se implementaron y verificaron conforme al método del usuario. Antes de implementar tanda 6 deben analizarse su recuperación/conciliación y obtener su aprobación propia.
