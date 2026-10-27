# Trato — ideas, producto y alcance

Registro de las ideas acordadas y propuestas en este chat. Actualizado el 21 de octubre de 2026.

## 1. Público y propuesta

Público inicial: freelancers que venden servicios, especialmente edición de video, diseño y desarrollo web. Pequeñas agencias pueden evaluarse después. No hemos validado demanda, disposición a pagar ni mejoras económicas reales.

Propuesta: ayudar a gestionar acuerdos, cobrar trabajo adicional, dar seguimiento a pagos y resolver cancelaciones con IA y PayPal. La interfaz debe nombrar explícitamente al freelancer como usuario; «cliente» significa la persona o empresa que contrata sus servicios.

Marca provisional: **Trato**. Nombre anterior: ScopePay. No se verificó disponibilidad de marca ni dominio. Diseño claro y responsive, sin selector de tema. El menú lateral no duplica el asistente: Clientes abre el chat del proyecto y la bolita abre el asistente general.

## 2. Las tres ideas integradas

### Cambios y extras (ScopePay)

El freelancer aporta el presupuesto original y una nueva solicitud. El agente identifica qué está incluido, qué podría ser adicional y qué es ambiguo. Cita las cláusulas que respaldan la interpretación. El profesional decide los extras y sus precios, revisa la propuesta y autoriza prepararla para el cliente. El cliente acepta y paga mediante PayPal. Solo una confirmación verificada permite marcar el cobro como pagado.

No se promete eliminar impagos ni decidir disputas legales. No se inventan precios ni cláusulas cuando faltan datos.

### Seguimiento de cobros (CobroClaro)

Se revisan solicitudes de pago pendientes, fecha límite y conversación con el cliente. El agente propone seguimiento según el contexto. Un cobro pendiente puede estar dentro del plazo; solo es vencido si pasó la fecha límite con saldo pendiente. El freelancer revisa el mensaje antes de enviarlo. El cliente decide pagar, y PayPal confirma el resultado.

Enviar un recordatorio no equivale a cobrar ni a resolver la causa del retraso.

### Cancelaciones y reembolsos (adaptación de ReturnGuide)

El agente consulta la reserva, los términos aplicables y la solicitud. Propone preguntas o una resolución con fuentes. El freelancer aprueba el importe y la acción. El backend solicita el reembolso a PayPal y verifica su estado.

La idea original trataba devoluciones físicas de tiendas; para el público elegido se adapta a cancelaciones y reembolsos de servicios. El procesamiento de devoluciones físicas no forma parte del MVP.

## 3. Entrada común desde una conversación

«Esto me escribió mi cliente, ¿qué hacemos?» permite comenzar sin elegir una de las tres funciones. Un futuro agente clasifica la intención, consulta el contexto del proyecto y prepara una propuesta revisable.

Flujo propuesto:

Cliente y proyecto → mensaje o pregunta → consulta de fuentes → interpretación con evidencia → propuesta → aprobación del freelancer → operación PayPal → confirmación → historial.

La clasificación de ejemplo del prototipo está predefinida. No es una capacidad de IA implementada ni una innovación probada frente a competidores.

## 4. Clientes y proyectos

- Cada cliente tiene identificador propio y proyectos asociados.
- Cada proyecto tiene documentos, versiones, conversaciones, propuestas y acciones.
- El usuario elige explícitamente cliente y proyecto antes de consultar al asistente.
- La conversación de un proyecto no debe mezclarse con la de otro, aunque sean del mismo freelancer.
- En producción, los límites se aplicarán en el backend y la base de datos por freelancer, cliente y proyecto; una selección en el frontend no es un control de seguridad.
- Los ejemplos actuales tienen cinco clientes y un proyecto por cliente. El modelo futuro debe admitir varios proyectos por cliente.

## 5. Base de conocimiento (KB)

Vista para consultar presupuesto, alcance, revisiones incluidas, términos del servicio, condiciones de pago, política de cancelación y sus versiones.

No confundir los términos generales de uso de Trato con el acuerdo comercial entre freelancer y cliente. Los términos generales por sí solos no prueban qué aceptó un cliente.

Datos propuestos de un documento:

```text
document_id       identificador estable
freelancer_id     propietario del documento
client_id         cliente al que corresponde
project_id        proyecto al que corresponde
title             nombre legible
version           versión consultada
status            borrador / propuesto / aceptado / reemplazado
content           texto o referencia al archivo
accepted_at       fecha de aceptación, si existe
acceptance_ref    evidencia de aceptación, si existe
```

El agente debe indicar la fuente, versión y fragmento que utilizó. Si no hay acuerdo aceptado o existen contradicciones, debe pedir aclaración. Un documento subido no se convierte automáticamente en un acuerdo aceptado. Los documentos y mensajes son datos de contexto; no pueden autorizar por sí mismos acciones ni cambiar las instrucciones del agente.

En el prototipo hay acuerdos ficticios v1.0 y un formulario de borradores locales. Los borradores no modifican las respuestas predefinidas. No hay carga de PDF, extracción ni embeddings implementados.

## 6. Asistente de preguntas libres

El freelancer podrá preguntar sobre su proyecto además de pegar mensajes del cliente. Ejemplos de intención: consultar lo acordado, aclarar revisiones, revisar fechas de pago o explorar qué información falta para evaluar una cancelación.

Las preguntas no deben disparar operaciones financieras automáticamente. El agente diferencia evidencia, interpretación y propuesta; una respuesta sin fuentes suficientes debe mostrar esa limitación.

El prototipo permite escribir texto libre y conserva cada turno en memoria dentro del proyecto. Solo «¿Qué acordamos?», «¿Qué sabemos del pago?» y el mensaje exacto de ejemplo producen respuestas predefinidas. Otros textos reciben un aviso explícito de que falta conectar el modelo. No se presentan respuestas simuladas como análisis real.

## 7. Historial y trazabilidad

### Asistente general flotante

Una bolita a la derecha abre un panel disponible en todas las vistas. Permite preguntas libres, sugerencias de resumen y orientación, y navegación hacia un cliente. «Todo mi estudio» muestra un resumen transversal con cada dato atribuido a su cliente y proyecto. Un selector acota el contexto a un solo proyecto.

El historial del asistente general es independiente de los chats privados por proyecto; cada contexto seleccionado conserva su propia conversación. No se transfieren preguntas ni respuestas entre esos historiales automáticamente. En la versión funcional, el agente general necesitará herramientas que consulten cada contexto con permisos y devuelvan referencias identificadas; no debe concatenar todos los chats sin control.

Implementado como simulación frontend: preguntas libres registradas, respuestas predefinidas a sugerencias, fuentes de datos ficticias y sin operaciones externas. La separación de mapas en memoria no reemplaza aislamiento de datos y autorización en un backend.

Se distinguen el chat privado freelancer–asistente, los mensajes aportados del cliente, los mensajes preparados para enviar y los que realmente se envíen. En el prototipo el mensaje del cliente es un ejemplo seleccionado; no hay sincronización con correo o WhatsApp.

Registrar fuentes y versiones, propuesta, modificaciones humanas, aprobación, operación solicitada, identificadores y estado verificado de PayPal. Mantener una línea de tiempo por proyecto. Evitar duplicar pagos o reembolsos ante reintentos.

El historial actual carga eventos ficticios desde `data/demo.json`, presenta filtros y resúmenes por proyecto y permite añadir acciones simuladas. Las adiciones de la sesión desaparecen al recargar. No existe persistencia ni sincronización entre usuarios. Ver `modelo-de-datos.md` para las entidades normalizadas y relaciones propuestas.

## 8. Evidencia del problema y pendientes de validación

- iHire, 2026: el 36,1 % de participantes con experiencia freelance señaló expectativas o alcance poco claros. No mide directamente pérdida de ingresos por cambios. Fuente: https://www.ihirelawenforcement.com/resourcecenter/employer/pages/the-freelance-revolution-insights-into-the-2026-us-workforce
- QuickBooks, enero de 2025, 2.487 pequeños negocios estadounidenses: el 47 % tenía alguna factura con más de 30 días de atraso. Fuente: https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2025/
- NRF, 2025: estimó devoluciones del 19,3 % de ventas online en EE.UU., a partir de una investigación con grandes comercios y consumidores. No valida por sí sola reembolsos de servicios freelance. Fuente: https://cdn.nrf.com/media-center/press-releases/consumers-expected-to-return-nearly-850-billion-in-merchandise-in-2025

No sumar ni ordenar estas cifras como si describieran una misma población. No extrapolarlas directamente a Perú. Entrevistar al menos a cinco freelancers, pedir casos anonimizados y medir frecuencia, tiempo y dinero afectados. Verificar si la misma persona necesita las tres funciones y si usaría o pagaría por Trato.

## 9. Alcance y prioridades

**Implementado en frontend de ejemplo:** presentación, tres recorridos, cinco casos ficticios, edición de precios y borradores de respuesta, clientes, vistas de documentos, borradores locales, preguntas libres con aviso, respuestas sugeridas con fuentes y registro de acciones por proyecto.

**Siguiente MVP funcional:** un cliente y proyecto de prueba, autenticación, acuerdo versionado, historial persistente, modelo real con respuestas estructuradas y citas, aprobación humana e integración PayPal sandbox de principio a fin. Priorizar cambios y extras; añadir seguimiento y reembolso supervisado sin perder calidad del recorrido central.

**Fuera de esta iteración:** pagos reales, escrow, resolución jurídica de disputas, conexión a WhatsApp/correo, OCR de contratos, entrenamiento de modelos, operaciones autónomas y logística de devoluciones físicas.

## 10. Stack y presupuesto

Presupuesto objetivo de servicios para la demo: US$0, sujeto a límites de cuotas y activación de créditos. Ver `stack-y-costos.md` para fuentes y condiciones. Opciones propuestas: Supabase, pgvector si los documentos justifican RAG, LangChain opcional y Render con créditos del hackathon. Vercel y Weaviate son alternativas, no compromisos de arquitectura. El proveedor de modelos sigue pendiente.

No hace falta una base vectorial para comparar dos textos cortos. No desplegar ni activar facturación sin una decisión posterior del equipo.

## 11. Equipo y presentación

Ideas futuras y experimentos de diferenciación en `ideas-futuras.md`, separados del alcance comprometido del MVP.

Sebastian cubre IA y parte del backend; Mariam cubre aplicación e integración; ambos verifican el recorrido completo. Editor para guion, captura y montaje. Reparto propuesto, sujeto a disponibilidad. Evaluar una incorporación solo si existe una parte concreta sin cubrir.

Preparar una demo de menos de tres minutos que explique para quién es Trato y muestre una conversación convirtiéndose en una propuesta y una operación sandbox verificable. Código público, licencia open source, instrucciones reproducibles y materiales en inglés o traducidos. El prototipo frontend actual todavía no satisface el requisito de aplicación funcional del hackathon.
