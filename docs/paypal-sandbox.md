# PayPal sandbox — adaptador y contrato con P2

24 de octubre de 2026. Implementación aislada del adaptador; no representa una
integración activa ni una transacción sandbox completada.

## Reparto acordado

P1 mantiene `backend/paypal/` y `backend/test_paypal.py`. P2 mantiene las
migraciones, el repositorio `backend/repositories/payments.py`, identidad Supabase
y el montaje HTTP en `backend/api.py`. El contrato compartido lo mantiene P2 en
`docs/contrato-api-integracion-v1.md`.

No se han cambiado archivos compartidos para montar estas rutas. El frontend
actual continúa siendo una simulación; su versión contractual ilustrativa no
permite crear un pago real de sandbox.

## Producto elegido

Checkout Orders v2, `intent=CAPTURE`, inicialmente USD y una cuenta merchant
sandbox configurada para la demostración. No es Invoicing, no envía facturas por
correo y no implementa onboarding de múltiples freelancers o reparto de fondos.

1. Un usuario autenticado solicita el cobro mediante `acceptance_id` e
   `Idempotency-Key`. El backend deriva los datos aceptados desde Supabase.
2. El repositorio valida propiedad, revisión inmutable y evidencia de aceptación/
   firma aplicable, y reserva la operación de manera atómica.
3. El adaptador crea la orden con referencia al `payment_id`, importe exacto y
   merchant configurado. La aprobación abre una URL de PayPal sandbox.
4. Tras aprobación, el servidor consulta la orden y comprueba el estado antes de
   capturar. Una redirección al frontend no confirma aprobación ni pago.
5. La respuesta canónica de PayPal se comprueba contra importe, moneda, merchant,
   referencia y captura. Una captura PENDING se conserva pendiente.
6. Webhooks auténticos disparan conciliación desde PayPal; no se aplican estados
   ciegamente desde el navegador ni desde el evento recibido.

## Código disponible

- `client.py`: OAuth, crear/consultar/capturar órdenes, validar evidencia,
  reconocer captura pendiente y verificar webhooks por postback al API PayPal.
  El host de operaciones está fijado a `api-m.sandbox.paypal.com`.
- `service.py`: operaciones de negocio independientes de FastAPI. Las entradas
  monetarias del navegador no forman parte de `create`.
- `repository.py`: protocolo de datos y operaciones transaccionales a implementar
  por P2. No ofrece un almacén en memoria para producción.
- `test_paypal.py`: pruebas con transporte falso y repositorio de prueba, sin
  credenciales ni llamadas externas.

Entradas del servicio: `create(user_id, acceptance_id, idempotency_key)`,
`get(user_id, payment_id)`, `capture(user_id, payment_id)`,
`reconcile(user_id, payment_id)` y `webhook(headers, event)`.

El servicio devuelve `PaymentRecord`. La capa API transforma ese registro al DTO
público, con `updated_at`, sin publicar claves de idempotencia del proveedor,
credenciales, datos de otros propietarios o detalles internos de leases.
`PayPalError` contiene `code`, `status` y `uncertain`; la capa HTTP debe convertirlo
al formato de errores acordado.

## Persistencia, concurrencia y reintentos

Las reservas devuelven un token de lease y una revisión de fencing. Finalizar o
marcar incierta una operación exige la revisión esperada y el token aplicable.
`completed` nunca debe degradarse por una consulta vieja, timeout o webhook
atrasado. Una consulta sin lease sigue usando CAS por revisión.

Cada resultado lleva un `evidence_key` estable que permite aplicar estado e
historial en una transacción sin duplicar hechos si se cae después de aplicar
el resultado y antes de completar el webhook.

Los eventos distinguen adquirido, procesado y en curso. Procesado se confirma;
en curso devuelve un error reintentable. No basta con reservar un evento y
contestar éxito antes de que termine el primer procesador.

Si crear orden queda incierto sin guardar `order_id`, solo se puede reclamar y
reintentar con el MISMO `create_request_id` dentro de la ventana de retención
válida del proveedor que configuremos. Fuera de esa ventana debe bloquearse y
conciliarse: no generar otra orden. El servicio conserva la reserva y no inventa
una segunda identidad. Esta recuperación depende de la implementación de P2.

El repositorio debe generar y persistir IDs por operación admitidos por PayPal;
las pruebas no verifican concurrencia de una base real. No mantener una
transacción de Postgres abierta durante una llamada HTTP a PayPal.

## Configuración pendiente en el servidor

La capa de montaje deberá leer, sin exponerlas al navegador:

- `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET` de una aplicación sandbox.
- `PAYPAL_MERCHANT_ID` de su cuenta Business sandbox.
- `PAYPAL_WEBHOOK_ID` de un listener asociado a esa aplicación sandbox.
- URLs de retorno/cancelación definidas por la aplicación, no por el usuario.

No se cargan ni crean estas credenciales por añadir este módulo. No pegarlas en
el chat ni subirlas al repositorio. Para el webhook real se necesita un endpoint
HTTPS accesible; las pruebas del simulador de webhooks no equivalen a eventos
vinculados a una orden real y no usan necesariamente la misma verificación.

## Comprobaciones ejecutadas y pendientes

Ejecutadas con datos falsos: creación con importe/merchant/referencia exactos,
idempotencia delegada, timeout sin nueva orden, bloqueo de aceptación simulada o
adicional cero, captura solo tras aprobación verificada, PENDING distinto de
pagado, discrepancias de evidencia, URL de aprobación solo sandbox, firma de
webhook obligatoria y deduplicación, aislamiento de propietario.

```bash
.venv/bin/python -m unittest discover -s backend -p 'test_paypal.py'
```

Pendientes: pruebas de repositorio/CAS/RLS concurrentes; montar Auth/rutas;
configurar cuentas sandbox de vendedor/comprador; ejecutar crear → aprobar →
capturar → consultar → webhook real; comprobar el historial persistido y
recuperación ante interrupción. No hubo pagos ni solicitudes reales a PayPal.

## Fuentes primarias

- Orders v2: https://developer.paypal.com/api/orders/v2
- Idempotencia: https://developer.paypal.com/api/rest/reference/idempotency/
- Webhooks: https://developer.paypal.com/api/rest/webhooks/rest/

## Correo de cobro al cliente

El producto elegido es Orders/Checkout: crear una orden no envía por sí mismo
nuestro correo de solicitud al cliente. Trato tendrá un paso separado para revisar
el destinatario y enviar el enlace. No requiere leer el buzón Gmail; Gmail puede
ser simplemente el proveedor del destinatario.

Código preparado:

- `backend/paypal/email.py`: mensaje multipart y transporte SMTP opcional con TLS;
  modo sin cifrado solo para un capturador local en loopback. No hay configuración
  ni envío habilitados por defecto.
- `backend/paypal/notifications.py`: protocolo de outbox separado y servicio
  independiente del framework. P2 debe revisar e implementar su persistencia.
- `payment-api.js`: cliente HTTP para la API acordada, con JWT e idempotencia,
  sin enviar importes ni destinatarios arbitrarios en la solicitud de cobro/email.
- `payment-panel.js`: vista previa explícitamente simulada, accesible al terminar
  una adenda de demo; muestra correo y estados, sin enlaces de pago operativos.

Ruta propuesta, todavía sin montar:
`POST /api/v1/payments/{id}/notifications/email`, JWT propietario e
`Idempotency-Key`, cuerpo vacío. Resolver contacto autorizado, importe y URL desde
el pago/aceptación en BD. Solo habilitar después de revisión humana y para pago
conectado pendiente de aprobación. Una aceptación simulada no puede enviarlo.

El outbox debe reservar una notificación y marcar `sending` antes de SMTP con
lease y revisión. Un timeout tras DATA o un crash tras aceptación SMTP puede ser
incierto: revisar en vez de reenviar ciegamente. Un Message-ID estable no garantiza
que SMTP elimine duplicados. Aceptado por SMTP no significa entregado al buzón,
recibido ni leído por la persona. Enviar un correo tampoco confirma un pago.

Configuración futura de SMTP: host, puerto, dirección remitente y, si procede,
usuario/contraseña en servidor. Credenciales solo en entorno/gestor de secretos.
Probar primero con Mailpit o transporte falso, sin enviar a direcciones reales.
El proveedor SMTP puede tener cuotas/costos propios; no se presupone envío gratis.

Estado: 13 pruebas unitarias de PayPal/correo con dobles; pruebas del cliente HTTP
sin backend real. No hubo envío SMTP, cobro, configuración de Gmail ni alta de
proveedor. Faltan outbox/rutas de P2, credenciales y prueba end-to-end autorizada.

La vista previa de cobro conserva su estado por solicitud en el guardado local
IndexedDB del prototipo. Tras completar el pago de prueba muestra Ver pago,
sin ofrecer crear/enviar otro cobro del mismo adicional. La API real no debe
confiar en ese estado del navegador: Supabase y PayPal verificado siguen siendo
las fuentes autoritativas del modo conectado. Los nuevos módulos web a empaquetar
son payment-api.js y payment-panel.js.

## Router autenticado preparado para trato-api

`backend/paypal/routes.py` ofrece
`build_router(payment_service, notification_service, require_user)`, usando la
dependencia de usuario validado que provea P2. No está montado en el servidor
Node ni en la aplicación de P2 por añadir este archivo. P2 controla el montaje y
la configuración real del repositorio. Si no hay servicio configurado devuelve
503, sin sustituirlo por uno falso. CORS deberá admitir `Idempotency-Key`.

Pruebas de rutas: seis casos con servicios dobles y sin red; verifican identidad,
cuerpo mínimo, campos monetarios no admitidos, DTO sin claves privadas, ausencia
de envío si SMTP no está configurado y verificación de proveedor en webhook.
Se ejecutaron con FastAPI 0.135.1/httpx 0.28.1 del Python disponible; falta probar
el paquete contra el lock definitivo de trato-api antes de su montaje.

```bash
python3 -m unittest discover -s backend -p 'test_paypal_routes.py'
```

Para comprobar configuración sin revelar secretos:

```bash
python3 -m backend.paypal.check_sandbox
```

Para la primera prueba **real de conexión**, después de configurar las variables
en el entorno y autorizar esa prueba:

```bash
python3 -m backend.paypal.check_sandbox --check-auth
```

Este segundo comando contacta solo OAuth sandbox, nunca crea una orden y no
imprime el access token. La revisión actual encontró ausentes client ID, secret
y merchant ID; no hizo llamadas a PayPal. La conexión OAuth no acredita todavía
aceptación, persistencia, checkout, captura ni webhooks end-to-end.

## Refuerzo posterior al primer snapshot polyrepo

Archivos a portar desde el original al paquete de trato-api: `client.py`,
`service.py`, nuevo `config.py` y `backend/test_paypal.py`. P2 fue avisado; no se
editaron sus repositorios ni esquema desde P1.

- El transporte no sigue redirecciones HTTP que puedan reenviar credenciales.
- OAuth exige respuesta estructurada y expiración positiva finita.
- Consulta, captura y conciliación comprueban propietario/ID también en el
  servicio, además de la autorización obligatoria del repositorio.
- `SandboxSettings` lee variables del servidor sin incluir secretos en repr.
  `build_payment_service` rechaza un repositorio ausente y el entorno live.
- Variables añadidas al contrato de configuración: `PAYPAL_RETURN_URL`,
  `PAYPAL_CANCEL_URL`, `PAYPAL_ENVIRONMENT=sandbox`. La factory solo construye
  objetos; no hace llamadas a PayPal.

El bloque PayPal/correo ahora tiene 17 pruebas aisladas aprobadas; las 6 pruebas
previas de router siguen siendo un conjunto separado. No confundir esas pruebas
con ejecución sandbox ni validación de la base de datos real.

## Correo de cobro con adenda PDF · 24 de octubre de 2026

El generador MIME permite un PDF adjunto opcional (`PdfAttachment`) de hasta 10 MB, con nombre seguro y SHA-256 del contenido. Mantiene cuerpo de texto y HTML con importe, referencia y enlace de aprobación de PayPal sandbox. Se comprueba cabecera/tamaño/hash para integridad del adjunto; esto no verifica la firma ni la validez del acuerdo.

`NotificationContext.agreement` puede proporcionar un `AgreementEmailDocument` resuelto en backend desde almacenamiento privado. Antes de reservar o enviar, el servicio exige coincidencia exacta de dueño, proyecto, aceptación y versión contractual, además del ID de pago. El hash de idempotencia incluye ID de documento, versión, nombre y SHA-256; cambiar el adjunto cambia el comando. El repositorio persistente debe rechazar una misma clave con distinto comando. Los pagos completados no pueden enviar otra solicitud de pago.

Este incremento está únicamente en el adaptador original `backend/paypal/`; debe trasladarse coordinadamente a la copia API. No añade una ruta para adjuntar un archivo arbitrario desde el navegador ni configura OAuth o envío real. SMTP existente puede transportar el mensaje completo cuando esté configurado. La resolución persistente del adjunto y la outbox siguen pendientes.

Para enviar desde la cuenta Gmail del freelancer hace falta autorización OAuth separada de su login a Trato. Gmail admite mensajes MIME con adjuntos codificados como base64url en `raw`, mediante `users.messages.send`. Pedir solo el permiso necesario para envío (`gmail.send`) cuando se implemente esa conexión; no asumir acceso a lectura de la bandeja. Fuentes: https://developers.google.com/workspace/gmail/api/guides/sending y https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send .

Validación local: `python -m unittest discover -s backend -p 'test_payment_documents.py'` cubre serialización y bytes del PDF, rechazo de adjuntos inválidos, aislamiento por proyecto/aceptación/versión, hash del comando, compatibilidad sin adjunto y pagos completados. No contacta proveedores ni envía mensajes.

## Dos correos y revisión humana explícita

Decisión de producto confirmada por Sebastian: el análisis de IA no envía mensajes. El freelancer revisa la alternativa, importe, fecha y PDF; solo después elige «Enviar adenda al cliente». El primer envío contiene una **propuesta de adenda pendiente de aceptación**, no un cambio ya aceptado ni una solicitud de pago. El cliente puede aceptar, pedir ajustes o rechazar; modificar la propuesta requiere una nueva revisión, conservando la anterior.

1. `ProposalEmail` contiene alcance revisado, adicional (puede ser USD0.00), fecha propuesta, referencia y PDF. No tiene campo de enlace de pago. Solicita devolver el documento firmado o indicar ajustes por correo.
2. `ProposalNotificationService` exige propuesta conectada, revisión humana previa (`ready_for_review`) y documento del mismo dueño/proyecto/revisión. Reserva en una outbox específica de propuesta antes del transporte. Enviar no crea aceptación ni pago.
3. La recepción y validación/registro de la aceptación ocurren en otro paso, aún pendiente de conexión; no se infieren al enviar el correo ni al abrirlo.
4. El segundo correo usa `PaymentNotificationService` con aceptación conectada y pago pendiente de aprobación. Adicional0 rechaza envío de cobro antes de reservar la outbox. La adenda aceptada puede acompañar este segundo correo.

Ruta opcional añadida al factory original: `POST /api/v1/proposals/{proposal_id}/notifications/email`, JWT obligatorio, UUID de propuesta e `Idempotency-Key`, cuerpo vacío. No acepta destinatario, precio ni URL/bytes de adjunto del navegador. `build_router(..., proposal_notification_service=...)` conserva compatibilidad; sin servicio responde503. El repositorio persistente de propuestas y la outbox deben ser inyectados por API, con revalidación atómica del estado/revisión al reservar. Este incremento no implementa las tablas ni conecta Gmail.

Archivos originales que deben trasladarse coordinadamente a API: `email.py`, `notifications.py`, `proposal_notifications.py`, `routes.py`. Pruebas locales: 9 de propuesta, 8 de adjuntos de cobro, 17 de PayPal/correo y 8 de rutas; 42 aprobadas. Transportes dobles/locales solamente, sin envíos ni llamadas a proveedores. Gmail OAuth, persistencia y conexión del botón siguen pendientes.

## Punto de continuación · 25 de octubre de 2026

Sebastian priorizó continuar la configuración de PayPal sandbox. Aún no hay valores PAYPAL_CLIENT_ID, CLIENT_SECRET, MERCHANT_ID, WEBHOOK_ID, RETURN_URL ni CANCEL_URL en la configuración privada de API. Siguiente paso con él: acceder al Developer Dashboard y seleccionar Sandbox en Apps & Credentials. Guiar un paso por vez; guardar secretos localmente, nunca pedir pegarlos en chat.

La migración `repos/trato-api/supabase/migrations/20261025165753_proposal_lifecycle.sql` es un **borrador local en preparación, no aplicado ni validado**. No hay todavía rutas/repositorio de dominio montados para esas tablas. El diseño fue coordinado con P2: revisión inmutable y fuentes exactas, cabeza/generación de acuerdo solo avanza por aceptación explícita, sin confundir una fuente inicial con contrato aceptado.

Regla nueva persistida en AGENTS.md: ningún fallback sin autorización explícita. Fallar visiblemente en vez de sustituir proveedor/modelo/transporte/datos o usar simulación como respaldo.

### Credenciales sandbox guardadas y autenticación real comprobada

25 de octubre de 2026. Sebastian completó el JSON privado `.local/paypal-sandbox-credentials.json`; se importaron PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET y PAYPAL_ENVIRONMENT=sandbox a `.env` de API con permisos0600, conservando Gmail y otras variables. No se mostraron valores secretos.

Se llamó exclusivamente `POST https://api-m.sandbox.paypal.com/v1/oauth2/token`: HTTP200, token con expiración válida. No se imprimió ni guardó el token y no se crearon órdenes, capturas o envíos. Este resultado acredita credenciales aceptadas por sandbox; no acredita integración de cobros completa.

Siguiente con el usuario: revisar los nombres de campos de Sandbox account info para configurar la identidad de la cuenta vendedora (PAYPAL_MERCHANT_ID). RETURN_URL, CANCEL_URL y WEBHOOK_ID siguen pendientes; los servicios conectados aún no se montan sin repositorio autoritativo. La migración de dominio sigue como borrador no aplicado.

### Identidad de vendedor sandbox configurada

Sebastian proporcionó el Account ID de su cuenta Business sandbox. Se guardó PAYPAL_MERCHANT_ID en la configuración privada de API, manteniendo el resto y permisos0600. El saldo mostrado de USD5000 pertenece al entorno de prueba; no es dinero real. Faltan RETURN_URL, CANCEL_URL, WEBHOOK_ID y la persistencia/montaje del flujo. No se crearon órdenes ni capturas. Siguiente preparación con usuario: identificar cuenta Personal sandbox distinta para actuar como comprador.

## Seguimiento único coordinado con P2 · 25 de octubre de 2026

Sebastian pidió expresamente no duplicar estados mientras P2 diseña la lista de cambios. La vista de negocio acordada es: Pedido guardado → Propuesta en preparación → Adenda en borrador → Esperando respuesta → Ajustes solicitados (si procede) → Aceptación por revisar → Pendiente de pago → Finalizado. Lista: título, estado, versión vigente y siguiente acción; detalle con historial de todas las revisiones.

La integración PayPal aporta evidencia financiera; sus estados técnicos se guardan en el registro de pago y se proyectan a ese seguimiento, sin otra lista de negocio competidora. Pendiente de pago exige aceptación de la revisión exacta revisada por humano y adicional>0. Solo captura COMPLETED verificada por PayPal (referencia/importe/moneda/merchant correctos) finaliza un cambio con adicional. Una aceptación revisada de importe0 finaliza sin crear cobro. PENDING, timeout, cancelación o volver del checkout no finalizan ni prueban pago. PDF recibido por sí solo sigue en Aceptación por revisar.

Usuario autorizó una prueba sandbox de USD0.10. A esta altura solo se verificó OAuth; no se creó orden ni se aprobó/capturó pago. Antes de modificar UI o persistencia de estados, coordinar con P2 y respetar su flujo único.

## Prueba explícita de conexión USD0.10 desde el perfil

Se añadió `trato_api/sandbox_payment.py` y su router para una prueba técnica autorizada por Sebastian, independiente de propuestas/aceptaciones. No fabrica una aceptación ni marca ningún proyecto/cambio como pagado. El importe es fijo USD0.10 y el comprador debe aprobar en su cuenta Personal sandbox.

El perfil carga `sandbox-checkout.mjs`. Las rutas JWT `/api/v1/sandbox/paypal-test`, `/capture` y `/reconcile` usan un almacén SQLite local privado separado (`PAYPAL_TEST_STORE`), con una sola prueba por usuario y IDs de creación/captura estables. También conserva el resultado al recargar y evita crear otra orden si cambia la clave del navegador. No hay llamadas a correo.

Variables explícitas: `TRATO_PAYPAL_TEST_ENABLED=true`, `PAYPAL_TEST_RETURN_URL`, `PAYPAL_TEST_CANCEL_URL` y `PAYPAL_TEST_STORE`. Las URLs apuntan a `paypal-sandbox-return.html`, dedicado a esta prueba, sin reutilizar el callback como si fuera el futuro flujo contractual. Las variables PAYPAL_RETURN_URL/CANCEL_URL del dominio siguen pendientes. El callback comunica el regreso; el backend consulta PayPal antes de capturar y verifica referencia, moneda, importe, vendedor y captura. PENDING/timeout/cancelación no significan pago completado. Una captura incierta solo admite consulta, no recaptura automática.

Es una herramienta local de prueba, proceso API único; no sustituye la persistencia contractual en Supabase ni habilita aceptar/finalizar adendas. Pruebas de dominio9 y navegador específico1 aprobadas con dobles. Validación OAuth previa realHTTP200. El resultado de crear/aprobar/capturar una orden real de sandbox se documentará aparte.

### Primera orden sandbox creada · 25 de octubre de 2026

Tras autorización explícita del usuario para pruebaUSD0.10, se creó la orden real de sandbox `6VA592034E322405A`, referencia local `df5e03d2-ba7b-4bd8-872b-35ef152375f7`, estado `pending_approval`. Se asoció al usuario de Trato identificado por su conexión Gmail previamente autorizada, sin extraer/fabricar JWT ni crear aceptación contractual. Una sola prueba por usuario; reabrir o cambiar clave no crea otra orden. No hay captura ni pago completado todavía.

El usuario debe abrir Trato→perfil→Probar pago de US$0,10→Abrir PayPal sandbox, iniciar sesión él mismo con su cuenta Personal sandbox y aprobar. El callback y el botón Verificar pago consultan PayPal y capturan solo si la orden está realmente aprobada. No se usan credenciales de comprador desde el agente.

Validación: suiteAPI84 y npm28 aprobados; navegador18 aprobadas (incluye prueba de checkout interceptado). Supervisor actualsesión72576, puertos5173/8000/8001. Esta prueba no modifica la tabla de8estados del cambio ni los prototipos de P2. Dominio contractual y envíos reales por proyecto siguen pendientes. No se publicó el código nuevo aGitHub en esta etapa.

### Pago sandbox completado y contrastado con PayPal · 25 de octubre de 2026

El usuario aprobó manualmente con la cuenta Personal sandbox. La orden `6VA592034E322405A` quedó `completed` en el almacén local. Una consulta independiente GET a PayPal confirmó captura `9HB1402829366804P` con estado `COMPLETED`, importe USD0.10 y coincidencia exacta de referencia, moneda y merchant. El ID de captura coincide con el guardado en Trato. Esta comprobación no ejecutó otra captura ni envió correos.

Queda verificado el recorrido técnico real de sandbox: crear orden → aprobación humana en PayPal → captura del servidor → consulta y estado persistido. Es una prueba de conexión separada de proyectos/adendas; no acredita el recorrido contractual ni cambia los ocho estados de negocio. Siguiente: persistencia autoritativa de propuestas/aceptación/outbox/pagos y envío de correo con enlace al cobro correspondiente a la versión aceptada.


### Integración de adendas, 25/10/2026

Se aplicaron migraciones `proposal_pdf_artifacts` y `proposal_delivery_payments`. El backend reserva una sola orden por aceptación de la revisión vigente; guarda el resultado verificado y bloquea el cambio pagado. Rutas de propuesta: POST `/api/v1/proposals/{id}/revisions/{revision}/payment`, POST `.../reconcile`; callback separado del diagnóstico en `/paypal-payment.html`. El retorno no acredita pago: GET canónico y validación de captura, importe, moneda y merchant. La clave exclusiva `SUPABASE_SERVER_KEY` fue verificada con consulta de solo lectura a un registro inexistente. No se creó una orden contractual ni se envió correo durante esa comprobación.

La primera propuesta de RPC con secreto compartido accesible por roles públicos fue rechazada por revisión automática. Se reemplazó por funciones privadas y wrapper invoker ejecutables solo por `service_role`; no hay secreto compartido alternativo ni comandos financieros disponibles para anon/authenticated. Pruebas SQL con fixtures y rollback verifican reserva única, importe exacto, bloqueo durante pago, captura única y no regresión de un pago completado. No equivalen a una captura contractual real.

Lectura actual de la cuenta conectada: no había propuestas guardadas ni cliente con `usuario@example.com`. Por tanto, sigue pendiente preparar/revisar la adenda y enviarla; no se inventó aceptación para crear un cobro.
