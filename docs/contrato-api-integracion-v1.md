# Contrato de integración v1 — propuesta paral equipo y el equipo

24 de octubre de 2026. Frontera y reparto confirmados con el equipo en esta fecha; endpoints y tablas descritos todavía no implementados. Protocolo Python acordado en `backend/paypal/repository.py`; repositorio persistente y validación de BD pendientes.

## Responsabilidades y archivos

Actualización de arquitectura: el responsable del proyecto eligió separar cuatro repositorios. La primera API está en `repos/trato-api/trato_api/app.py`, con una copia explícita del paquete PayPal del equipo y su router montado sin servicio configurado. El repositorio de pagos aún no está implementado. Las rutas y responsabilidad de datos de este contrato se conservan; los paths `backend/` siguientes documentan el reparto inicial durante la transición. Ver `arquitectura-polyrepo.md` para estado y límites reales.

- el equipo: PayPal sandbox, creación/captura/consulta, autenticidad de eventos, idempotencia de operaciones y presentación de estados de pago.
- el equipo: Supabase Auth, entidades de negocio normalizadas, documentos privados, propuestas/aceptaciones, análisis con fuentes y LangGraph.
- el equipo mantiene este contrato y es el único responsable de migraciones/repositorio de pagos y eventos. Preparará la API Python en `backend/api.py` (FastAPI) y el repositorio en `backend/repositories/payments.py`; la adopción de dependencias y el montaje en la aplicación se implementarán después. No reescribe la migración inicial ni modifica frontend, `server.mjs`, `workflow-bridge.mjs` o `backend/workflow.py` durante esta coordinación.
- el equipo trabaja en `backend/paypal/`, `backend/test_paypal.py` y `docs/paypal-sandbox.md`. Su servicio Python será independiente del framework y recibirá contexto de usuario validado por la API del equipo. el equipo prepara primero el protocolo de repositorio para cerrar sus métodos con el equipo. Ninguno modifica archivos compartidos hasta acordar su montaje.
- Las tablas de pagos y eventos se diseñan con el equipo y las migral equipo. No mantener una segunda base de pagos desconectada de Supabase.
- Primer recorrido con un único merchant sandbox configurado. Comprobar y persistir destinatario/merchant esperado; el onboarding de cuentas comerciales por freelancer queda fuera de este bloque.

## Identidad, IDs y dinero

Rutas públicas bajo `/api/v1`. Peticiones de usuario con `Authorization: Bearer <access_token Supabase>`, validado por backend. El propietario se deriva del token y el recurso persistido; no se acepta `owner_id` como autoridad desde el cuerpo.

IDs de negocio UUID. `proposal_id`, `proposal_revision_id`, `acceptance_id`, `agreement_version_id`, `payment_id` y el ID externo de PayPal son identidades distintas. El `payment_id` es estable y propio de Trato.

Importes como cadenas decimales exactas y moneda explícita, inicialmente USD: `{"amount":"125.00","currency":"USD"}`. El backend valida precisión y límites. Una propuesta aceptada fija importe, moneda, alcance y revisión; la UI y el LLM no pueden sobrescribirlos al crear el cobro. Datos estructurales en tablas/columnas; JSON se reserva para metadatos y evidencia del proveedor.

## Recursos públicos propuestos

| Método y ruta | Responsable | Finalidad |
|---|---|---|
| GET `/api/v1/proposals/{id}` | el equipo | Consultar propuesta, revisión y decisión autorizadas |
| POST `/api/v1/payments` | el equipo + repositorio el equipo | Crear o recuperar una operación de cobro del acuerdo aceptado |
| GET `/api/v1/payments/{id}` | el equipo + repositorio el equipo | Consultar estado persistido y autorizado |
| POST `/api/v1/payments/{id}/capture` | el equipo | Intentar captura tras aprobación del comprador; verificar resultado con proveedor |
| POST `/api/v1/payments/{id}/reconcile` | el equipo | Consultar proveedor y reconciliar una operación incierta, sin crear otra |
| POST `/api/v1/webhooks/paypal` | el equipo | Verificar evento PayPal y aplicar una transición idempotente |
| GET `/api/v1/projects/{id}/events` | el equipo | Historial persistente con fuentes y referencias a pagos |

Producto confirmado con el equipo: PayPal Checkout Orders v2, `intent=CAPTURE`. Crear orden → aprobación del comprador → captura en servidor. Invoicing queda fuera de este recorrido.

Crear pago requiere `Idempotency-Key` y un cuerpo mínimo:

```json
{"acceptance_id":"<uuid>"}
```

El servidor obtiene de la aceptación la revisión y versión contractual, comprueba que se cumplen las condiciones de cobro y deriva el importe. La respuesta incluye:

```json
{
  "data": {
    "id":"<payment_uuid>",
    "project_id":"<project_uuid>",
    "acceptance_id":"<acceptance_uuid>",
    "amount":"125.00",
    "currency":"USD",
    "status":"pending_approval",
    "provider":"paypal",
    "environment":"sandbox",
    "approval_url":"<URL devuelta por PayPal>",
    "updated_at":"<ISO-8601 UTC>"
  }
}
```

No se admite crear desde una aceptación simulada ni derivar aceptación de la salida del modelo. Una opción sin adicional responde con un error de dominio `PAYMENT_NOT_REQUIRED`, sin crear orden PayPal. No confundir aprobación del cambio, aprobación del comprador en PayPal, captura completada y disponibilidad de fondos.

## Frontera interna entre módulos

el equipo proveerá una interfaz de repositorio; la forma de invocarla (funciones o API interna) se acuerda con el equipo para no acoplarla al transporte ni abrir endpoints administrativos públicos:

1. Resolver aceptación cobrable con contexto del usuario: dueño, proyecto, revisión inmutable, versión contractual, importe y moneda, con evidencia validada.
2. Reservar una operación pendiente de forma atómica por aceptación/propósito e idempotencia; devolver la existente si corresponde. Guardar un hash del comando para detectar claves reutilizadas con datos distintos.
3. Persistir referencia externa y transiciones condicionadas a la revisión/estado esperado. Aplicar resultado y evento de historial dentro de una transacción.
4. Reservar eventos por proveedor/ID externo único y comprobar si ya fueron procesados.

el equipo provee el adaptador PayPal: autenticación con proveedor, creación/captura/consulta, verificación de webhooks y traducción de respuestas. el equipo y el equipo acuerdan restricciones únicas en BD y una estrategia de conciliación ante caída después de que PayPal complete una operación pero antes de que se guarde su resultado.

No se mantiene una transacción SQL abierta durante llamadas de red a PayPal. Los trabajos reservados, referencias e idempotencia permiten reintentar y reconciliar sin duplicar efectos. El webhook no usa JWT del usuario: autentica al proveedor y resuelve el pago desde referencias previamente guardadas.

La interfaz interna acordada usa `PaymentRecord` con revisión y fecha persistidas, `OperationClaim` con token y caducidad de reserva, y `VerifiedOrder` con una clave de evidencia para deduplicar historial. Las escrituras comparan revisión y token cuando corresponda; un proceso con reserva vencida no puede sobrescribir otro resultado. Los webhooks distinguen `acquired`, `processed` e `in_progress`; este último requiere reintento en lugar de confirmar procesamiento. El código fuente del protocolo define las firmas de métodos. el equipo reportó nueve pruebas aisladas con transporte falso; esas pruebas no acreditan funcionamiento del repositorio Supabase ni del recorrido completo.

## Estados y errores

Estados acordados de una operación: `creating`, `pending_approval`, `approved`, `capturing`, `pending`, `completed`, `failed`, `reconciliation_required`. `cancelled` solo se incorporará para un hecho autoritativo; visitar `cancel_url` no demuestra cancelación. el equipo concretará correspondencia con los estados del proveedor. Registrar por separado intentos, hechos externos y su fecha; el orden de recepción de webhooks no establece el orden del negocio. Una captura pendiente no significa pagado y un webhook atrasado no puede degradar un pago completado.

Solo un resultado verificado del proveedor puede producir `completed`. Redirección de navegador, mensaje del cliente o salida de IA no confirman el pago. El pago completado se refleja en un evento con IDs de aceptación, revisión contractual, solicitud y documentos fuente.

Errores estables: `{"error":{"code":"ACCEPTANCE_NOT_PAYABLE","message":"La aceptación aún no habilita un cobro.","request_id":"<id>"}}`. No incluir secretos ni respuestas completas sensibles del proveedor.

- 401: identidad ausente/inválida.
- 404: recurso inexistente o sin acceso, sin revelar otro propietario.
- 409: revisión obsoleta, transición incompatible o clave de idempotencia reutilizada con otro comando.
- 422: aceptación no cobrable, importe inválido o pago no requerido.
- 502/503: fallo o indisponibilidad externa; si el resultado es incierto, conservar la operación para conciliación.

## Evolución y comprobaciones

Añadir campos compatibles mediante migraciones y respuestas aditivas; los clientes ignoran campos desconocidos. Cambios incompatibles requieren nueva versión del contrato. No guardar todo el dominio en un JSON para evitar migraciones.

Validar al integrar: dueño cruzado; propuesta modificada tras aceptación; aceptación simulada; adicional cero; doble clic; reintento tras timeout; webhook repetido o desordenado; captura pendiente; discrepancias de importe/moneda/destinatario; recuperación de historial tras reinicio. el equipo y el equipo deben acordar además las credenciales y cuentas sandbox de prueba sin poner secretos en el repo.
