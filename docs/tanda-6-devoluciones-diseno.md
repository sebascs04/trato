# Tanda 6: conciliación, webhooks e historial único

Análisis: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Estado: implementación aprobada explícitamente por Gianfranco y preparada localmente; resultados y límites de verificación en `tanda-6-devoluciones-validacion.md`. Este documento no acredita conciliación implementada, endpoint publicado ni una operación financiera ejecutada.

## Objetivo y frontera con tanda 7

Completar la recuperación técnica de TRATO-15 y la proyección de sus hitos a TRATO-16: eventos verificados, estado canónico, devoluciones externas, intentos recuperables y dinero contabilizado una sola vez por captura.

Esta es la última tanda de backend antes del recorrido integral. La tanda 7 también incluye terminar la interfaz financiera —autorización, ejecución, consulta y recuperación—, aplicar coordinadamente las migraciones y validar el recorrido conectado en la aplicación. No se considera que esa interfaz ya exista por entregar estas API.

El código de tanda 6 se probará con proveedores dobles identificados, PostgreSQL aislado y navegador para el historial modificado. No se harán reembolsos, registros de webhook, publicaciones ni cambios en infraestructura compartida durante estas verificaciones.

## Hallazgos de la revisión

| Código actual | Adaptación necesaria |
| --- | --- |
| `refunds/financial.py` | `refresh()` exige un refund ID conocido. Falta localizar referencias perdidas, resolver ejecuciones interrumpidas y coordinar recuperación concurrente sin despachar otra captura por error. |
| `refund_financial_attempts` | `operation_id` es único: admite un solo intento para siempre. Sustituir esa restricción por historial de intentos y exclusión de intentos activos, preservando payload, request ID y evidencia anteriores. |
| Comandos financieros SQL | Un `bind` solo permite el estado `dispatching`; una ejecución caída permanece `running`. Añadir comandos de recuperación específicos, sin usar un timeout como prueba de que no se envió dinero. |
| `backend/paypal/client.py` y copia en API | Ya hay verificación por postback mediante `verify_webhook()`, pero `RefundFinance.provider()` no configura un webhook ID. Conectarlo de forma explícita para devoluciones y mantener ambas copias equivalentes. |
| `app.py` y `paypal/routes.py` | `/api/v1/webhooks/paypal` depende del servicio antiguo, que la aplicación monta como no disponible. No acredita recepción de eventos de devolución. Crear un receptor de devoluciones separado y configurado; no registrar dos handlers para la misma ruta. |
| `persistence.py:activity()` / `connected-workspace.mjs` | El historial solo proyecta cambios y agrupa mediante `request_document_id`. Incorporar expedientes de devolución con identidad propia; no disfrazar el UUID de una devolución como si fuese un documento de pedido. |
| `private.refund_previous()` | Ya cuenta éxitos locales parciales. Ampliar la fuente canónica por refund ID para incorporar dinero externo sin duplicarlo cuando después se vincule a un intento local. |

No modificar adendas pagadas, aceptación contractual, PDFs, deducciones o distribución acordados para resolver un fallo técnico.

## Fuentes oficiales contrastadas

Consultadas el 2 de noviembre de 2026; los ejemplos externos son datos de referencia, no órdenes para ejecutar llamadas.

- [Eventos PayPal](https://developer.paypal.com/api/rest/webhooks/event-names/): considerar `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING` y `PAYMENT.REFUND.FAILED`. `PAYMENT.CAPTURE.REVERSED` requiere tratar una reversión como incidencia, sin convertirla en reembolso autorizado. No inventar eventos de completado/cancelación de reembolso que no figuran en esta lista.
- [Integración y verificación de webhooks](https://developer.paypal.com/api/rest/webhooks/rest/): el webhook ID corresponde al listener registrado. Elegimos el postback ya usado por el adaptador. Los eventos ficticios del simulador no se validan mediante ese método; no se habilitará una excepción para aceptarlos. El listener real necesita HTTPS accesible; la guía describe reentregas ante respuestas no exitosas, por lo que deduplicar y persistir antes de reconocer es necesario.
- [Consulta canónica de reembolso](https://developer.paypal.com/api/payments/v2/refunds-get) y [pagos/reembolsos de la orden](https://developer.paypal.com/api/orders/v2/definitions/purchase_unit): usar IDs y referencias como evidencia, no una coincidencia de importe/fecha. Una colección vacía no demuestra que una solicitud incierta jamás llegó.
- [Cabeceras e idempotencia](https://developer.paypal.com/api/rest/requests/): el ejemplo oficial de reembolso describe hasta 45 días para reutilizar la identidad. No es permiso para repetir automáticamente ni para crear otra identidad al vencer. La política local fijará un límite conservador dentro de esa ventana y comprobará el vencimiento antes del despacho.

## A — Registro canónico y evolución de intentos

Crear mediante migración nueva:

- Bandeja privada de webhooks: ambiente/app/listener, event ID, hash del cuerpo y verificación, estado de procesamiento y errores seguros. Un mismo ID con otro contenido se rechaza como conflicto; no sobrescribe el evento verificado.
- Registro canónico de reembolsos del proveedor: refund ID único por ambiente/merchant, captura, moneda, importe, estado y evidencia seleccionada de consulta. Puede existir antes de conocerse su relación con un expediente local.
- Relaciones entre comprobantes e intentos/operaciones; una misma devolución del proveedor no suma dos veces por descubrirla primero como externa y después como local.
- Historial de intentos y revisiones de coordinación. La operación conserva la asignación aceptada; cada intento fija su propio importe pendiente, payload, referencia y request ID antes de HTTP. Solo puede existir un intento financiero activo/incierto por operación.
- Acciones de recuperación y nuevos consentimientos financieros: actor, versión, intento esperado, digest, motivo y clave idempotente. No se reconstruye consentimiento desde correos ni estados de interfaz.

Conservar el intento de tanda 5 y su referencia `custom_id` original. Un intento nuevo tras fallo definitivo utiliza una referencia propia que permita distinguirlo de los anteriores; nunca reescribe sus payloads. Un replay del intento incierto conserva exactamente su referencia y `PayPal-Request-Id`.

Migrar los éxitos locales comprobados a la fuente canónica sin volver a sumarlos. Los registros heredados sin refund IDs conservan su evidencia anterior y requieren revisión si no puede descartarse un doble conteo con un comprobante externo; no enlazarlos por importe.

Mantener FK compuestas, RLS, permisos mínimos y bloqueos proyecto → capturas ordenadas → expediente/operación/intento. No abrir una transacción SQL durante HTTP.

## B — Receptor de webhooks de devolución

Ruta propuesta: POST `/api/v1/refunds/webhooks/paypal`. Registrar el listener real y sus suscripciones será una acción posterior coordinada; no se ejecuta por aprobar código.

Configuración explícita propuesta: `PAYPAL_REFUND_WEBHOOK_ID`, correspondiente a esta URL y a la app Sandbox. Sin ese valor, mostrar integración no configurada; no reutilizar silenciosamente el ID de otro listener. No cambiar los callbacks de checkout ni los de Gmail.

Procesamiento:

1. Leer un cuerpo limitado y validar esquema, ID, versión/tipo de recurso y cabeceras de transmisión. No requiere sesión del navegador; requiere verificación del proveedor. Las rutas de consulta/recuperación sí requieren JWT de usuario.
2. Verificar por postback contra el endpoint fijo Sandbox y el webhook ID configurado. Si falta configuración, falla la consulta de verificación o la firma no es válida, no modificar hechos financieros. No descargar ni seguir URLs arbitrarias del payload y no introducir otro método de verificación como respaldo.
3. Persistir/deduplicar el evento verificado y reclamar su procesamiento. Resolver dueño, proyecto y captura mediante registros propios; no confiar en un owner o project ID recibido en el cuerpo.
4. Usar el evento como aviso para consultar el recurso canónico. Identificar el refund ID según el tipo/versión real del recurso: no asumir que todo `resource.id` es una captura o que siempre es un reembolso. Validar relación con captura, merchant, moneda e importe antes de aplicar.
5. Guardar el resultado y terminar el evento. Un error de DB o proveedor deja procesamiento pendiente y responde como fallo, sin declarar aplicado. Una reentrega retoma esa misma evidencia; no inicia un reembolso.

Un evento `PENDING` antiguo no degrada un `COMPLETED` comprobado. Un evento de fallo recibido tarde tampoco modifica otro intento más reciente. Las contradicciones se registran como incidencias y motivan consulta; no borran dinero confirmado. Un evento ajeno/no aplicable no revela datos de cuentas en la respuesta pública.

La bandeja se atiende de forma acotada en el receptor y mediante consulta explícita; no añade un worker de IA ni un scheduler que reintente dinero. La recuperación por GET debe seguir disponible aunque se agoten las reentregas de PayPal.

## C — Conciliación de pendientes e incertidumbre sin ID

Separar consulta de recuperación y escritura financiera.

### Consulta sin devolver dinero

- Si hay refund ID, consultar ese recurso y comprobar su relación con el intento exacto.
- Si falta, obtener candidatos desde la orden y los eventos verificados, y consultar cada candidato permitido mediante el endpoint fijo.
- Para vincular un ID perdido automáticamente exigir referencia exacta del intento (`custom_id` persistido), captura, merchant, USD e importe. La validación actual permite que la referencia falte al consultar un ID ya conocido; la recuperación sin ID debe exigirla.
- Cero candidatos no prueba rechazo; varios candidatos o una referencia ausente son ambiguos. Conservar reserva y estado de revisión, sin inventar un ID ni escoger por importe/fecha.
- Reclamar la conciliación bajo bloqueo, comparar la revisión del intento al aplicar y conservar observaciones repetidas sin duplicar dinero. Las ejecuciones antiguas deben quedar impedidas de reclamar otra captura después de que la recuperación haya tomado el control. Una respuesta canónica tardía del mismo intento se conserva y no se usa para autorizar un intento nuevo.

### Replay explícito del mismo intento

Esta acción puede iniciar el reembolso si el primer POST nunca llegó. Por eso debe distinguirse de «consultar» y exigir nueva confirmación financiera del usuario.

Permitirlo únicamente cuando se conservan la autorización, el payload/hash y la identidad originales, no hay otro intento activo o conflicto externo, y se está dentro de la ventana de idempotencia validada para este endpoint, con margen local conservador. Volver a comprobar antes de transmitir; un proceso antiguo tampoco puede despachar fuera de ese límite.

Reutilizar la misma captura, importe, moneda, referencia y request ID. No generar un UUID nuevo, recortar el importe ni redistribuirlo. Serializar solicitudes de replay: si hay otra en curso, consultar o informar el bloqueo. Un error de duplicado/timeout continúa incierto hasta obtener prueba canónica.

Fuera de la ventana, con evidencia insuficiente, datos perdidos o discrepancia externa, se permite consulta y revisión manual; no otro POST ni una reserva liberada por antigüedad. El sistema no promete resolver automáticamente un caso que PayPal no permite atribuir.

### Ejecuciones interrumpidas

Distinguir miembros reservados aún no despachados de intentos despachados/inciertos. Cerrar o sustituir un registro de coordinación no demuestra que el POST falló y no libera su reserva. Aplicar control de revisión/token para que un handler antiguo no reclame el siguiente miembro del lote. Un timeout de coordinación solo habilita revisar, no repetir un efecto financiero.

## D — Reembolso externo y nuevo intento tras fallo

Un reembolso externo verificado se registra una sola vez como movimiento de la captura. No se le atribuye la aceptación de Trato ni se completa su expediente por igualdad de importe. Se mantiene la distinción entre lo devuelto en PayPal y lo aplicado a esta liquidación.

Si el usuario quiere aplicar ese comprobante a la liquidación, necesita revisión explícita de versión, operación y refund ID. El servidor verifica propiedad, estado `COMPLETED`, captura, moneda, importe no superior al pendiente y ausencia de una aplicación previa o intento incierto que pudiera devolver lo mismo. El navegador no aporta el importe como hecho confiable. Una asociación contable no ejecuta dinero ni altera el PDF aceptado.

Cuando queda un saldo pendiente tras un comprobante parcial aplicado, o tras un `FAILED`/`CANCELLED` definitivo:

1. Resolver todos los intentos anteriores; no crear otro mientras uno pueda haber devuelto dinero. Una declaración humana de que «no ocurrió» no sustituye esa prueba.
2. Consultar captura y comprobantes, y calcular el pendiente de la asignación aceptada sin repetir deducciones, comisiones ni devoluciones previas. La operación conserva su total acordado; el nuevo intento solo puede cubrir el pendiente exacto por esa captura.
3. Presentar una comprobación/digest nuevos y exigir consentimiento financiero explícito para ese intento. Guardar payload, referencia e identidad nuevos antes de ejecutar. Conservar todos los intentos anteriores.
4. Reservar sin duplicar las reservas de los reembolsos pendientes del proveedor que ya estén vinculados a Trato. Una devolución externa pendiente no libera una obligación local ni se aplica como dinero confirmado.
5. Si la evidencia muestra un importe superior al acordado, conservar el hecho financiero y abrir una incidencia. No rechazar/ocultar una devolución real para hacer cuadrar el presupuesto ni marcar un cierre sin diferencias.

El plazo vencido de un intento incierto no es un fallo definitivo que habilite una identidad nueva. Ninguna de estas acciones modifica una adenda pagada ni la distribución entre capturas aceptada por el cliente.

## E — Historial único de negocio

Extender GET `/api/v1/projects/{id}/activity` y su render existente. Identificar cada grupo por tipo e ID propios (`change` o `refund`); conservar referencias documentales reales. Paginar las consultas necesarias para no perder hitos silenciosamente y mantener el contrato consumido por el historial.

Proyectar solo hitos respaldados: solicitud, propuesta enviada, ajustes revisados/nueva versión cuando corresponda, aceptación documental, autorización financiera, devolución confirmada y cierre. Los borradores internos no se presentan como nuevas versiones enviadas.

El movimiento monetario se identifica por el comprobante canónico; no se duplica por un webhook repetido, un refresh o por pasar de externo a vinculado. El cierre agregado se muestra como cierre, sin volver a sumar el dinero de sus capturas. Un éxito parcial aparece por su importe comprobado aunque el expediente siga pendiente.

Timeouts, rechazos HTTP, reentregas y detalles de coordinación permanecen en los registros financieros; no generan otra lista de estados de negocio ni otro feed. No añadir cancelaciones de checkout. Los nuevos textos, ayudas e hitos del historial tendrán ES/EN mediante los catálogos y `uiText()`; fechas y moneda por locale, iconos Lucide y contenido del cliente sin traducir.

## Rutas y archivos previstos

| Acción propuesta | Efecto |
| --- | --- |
| POST `/api/v1/refunds/webhooks/paypal` | Verificación del proveedor y consulta canónica; no ejecuta devoluciones. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/reconcile` | Búsqueda y conciliación por usuario autorizado, incluso sin ID. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/replay` | Confirmación explícita del mismo intento y misma identidad, solo dentro de las condiciones descritas. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/external-receipts` | Revisión y aplicación de comprobante externo verificado, sin transferir dinero. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/retry-authorizations` | Nuevo consentimiento y reserva del pendiente tras prueba definitiva y comprobación vigente. La ejecución permanece explícita. |
| GET `/api/v1/refunds/{id}/financial` y consulta de comandos | Mostrar intentos, evidencia segura, discrepancias y resultados actuales; no reintentar por leer. |

Implementación prevista:

- Migraciones posteriores a tanda 5: inbox, comprobantes, aplicaciones, historial de intentos, consentimientos de recuperación y comandos con control de concurrencia. No editar migraciones ya aplicadas.
- Módulo de conciliación/webhook en `trato_api/refunds/`; adaptación limitada de `financial.py`, dominio, rutas, repositorio y conexión en `app.py`.
- Ambos adaptadores PayPal, manteniendo equivalencia; configuración explícita del listener en `.env.example`, sin publicar valores privados.
- Proyección de actividad y `connected-workspace.mjs`, catálogos ES/EN, pruebas y documentación. El formulario financiero completo sigue en tanda 7.

## Verificación por secciones

1. **Persistencia:** migraciones desde cero y evolución de registros de tanda 5; RLS, escritura directa denegada, FK y un intento activo. Reinicio conserva referencias, consentimientos, reservas e historial.
2. **Webhook:** firma inválida/configuración ausente/verificación caída; evento enorme/malformado, duplicado y mismo ID con cuerpo distinto; recursos de otro ambiente/cuenta, llegada antes de guardar refund ID, eventos fuera de orden y fallo después de persistir. Ningún evento dispara un POST financiero.
3. **Recuperación:** ID conocido, perdido con referencia exacta, referencia ausente y múltiples candidatos; respuesta perdida, proceso antiguo aún ejecutándose y carrera webhook/refresh/reconcile. GET fallido no inventa rechazo ni libera reserva.
4. **Replay:** consentimiento falso/ausente, identidad/payload alterados, plazo límite y vencimiento, dos replays concurrentes y caída tras POST. Nunca usar una identidad nueva ante incertidumbre.
5. **Fallo definitivo y dinero externo:** intento nuevo sin heredar el ID anterior; comprobante externo total/parcial/pendiente, aplicación duplicada/ajena, exceso y discrepancias. Verificar el pendiente sin doble descuento y sin repetir capturas completadas.
6. **Multipago:** inicial completado + adenda pendiente/fallida/incierta; reanudar solo lo pendiente con autorización correspondiente. El padre no completa hasta justificar la cobertura y ausencia de diferencias del cierre.
7. **Historial y regresión:** un único feed, grupos separados sin IDs documentales falsos, hitos idempotentes y valores confirmados; ES/EN y móvil en Chromium; propuestas, Gmail y pagos originales conservados. Suites API/SQL de tandas anteriores y pruebas de concurrencia.

Las pruebas usarán dobles explícitos y SQL real temporal. El simulador de webhook no se presentará como firma válida de una transacción Sandbox. La prueba de recepción real depende de HTTPS y suscripciones configuradas y se coordina con tanda 7. Al terminar se detienen los recursos propios y se borran datos/capturas temporales tras documentar resultados.

## Criterio de salida y aprobación

Backend capaz de conciliar dinero confirmado y recuperar intentos con evidencia, sin duplicar devoluciones, con webhook verificado e historial único. Los casos sin prueba suficiente permanecen bloqueados de forma visible; no se cierran para aparentar éxito.

No autoriza deploy, registro remoto de un listener, cambios de credenciales, producción, push, PR, merge, envíos o una operación financiera concreta. La implementación de las acciones de replay/reintento se prueba con dobles; utilizarlas en Sandbox conectado requiere consentimiento para esa operación.

Conforme al método solicitado por el usuario, procede aprobar este diseño antes de tocar código. Después se implementa/verifica cada sección y se presenta el resultado antes de iniciar tanda 7.
