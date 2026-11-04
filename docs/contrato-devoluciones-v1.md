# Contrato de cierre económico y devoluciones v1

Estado al 2 de noviembre de 2026: tandas 1–4 implementadas y probadas localmente, sin IA ni ejecución financiera. Migraciones compartidas pendientes. Evidencia y límites actuales en `tanda-4-devoluciones-validacion.md`.

## Alcance

La ampliación aprobada en tanda 4 admite `scope=payment_only` para un pago inicial o una adenda cobrada y `scope=project_closure` para todos los cobros registrados del proyecto. USD y un mismo merchant configurado; nunca modifica sus registros pagados. El cierre global fija sus miembros y exige revisión explícita de que no faltan cobros. Cada instantánea fija el reparto por captura y debe sumar exactamente la devolución propuesta; una captura puede recibir cero. Detalle en `cierre-proyecto-multipago.md`.

La solicitud tiene motivo, solicitante y evidencia. No declara culpabilidad por cancelar. Se bloquea su creación si el proyecto tiene un pedido abierto. Reintentar la misma solicitud no debe crear otro pedido: el repositorio resolverá la idempotencia antes de evaluar un nuevo alta bajo bloqueo del proyecto. El expediente abierto ocupará ese mismo cupo hasta cierre explícito, devolución confirmada o cierre aceptado sin devolución. Rechazar la propuesta o retirarla no permite borrar el historial ni revocar unilateralmente una aceptación vigente.

## Datos y autoridad

Código: `repos/trato-api/trato_api/refunds/domain.py`.

- `SettlementRequest`: pago, alcance, motivo, solicitante y citas de la petición.
- `SettlementTerms`: moneda, conceptos explícitos (lista vacía significa sin deducciones), condiciones e importe final propuesto.
- `Adjustment`: identidad estable del concepto, categoría, beneficiario, descripción, importe y evidencia. Categorías: trabajo reconocido, gasto, penalidad y otro ajuste. Beneficiarios: vendedor (retención) o cliente (crédito).
- `Percentage`: base monetaria en centavos y tasa en puntos básicos (100 = 1 %), redondeo half-up al centavo. Conservar ambos junto al importe calculado.
- `CaptureContext`: evidencia financiera exclusivamente del servidor, con propietario/proyecto/pago, captura, merchant, moneda, bruto, comisión original, devuelto confirmado, remanente del proveedor y reservas activas.
- `Source` y `Citation`: documento, extracción exacta, hash y texto literal. Se comprueba pertenencia a propietario y proyecto y coincidencia de versión/hash/cita. El repositorio deberá cargar únicamente fuentes privadas autorizadas y extracciones terminadas. Para correos, se utilizará su documento/evidencia persistente, no texto libre atribuido a un cliente.

Los DTO prohíben campos adicionales; importes son enteros estrictos, nunca floats, strings ni booleanos. USD es el único alcance inicial. Los errores internos son códigos, no etiquetas visibles; al montar la interfaz requerirán traducciones ES/EN.

Las funciones puras no autentican un JWT ni consultan la DB: comparan el actor con el contexto ya autorizado del servidor. Nunca aceptar `CaptureContext`, `Source`, merchant, saldos ni banderas de verificación como datos financieros confiables aportados por HTTP. La futura API deriva todo ello del repositorio y proveedor. `capture_verified=True` no reemplaza esa verificación.

## Cálculo

Se negocia el cierre del bruto de la captura elegida o de la suma de cobros registrados incluidos en el cierre global. Las adendas sin pago no aportan fondos. Retenciones, créditos y devoluciones previas se calculan una sola vez sobre ese total; el reparto por captura respeta su remanente registrado. Antes de ejecutar se exige comprobación externa individual, pendiente de tanda 5. El precio escrito del contrato y el número de tareas no acreditan dinero recibido.

```text
retenciones = suma de conceptos a favor del vendedor
créditos = suma de conceptos a favor del cliente
derecho total propuesto al cliente = bruto − retenciones + créditos
nuevo reembolso = máximo(derecho total propuesto − devoluciones confirmadas anteriores, 0)
disponible = remanente verificado del proveedor − reservas activas
```

El nuevo reembolso debe coincidir exactamente con el importe propuesto y no superar el disponible. No se recorta automáticamente. Si el proveedor y el registro de devoluciones anteriores discrepan, se exige conciliación antes del cálculo. Las reservas limitan disponibilidad, no reducen el derecho negociado.

Ejemplo: bruto 300, trabajo 120, penalidad respaldada 30 → derecho propuesto 150. Si ya se devolvieron 50, quedan 100 por devolver. No volver a cargar esos 50 como gasto o penalidad. La comisión original se informa aparte; no reduce automáticamente el reembolso.

Cada concepto requiere evidencia; para penalidades la cita debe identificar la cláusula o acuerdo de cierre que las respalda. El código verifica existencia literal y contexto, no interpreta validez legal ni prueba que esa cláusula permita ese importe. Esa valoración corresponde a revisión humana. Dos conceptos con la misma identidad se rechazan, incluso si cambia la categoría; no es posible detectar todas las duplicaciones semánticas con IDs diferentes sin revisar el desglose.

Si retenciones netas superan el bruto, se informa cero reembolso y un saldo adicional propuesto separado, sin cobrarlo ni reconocer automáticamente un derecho exigible. Si una nueva propuesta intenta dejar al cliente menos de lo ya devuelto, se rechaza como conflicto con el cierre anterior; no se inventa una deuda para recuperar devoluciones confirmadas.

## Revisiones, permisos y estados

Solo el propietario autorizado puede crear/revisar; las aceptaciones seguirán siendo documentales y revisadas por una persona. El cliente no ejecuta directamente acciones financieras. Cambiar el selector de Gemini no altera este flujo.

Un comando lleva `expected_snapshot_id`. Borrador no enviado: nueva instantánea interna conservando número público. Tras envío: nueva versión con feedback respaldado; el repositorio deberá verificar también participante, respuesta al envío y versión exacta. La tanda 1 comprueba cita y snapshot, no sustituye esas futuras comprobaciones de relación. Un expediente finalizado es de consulta.

Estados de negocio definidos: `draft`, `awaiting_response`, `adjustments_requested`, `accepted`, `refund_pending`, `completed`, `closed_without_refund`, `rejected`, `withdrawn`. Se reserva `accepted` para la versión enviada aceptada y revisada; no ejecuta dinero. Importe cero aceptado cierra sin operación financiera. Rechazo/retiro solo antes de aceptación y sin operaciones pendientes.

Estados técnicos separados: `reserved`, `uncertain`, `pending`, `completed`, `failed`, `cancelled`. Los últimos tres reflejarán el proveedor verificado; `reserved` y `uncertain` son locales. Un fallo no cierra el expediente como devuelto. Las transiciones persistentes, aceptación y autorización financiera se implementarán en sus tandas, bajo bloqueo, con historial e idempotencia; los enums de esta tanda no constituyen una máquina de estados ejecutable.

## Comprobación y siguiente paso

Tests puros: `tests/test_refund_domain.py`, sin credenciales ni red. No existe recorrido nuevo en app hasta la tanda 3. El flujo simulado y el registro pagado permanecen intactos.

Resultado: 20 pruebas de dominio aprobadas y 228 pruebas de API aprobadas con `../trato-file-processor/.venv/bin/python -m unittest discover -s tests` desde `repos/trato-api`, fuera del sandbox. La ejecución de la suite completa dentro del sandbox quedó detenida; se interrumpió y se repitió fuera con límite de tiempo. No se hicieron llamadas a modelos, PayPal ni correo.

La tanda 2 añade persistencia/RLS, reserva del cupo de pedido e idempotencia de solicitudes y revisiones. La reserva de dinero corresponde a tanda 5. `prepare_settlement` refleja hechos locales y deja desconocidos comisión y remanente externos; no fabrica un `CaptureContext` verificado para guardar borradores. La asistencia IA queda como requerimiento posterior, fuera de las siete tandas actuales.


## Documentos y aceptación implementados en tanda 4

PDF privado e idioma fijados por instantánea, revisión humana, vista previa y envío explícito Gmail. Envío aceptado por Gmail no acredita lectura. Respuestas se vinculan al envío exacto; ninguna acepta automáticamente. Evidencia manual distingue cita de feedback ya leída y PDF de aceptación revisado por humano, incluso escaneado. No certifica firma criptográfica.

Una versión nueva exige feedback de la enviada y conserva ese respaldo al editar sus borradores internos. Necesita su propio PDF, revisión, envío y aceptación. Importe positivo aceptado queda en `accepted`; no devuelve dinero. Cero individual cierra solo el expediente. Cero global aceptado cierra el proyecto y bloquea nuevos pedidos. Un saldo adicional propuesto exige un cobro independiente.
