# Tanda 5: backend financiero implementado y validado localmente

Fecha: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Diseño aprobado por el usuario. Se implementaron autorización financiera separada, reservas e intentos persistentes, adaptador PayPal Sandbox y ejecución/consulta por captura para devolución individual y cierre multipago. Sin IA. Las verificaciones usaron datos sintéticos, PostgreSQL temporal real y un proveedor de prueba explícito: no hubo consultas ni reembolsos contra PayPal real o Sandbox conectado.

## Comportamiento entregado

1. El backend carga propietario, aceptación, snapshot y PDF/hash antes de consultar al proveedor. La comprobación financiera guarda evidencia seleccionada, reglas consultadas y digest; caduca en cinco minutos. No es una reserva ni una autorización.
2. La autorización exige confirmación financiera explícita y la comprobación exacta vigente. Reserva todos los importes positivos en una transacción y fija orden de operaciones, payload e ID idempotente por captura. Un miembro con importe cero no genera operación. El proyecto conserva su única solicitud de negocio abierta.
3. La ejecución requiere una acción explícita adicional y una clave propia. Revalida la captura antes del despacho y reclama el intento en DB antes del POST. Dos ejecuciones concurrentes no envían dos veces. Repetir la misma clave consulta el avance; no continúa un lote por sí solo.
4. Guarda el refund ID recibido antes de consultar el resultado canónico. Solo una evidencia atribuible a la captura, con importe/moneda correctos y `COMPLETED`, confirma dinero. `PENDING` y la incertidumbre mantienen reservas. Un rechazo definitivo o un `FAILED`/`CANCELLED` canónico liberan solo su reserva.
5. El lote se detiene ante el primer pendiente, fallo o incertidumbre; los demás miembros quedan reservados sin despachar. No cambia el reparto, no compensa por otra captura y no repite éxitos anteriores. Tras una consulta que confirme el pendiente, continuar los miembros aún reservados requiere otra acción explícita con nueva clave de ejecución, sobre la misma autorización y los mismos intentos.
6. Cada éxito cuenta inmediatamente en el registro de devoluciones anteriores, aunque el padre siga pendiente. El expediente solo completa al comprobar toda su suma. El cierre global cierra el proyecto; una devolución individual mantiene abierto el proyecto. Las adendas cobradas permanecen inmutables.
7. Las consultas de recuperación devuelven el estado financiero actual, evitando presentar una reserva antigua después de que el dinero se confirmó. Las comisiones originales permanecen separadas del reembolso acordado; un dato ausente no se convierte en cero.

La comprobación usa orden/captura y, cuando corresponde, reembolsos canónicos para justificar el acumulado. Si detecta devoluciones ajenas, pendientes, discrepancias o evidencia insuficiente, bloquea antes de otro POST. La primera devolución de una captura canónica `COMPLETED` se evalúa con el contexto definido en el diseño; no se presenta como lectura de saldo líquido de la cuenta. El chequeo local no puede impedir una operación manual paralela dentro de PayPal: la validación final del proveedor y la conciliación siguen siendo necesarias.

## Archivos y migraciones

- `refunds/financial_domain.py`: contratos de autorización/ejecución, dinero exacto, fechas, referencias y validación de evidencia financiera.
- `refunds/financial.py`: comprobación, despacho secuencial y consulta canónica, con claims duraderos y sin transacciones SQL abiertas durante HTTP.
- `refunds/financial_routes.py`, repositorio y `app.py`: rutas autenticadas, sin admitir hechos financieros aportados por el navegador.
- `backend/paypal/client.py` y `repos/trato-api/paypal/client.py`: consulta y emisión de reembolso, IDs y payload explícitos, errores con códigos permitidos sin texto/cuerpos sensibles. Ambos adaptadores quedaron equivalentes.
- `20261102100000_refund_financial_records.sql`: comprobaciones, autorizaciones, operaciones, intentos, ejecuciones y observaciones; permisos, RLS, FK y agregación por captura.
- `20261102110000_refund_financial_commands.sql`: validación, reserva, claims, resultados y consultas de recuperación.

Las pruebas detectaron que la API empaqueta su propia copia de `paypal/client.py`: la consulta de captura de tanda 4 estaba solo en el adaptador raíz. Se corrigió también la copia que realmente carga la API y se probaron ambos entornos de importación. No se cambió de transporte ni se introdujo un respaldo.

Las dos migraciones nuevas dependen de tandas 2–4. **No se aplicaron al Supabase compartido**. El despliegue sigue pendiente de coordinación; no hay simulación automática si faltan tablas/RPC.

## Rutas entregadas

| Método y ruta | Resultado |
| --- | --- |
| POST `/api/v1/refunds/{id}/financial-checks` | Comprobación de snapshot y evidencia, sin devolver dinero. |
| POST `/api/v1/refunds/{id}/financial-authorizations` | Consentimiento estricto, comprobación/digest y notas; reserva atómica con `Idempotency-Key`. |
| POST `/api/v1/refunds/{id}/financial-authorizations/{authorization_id}/execute` | Ejecución explícita del plan del servidor; requiere confirmación y clave idempotente. |
| GET `/api/v1/refunds/{id}/financial` | Consulta persistida sin ejecutar/reintentar. |
| POST `/api/v1/refunds/{id}/financial-operations/{operation_id}/refresh` | Consulta de refund ID conocido, sin otro POST financiero. No permite declarar `COMPLETED` desde HTTP. |

Los DTO prohíben importes, captura, merchant, propietario, saldo o estado del proveedor como campos extra del cliente. Las funciones de servidor no son ejecutables por usuarios autenticados. Las autorizaciones y observaciones son inmutables; los errores HTTP conservan solo estado y códigos técnicos seguros. No se publican credenciales, cuerpos de error ni contenido libre del proveedor.

## Verificaciones aprobadas

- **284 tests API**, incluidos los 265 anteriores, 11 de dominio/adaptador financiero y 8 de contratos HTTP/repositorio. Comprueban JWT antes de trabajo, autorización y ejecución explícitas, campos falsificados, IDs/digest, tamaño, dinero exacto, plazo, datos ausentes, acumulados, evidencia ajena, payload fijo y clasificación segura de errores.
- **25 tests PayPal/backend** de regresión aprobados. Los mismos 11 tests financieros se ejecutaron también importando el adaptador raíz; se cuentan como 11 casos únicos, sin duplicar ese número.
- **17 escenarios de integración aprobados** mediante `scripts/test-refund-finance-integration.py`: workflow financiero real y SQL real por socket; PayPal es un doble explícito. Cubren éxito total; éxito parcial y pendiente; timeout; respuesta malformada; captura ajena; rechazo definitivo con evidencia HTTP segura; caída después de reclamar despacho; pérdida de respuesta tras persistir éxito; dos autorizaciones concurrentes; dos ejecuciones concurrentes; `FAILED` y `CANCELLED` canónicos; cambio de merchant; comprobación caducada; asignación cero; aislamiento entre cuentas; recuperación del resultado actual.
- **32 migraciones aplicadas desde cero** en PostgreSQL 14 temporal. Aprobados los seis conjuntos SQL: `refund_financial.sql`, `refund_settlements.sql`, `refund_operations.sql`, `refund_project_documents.sql`, `one_open_request.sql` y `proposal_lifecycle.sql`.
- **4 carreras SQL anteriores** aprobadas: doble alta, devolución frente a pedido de cambio, doble edición y reintentos idénticos. Las dos carreras financieras están incluidas en los 17 escenarios, no se cuentan dos veces.
- **Reinicio comprobado**: autorizaciones, reservas, request IDs, payloads, estados de intentos/ejecuciones y resultados permanecieron idénticos después de reiniciar PostgreSQL. También se conservaron instantáneas y hashes del runner anterior.
- **46 tests CJS y 6 MJS aprobados**. `npm run check` y paridad de **1.698 traducciones ES/EN** aprobados. No cambió la interfaz en esta tanda y no se volvió a descargar Chromium; la nueva interfaz financiera se verificará en tanda 7.
- `git diff --check` sin errores de contenido/espacios. Sin push, PR, merge ni despliegue.

## Reproducción y alcance de la evidencia

```bash
PYTHONPATH=repos/trato-api:backend repos/trato-file-processor/.venv/bin/python -m unittest discover -s repos/trato-api/tests -v
PYTHONPATH=backend repos/trato-file-processor/.venv/bin/python -m unittest discover -s backend -p 'test_paypal*.py'
PYTHONPATH=backend:repos/trato-api repos/trato-file-processor/.venv/bin/python -m unittest discover -s repos/trato-api/tests -p 'test_refund_financial_domain.py' -v
npm run check
npm test
node --test tests/*.test.mjs
```

Para SQL: cluster vacío y desechable con socket `/tmp/trato-refunds-pg/socket`, base `trato_refunds_test`, scaffold `supabase/tests/fixtures/postgres_supabase_scaffold.sql` y migraciones ordenadas. No es un bootstrap de producción. Los tests Auth/Storage no prueban el verificador JWT ni el Storage HTTP de Supabase.

Los runners `scripts/test-refund-finance-integration.py` y `scripts/test-refund-concurrency.py` exigen `--psql`, `--socket` y un marcador explícito de base aislada. El primero admite `--state-file` y `--verify-state` para la comprobación tras reinicio. La fixture temporal puede alterar fechas de sus propios registros para probar caducidad; no existe una ruta de producción que permita esa alteración.

## Límites y continuación

- La evidencia demuestra persistencia y orquestación local; **no acredita reembolsos Sandbox conectados ni abonos bancarios**. La validación financiera integral sigue en tanda 7, con capturas/cuentas y autorización concreta de ejecución.
- La interfaz financiera completa sigue pendiente de tanda 7. Los errores/estados técnicos se conservan en sus registros; el historial único y los webhooks corresponden a tanda 6.
- Un resultado incierto sin refund ID no se reenvía, no libera su reserva y no se recupera por vencimiento de un proceso. La recuperación sin ID y la resolución de ejecuciones que quedaron abiertas por una caída se implementarán en tanda 6. Esta tanda crea un intento por operación; no incorpora un nuevo intento tras fallo/cancelación ni reintentos POST, aunque la ventana documentada de idempotencia siga abierta.
- El checkout inicial sigue fuera de este lote. El flujo integral necesita un inicial realmente capturado con su referencia contractual; no usa el pago diagnóstico como anticipo ni inventa el ingreso.
- Las incidencias de la simulación y del entorno histórico descritas en tanda 4 permanecen separadas. No se modificó su implementación ni se presentan como regresiones resueltas aquí.

TRATO-15 queda en curso, con ejecución preparada y validada localmente; no se marca terminado antes de conciliación y prueba integral. El siguiente paso es analizar tanda 6, explicar el diseño y esperar aprobación del usuario.

## Recursos

PostgreSQL se ejecutó únicamente por socket privado, sin TCP. Se detuvo con todas sus sesiones y se eliminaron el runtime, las bases sintéticas y los logs/archivos de estado después de registrar estos resultados. La revisión final de listeners mostró únicamente los servicios que ya existían antes de las pruebas. No se iniciaron la web, API, worker, Redis ni Chromium para esta tanda; no se tocaron servicios o credenciales de otros proyectos.
