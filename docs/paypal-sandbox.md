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
