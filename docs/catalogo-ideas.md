# Trato — catálogo consolidado y prioridad por diferenciación

Actualizado: 23 de octubre de 2026. Reúne las ideas anteriores, agrupa variantes y ordena primero las oportunidades que merece la pena contrastar. Este catálogo actualiza las prioridades exploratorias de los otros documentos; no cambia el código ni compromete todas las funciones para el hackathon.

## Cómo interpretar el orden

No se ha demostrado que ninguna idea sea exclusiva. «Menos cubierta» significa que en esta revisión no encontramos una descripción pública de la combinación exacta; no demuestra ausencia en el mercado. Se revisaron páginas de producto y documentación, no pruebas de uso de las aplicaciones. La prioridad es una decisión de producto provisional, no una puntuación científica de originalidad.

Las historias de Reddit son testimonios individuales, no tasas de prevalencia ni hechos comprobados contra ambas partes. La investigación de YouTube localizó contenido, pero no aportó transcripciones ni comentarios verificados que justifiquen hallazgos adicionales. No se presenta como videos vistos.

## A. Primero: combinaciones específicas para investigar

### 1. Resolver instrucciones contradictorias y convertirlas en una decisión

**Problema:** dos personas del mismo cliente piden cambios incompatibles y el freelancer termina haciendo trabajo que otra persona desautoriza.

**Experiencia:** enlazar dos mensajes sobre el mismo entregable y versión → mostrar la contradicción → identificar quién tiene autoridad para decidir → preparar alternativas → registrar la elección explícita → cobrar mediante PayPal si corresponde.

**Ejemplo:** marketing pide un video de 60 segundos y la responsable final pide uno de 15 segundos. El asistente propone sustituir la entrega, preparar ambas versiones con un adicional o separar fases, usando estimaciones del profesional.

**IA:** relacionar instrucciones y explicar incompatibilidades con fuentes; puede pedir aclaración. **PayPal:** cobrar el cambio aceptado. **Diferenciación por comprobar:** el paso completo entre conflicto de varias personas, decisión autorizada y consecuencia comercial. Frame.io y Rougelio ya cubren partes de revisión/aprobación; no vender centralizar feedback como novedad.

### 2. Sala de acuerdos con alternativas comparables

**Problema:** el cliente quiere más trabajo sin aumentar presupuesto ni plazo; emitir un adicional no siempre destraba el proyecto.

**Experiencia:** tres opciones sobre el mismo acuerdo: pagar más, intercambiar trabajo aún no iniciado o dividir la entrega en fases. Mostrar diferencias de alcance, precio y fecha; el profesional revisa antes de compartir y ambas partes aceptan el resultado. Sin diferencia monetaria no hay cobro ficticio.

**IA:** preparar opciones compatibles con restricciones conocidas. **PayPal:** cobrar la opción aceptada. **Diferenciación por comprobar:** comparar alternativas y registrar lo que reemplazan, más allá de aprobar/rechazar un extra. ScopeDue y Aitaskora ya describen cambios con precio, plazo y aprobación; esa parte es base compartida.

### 3. Salida acordada de un proyecto cancelado

**Problema:** cancelar a mitad deja dudas sobre entregables, aceptaciones, pagos, saldo y reembolso.

**Experiencia:** reconstruir lo terminado y aceptado → señalar desacuerdos y datos faltantes → preparar escenarios de cierre según condiciones revisadas → ambas partes acuerdan → ejecutar el cobro o reembolso autorizado.

**Ejemplo ficticio:** proyecto de USD600, anticipo USD300, trabajo reconocido por ambas partes USD200: propuesta de devolver USD100, con costos del proveedor mostrados aparte. El valor del trabajo no se infiere automáticamente de un porcentaje de tareas.

**IA:** reconstruir el caso y explicar alternativas. **PayPal:** operación aprobada y estado verificado. **Diferenciación por comprobar:** el paquete de cierre entregables/acuerdo/dinero, no el botón de reembolso. Upwork ya permite solicitar y emitir reembolsos; Trato no arbitra derechos ni garantiza acuerdos.

### 4. Detective del bloqueo de cobro

**Problema:** falta dinero, pero no está claro si falta revisión, aprobación, emisión de factura, pago o confirmación del proveedor.

**Experiencia:** preguntar «¿Qué está frenando mi cobro?» → cadena de dependencias con fuentes → siguiente acción revisable dirigida a la persona adecuada. No atribuir causas si faltan registros.

**IA:** reconstruir dependencias entre mensajes, entregas y facturas. **PayPal:** verificar el pago y preparar el cobro pendiente. **Diferenciación por comprobar:** explicar la dependencia operativa del proyecto, además del estado financiero. ScopeDue ya distingue aprobado/impagado y Spendesk describe facturas bloqueadas y consultas de estado: no es una categoría nueva.

### 5. Acuerdo sobre el uso permitido de IA

**Problema:** cliente y profesional tienen expectativas distintas sobre herramientas, privacidad, revisión humana y entregables.

**Experiencia:** preguntas previas → condiciones explícitas → cambios versionados → propuesta aprobada y pago correspondiente. No usar detectores para certificar autoría ni prometer cumplimiento automático.

**Diferenciación por comprobar:** condiciones de IA conectadas con cambios comerciales. La integración PayPal resulta menos central que en las ideas 1–3; conservar como hipótesis, no prioridad de demo.

## B. Ideas útiles con solapamiento competitivo o novedad sin evaluar

| Idea consolidada | Resultado para el usuario | Papel de IA / PayPal | Situación |
|---|---|---|---|
| Ensayar antes de enviar / juego de negociación | Practicar una respuesta difícil usando el acuerdo del proyecto | Contraparte simulada y comentarios; pago sandbox opcional, nunca aceptación real | Negosim y ParleyLab ya ofrecen simulación. Contextualizar al proyecto es una variante por evaluar; futura |
| Dos asistentes negocian un borrador | Explorar opciones dentro de restricciones privadas de cada parte | Agentes proponen; humanos autorizan acuerdo y dinero | Investigación existente de negociación multiagente; complejidad alta, posterior |
| Mapa de evolución del acuerdo | Ver qué cambió, quién aceptó y qué efecto tuvo | Extraer diferencias con fuentes; enlazar pagos verificados | Historial/aprobaciones ya cubiertos por ScopeDue y Rougelio; apoyo visual |
| Copiloto de entrega y cierre | Separar corrección, revisión incluida y extra antes de cerrar | Revisar checklist, pedir confirmación, preparar saldo/reembolso | Solapa revisión/aprobación de Frame.io; soporte a cierre acordado |
| Explicar diferencias del dinero | Entender factura, bruto, comisión, conversión, reembolso y liquidación | Matching sugerido y explicación; cálculos fuera del LLM, registros PayPal | Conciliación ya es categoría existente; útil, novedad específica no demostrada |
| Vista previa del costo del reembolso | Saber efecto sobre cliente y saldo antes de aprobar | Explicar cifras verificadas y ejecutar reembolso autorizado | Base funcional útil; condiciones dependen de país/producto |
| Expediente de disputa | Reunir pruebas existentes, requisitos y faltantes | Extracción con referencias; Disputes API si hay permisos | PayPal ya ofrece gestión de disputas; no prometer ganar ni fabricar evidencia |
| Distinguir pagado, retenido y disponible | Evitar comprometer dinero que aún no puede usarse | Explicar estados accesibles y escenarios | No liberar fondos ni garantizar fechas; viabilidad de datos pendiente |
| Entender y seguir cancelación de suscripciones | Saber qué autorización o contrato se canceló | Interpretar confirmaciones; acción solo con capacidad comprobada | Otro público/flujo. No hay acceso universal supuesto a suscripciones de un comprador |
| Detectar posible pago repetido o intento incompleto | Revisar transacciones que parecen duplicadas antes de volver a cobrar o devolver | Relacionar registros y explicar incertidumbre | Dos movimientos no prueban doble cobro; PayPal ya tiene mecanismos técnicos de idempotencia |
| Revisar pedido antes de pagar | Detectar diferencias de dirección, moneda, entregable o fecha contra el acuerdo | Comparar y pedir confirmación antes del checkout | Más pertinente a comercio físico; no cambiar pagos completados ni certificar protección |
| Explicar una solicitud de pago sospechosa | Comprobar si corresponde a algo acordado | Señalar discrepancias y orientar a verificación oficial | No clasificador infalible de fraude; seguridad de facturas ya atendida por PayPal |
| Agrupar avisos y señalar qué requiere acción | Reducir ruido de notificaciones repetidas | Agrupar por operación y resumir pendientes | Idea secundaria; correo solo con acceso autorizado, no necesario para demo |
| Asistencia y accesibilidad del checkout | Facilitar comprender y completar los pasos | Ayuda contextual, interfaz propia accesible y confirmación explícita | No sustituir pruebas de teclado/lector por score de IA ni prometer corregir todo el checkout alojado |

Las últimas cinco oportunidades provienen de exploración adicional. Enlaces de relatos: [posible pago repetido](https://www.reddit.com/r/paypal/comments/ijvizu/), [notificación faltante y trabajo manual](https://www.reddit.com/r/paypal/comments/1cnmn35/), [dirección](https://www.reddit.com/r/paypal/comments/1k389ab/), [avisos](https://www.reddit.com/r/paypal/comments/1p1sf59/email_notifications_about_split_payments/), [accesibilidad](https://www.reddit.com/r/webdev/comments/1wz3ilm/paypal_button_links_are_not_accessible/). Son señales para investigar, algunas antiguas, no evidencia de fallos vigentes de todo PayPal. [Ayuda oficial sobre solicitudes engañosas](https://www.paypal.com/us/cshelp/article/what-are-invoice-scams-and-money-request-scams-on-paypal-help1059).

## C. Modelos predictivos: conservar, pero requieren datos

| Idea | Pregunta | Condición antes de ofrecerla |
|---|---|---|
| Fecha de cobro y liquidez | ¿Qué cobros pueden llegar tarde y cómo afecta a mis gastos? | Historial etiquetado, evaluación temporal; Float ya ofrece previsión/escenarios |
| Devoluciones esperadas | ¿Cuántos pedidos podrían devolverse y qué importe representan? | Datos adecuados de comercio, probabilidades calibradas; no trasladar tasas a freelancers |
| Dinero expuesto a devolución | ¿Cuánto de lo cobrado podría tener que devolver en cada horizonte? | Estimar importes y probabilidades de forma evaluada; escenario determinista si no hay datos |
| Cancelación de reservas | ¿Qué reservas podrían cancelarse y qué espacios quedan? | Datos del sector y del instante de decisión; ampliaría el público |
| Abandono de suscripciones | ¿Qué suscripciones podrían no renovarse? | Datos propios y evaluación; PayPal ya tiene recuperación de pagos fallidos |

No entrenar con hoteles, telecomunicaciones o compras de ropa y presentar precisión para freelancers. No llamar predictor a datos hardcodeados. Datasets, sesgos y evaluación: [investigacion-prediccion.md](investigacion-prediccion.md).

## D. Idea inicial y base que se conserva

La idea original reunía **cambios y extras + seguimiento de cobros + cancelaciones/reembolsos** para freelancers. Sigue siendo útil, pero no se presenta como innovación exclusiva.

- Clientes/proyectos, documentos y términos versionados, fuente de conocimiento y referencias por respuesta.
- Asistente libre por proyecto y asistente flotante general, con permisos y contextos separados.
- Historial de acuerdos, solicitudes, cobros, devoluciones y conversaciones, relacionado mediante IDs.
- Comparación de solicitudes contra alcance, borrador de extra, aceptación y cobro.
- Recordatorios revisados por el profesional y reembolso aprobado con confirmación del proveedor.
- JSON normalizado actual como fixture; frontend simulado no equivale a integración ni seguridad real.

HoneyBook ya agrupa gestión de clientes, contratos, propuestas e invoices con IA; ScopeDue cubre cambios/aprobación/evidencias; ChangeProof y varias herramientas ya anuncian detección de extras con IA. Se conserva la base para ejecutar una solución, pero el relato principal debe centrarse en una tarea más específica.

## Qué priorizar para nuestra demo

**Apuesta recomendada:** conflicto de instrucciones → sala de alternativas → acuerdo versionado → pago PayPal sandbox confirmado. El detective del bloqueo sirve como pregunta de entrada y la línea de tiempo como evidencia, sin crear más módulos por cada nombre.

**Segunda historia posible:** cancelación a mitad → cierre acordado → reembolso sandbox. Elegirla si los casos reales del equipo muestran más urgencia o si la primera no se valida. No comprometer dos recorridos complejos completos por acumular funciones.

**Futuro:** práctica de negociación, negociación multiagente, predicción y expansiones a tiendas/reservas/suscripciones. Todas permanecen documentadas.

Para decidir: comparar el recorrido completo con alternativas, obtener casos anonimizados autorizados, comprobar si ambas partes entienden las opciones y verificar capacidades de la API antes de diseñar acciones. No afirmar exclusividad, reducción de disputas o aumento de ingresos sin evidencia.

## Fuentes competitivas consultadas

- ScopeDue: https://scopedue.com/features/change-request-approval/ y https://scopedue.com/help/client-approval-links/
- ChangeProof: https://changeproof.linkvault.biz/
- Aitaskora: https://aitaskora.com/
- Fenscope: https://fenscope.com/
- Pactelio: https://pactelio.com/
- Rougelio: https://rougelio.com/
- Frame.io: https://frame.io/features/review-and-approval
- Negosim: https://negosim.ai/
- ParleyLab: https://github.com/IEEE-VIT/ParleyLab/
- Spendesk: https://www.spendesk.com/blog/ai-in-accounts-payable/
- HoneyBook: https://www.honeybook.com/ai-information
- Float: https://www.floatapp.com/product
- Upwork, devolución de pagos: https://support.upwork.com/hc/en-us/articles/211062088-How-to-request-a-refund-from-a-freelancer-or-agency

Evidencia de problemas y límites técnicos: [problemas-reddit.md](problemas-reddit.md). Visión e implementación: [propuesta-consolidada.md](propuesta-consolidada.md), [ideas-y-alcance.md](ideas-y-alcance.md), [ideas-futuras.md](ideas-futuras.md), [modelo-de-datos.md](modelo-de-datos.md). Este catálogo conserva variantes, pero agrupa las que resuelven la misma tarea.
