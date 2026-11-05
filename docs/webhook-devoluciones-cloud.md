# Webhook de devoluciones en cloud

El receptor de devoluciones usa una suscripción Sandbox propia. Un webhook de checkout o uno configurado para un túnel local no sustituye este registro.

## Recorrido

PayPal Sandbox → web HTTPS de Trato → proxy de la web → API privada → verificación de firma con PayPal → consulta del recurso canónico → registro idempotente del resultado.

Ruta pública: `POST /api/v1/refunds/webhooks/paypal` en el origen HTTPS de la instalación. El proxy conserva el cuerpo y reenvía únicamente las cinco cabeceras de verificación de PayPal. También conserva el soporte de `/api/v1/webhooks/paypal` para checkout. No reenvía esas cabeceras a otras rutas ni a variantes de la ruta de devolución.

El receptor no requiere sesión de navegador. Exige la verificación postback del proveedor; una notificación no ejecuta un reembolso nuevo. El flujo financiero existente consulta los recursos reales del proveedor antes de registrar estados.

## Configuración

1. Leer los listeners de la misma aplicación PayPal Sandbox cuyas credenciales usa la API cloud.
2. Comprobar que los cuatro eventos siguientes figuren en el catálogo disponible.
3. Registrar la URL exacta, o reutilizar el registro de esa misma app y URL si su configuración coincide. Si hay duplicados o diferencias, detenerse y revisarlos; no reemplazar otros listeners.
4. Leer de nuevo el listener y verificar URL, ID y suscripciones.
5. Guardar su ID en `PAYPAL_REFUND_WEBHOOK_ID` del entorno privado de API cloud, respaldando antes la configuración. Preservar `PAYPAL_WEBHOOK_ID`, el correo central, las credenciales y los volúmenes existentes.
6. Recargar el servicio de API de Trato y comprobar salud y configuración.

Eventos exactos:

- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.REFUND.PENDING`
- `PAYMENT.REFUND.FAILED`
- `PAYMENT.CAPTURE.REVERSED`

No suscribirse a todos los eventos por comodidad. No copiar el ID del listener local de otro integrante.

## Verificación

Las pruebas HTTP del proxy comprueban que las cabeceras llegan a las dos rutas autorizadas y no se filtran a clientes o rutas parecidas. La comprobación en cloud debe contrastar el registro del proveedor y el ID cargado por API; una petición sin firma debe rechazarse sin modificar datos financieros.

La verificación completa requiere un evento genuino de una devolución Sandbox o el reenvío de uno ya existente en la misma app hacia este listener. Consultar el recibo de procesamiento y comprobar idempotencia sin iniciar otra devolución. Si aún no existe un evento genuino, conservar esa prueba pendiente.

El simulador de PayPal no acredita la verificación postback utilizada por Trato: sus eventos mock no se pueden verificar mediante ese endpoint. No desactivar la firma, sustituir el transporte ni presentar un mock como evento autenticado.

Fuentes oficiales: [integración de webhooks](https://developer.paypal.com/api/rest/webhooks/rest/), [reenvío de eventos](https://developer.paypal.com/api/webhooks/v1/webhooks-events-resend), [simulador y verificación](https://developer.paypal.com/api/rest/webhooks/simulator/).
