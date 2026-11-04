# Ampliación: cierre económico del proyecto con varios pagos

## Fundamento comprobado

El usuario autorizó ampliar el alcance si corresponde a una práctica real de la industria. La documentación oficial consultada el 1 de noviembre de 2026 confirma el patrón: un reembolso comercial puede distribuirse entre las transacciones originales, manteniendo el límite y seguimiento de cada una.

- [Shopify: refunding orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/refunding-orders): en pedidos con varias transacciones permite repartir el reembolso parcial y ajustar cada importe hasta su disponibilidad. Es un precedente concreto de plataforma, no una regla jurídica universal para proyectos de servicios.
- [PayPal: refund a payment](https://developer.paypal.com/checkout/refund-payment): ejecución por captura original, devoluciones parciales, historial acumulado e idempotencia.
- [Stripe: refunds](https://docs.stripe.com/refunds): cada reembolso se vincula al pago/cargo original y no puede superar su importe pendiente de devolver.

Adaptar el patrón de pedido/transacciones a proyecto/cobros es una decisión de diseño de Trato, respaldada por esas implementaciones. No significa que todo cierre de proyecto deba devolver todos los cobros íntegramente ni que exista una penalidad automática.

## Alcance ampliado

Conservar devolución de un pago individual y añadir cierre económico del proyecto. En este último se revisan todos los cobros efectivamente recibidos que pertenecen al proyecto: inicial y adicionales de adendas. Una adenda emitida/aceptada sin pago no aumenta los fondos disponibles.

El cierre presenta un desglose global de trabajo reconocido, gastos, penalidades justificadas y ajustes. Las devoluciones anteriores se descuentan una vez. La distribución aprobada por captura suma exactamente el nuevo importe acordado, sin duplicar retenciones por cada pago. No elegir automáticamente un orden de devolución ni cambiar la distribución tras un fallo sin revisión/autorización.

Una captura puede recibir importe cero mientras las otras cubren la devolución; incluir todos los cobros en el análisis no obliga a devolver parte de cada uno. No mezclar propietarios, clientes, proyectos, merchants ni monedas. No hacer conversión implícita.

Cada operación financiera conserva captura, importe, revisión aceptada, autorización e identidad idempotente propios. Las llamadas al proveedor no forman una transacción atómica: una puede completarse y otra fallar. Conservar el avance confirmado y mantener el cierre financiero pendiente hasta comprobar todas las operaciones previstas. Nunca repetir una ya completada por un fallo de otra.

## Prerrequisitos antes del PDF de tanda 4

1. Ampliar el contrato, persistencia y UI de tandas 1–3 mediante cambios nuevos; el soporte multipago está implementado y probado localmente en tanda 4; migraciones compartidas pendientes.
2. Resolver cómo registrar/verificar el pago inicial: el cobro actual está ligado a propuestas de cambio. Un contrato, un importe escrito, una adenda pendiente o el diagnóstico de USD 0.10 no acreditan ese pago. Si falta registro verificable, mostrar la carencia; no inventar el ingreso ni usar otro medio como respaldo.
3. Definir cabecera de cierre y relación con sus pagos y asignaciones por captura; conservar la referencia y contenido de los registros pagados anteriores. Cada snapshot fija el conjunto y los importes, sin incorporar cobros nuevos silenciosamente después del envío.
4. Revalidar todos los pagos y disponibilidades en las operaciones financieras de tanda 5. Antes de conciliación, el borrador distingue lo registrado de lo desconocido.
5. Acordar y probar cuándo el cierre aceptado bloquea nuevos trabajos/cobros y cuándo el proyecto pasa a cerrado. No confundir aceptación del cierre con devolución completada.

## Impacto en las tandas

- Base previa a tanda 4: análisis detallado y adaptación de dominio/API/SQL/UI, con pruebas por captura, sumas globales, fuentes e aislamiento. Regresión del caso de un solo pago.
- Tanda 4: un PDF y aceptación del cierre global, con la distribución exacta; nueva versión requiere feedback de esa propuesta. Cero global permite cierre sin llamadas de reembolso.
- Tandas 5–6: ejecución y conciliación independientes por captura; estado agregado solo a partir de resultados verificados. Fallo parcial visible, sin redistribución automática.
- Tanda 7: caso Sandbox con pago inicial y adenda cobrados, devolución repartida y comprobación de resultados parciales/pendientes además del caso simple.

Implementación local aprobada de tanda 4: registro inmutable de ingresos, miembros del cierre, reparto por captura, documentos y aceptación. Ver `tanda-4-devoluciones-validacion.md`. El registro inicial solo admite orden/captura Sandbox completadas, pagador del cliente, merchant configurado y `reference_id`/`custom_id` iguales a `initial-{project_uuid}`. No admite pagos arbitrarios, el diagnóstico de USD 0.10 ni un importe escrito como prueba. Este lote no crea el checkout inicial. Si no existe una captura verificable con ese contexto, debe resolverse su cobro/registro antes del recorrido financiero integral; no hay ingreso ficticio. No se ejecutaron llamadas financieras en la validación local.
