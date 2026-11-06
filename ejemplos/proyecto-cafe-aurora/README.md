# Proyecto completo de prueba: Café Aurora

PDFs preparados para probar un proyecto nuevo, un cambio con dos versiones y una devolución parcial. Las fuentes editables están en `fuentes/` y los datos del caso en `caso.json`. Todo pertenece a un mismo caso ficticio.


## Prueba del cobro por entregable

Para el plan revisado de Café Aurora, usa `10-conformidad-entregable-1.pdf` en **Plan de trabajo → Entregable 1 → Entrega y pago → Adjuntar respaldo de entrega**. Contiene la conversación ficticia donde Alex entrega el diseño y Lucía confirma que la primera etapa está cerrada y conforme, por USD 180 (30 % de USD 600). No afirma que esté pagada. Espera su procesamiento antes de preparar la solicitud de pago Sandbox.

Los importes y anticipos de los documentos 01 a 09 corresponden al escenario heredado de cambios y devoluciones. El flujo actual del plan solicita el pago después del cierre documentado de cada entregable; el importe real del checkout lo fija el plan guardado.

## Datos para crear el proyecto

- Cliente: **Café Aurora**.
- Correo del caso: **cafe.aurora@example.com**. Para probar envíos y respuestas por correo, introduce en Trato una dirección que tú controles.
- Proyecto: **Sitio web de Café Aurora**.
- Presupuesto inicial: **USD 600**.
- Entrega original: **20 de noviembre de 2026**.
- Plan de pagos: **USD 300 al comenzar, USD 180 al aprobar el diseño y USD 120 antes de publicar**.

Encargo para copiar en el formulario:

> Diseño y desarrollo de una web responsive de cinco secciones en español para Café Aurora: Inicio, Menú, Sobre nosotros, Galería y Contacto. Incluye formulario de consultas, dos rondas de revisión y publicación. El cliente aporta textos, fotos y logotipo. Presupuesto: USD 600. Entrega: 20 de noviembre de 2026. No incluye tienda, carrito, pagos en línea, usuarios, inventario ni traducciones.

## 1. Crear desde cero

1. Crea el cliente y elige **Nuevo proyecto → Voy a empezar**.
2. Usa el encargo anterior y `01-conversacion-inicial.pdf` como información de partida.
3. Revisa el plan propuesto. Para seguir los números de este caso, deja las etapas en 50 %, 30 % y 20 %.
4. Confirma la creación. El acuerdo final de referencia es `02-acuerdo-inicial-confirmado.pdf`; incorpóralo en el apartado del acuerdo inicial cuando ese paso corresponda.
5. Prueba el pago inicial de **USD 300** mediante el checkout Sandbox de Trato.

Para probar la otra entrada, crea un proyecto distinto con **Proyecto en marcha** y utiliza directamente `02-acuerdo-inicial-confirmado.pdf`. No hace falta repetir la preparación del encargo en ese recorrido.

## 2. Registrar un cambio y negociar su versión

| Momento | Documento | Qué contiene |
| --- | --- | --- |
| Nuevo pedido | `03-pedido-de-cambio-tienda.pdf` | Diez productos, carrito y PayPal. Presupuesto adicional de USD 240, entrega el 25 de noviembre. |
| Respuesta a la adenda v1 ya enviada | `04-ajustes-cliente-adenda-v1.pdf` | El cliente pide reducir a cinco productos, USD 180 y entrega el 23 de noviembre. |
| Conformidad con la v2 enviada | `05-aceptacion-cliente-adenda-v2.pdf` | Acepta el alcance reducido, el importe y la nueva fecha. |

Trato genera las propuestas y sus PDFs. Estos archivos contienen las conversaciones y respuestas del cliente, para anexarlas en el paso correspondiente. Si el recorrido pide devolver el PDF de una propuesta concreta, utiliza el PDF exacto que descargaste de Trato; las respuestas de ejemplo te sirven como respaldo o como texto para responder desde el buzón de pruebas.

Al revisar las propuestas, utiliza los valores del cuadro para que el caso continúe siendo coherente. La v1 no se paga: recibe ajustes y da lugar a la v2. Después de aceptar la **v2**, completa su pago de **USD 180** en Sandbox. El cambio pagado queda de solo consulta.

## 3. Probar una devolución parcial

Continúa cuando Trato haya verificado estos dos pagos: anticipo original de **USD 300** y adicional de **USD 180**. El resto de etapas del proyecto original no se paga en este caso.

| Momento | Documento |
| --- | --- |
| Avances y valoración reconocida | `06-respaldo-trabajo-realizado.pdf` |
| Solicitud del cliente para detener lo pendiente | `07-solicitud-de-devolucion.pdf` |
| Respaldo del desglose por pago | `08-respaldo-desglose-devolucion.pdf` |
| Conformidad con la propuesta de devolución v1 | `09-aceptacion-propuesta-devolucion.pdf` |

Valores esperados al revisar la propuesta:

| Pago original | Recibido | Trabajo que se conserva | Devolución |
| --- | ---: | ---: | ---: |
| Anticipo del proyecto | USD 300 | USD 240 | USD 60 |
| Adicional de la tienda | USD 180 | USD 60 | USD 120 |
| **Total** | **USD 480** | **USD 300** | **USD 180** |

Penalidad: **USD 0**. El precio total acordado fue USD 780, pero solo se recibieron USD 480. No se incluyen en la devolución los USD 300 del proyecto original que nunca se cobraron.

Revisa la propuesta generada, registra la aceptación de esa versión y autoriza la devolución mediante el flujo de Trato. El resultado de PayPal y su notificación deben confirmar el estado; ninguno de estos documentos es un comprobante de cobro o reembolso.

## Orden de subida

Utiliza solo los documentos del paso en el que estás. No subas toda la carpeta como acuerdo inicial: las conversaciones de cambios y devoluciones pertenecen a etapas posteriores. Los IDs reales del cliente, proyecto, revisión y pagos los asigna Trato al realizar esas acciones; no vienen fijados en estos PDFs.

## Editar y regenerar

Edita los archivos Markdown de `fuentes/` y vuelve a generar los PDF con la dependencia ReportLab que ya utiliza el proyecto:

```bash
repos/trato-file-processor/.venv/bin/python ejemplos/proyecto-cafe-aurora/generar.py
```

Si cambias importes, alcance o versiones, actualiza también los documentos posteriores y `caso.json` para conservar la coherencia del recorrido.

Este mismo caso queda disponible para preparar después la demostración guiada. Crear estos archivos no registra clientes o proyectos, sube documentos ni ejecuta pagos o devoluciones.
