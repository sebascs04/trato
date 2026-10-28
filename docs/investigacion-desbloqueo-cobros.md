# Investigación: entregué y todavía no me pagan

27/10/2026. Investigación solicitada por Sebastian antes de decidir una automatización. No implica implementación, envíos, activación de seguimiento, contratación ni cambios en pagos.

## Evidencia y límites

- OSBC, caso de dos consultorías IT: dos meses tras vencimiento; el organismo contactó al director financiero y se realizaron pagos inmediatos. Evidencia de un resultado particular con intervención institucional; no prueba que un bot, un correo o Trato logren el mismo resultado. https://www.smallbusinesscommissioner.gov.uk/success-stories/it-consultant/
- OSBC, negocio de fotografía: trabajo usado por cliente e invoice aceptada; meses de gestiones sin pago. La intervención del organismo resolvió el impago en una semana. No atribuir a recordatorios automáticos ni extrapolar tasa de éxito. https://www.smallbusinesscommissioner.gov.uk/success-stories/photography-business/
- OSBC recomienda identificar destinatario de facturación (puede diferir de quien encargó trabajo), confirmar calendario y fecha de pago, pedir PO cuando el cliente lo exige y describir el trabajo/importes/términos correctamente. Son recomendaciones profesionales, no ensayo causal. No importar plazos o reglas tributarias británicas a Perú. https://www.smallbusinesscommissioner.gov.uk/help-and-guidance/all-advice/getting-invoices-right/
- Freelancers Union describe reunir contrato, comunicaciones, trabajo e invoices para su clínica legal y posibles requerimientos formales. Ese servicio y derechos corresponden a su contexto; Trato podría ordenar evidencia, pero no sustituir a abogados ni emitir amenazas/intereses inventados. https://blog.freelancersunion.org/2026/05/07/stiffed-by-a-client-heres-how-to-get-paid/
- PayPal Invoicing ya ofrece seguimiento y recordatorios; API permite crear borradores, enviar y recordar invoices. No confundir con Orders v2 actualmente usada en Trato ni tratar una invoice PayPal como comprobante fiscal peruano. Viabilidad/permisos/cuenta/sandbox de Invoicing deben comprobarse antes de adoptarla. https://developer.paypal.com/invoicing/about/ y https://developer.paypal.com/api/invoicing/v2/
- Relatos de freelancers aconsejan pedir fecha concreta, identificar destinatario de pagos y registrar última gestión/próxima acción; varios hilos incluyen promociones de productos. Son señales de investigación, no pruebas de efectividad ni fuentes para porcentajes. https://www.reddit.com/r/Freelancers/comments/1wuua61/freelancers_how_do_you_handle_unpaid_invoices_and/ y https://www.reddit.com/r/freelancing/comments/1vsupaf/payment_and_invocing_with_clients/

## Hipótesis para Trato

El valor candidato es seguimiento contextual: distinguir falta de datos administrativos, ausencia de respuesta, una fecha prometida y una objeción al trabajo. No inferir una causa a partir del silencio. El sistema propone una acción sustentada y pide aclaración si falta información.

1. Comprobar acuerdo, entrega, condiciones, destinatario e importe, con citas y fechas reales.
2. Consultar pago asociado y verificado. No considerar «ya pagué» como comprobación del proveedor. Una verificación fallida detiene el seguimiento, sin tratarla como impago confirmado.
3. Preparar una gestión específica: pedir referencia faltante, confirmar destinatario o pedir fecha concreta. Usuario revisa y autoriza envío.
4. Si el cliente propone una fecha, registrarla como promesa revisable, nunca como pago ni aceptación. Proponer próxima acción basada en ella.
5. Antes de cada gestión, volver a consultar estado de pago y revisar respuestas; detener ante pago confirmado y pedir revisión ante disputa, pago externo no conciliado o incertidumbre. No duplicar recordatorios nativos de PayPal y Gmail.
6. Preparar expediente de evidencias para revisión humana si se decide escalar; no contactar terceros ni iniciar acciones legales automáticamente.

Automatizar cálculos de fechas, consulta, preparación y organización es separable de autorizar mensajes o dinero. Sebastian no ha aprobado una cadencia ni destinatarios para envíos automáticos por esta investigación.

Ejemplo ilustrativo: saldo acordado300; cliente dice que falta su referencia interna para procesarlo. Trato propone pedirla al contacto confirmado, incorporar la referencia revisada y preparar la solicitud de pago. Cliente promete viernes; el estado sigue pendiente hasta verificación. Si paga, se detienen gestiones; si no, se propone seguimiento de esa fecha en lugar de otro mensaje genérico.

## Validación antes de afirmar que funciona

Revisar casos anonimizados con permiso y comparar contra seguimiento manual: tiempo dedicado, gestiones necesarias y evolución hasta pago confirmado. Registrar también cobros que no se recuperan, objeciones, errores y mensajes innecesarios. Un caso de éxito o la disponibilidad de una API no demuestra que la automatización aumente la recuperación. Empezar con preparación asistida y revisión humana; una automatización de envíos requerirá autorización específica.
