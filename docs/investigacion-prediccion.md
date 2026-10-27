# Investigación — predicción y diferenciación

23 de octubre de 2026. Investigación de alternativas; no cambia el público ni el MVP actual. Las ideas no tienen exclusividad ni novedad comercial demostrada. No se ha descargado ni entrenado ningún modelo.

## Hallazgos y datos disponibles

### Devoluciones de comercio electrónico

NRF estima que el 19,3 % de ventas online de EE.UU. se devolvería en 2025. Es una estimación agregada de comercio minorista, no una tasa para servicios freelance ni una probabilidad utilizable para cada cliente. https://cdn.nrf.com/research/2025-retail-returns-landscape

El artículo original ASOS GraphReturns describe compras con etiquetas de devolución/conservación y enlaza un dataset en OSF. Incluye aproximadamente 1,4 millones de eventos de entrenamiento y 1,5 millones de prueba. El artículo compara modelos tabulares con grafos. Importante: la selección incluye clientes con al menos una devolución; los autores advierten que las tasas observadas no representan las tasas reales de ASOS. El acceso actual, archivos y licencia del dataset deben comprobarse antes de incorporarlo; la licencia del artículo no sustituye la licencia de los datos.

Fuente original: https://arxiv.org/html/2302.14096v1
Repositorio enlazado por autores: https://osf.io/c793h/

### Cancelaciones de reservas

Hotel Booking Demand describe dos hoteles y 119.390 reservas, con cancelaciones y estancias completadas, correspondientes a 2015–2017. Datos antiguos y de otro sector; no validan predicciones de sesiones freelance ni de un hotel nuevo sin evaluación adicional.

Fuente original: https://pmc.ncbi.nlm.nih.gov/articles/PMC6297060/

### Pagos atrasados y liquidez

La investigación encargada por DBT y Small Business Commissioner en 2025 estima que el 28 % de negocios de Reino Unido se ve afectado por pagos atrasados anualmente. Esto respalda el problema, pero no aporta por sí mismo una tabla de facturas individuales para entrenar un predictor de Trato.

Fuente oficial: https://www.smallbusinesscommissioner.gov.uk/late-payments-research-2/

### Suscripciones y abandono

La retención y los pagos fallidos son otro problema posible. PayPal ya documenta reintentos y recuperación de saldo; duplicar esos reintentos no sería una diferenciación fuerte. Los datasets de abandono de telecomunicaciones no deben presentarse como validación de un predictor para freelancers o creadores.

https://developer.paypal.com/subscriptions/payment-failure-retry/
https://archive.ics.uci.edu/dataset/563/iranian+churn+dataset

## Productos existentes que reducen la novedad de ideas genéricas

- HoneyBook reúne clientes, contratos, propuestas, invoices e IA. https://www.honeybook.com/ai-information
- Float ofrece previsión de caja y escenarios. https://www.floatapp.com/product
- Loop documenta agentes para automatizar/revisar devoluciones. https://help.loopreturns.com/en/articles/12608193

La existencia de estos productos no descarta Trato, pero obliga a definir una interacción, usuario o resultado diferencial. Esta revisión es inicial y no demuestra ausencia de competidores para las propuestas nuevas.

## Alternativas de producto

| Problema | Predicción propuesta | Decisión que ayuda a tomar | Relación con PayPal | Encaje |
|---|---|---|---|---|
| Cobros que llegan después de los gastos | Fecha probable de cobro y escenarios de liquidez | Qué factura revisar primero y qué compromiso de entrega/pago es viable | Invoicing y confirmación de pagos | Compatible con Trato, pero falta historial etiquetado |
| Devoluciones que sorprenden al vendedor | Reembolsos esperados por cohorte y monto expuesto | Planificar liquidez y revisar productos/procesos | Pago y reembolso de una compra verificables | Mejor dataset inicial; implica explorar microtiendas |
| Cancelaciones que dejan reservas vacías | Cancelaciones por reserva y volumen semanal | Pedir confirmación y ofrecer reprogramación | Cobrar reservas/reembolsar según condiciones aprobadas | Reservas de hospitalidad; exige decidir público |
| Abandono de suscripciones | Probabilidad de no renovar | Ofrecer una pausa o cambio con consentimiento | Subscriptions | Otro producto; evitar ampliar el MVP por acumular modelos |

## Hipótesis distintiva para investigar

**«¿Cuánto de lo que cobré todavía podría tener que devolver?»**

Para una microtienda, un panel relaciona pedidos cobrados, ventana de devolución y probabilidad calibrada de devolución. Permite explorar el efecto de una devolución grande sobre el dinero disponible y ejecutar un reembolso sandbox aprobado.

No es simplemente un score rojo/verde por cliente. La experiencia propuesta conecta horizonte temporal, dinero expuesto, explicación y una acción. No se afirma que esta combinación sea inédita. Una estimación no limita el derecho de devolución ni identifica al cliente como fraudulento.

Una aproximación al número esperado de pedidos devueltos es la suma de probabilidades calibradas por pedido; una aproximación monetaria requiere estimar además el importe reembolsable. Distinguir pedidos, productos y clientes únicos. No usar un porcentaje agregado ni un LLM para inventar probabilidades. La estimación con ASOS no representa directamente la cartera de otro comercio por el sesgo de selección y cambio de distribución.

Para Trato freelance, una alternativa sería mostrar el efecto de cancelar una fase según entregables y condiciones aceptadas; eso puede comenzar como simulador determinista. No etiquetarlo como predictor entrenado sin datos de proyectos y cancelaciones reales.

## Cómo decidir si seguir

1. Elegir un usuario y un resultado que podamos demostrar. No decidir primero el algoritmo.
2. Entrevistar usuarios sobre frecuencia, montos y decisiones actuales; pedir ejemplos anonimizados y autorizados.
3. Comprobar descarga, licencia, etiquetas y variables disponibles en el instante de predicción.
4. Comparar una tasa histórica y un modelo sencillo antes de redes complejas.
5. Separar entrenamiento y evaluación por tiempo; excluir variables posteriores al desenlace. Evaluar fuga de información por cliente y producto.
6. Si se mostrarán probabilidades, comprobar calibración y error de agregados, además de discriminación. En clases desbalanceadas no basarse solo en accuracy.
7. Mostrar procedencia de datos e incertidumbre. Una demo con datos sintéticos explica el flujo, no acredita precisión real.
8. Si se proponen acciones para reducir devoluciones, validar ese efecto mediante evaluación de intervención. Un predictor no demuestra qué acción causará una mejora.

Se dispone de aproximadamente 20 días desde el 23 de octubre hasta el cierre publicado del 12 de noviembre. Elegir una sola apuesta adicional después de evaluar los datos y la utilidad; mantener Trato como implementación actual mientras se investiga.

## Segunda exploración — problemas específicos y coincidencia competitiva

Investigación adicional del 23 de octubre de 2026. Son líneas de exploración; no se modificó la aplicación.

- ScopeDue describe aprobaciones de cambios, precios, condiciones de pago y un registro de evidencias. Hay coincidencia importante con el núcleo actual de Trato. La página apareció en búsqueda; la apertura directa falló, por lo que no se verificó el producto funcionando. Fuente: https://scopedue.com/blog/how-to-document-client-approval-for-freelance-work/
- Frame.io ofrece revisión, comentarios y comparación de versiones. Comparar entregas o centralizar feedback tampoco basta para demostrar novedad. Fuente oficial: https://frame.io/features/review-and-approval
- Wripple reporta falta de claridad como desafío para el 38 % de freelancers de su estudio de 2024. Fuente del organizador: https://www.wripple.com/insights/team-up-deep-dive-addressing-persistent-process-pain-points
- Un estudio de 2026 sobre divulgación del uso de IA en trabajo freelance identifica expectativas y políticas poco claras entre clientes y profesionales. Esto abre una hipótesis sobre acuerdos explícitos de uso de IA; no aporta un predictor validado de reembolsos. Fuente: https://arxiv.org/abs/2603.07459

### Hipótesis A — resolver feedback contradictorio antes de cobrar retrabajo

Recibir solicitudes de varias personas del mismo cliente, identificar instrucciones incompatibles sobre el mismo entregable y preparar una decisión para la persona autorizada. El agente muestra las fuentes y propone alternativas de alcance, plazo e importe. Solo tras aprobación genera el cobro PayPal correspondiente.

La prueba inicial usaría versiones y mensajes de ejemplo, comparando contra una clasificación humana. No afirmar detección perfecta ni probabilidad de conflicto sin evaluación. Diferenciación pendiente de contrastar con productos de revisión y aprobación existentes.

### Hipótesis B — planificar la salida de un proyecto cancelado

Reconstruir entregables terminados, entregables aceptados, importes pagados y condiciones. Proponer un cierre con trabajo entregable, saldo y posible reembolso, con cantidades calculadas desde reglas revisadas por las partes. PayPal ejecuta únicamente la operación aprobada. No decidir derechos legales ni arbitrar automáticamente.

Medir si los usuarios pueden reconstruir más rápido qué falta por acordar. No llamar predicción a una liquidación basada en condiciones conocidas.

### Hipótesis C — acuerdo explícito sobre uso de IA

El cliente y el freelancer acuerdan antes de comenzar qué herramientas, datos y entregables pueden involucrar IA y qué revisión humana se requiere. Un cambio posterior genera una propuesta versionada e importe aprobado si corresponde.

No usar detectores de texto o imagen para certificar que algo fue hecho sin IA. Los registros son declaraciones y evidencias del proceso, no prueba absoluta de autoría. La conexión PayPal sería el pago de la propuesta aprobada; evaluar si es suficientemente central antes de priorizar esta idea.

### Cómo seguir investigando

Comparar en detalle el flujo propuesto con productos existentes y buscar evidencia de tareas mal resueltas. Una funcionalidad ausente de una página de marketing no prueba que el competidor no la tenga. Priorizar experimentos de producto medibles sobre añadir más módulos o probabilidades sin datos.
