# Frustraciones con PayPal encontradas en Reddit

Investigación del 23 de octubre de 2026. Lectura de publicaciones públicas, sin contactar a usuarios ni publicar mensajes. Son testimonios no verificados, no una muestra representativa ni porcentajes de prevalencia. Los comentarios de usuarios y bots no se usan como documentación de políticas. No se infiere fraude, culpa ni derecho a un reembolso por el relato de una sola parte.

## 1. Pagos recibidos pero retenidos

Un editor de video pregunta qué hacer cuando parte de un pago está retenida y la interfaz le ofrece opciones de envío físico que no entiende cómo aplicar a su servicio.

https://www.reddit.com/r/paypal/comments/1tfrp8r/money_total_on_hold/

Otra persona que trabaja como freelancer relata confusión porque su cuenta se usa para comprar, pero recibe una retención al volver a cobrar por servicios.

https://www.reddit.com/r/paypal/comments/1l4yk6h/

**Idea:** panel que distingue pago enviado, recibido, pendiente/retenido y disponible; prepara preguntas/documentos para soporte y permite simular el impacto de no disponer todavía del dinero. Debe consultar estados realmente expuestos y declarar lo que no conoce.

**Límite:** no liberar fondos, garantizar plazos, inventar tracking de servicios o recomendar evadir controles usando pagos personales. No seguir instrucciones de comentarios que pidan compartir códigos de acceso.

## 2. Costo del reembolso y diferencia entre bruto y neto

Un vendedor pregunta por qué devolver un pago puede reducir su saldo por debajo del que tenía antes de cobrar. Otro relata cancelaciones que le hacen perder comisiones.

https://www.reddit.com/r/paypal/comments/1ifcjr5/
https://www.reddit.com/r/paypal/comments/1igx2c4/

**Idea:** antes de confirmar un reembolso, mostrar importe que recibirá el cliente, neto que recibió el vendedor, comisiones conocidas y variación de saldo. Permitir preguntar de dónde sale cada cifra y preparar la operación aprobada.

**Verificación:** la ayuda de PayPal consultada para Singapur indica que no se cobra por emitir el reembolso, pero no se devuelven las comisiones originales. Debe comprobarse país y producto; no trasladar porcentajes ni excepciones de Reddit.

https://www.paypal.com/sg/cshelp/article/how-do-i-issue-a-refund-help101

## 3. Pago y reembolso en monedas distintas

Una persona relata que un pago de USD160 equivalía a EUR144 y, al recibir USD160 de vuelta, ve EUR137. Los comentarios ofrecen explicaciones contradictorias; no se verificaron los extractos.

https://www.reddit.com/r/paypal/comments/1vsg6yc/paypal_whats_going_on_here_i_paid_the_seller_160/

**Idea:** reconstruir las dos conversiones y explicar moneda, importe, fecha y tipo aplicado. Mostrar datos confirmados frente a estimaciones, sin prometer recuperar diferencias ni fijar cotizaciones futuras. Encaja con el explicador de reembolsos.

## 4. Documentación y conciliación de miles de pagos pequeños

Un vendedor de assets para juegos cuenta que tuvo que obtener documentos para unas 2.000 transacciones y automatizar impresiones. Otro hilo describe dificultades para conciliar PayPal, Stripe y Wise con monedas y formatos distintos.

https://www.reddit.com/r/smallbusiness/comments/1rxp9eg/my_accountants_wanted_a_primary_invoice_for_every/
https://www.reddit.com/r/smallbusiness/comments/1t3orwo/how_are_you_currently_managing_billing_invoices/

**Idea:** importar registros/documentos autorizados y construir el recorrido factura → pago bruto → comisión → conversión → reembolso → liquidación. El usuario pregunta por una diferencia concreta y ve los documentos fuente. Una vinculación ambigua se revisa; no se adivina silenciosamente.

**Límite:** la necesidad documental del relato no es una norma tributaria universal. No generar comprobantes falsos ni sustituir originales por resúmenes del modelo. Validar acceso, permisos, campos y condiciones de la API de reporting; un CSV de muestra autorizado permite probar el matching sin acceso a otras plataformas.

## 5. Evidencias dispersas cuando aparece una disputa

Un proveedor relata una disputa de USD597 y enumera mensajes, registros de pedidos, informes y pruebas de entrega. El relato incluye una actualización sobre negociación de un reembolso parcial; no conocemos la versión del comprador.

https://www.reddit.com/r/Entrepreneurs/comments/1sob2yf/paypal_dispute_worth_597/

**Idea:** leer el motivo y los requisitos del caso, organizar evidencias existentes, señalar lo que falta y preparar un expediente revisable. Mantener referencias al archivo, mensaje, entrega y transacción; no inventar pruebas ni decidir quién tiene razón.

**Viabilidad inicial:** PayPal documenta consulta de disputas y entrega de evidencia. Falta comprobar acceso, permisos y flujo sandbox antes de comprometer esta integración. No garantizar victoria ni cobertura de Seller Protection.

https://developer.paypal.com/platforms/disputes/integrate-disputes/
https://developer.paypal.com/disputes/reasons-evidence/

## 6. Suscripciones: no saber si se cancelaron realmente

Personas preguntan cómo cancelar pagos automáticos y cómo interpretar el resultado después de cancelarlos en el sitio del comercio.

https://www.reddit.com/r/paypal/comments/1u5ilnt/did_i_successfully_cancel_a_recurring_paypal/
https://www.reddit.com/r/paypal/comments/1otayr0/unable_to_find_option_to_cancel_automatic/

**Idea:** asistente que distingue contrato del comercio, autorización de pago y cargos ya iniciados; guarda confirmaciones y orienta hacia acciones oficiales.

**Límite importante:** no asumir que la API de un comercio permite leer o cancelar todas las suscripciones de una cuenta compradora en PayPal. Requerir validación técnica del acceso antes de proponer automatización universal.

## Prioridad de exploración

1. **Conciliación explicable:** tarea específica, evidencia visible y posibilidad de evaluar matching contra relaciones conocidas. Revisar competidores antes de afirmar diferenciación.
2. **Explicador de reembolsos:** coherente con Trato, mezcla cálculos deterministas y explicación con IA; conexión directa con una acción PayPal aprobada.
3. **Expediente de disputa:** problema urgente y conexión fuerte con documentos; mayor complejidad de permisos y evaluación.

Retenciones y bloqueo de cuentas son frustraciones reales relatadas, pero una integración externa no controla las decisiones de riesgo de PayPal. Las predicciones no son obligatorias: un sistema que encuentra y explica discrepancias con evidencia puede aportar más valor que un score sin datos.

Las ideas permanecen en investigación. No se modificó el MVP ni se entrenó un modelo.
