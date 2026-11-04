# Plan de implementación de devoluciones conectadas

Fecha: 1 de noviembre de 2026.
Rama de trabajo: `codex/devoluciones-reales`.
Estado al 2 de noviembre de 2026: tandas 1–3 implementadas y verificadas localmente. Tanda 4 aprobada, incluido alcance individual y cierre multipago; implementación y validación en `tanda-4-devoluciones-validacion.md`. Migraciones compartidas pendientes. Tanda 5 aprobada, implementada y verificada localmente; ver `tanda-5-devoluciones-validacion.md`. Tanda 6 implementada localmente; validaciones principales aprobadas y límites de la última repetición documentados en `tanda-6-devoluciones-validacion.md`. Tanda 7: frontend autorizado, implementado y validado en `tanda-7-frontend-validacion.md`; prueba integral conectada pendiente.

## Objetivo y alcance

Completar TRATO-13, TRATO-14, TRATO-15 y TRATO-16: expediente persistente de cierre, propuesta versionada, envío y aceptación documental revisada, autorización financiera separada, reembolso PayPal Sandbox confirmado e interfaz conectada ES/EN.

El cierre puede resultar en devolución total, parcial o cero. Debe distinguir trabajo reconocido, gastos, penalidades y otros ajustes justificados; una cancelación no implica automáticamente incumplimiento ni penalidad. Cada deducción necesita concepto, importe, evidencia y revisión humana. Registrar cláusula exacta, base y porcentaje cuando corresponda; impedir duplicar conceptos. La aplicación no determina exigibilidad legal. Un saldo a cobrar requiere una operación independiente, nunca un reembolso negativo.

El importe negociado y el límite financiero son datos distintos. Ninguna devolución supera el remanente verificable de la captura; las comisiones de PayPal se muestran separadas y no se deducen automáticamente al cliente. El cambio pagado original permanece inmutable.

## Método obligatorio por tanda

1. Analizar la tanda y revisar el código vigente, dependencias y estado del checkout.
2. Explicar archivos previstos, decisiones, migraciones, pruebas, límites y criterios de aceptación. Resolver decisiones pendientes antes de implementar.
3. Esperar aprobación explícita del usuario para implementar esa tanda.
4. Implementar únicamente el alcance aprobado.
5. Ejecutar pruebas pertinentes; probar en la aplicación cuando exista un recorrido verificable. Distinguir pruebas con dobles, integración local y proveedor Sandbox.
6. Presentar resultados, fallos y pendientes. Esperar revisión del usuario antes de avanzar a la siguiente tanda.

Una aprobación no autoriza las tandas siguientes, push, PR ni merge. No marcar una tanda terminada por tener código sin verificar. Una prueba omitida o bloqueada se registra como tal. Actualizar este documento con evidencia al cerrar cada tanda.

## Tanda 1 — Contrato de dominio y cálculo revisable

**Backlog:** base de TRATO-13.

- Revisar propuestas, pagos, documentos, reglas de pedido abierto y simulación existente.
- Acordar si el cierre afecta un cobro, parte del servicio o todo el proyecto, y su convivencia con un pedido abierto.
- Limitar inicialmente la ejecución a capturas verificables registradas en Trato; no inventar anticipos a partir de documentos. Mantener el merchant Sandbox actual; múltiples cuentas de freelancers requieren alcance separado.
- Definir DTO/esquemas, estados, permisos, fuentes, revisión exacta y desglose económico. El importe propuesto no se deriva de un porcentaje de tareas.
- Precisar cómo representar trabajo reconocido y devoluciones anteriores sin descontarlos dos veces, así como porcentaje/base/redondeo y ajustes a favor de cada parte.
- Implementar contrato y validaciones de dominio aprobados, sin llamadas financieras ni cambios al flujo simulado como sustituto.

**Verificación:** pruebas de devolución total/parcial/cero, penalidad respaldada o sin respaldo, datos faltantes, doble deducción, devoluciones previas, importes inválidos y exceso del remanente. Sin interfaz utilizable todavía, verificar por tests.

**Salida:** contrato documentado y validaciones probadas; decisiones de negocio resueltas antes de diseñar migraciones.

## Tanda 2 — Persistencia y API del expediente

**Backlog:** TRATO-13.

- Migraciones coordinadas para solicitud, evidencias, revisiones, instantáneas y eventos; referencias a propietario, proyecto, pago y captura.
- API autenticada para registrar, consultar y preparar propuesta. Borrador editable sin aumentar versión pública; enviado inmutable, nueva versión con feedback real.
- RLS/permisos, idempotencia y bloqueo transaccional del recurso financiero; integrar la regla de pedido abierto según contrato aprobado.
- Mantener inmutable el registro pagado original y consultar devoluciones anteriores.

**Verificación:** tests API y SQL de aislamiento, acceso directo, referencias cruzadas, reintentos, concurrencia y revisiones; reinicio conserva el expediente. Registrar aplicación y pruebas reales de migraciones por separado.

**Salida:** expediente real persistente y consultable, sin ejecución de reembolsos.

## Tanda 3 — Interfaz conectada de solicitud y propuesta

**Backlog:** parte de TRATO-16 y verificación visible de TRATO-13.

- Elegir pago elegible, registrar motivo y evidencia, revisar desglose y guardar borrador.
- Mostrar documentos, cláusulas, datos ausentes e historial de versiones; errores visibles sin datos de ejemplo como respaldo.
- Separar explícitamente el recorrido conectado de la simulación existente.
- Catálogos ES/EN, formato monetario y fechas por locale, accesibilidad e iconos Lucide.

**Verificación:** paridad ES/EN, tests de navegador y prueba en app de creación, edición, recarga, consulta y acceso inválido.

**Salida:** usuario puede preparar una propuesta real sin enviar ni devolver dinero.

## Tanda 4 — PDF, envío y aceptación de la versión exacta

Ampliación aprobada: devolución individual del pago inicial o una adenda cobrada y cierre del proyecto con todos sus cobros registrados, reparto explícito y una liquidación global. Patrón y límites en [cierre de proyecto multipago](cierre-proyecto-multipago.md). El backend verifica un pago inicial existente mediante consulta de orden/captura Sandbox y referencia de proyecto; este lote no crea su checkout. Tandas 5–7 deben autorizar, ejecutar y conciliar cada captura por separado.

**Backlog:** TRATO-14 y parte de TRATO-16.

- Generar PDF privado exacto por instantánea, con desglose, condiciones y referencias.
- Vista previa del correo y envío explícito con Gmail; conservar destinatario, hilo y PDF enviado.
- Registrar respuesta, feedback y aceptación documental revisada por humano de la versión enviada. No aceptar automáticamente por leer un correo.
- Nueva versión tras ajustes respaldados; no heredar aceptación. Cierre de importe cero sin llamada a PayPal.

**Verificación:** tests de contenido/hash, archivos privados, envío duplicado, revisión obsoleta y aceptación inválida; app para PDF, previsualización y versiones. Envíos reales de prueba solo con destinatario y acción autorizados.

**Salida:** propuesta enviada y aceptación trazable a su versión exacta.

## Tanda 5 — Reserva financiera y adaptador PayPal Sandbox

**Backlog:** ejecución de TRATO-15.

- Revisar documentación oficial vigente y elegibilidad por país/producto antes de fijar reglas.
- Añadir consulta de captura, emisión y consulta de reembolso al adaptador del servidor.
- Validar propietario, merchant, captura, moneda, importe aceptado y remanente; reservar importes de operaciones pendientes o inciertas bajo concurrencia.
- Autorización financiera explícita vinculada a versión e importe. Persistir identidad local y `PayPal-Request-Id` antes de llamar al proveedor.
- No mantener transacciones DB abiertas durante HTTP. Timeout conserva operación incierta; sin otra clave ni transporte alternativo automático.

**Verificación:** tests con transporte doble de éxito, rechazo, pending, cancelled, timeout, doble clic, concurrencia y evidencia incorrecta. No presentar estos tests como reembolsos Sandbox ejecutados.

**Salida:** ejecución segura preparada; confirmación asíncrona y validación completa continúan en tanda 6.

## Tanda 6 — Conciliación, webhooks e historial

**Backlog:** cierre técnico de TRATO-15 y parte de TRATO-16.

- Verificar firmas, deduplicar eventos y consultar resultado canónico; tolerar eventos repetidos o fuera de orden sin degradar confirmaciones válidas.
- Conciliar operaciones pendientes/inciertas y detectar diferencias por reembolsos emitidos fuera de Trato; definir recuperación segura cuando falte refund_id.
- Evitar duplicar devoluciones o liberar una reserva incierta. No reemitir automáticamente fuera de la retención de idempotencia del proveedor.
- Proyectar solo hitos confirmados al historial único. Conservar detalles técnicos en registros financieros.

**Verificación:** firmas inválidas, aislamiento, caída entre persistencia y respuesta, eventos duplicados/tardíos, devolución externa y recuperación. Integración con endpoint Sandbox accesible cuando esté configurado.

**Salida:** resultado financiero verificable y recuperable sin duplicados.

## Tanda 7 — Finalización de interfaz y prueba integral

**Backlog:** cierre de TRATO-16 y aceptación integral TRATO-13 a 16.

- Mostrar autorización, estado real y consulta de resultado; distinguir confirmación de PayPal de abono visible en banco.
- Fuentes oficiales con URL, fecha, país, producto y ámbito conservados por revisión; no prometer saldo global, conversión ni fecha de abono.
- Separar bruto, comisión original, neto, retenciones justificadas y devolución. Completar ES/EN y accesibilidad.
- Actualizar documentación y estado de backlog conforme a evidencia, sin declarar completado lo bloqueado.

**Verificación:** suites apropiadas API/SQL/frontend, paridad ES/EN y navegador; app de solicitud → propuesta con deducciones → PDF → envío → aceptación → autorización → devolución parcial Sandbox confirmada. Cubrir también cero, total, feedback, errores y persistencia tras recarga. Una prueba Sandbox requiere cuentas, captura y autorización concreta de ejecución; si faltan, queda pendiente.

**Salida:** criterios de los cuatro IDs demostrados y evidencia registrada. Sin publicación automática.

Roadmap de aceptación manual: [prueba integral de devoluciones](roadmap-prueba-integral-devoluciones.md). Incluye preparación técnica, pasos en la app, resultados esperados y acta; todavía no acredita ejecución conectada.

## Límites y coordinación

- No activar producción, nuevos proveedores, gasto, IA ni infraestructura ajena. Aclaración del usuario: construir primero la estructura sin IA; incorporar IA será otro requerimiento posterior, fuera de estas siete tandas.
- Antes de servicios: consultar `local-ports.json`, `docs/puertos-locales.md`, listeners y contenedores. No detener procesos ajenos.
- Coordinar archivos compartidos y migraciones antes de editar. Preservar los cinco archivos sin seguimiento detectados al preparar el plan; no incorporarlos por defecto.
- La simulación sirve como referencia de comportamiento, no como persistencia ni evidencia financiera real.

## Seguimiento

**Cierre actualizado al 3 de noviembre:** siete tandas implementadas e integradas en el alcance Sandbox aprobado. Ver [acta de cierre](cierre-validacion-devoluciones.md) para los dos recorridos manuales, la entrega/deduplicación de webhooks y los límites de cobertura. Los números de las actas por tanda son históricos.

| Tanda | Estado | Evidencia |
| --- | --- | --- |
| 1 | Implementada e integrada; cierre Sandbox documentado | 20 tests de dominio aprobados; suite API completa: 228 tests aprobados fuera del sandbox (la ejecución aislada quedó detenida). Sin prueba en app porque aún no hay rutas/UI conectadas. Contrato en `contrato-devoluciones-v1.md` |
| 2 | Implementada e integrada; cierre Sandbox documentado | `tanda-2-devoluciones-validacion.md`: 240 tests API, SQL de devoluciones, concurrencia y reinicio; fallo histórico de ingesta reproducido en baseline |
| 3 | Implementada e integrada; cierre Sandbox documentado | `tanda-3-devoluciones-validacion.md`: 242 tests API, 45 CJS + 6 MJS, ES/EN, SQL y 18 casos únicos Chromium aprobados |
| 4 | Implementada e integrada; cierre Sandbox documentado | `tanda-4-devoluciones-validacion.md`: multipago, PDF exacto, revisión, Gmail, respuestas y aceptación; límites de integración indicados |
| 5 | Implementada e integrada; cierre Sandbox documentado | `tanda-5-devoluciones-validacion.md`: 284 tests API, SQL, 17 escenarios financieros con proveedor doble y persistencia tras reinicio |
| 6 | Implementada e integrada; cierre Sandbox documentado | `tanda-6-devoluciones-validacion.md`: conciliación, webhook, intentos, dinero externo e historial; guard final, regresión de reloj y reinicio final aprobados en la preparación integral |
| 7 | Implementada e integrada; cierre Sandbox documentado | `tanda-7-frontend-validacion.md`: 4 pruebas de lógica, 7 Chromium y ES/EN; recorridos conectados posteriores y UX guiada documentados en el acta de cierre |

Referencias locales: `docs/backlog.md`, `docs/worker-flujo-devoluciones.md`, `docs/paypal-sandbox.md`, `AGENTS.md`.
