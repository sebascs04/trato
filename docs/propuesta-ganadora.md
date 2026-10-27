# Trato — propuesta para el PayPal AI Hackathon

Propuesta de trabajo para Sebastian y Mariam · 23 de octubre de 2026

## La idea en una frase

**Un espacio para freelancers que convierte conversaciones confusas con sus clientes en acuerdos claros, decisiones registradas y cobros o reembolsos verificables con PayPal.**

Trato es el nombre provisional. La propuesta está abierta a ajustes del equipo; las funciones descritas no están todas implementadas ni validadas.

## Para quién y qué problema queremos resolver

Nuestro usuario inicial es un freelancer o pequeño estudio de servicios digitales: desarrollo, diseño, edición de video o trabajos similares.

El problema aparece cuando lo acordado, lo pedido y lo pagado dejan de coincidir. El alcance está en un documento; los cambios llegan por mensajes; distintas personas del cliente pueden pedir cosas incompatibles; una entrega espera aprobación y el freelancer no sabe qué está frenando el cobro. Si se cancela el proyecto, reconstruir qué corresponde entregar, cobrar o devolver se vuelve difícil.

Queremos ayudar a resolver esas decisiones durante el proyecto, con documentos y conversaciones como evidencia. El asistente prepara propuestas; las personas aceptan los acuerdos y autorizan las operaciones financieras.

## Qué queremos destacar primero

### 1. Resolver instrucciones contradictorias

Si dos personas del cliente piden cambios incompatibles sobre una entrega, Trato muestra los mensajes relacionados, explica el conflicto y pide una decisión a la persona autorizada. No decide por el cliente ni toma cualquier mensaje como aprobación.

### 2. Una sala de acuerdos con alternativas

Ante un cambio, no ofrecer solamente «pagar el extra». Preparar opciones comparables: ampliar presupuesto, intercambiar una tarea aún no iniciada o dividir el trabajo en fases. Cada opción indica qué cambia en alcance, precio y fecha. El profesional revisa antes de compartir y el cliente elige explícitamente.

### 3. Un cierre acordado si el proyecto se cancela

Relacionar entregables terminados y aceptados, pagos recibidos y condiciones aplicables. Preparar una propuesta de cierre con saldo o posible reembolso. Si hay desacuerdo o datos faltantes, mostrarlo; no inventar un valor del trabajo ni determinar derechos legales automáticamente.

### 4. Un detective del bloqueo de cobro

Responder «¿qué está frenando mi cobro?» distinguiendo revisión, aprobación, factura pendiente, impago o estado del proveedor. Proponer el siguiente paso con fuentes. Que alguien diga «ya pagué» no confirma un pago.

Estas son hipótesis de diferenciación. El recorrido principal propuesto combina las dos primeras; cierre y diagnóstico pueden ampliar la solución después.

## Ejemplo del recorrido principal

1. Una editora registra un proyecto, sus entregables, presupuesto, revisiones incluidas y la persona que puede aprobar cambios.
2. Incorpora el acuerdo y mensajes autorizados. Para el MVP puede hacerse manualmente; no necesitamos integrar WhatsApp o correo desde el comienzo.
3. Marketing pide un video de 60 segundos y la responsable final pide uno de 15. El asistente relaciona ambas solicitudes con el mismo entregable y señala la incompatibilidad.
4. La editora aporta esfuerzo estimado y disponibilidad. Trato prepara opciones: sustituir la versión, producir ambas con un adicional o entregar en fases.
5. La editora revisa precios y fechas. El cliente ve las alternativas y acepta una versión concreta.
6. Si corresponde un adicional, Trato crea el cobro mediante PayPal sandbox. El cliente realiza el pago de prueba.
7. El backend verifica el resultado del proveedor y actualiza el historial. La aceptación y el pago quedan como eventos distintos.
8. Ambas partes pueden consultar qué cambió, quién lo aceptó y a qué pago corresponde.

Las cifras de demo serán ficticias y estarán identificadas. Una opción sin diferencia monetaria registra el acuerdo sin generar un cobro artificial.

## Qué tendrá la aplicación

| Espacio | Para qué sirve |
|---|---|
| Inicio | Mostrar pendientes y decisiones que necesitan atención |
| Clientes y proyectos | Reunir el contexto de cada relación sin mezclar información de otros clientes |
| Documentos y términos | Guardar acuerdos, versiones y condiciones que el asistente puede consultar |
| Cambios y acuerdos | Revisar solicitudes, conflictos y alternativas antes de aceptarlas |
| Cobros | Consultar solicitudes pendientes y pagos confirmados |
| Reembolsos | Revisar propuestas y distinguir autorización de devolución completada |
| Historial por proyecto | Reconstruir acuerdos, solicitudes, entregas y movimientos con sus fuentes |
| Asistente contextual | Hacer preguntas libres sobre el proyecto y obtener respuestas sustentadas |
| Asistente general flotante | Consultar el propio estudio, atribuyendo cada dato a su cliente o proyecto |

No hace falta una pestaña nueva por cada función. Por ejemplo, el diagnóstico de un cobro puede aparecer en su registro o en el asistente.

## Qué aporta la IA y qué aporta PayPal

**IA:** interpretar solicitudes, recuperar cláusulas y mensajes relevantes, proponer conflictos para revisión, redactar alternativas y explicar resultados con referencias. Si falta información, debe pedirla o indicar la limitación.

**PayPal:** crear el cobro del acuerdo aceptado y verificar su resultado; posteriormente, ejecutar y seguir un reembolso aprobado. Las capacidades, permisos y eventos concretos se comprobarán durante la integración sandbox.

Importes, moneda, límites y estados financieros se validan en el backend. El modelo no confirma por sí mismo un pago ni autoriza mover dinero.

## Técnicas que podemos evaluar

| Técnica | Uso propuesto | Decisión para el MVP |
|---|---|---|
| Recuperación con fuentes / búsqueda híbrida | Encontrar cláusulas, mensajes e IDs dentro del proyecto autorizado | Prioritaria; comenzar sencillo y medir si hacen falta embeddings |
| Grafos, posiblemente Neo4j | Recorrer relaciones entre persona, acuerdo, cambio, aprobación, entrega, factura y pago | Prueba acotada; mantenerlo solo si aporta frente a consultas relacionales |
| Optimización con restricciones, posiblemente OR-Tools | Comprobar qué alternativas caben en presupuesto, plazo y capacidad conocidos | Empezar con reglas simples; solver si la complejidad lo justifica |
| Máquina de estados | Controlar pasos válidos entre propuesta, aceptación, cobro y confirmación | Prioritaria |
| Flujo con aprobación humana, con o sin LangGraph | Pausar antes de compartir acuerdos o ejecutar operaciones financieras | Prioritario; framework opcional |
| Registro de eventos y versiones | Conservar qué ocurrió y con qué fuentes | Prioritario; no requiere adoptar event sourcing completo |
| Simulación de escenarios | Mostrar efecto de cambiar fases, presupuesto o devolución | Cálculos deterministas; no presentarlos como predicciones |
| Análisis multimodal | Extraer solicitudes de PDFs, imágenes y audios autorizados | Ampliación posterior; comenzar con texto y documentos manejables |
| Modelos predictivos | Estimar cobros tardíos o devoluciones futuras | Futuro: faltan datos adecuados y evaluación |

Ejemplo de grafo: mensaje → solicita cambio → entregable → pertenece a acuerdo → aceptado por persona autorizada → genera factura → recibe pago PayPal. La IA puede sugerir relaciones; las aceptaciones y pagos requieren registros confirmados. Un grafo no implica entrenar una red neuronal de grafos.

Arquitectura candidata: frontend + backend + Postgres/Supabase como fuente principal + proveedor de IA + PayPal sandbox. Neo4j sería una capa opcional de relaciones, evitando duplicar datos sin sincronización. No necesitamos incorporar Neo4j, Weaviate y varios frameworks a la vez. Autorización por propietario/proyecto en backend; un selector visual no protege datos por sí solo.

## Alcance de entrega propuesto

**Primero, un recorrido funcional completo:** autenticación y aislamiento de datos; cliente/proyecto; acuerdo y mensajes de entrada; análisis con fuentes; alternativas revisables; aceptación explícita; cobro sandbox; confirmación del proveedor e historial persistente.

**Después, si alcanza el tiempo:** cierre con reembolso sandbox, explicación de diferencias financieras y diagnóstico más amplio de bloqueos. Elegir según utilidad y viabilidad; no comprometer todos los módulos funcionales al mismo tiempo.

**Fuera del primer alcance:** sincronización con múltiples chats/pasarelas, arbitraje automático, liberación de fondos retenidos, predicción sin datos, agentes que mueven dinero solos y evaluación automática de calidad de cualquier entrega.

## Otras ideas que conservamos para explorar

- Simulador de conversaciones difíciles usando el acuerdo del proyecto; sesiones ficticias separadas de mensajes y aceptaciones reales.
- Dos asistentes que preparan un borrador negociado bajo restricciones privadas; ambas partes autorizan el resultado.
- Mapa visual de evolución del alcance y checklist de aceptación/cierre.
- Acuerdo explícito sobre herramientas y uso de IA, datos permitidos y revisión humana.
- Conciliación y explicación del recorrido factura → bruto → comisión → conversión → devolución → liquidación.
- Vista previa del costo de un reembolso; distinción entre pagado, retenido y disponible cuando los datos lo permitan.
- Expediente de disputa con pruebas existentes, requisitos y faltantes; sin prometer ganar.
- Revisión de posibles pagos repetidos, intentos incompletos y discrepancias antes de pagar.
- Orientación sobre solicitudes sospechosas, seguimiento de cancelaciones de suscripciones y agrupación de avisos. El acceso necesario no se presupone.
- Ayuda contextual y accesibilidad del checkout, con pruebas reales de uso.
- Predicción evaluada de fecha de cobro, liquidez y dinero expuesto a devolución; reservas y suscripciones serían expansiones a otros públicos.

## Qué existe hoy

Tenemos un **frontend interactivo con JSON ficticio**, navegación, clientes/proyectos, documentos, asistentes con respuestas predefinidas e historial simulado. Los datos están relacionados por IDs para facilitar la futura conexión con una base de datos.

Todavía no hay integración real de IA o PayPal, autenticación ni persistencia en base de datos. La siguiente etapa consiste en convertir un recorrido visual en uno funcional verificable.

## Competencia y evidencia: cómo presentar la propuesta con honestidad

La idea inicial de gestionar extras, cobros y reembolsos se conserva como base. No es exclusiva: ScopeDue cubre cambios, aprobación y evidencias; Fenscope anuncia comparación de solicitudes con contratos mediante IA; HoneyBook reúne gestión de clientes, documentos y facturación; Negosim ofrece práctica de negociación.

Nuestra apuesta a validar es resolver un desacuerdo concreto entre instrucciones y convertirlo en una elección compartida conectada con un pago. La revisión de páginas públicas no demuestra que ningún competidor tenga ese recorrido.

PayPal documenta desacuerdos sobre facturas y requisitos de evidencia para disputas, y su equipo ha publicado sobre grafos para combatir fraude. Esto respalda la relevancia de los problemas y las técnicas, pero no implica que PayPal avale Trato ni que nos dé acceso a su grafo interno. Los relatos de Reddit sirven como señales de investigación, no como porcentajes representativos.

Fuentes principales:

- Problemas de facturas: https://www.paypal.com/us/brc/article/what-is-an-invoice-dispute
- Evidencias de disputas: https://developer.paypal.com/disputes/reasons-evidence/
- Grafos en PayPal: https://medium.com/paypal-tech/graph-usage-in-combating-ato-fraud-risk-6dafbe5cc3e5
- Competencia: https://scopedue.com/features/change-request-approval/ · https://fenscope.com/ · https://www.honeybook.com/ai-information · https://negosim.ai/
- Neo4j y límites gratuitos: https://neo4j.com/free-graph-database/
- Optimización: https://developers.google.com/optimization/cp/
- Pausas con aprobación: https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph

## Costos y trabajo en equipo

Buscamos una demo sin gasto obligatorio: PayPal sandbox para pagos de prueba y opciones locales o planes gratuitos para datos, alojamiento y modelos. No asumir que PayPal cubre todos los gastos ni que una base de datos gratuita incluye inferencia de IA. Verificar cuotas, condiciones y disponibilidad antes de elegir servicios; evitar activar consumo pago por defecto.

Reparto propuesto, por acordar: Sebastian se concentra en recuperación, IA, alternativas y evaluación; Mariam en backend, autenticación, datos e integración PayPal; ambos comparten frontend e integración completa. El editor prepara el video cuando el recorrido sea reproducible. Es una propuesta de responsabilidades, no una asignación ya aceptada.

El criterio de éxito de la primera demo es sencillo: **una solicitud conflictiva termina en un acuerdo explícito y un pago sandbox confirmado, con evidencia consultable en cada paso.**

Para el inventario detallado y las investigaciones previas, consultar [catalogo-ideas.md](catalogo-ideas.md). Este documento es la propuesta compartible; el README describe el estado real del código.

## Validación de nuevas solicitudes por proyecto

El formulario de nueva solicitud se reserva para pedidos del cliente que agregan,
sustituyen o modifican trabajo del proyecto seleccionado. No sirve para incorporar
el contrato inicial, facturas o documentos de otros proyectos. El futuro agente
primero deberá clasificar el documento y contrastar su relación con el proyecto y
el acuerdo vigente. Una solicitud ajena debe impedir el avance; una relación ambigua
requiere aclaración, sin decidir únicamente por coincidencia de nombres o palabras.
Solo después se podrán preparar alternativas. El documento se trata como evidencia,
no como instrucciones que puedan autorizar acciones o cambiar el contexto del agente.

Estado actual: la UI explica esta restricción y pide confirmación del usuario.
La lectura local extrae texto y algunas cabeceras; no verifica semánticamente el
proyecto ni la identidad. Las solicitudes quedan pendientes de análisis con IA.
