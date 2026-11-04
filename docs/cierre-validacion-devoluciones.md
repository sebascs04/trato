# Cierre de implementación de devoluciones

3 de noviembre de 2026. Rama de trabajo: `codex/devoluciones-reales`. Alcance aprobado: estructura y flujo conectado de devoluciones sin IA, PayPal Sandbox, correo y documentos, interfaz guiada. Publicación autorizada únicamente en la rama; sin PR ni merge.

## Recorridos manuales confirmados

| Caso | Resultado contrastado con PayPal Sandbox | Resultado en Trato |
| --- | --- | --- |
| Cierre global parcial | USD 12 de la adenda + USD 6 del inicial, ambos `COMPLETED` | USD 18 confirmados, cero reservados, expediente completado y proyecto cerrado |
| Individual total de adenda | USD 120, `COMPLETED` | Solo esa adenda afectada; proyecto conserva su estado `draft`; propuesta y pago originales conservan su bloqueo/historial |

Los casos se ejecutaron desde la aplicación por el usuario, con revisión de propuesta, envío Gmail, aceptación y autorización separada de la ejecución. Las consultas de comprobación posteriores fueron de solo lectura. Todos los importes financieros corresponden a fondos ficticios de Sandbox. No se acredita uso Live ni fecha de abono a un banco.

## Entrega y deduplicación de webhooks genuinos

Se registró un listener temporal dedicado con las cuatro suscripciones del adaptador, y se cargó su ID en la API. Se solicitaron mediante la API oficial de PayPal reenvíos de dos eventos ya existentes, dirigidos solo a este listener, sin crear capturas ni reembolsos:

- `WH-3BK517468D4862700-0BF781347F4446646` — devolución del inicial de USD 6.
- `WH-7UU73482FW3852432-02932901RY943312R` — devolución de la adenda de USD 12.

Primera ronda y repetición explícita: PayPal devolvió HTTP 202 en las cuatro solicitudes de reenvío. El túnel registró seis respuestas HTTP 200 al listener, incluidas entregas adicionales del proveedor. El código del endpoint verifica la firma con PayPal antes de registrar el evento.

La lectura administrativa del inbox privado confirmó exactamente dos filas para el listener de prueba: ambas `processed`, `attempts = 1`, `error_code = null`. El mismo ID de evento queda deduplicado dentro del namespace del listener. No se simuló la firma ni se utilizó el simulador como sustituto.

Comparación privada anterior/posterior sobre ambos proyectos: se conservan tres operaciones, tres intentos, tres comprobantes y tres aplicaciones. Permanecen iguales sus IDs, referencias, request IDs, payloads, estados e importes. Los timestamps de observaciones canónicas pueden actualizarse por consulta; no se usan para atribuir dinero adicional. La repetición no duplicó un reembolso ni generó otro intento.

## Comprobaciones de código para la publicación

- 91 pruebas API/dominio/workflow de devoluciones aprobadas, incluidos aislamiento, validaciones financieras, webhooks, idempotencia y Gmail. La primera ejecución en el sandbox de herramientas quedó bloqueada y fue detenida; la ejecución acotada fuera de esa restricción terminó correctamente en 2,481 segundos.
- Fixtures actualizados al ID canónico real de Gmail, al contenedor de diálogo y al reparto automático; no se alteraron las validaciones del proveedor para hacer pasar las pruebas.
- 17 pruebas del adaptador PayPal, 10 de formulario/controlador y 4 del panel financiero aprobadas. Sintaxis JavaScript y 1.841 traducciones ES/EN comprobadas antes del commit. La cobertura visual histórica de Chromium y sus límites están en las actas anteriores; no se presenta como repetición de Chromium sobre toda la nueva modal.

## Cierre y alcance de la entrega

TRATO-13 a TRATO-16 quedan implementados y validados para el alcance Sandbox aprobado. La UX guiada se ajustó con feedback del usuario sobre el recorrido real. Las siete tandas y las incidencias detectadas en esas pruebas quedan documentadas en sus actas y en la propuesta UX.

Las variantes de saldo cero, nuevas versiones, dinero externo y recuperación tienen evidencia automatizada/local indicada en el plan; no se afirma haber ejecutado todas ellas manualmente contra Sandbox. La incorporación de IA y un checkout inicial integrado siguen siendo trabajos separados. Vincular un inicial existente conserva comprobaciones; el binding de identidad de prueba es explícito, privado y exclusivo de Sandbox.

El listener temporal de esta prueba se eliminó y una consulta posterior confirmó HTTP 404. Su ID se retiró del `.env`; se detuvieron túnel, gateway, servicios propios y runners de prueba. Los puertos de Trato quedaron libres; no se tocaron servicios ajenos. Configuración privada, credenciales y artefactos temporales no forman parte de la publicación. Las migraciones y registros de negocio se conservan.
