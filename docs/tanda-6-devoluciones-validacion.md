# Tanda 6 — Implementación y verificación local

Fecha: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Implementación aprobada por Gianfranco. Código preparado localmente, sin commit, push, PR ni despliegue. Las pruebas usaron PostgreSQL temporal real, dobles explícitos de PayPal y API de navegador. No hubo llamadas financieras conectadas, correos reales, IA ni cambios en infraestructura compartida.

## Entrega por secciones

- **Registro canónico:** tres migraciones nuevas posteriores a tanda 5. Comprobantes únicos por ambiente/merchant/refund ID, aplicaciones únicas, incidencias, comprobaciones y consentimientos de recuperación. RLS y escritura restringida al backend. Los éxitos anteriores con ID se migran sin volver a sumar; los agregados sin comprobante conservan su evidencia y requieren revisión.
- **Intentos:** historial por operación, identidad/payload inmutables y un solo intento activo. Una secuencia `attempt_no` determina cuál es el último intento, independientemente del reloj. La operación conserva el importe acordado; el intento nuevo cubre solo su saldo pendiente.
- **Conciliación:** consulta canónica, descubrimiento en la orden y pistas verificadas, atribución por ID conocido o referencia exacta persistida. Sin referencia suficiente o con candidatos múltiples se mantiene la incertidumbre. Recuperar una ejecución interrumpida invalida su coordinación para que el handler anterior no reclame otra captura.
- **Recuperación financiera:** replay separado y explícito del mismo payload/request ID, con límite local conservador de 44 días y exclusión de replay simultáneo. No se crea otra identidad por timeout o antigüedad. Tras fallo definitivo se exige nueva comprobación, digest y consentimiento para reservar un intento nuevo; ejecutarlo sigue siendo una acción adicional.
- **Dinero externo:** se registra antes de atribuirlo al acuerdo. Aplicarlo exige revisión explícita y comprobar propietario, captura, versión, estado, importe y ausencia de incertidumbre. Un comprobante parcial reduce solo el saldo de esa asignación. Los excesos se conservan completos y producen una incidencia; no se recortan ni se ocultan para cuadrar el acuerdo.
- **Webhook:** POST `/api/v1/refunds/webhooks/paypal`, independiente del callback antiguo. Postback con listener dedicado, límite de cuerpo, esquema v2, JSON sin claves duplicadas, inbox privado durable, deduplicación y conflicto de contenido. Solo consulta recursos canónicos; nunca inicia reembolsos. Firma inválida no escribe hechos y fallo de proveedor/DB queda visible y reintentable.
- **Historial único:** ampliación de `/projects/{id}/activity`, consultas paginadas y grupos con tipo/ID propios. Solicitud, envío, feedback revisado, aceptación, autorización, comprobante confirmado y cierre. El ID del hito monetario deriva del comprobante; refresh, webhook y aplicación externa no generan otro movimiento. Cierre sin segundo importe. ES/EN, moneda/fechas por locale y Lucide en el render existente.

## Rutas nuevas

Todas las acciones de recuperación requieren JWT de propietario. Los consentimientos requieren `confirmed: true`, snapshot, intento, revisión esperada, notas e `Idempotency-Key`; no aceptan importes ni resultados del proveedor desde el navegador.

| Ruta relativa a `/api/v1/refunds/{id}/financial-operations/{operation_id}` | Acción |
| --- | --- |
| `/reconcile` | Consulta y atribución sin devolver dinero |
| `/retry-checks` | Comprobación nueva del saldo restante |
| `/replay` | Repetición explícita de la misma identidad, bajo condiciones |
| `/external-receipts` | Aplicación contable explícita, sin transferencia |
| `/retry-authorizations` | Consentimiento y reserva para un intento nuevo tras prueba definitiva |

GET financiero y la consulta existente de comandos devuelven intentos, aplicaciones, incidencias y estado actual. No reintentan dinero al leer.

## Resultados observados

| Verificación | Resultado |
| --- | --- |
| Suite API | 298 pruebas aprobadas; incluye 10 nuevas de recuperación/HTTP y 4 de actividad |
| Adaptador PayPal raíz | 25 pruebas aprobadas; 11 pruebas de dominio/adaptador repetidas con prioridad de importación de la copia raíz |
| Migraciones | 35 aplicadas desde esquema vacío, con evolución desde tanda 5 y éxito canónico previo |
| Conservación de evidencia previa | Comprobado que todos los campos originales del intento de tanda 5 permanecen equivalentes tras migrar |
| SQL | 7 suites aprobadas: conciliación, finanzas, expedientes, operaciones, documentos, pedido único y ciclo de propuestas |
| Integración financiera de tanda 5 | 17 grupos de escenarios aprobados con SQL real y proveedor doble |
| Integración nueva | 17 grupos aprobados: ID perdido, ambigüedad, replay, vencimiento, fallo definitivo, dinero externo total/parcial/pendiente/excesivo, webhook, fallos de confirmación, carreras y cierre multipago |
| Concurrencia anterior | 4 carreras SQL aprobadas |
| Chromium de devoluciones | 20 pruebas aprobadas, incluidas ES/EN y móvil |
| Chromium de historial | 8 pruebas aprobadas; se solapan las 4 nuevas con la suite anterior |
| Frontend | `npm run check`, 46 pruebas CJS, archivo de pruebas MJS y 1.712 claves ES/EN aprobados |
| Reinicio | Estado financiero de comprobantes, aplicaciones, intentos, consentimientos, incidencias y reservas conservado en la comprobación realizada antes del último ajuste de secuencia |

La ejecución general inicial de Chromium tuvo 47/56 aprobadas. Se corrigieron los fixtures de historial que carecían de importe/moneda y el selector ambiguo de la prueba nueva, y su repetición específica aprobó. Persisten dos pruebas generales antiguas ajenas a devoluciones: creación de proyecto espera el botón anterior «Crear proyecto» y la vista inicial espera el texto anterior «Guarda lo que han conversado». No se cambió el producto de planificación para hacerlas pasar ni se afirma que toda la suite general esté verde.

## Cierre de las repeticiones y límites pendientes

Una repetición detectó retroceso del reloj local y reveló que ordenar intentos por fecha podía seleccionar uno anterior. Se sustituyó por `attempt_no` persistido y se repitieron con éxito migraciones, SQL e integración financiera/recuperación. Después se añadió un rechazo explícito de consentimientos sobre intentos que ya no sean el último y una regresión que fuerza retroceso del reloj.

La última repetición adicional fue rechazada en la interfaz de permisos; no se insistió. Quedan para la verificación de tanda 7 esa regresión forzada, la comprobación del último guard adicional y la repetición de reinicio sobre la revisión final con secuencia. La comparación inicial del runner antiguo de snapshots se tomó antes de crear más fixtures y por ello no coincidió; no se presenta como evidencia de pérdida de persistencia.

**Actualización del 2 de noviembre:** esos tres pendientes quedaron aprobados durante [la preparación de la prueba integral](preparacion-prueba-integral-devoluciones.md), sobre PostgreSQL temporal aislado con la revisión final de `attempt_no`. No cambian el resultado histórico de las ejecuciones anteriores ni acreditan un recorrido financiero conectado.

Las incidencias bloquean nuevas acciones financieras y requieren revisión; no se añade un mecanismo automático para borrarlas o resolver evidencia insuficiente. Un cambio del saldo externo que invalida una propuesta aceptada no autoriza modificar el acuerdo ni crear otra identidad de pago.

No se registró un webhook remoto ni se configuró un listener inventado. `repos/trato-api/.env.example` incorpora `PAYPAL_REFUND_WEBHOOK_ID=` vacío. Para conectarlo se necesita registrar la URL HTTPS de esta ruta en la app Sandbox, obtener su ID y coordinarlo en tanda 7. No reutilizar el listener de checkout ni aceptar eventos del simulador sin postback válido.

Las migraciones compartidas, el formulario financiero completo, el recorrido real en PayPal Sandbox y la recepción HTTPS real siguen correspondiendo a tanda 7. Los resultados locales no acreditan devolución ni abono al cliente.

## Recursos de pruebas

PostgreSQL se ejecutó únicamente en `/tmp/trato-refunds-pg`, por socket privado sin puerto TCP. Chromium y su biblioteca temporal se descargaron en `/tmp/trato-refund-browser`; la web de pruebas usó el puerto reservado 5173. El cierre detiene solo esos procesos propios y elimina sus bases, binarios, registros y capturas temporales después de documentar resultados. No se modifican `.env`, credenciales, Weaviate, Redis ajeno ni QAMAQ.
