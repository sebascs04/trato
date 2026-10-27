# Trato — propuesta consolidada

23 de octubre de 2026. Síntesis de las ideas del equipo y la investigación documentada. No implica que todas las funciones estén implementadas ni validadas.

Actualización de prioridades: el [catálogo consolidado de ideas](catalogo-ideas.md) reúne todas las líneas exploradas y ordena primero las combinaciones con potencial de diferenciación. Sustituye el orden de exploración de este documento; sus tablas siguen describiendo el estado previo, no compromisos de implementación.

## La propuesta

**Trato conecta lo que acordaste, lo que entregaste y lo que ocurrió con tu dinero.**

Ayuda a freelancers y pequeños estudios de servicios digitales a gestionar acuerdos y explicar diferencias entre lo que esperan cobrar y lo que muestran sus registros. El usuario inicial sigue siendo el freelancer. Vendedores de assets y microtiendas son públicos posibles para una expansión, no públicos ya validados.

La pregunta de entrada puede ser «¿Qué pasó con este proyecto o este pago?». El asistente consulta fuentes del contexto autorizado, reconstruye el recorrido y propone una acción revisable. No interpreta cada discrepancia como fraude ni supone que una parte tiene razón.

## Tres áreas con una finalidad distinta

### 1. Acordar el trabajo

- Comparar una solicitud con el alcance aceptado.
- Distinguir revisiones incluidas, extras y ambigüedades.
- Preparar alternativas de precio, alcance y plazo con datos aportados por el profesional.
- Registrar aceptación explícita y versión del acuerdo.
- Preparar el cobro del adicional mediante PayPal cuando corresponda.

### 2. Entender el dinero

- Relacionar solicitud de pago, pago, comisión, conversión, reembolso y liquidación, si los registros necesarios existen.
- Separar importe propuesto, pendiente, pagado y disponible. Un pago completado no implica necesariamente dinero retirable.
- Explicar diferencias con cifras de origen y referencias verificables.
- Previsualizar el efecto de un reembolso con las condiciones aplicables al país y producto.
- Preparar seguimiento de pagos pendientes con aprobación humana.

No inventar comisiones, tipos de cambio ni fechas de liberación. La API puede no exponer toda la información de la interfaz de PayPal; verificar acceso antes de comprometer una función. Una exportación importada debe identificarse como tal.

### 3. Resolver y cerrar

- Revisar cancelaciones según acuerdos y entregables.
- Preparar una propuesta de cierre con saldo o reembolso, sin determinar derechos legales automáticamente.
- Organizar documentación existente ante una disputa y mostrar lo que falta.
- Enviar información o ejecutar un reembolso solo tras aprobación y si la integración lo permite.
- Registrar la respuesta verificada del proveedor, sin equiparar aprobación a operación completada.

## Recorrido distintivo que explorar

El freelancer abre un cliente o selecciona una transacción. Trato muestra:

1. Qué se acordó y dónde está la evidencia.
2. Qué solicitudes, entregas y pagos están relacionados.
3. Cómo se explica una diferencia de importe o estado.
4. Qué información falta o qué asociación requiere revisión.
5. Qué siguiente acción puede aprobar el profesional.
6. Qué ocurrió realmente después de la respuesta de PayPal.

La interacción de demostración propuesta es «Explícame esta diferencia» y terminar con una acción sandbox verificable. Es una hipótesis de diferenciación; todavía hay que contrastarla con competidores y usuarios.

## Alcance priorizado

| Función | Prototipo actual | Prioridad propuesta |
|---|---|---|
| Clientes, proyectos, documentos y versiones | Frontend simulado | Base del MVP |
| Asistente por proyecto y general | Frontend simulado; sin modelo | Base del MVP |
| Cambios, cobros y reembolsos | Recorridos predefinidos | Un recorrido real completo primero |
| Historial con fuentes | JSON ficticio y acciones en memoria | Base del MVP |
| Explicar diferencia bruto/neto/reembolso | Investigación | Primera extensión a evaluar |
| Conciliar pagos y documentos | Investigación | Prueba acotada a PayPal y un formato de entrada |
| Gestión de disputas y evidencias por API | Investigación; permisos sin comprobar | Posterior al recorrido central |
| Entender retenciones | Investigación; datos accesibles sin comprobar | Solo información confirmada |
| Predecir devoluciones/cancelaciones/cobros | Sin modelo ni datos propios evaluados | Investigación futura |
| Simulador de negociación y demás ideas creativas | Documentadas | Experimentos posteriores |

No intentar cubrir varias pasarelas, países y monedas en la primera demo. Si un caso necesita convertir monedas, usar importes y tasas confirmadas o un escenario explícitamente ficticio; nunca presentarlo como cotización garantizada.

## Navegación propuesta

- **Vista general:** pendientes y discrepancias que requieren atención.
- **Clientes:** proyectos, asistente contextual e historial.
- **Documentos y términos:** fuentes y versiones aplicables.
- **Cambios y extras:** propuestas pendientes de decisión.
- **Cobros pendientes:** solicitudes que faltan pagar.
- **Reembolsos:** solicitudes y operaciones relacionadas.
- **Asistente flotante:** consultar una vista transversal del propio estudio, con cada dato atribuido a su cliente, o acotar a un proyecto.

La explicación de un pago puede abrirse desde su registro o el asistente. No añadir una sección por cada idea sin comprobar que necesita una tarea o navegación propia.

## Modelo de datos

Conservar entidades relacionadas por ID. La fixture actual y sus relaciones están en `modelo-de-datos.md`. Para conciliación, evaluar entidades adicionales como payments, payment_fees, currency_conversions, settlements, imported_documents y reconciliation_links. Distinguir invoices (solicitud) de payments (movimiento real), y payment de settlement (liquidación/disponibilidad).

No almacenar nombres o documentos completos repetidos en cada movimiento. Una asociación inferida por IA tiene estado propuesto y confianza/justificación; solo una asociación confirmada se trata como vínculo definitivo. El LLM no decide importes ni estados financieros. El backend valida propiedad, proyecto, proveedor y moneda.

El agente general y los agentes por proyecto no comparten historiales automáticamente. La autorización debe existir en el backend, no solo en el selector visual.

## Límites explícitos

- No liberar dinero retenido ni revertir bloqueos de cuenta.
- No garantizar victoria en disputas o recuperación de comisiones.
- No inventar documentos fiscales o evidencias de entrega.
- No cancelar universalmente suscripciones de otras empresas sin capacidades verificadas.
- No mover dinero por una recomendación del modelo sin aprobación.
- No llamar predicción real a cifras hardcodeadas o probabilidades sin evaluación.
- No describir testimonios de Reddit como tasas representativas ni políticas oficiales.

## Evidencia e investigación de apoyo

- `problemas-reddit.md`: relatos y oportunidades sobre retenciones, comisiones, moneda, conciliación, disputas y suscripciones.
- `investigacion-prediccion.md`: datos disponibles, limitaciones y coincidencias con productos existentes.
- `ideas-futuras.md`: negociación, práctica, evolución de acuerdos y cierre.
- `ideas-y-alcance.md`: visión original y decisiones previas.
- `stack-y-costos.md`: opciones de infraestructura y créditos investigados.

Este documento es la síntesis actual de producto. El README describe el estado del código; la síntesis no amplía por sí sola lo implementado.
