# Tanda 4: cierre documental y alcance multipago

Fecha: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Implementación autorizada por el usuario y verificada localmente. Incluye la ampliación aprobada: devolución individual del pago inicial o una adenda cobrada, y cierre global con todos los cobros registrados del proyecto. Sin IA ni ejecución de reembolsos. Las migraciones no se aplicaron al Supabase compartido; la verificación local no acredita todavía un recorrido conectado completo ni cierra por sí sola TRATO-13 a 16.

## Comportamiento implementado

- Registro inmutable de ingresos: las adendas completadas se referencian conservando sus IDs y registros originales; el pago inicial se vincula mediante consulta verificada de orden y captura Sandbox. No se acredita un ingreso mediante un contrato, texto libre, redirección o declaración del navegador.
- El cierre global exige revisar el conjunto de pagos. Una adenda sin pago no aporta fondos. No permite omitir miembros, mezclar proyectos/propietarios/merchants/monedas ni distribuir automáticamente la devolución. Las retenciones justificadas y devoluciones anteriores se calculan una sola vez; cada asignación respeta su remanente registrado y la suma coincide con la propuesta.
- PDF privado y determinista por instantánea, con proyecto/cliente fijados, versión, desglose, condiciones, citas y distribución por captura. El idioma ES/EN queda fijado al reservar el artefacto. La edición crea otro archivo y no sobrescribe el anterior; descarga y envío comprueban SHA-256.
- Revisión humana del PDF exacto antes del envío. Vista previa de remitente, destinatario, asunto, cuerpo y adjunto; un cambio invalida su digest. Envío explícito mediante Gmail, con identidad reservada antes de HTTP. Un resultado incierto conserva el bloqueo y se consulta por RFC Message-ID, contenido y adjunto exactos; no se reenvía automáticamente ni se interpreta una búsqueda vacía como fracaso definitivo.
- Respuestas consultadas bajo demanda, con permiso de lectura y cuenta correspondiente. Comprueba hilo, participantes, referencias al envío exacto y fecha; deduplica el mensaje. Conserva el mensaje original y separa el texto nuevo de la conversación citada para mostrarlo. No acepta ni interpreta automáticamente el contenido.
- Feedback revisado permite otra versión pública; cada edición interna conserva ese respaldo. La nueva versión requiere PDF, revisión, envío y aceptación propios. Las versiones enviadas y aceptadas permanecen de consulta.
- La aceptación puede respaldarse con una respuesta vinculada o un PDF privado revisado manualmente, incluso escaneado. Conserva documento/hash y notas, sin afirmar OCR ni firma criptográfica. Para citar un documento como feedback sí exige extracción terminada y cita literal.
- Importe positivo aceptado: `accepted`, pendiente de autorización financiera. Cero individual: cierra solo el expediente y libera el cupo. Cero global aceptado: cierra el proyecto y bloquea nuevos pedidos. Un saldo adicional propuesto requiere un cobro independiente.
- Interfaz ES/EN, documentos de devolución agrupados por su propio expediente, historial de instantáneas, importación explícita de adjuntos y recuperación de operaciones inciertas tras recarga. Corrección de desbordamiento del hash de PDF en móvil.

## Archivos y migraciones

Módulos nuevos de PDF/correo/workflow en `repos/trato-api/trato_api/refunds/`, ampliación de dominio/repositorio/rutas, consulta de captura en el adaptador PayPal y extensión limitada del transporte Gmail. Interfaz en `refund-documents.mjs`, `refund-workspace.mjs/css`; relaciones documentales en `persistence.py` y `connected-workspace.mjs`.

Migraciones nuevas de esta tanda, en orden:

1. `20261101180000_refund_project_scope.sql`: ingresos, miembros, alcance y cálculo global.
2. `20261101190000_refund_documents.sql`: PDF, revisión, envío, respuestas, feedback, aceptación y transiciones.
3. `20261101200000_refund_server_commands.sql`: operaciones exclusivas del servidor; un usuario autenticado no puede declarar un envío completado ni insertar un ingreso verificado.
4. `20261101210000_refund_operation_results.sql`: consulta de resultado confirmado de PDF, registro inicial y envío.

Dependen de las migraciones de tandas 2–3. Coordinarlas antes de desplegar la API/UI nueva: sin esas tablas/RPC el error de persistencia es visible; no se usa la simulación como respaldo.

## Resultados comprobados

- **265 pruebas de API aprobadas**, incluidas las regresiones existentes. Cubren JWT en todas las rutas nuevas, DTO estrictos de alcance/evidencia, identidad del servidor, revisión explícita, PDF real extraído con `pdftotext`, hash, idioma, caracteres incompatibles, correo MIME y adjunto, cambio de remitente/destinatario/digest, no duplicación, incertidumbre, conciliación exacta, lectura denegada, respuestas ajenas/antiguas y validación del ingreso inicial. Los servicios externos usan dobles explícitos.
- **25 pruebas específicas de PayPal/backend aprobadas**, sin llamadas reales al proveedor.
- **46 pruebas CJS y 6 MJS aprobadas**. Incluyen reparto global incompleto, duplicado, desequilibrado o excesivo y regresión individual. `npm run check` aprobado; **1.698 claves ES/EN** con paridad y parámetros verificados.
- **30 migraciones aplicadas desde cero** en PostgreSQL 14 temporal. Aprobados `refund_settlements.sql`, `refund_operations.sql`, `refund_project_documents.sql`, `one_open_request.sql` y `proposal_lifecycle.sql`. El caso nuevo cubre inicial + adenda, reparto, PDF revisado, envío, feedback, v2 y su edición interna con respaldo conservado, rechazo de respuesta de v1 para aceptar v2, cierre global cero y aceptación individual positiva sin ejecutar dinero ni modificar la adenda pagada.
- **4 carreras SQL aprobadas**: dos altas, devolución contra pedido de cambio, dos ediciones sobre la misma cabeza y reintentos idénticos. Las instantáneas y hashes se conservaron después de reiniciar la base temporal.
- **30 casos únicos de Chromium aprobados en ejecuciones seleccionadas**: 16 de devoluciones conectadas con API doblada, 4 de resumen, 3 de documentos/navegación, 2 de Gmail, 2 de propuestas y 3 de límites/acceso a simulación. Incluyen cierre inicial + adenda, edición v1→v2 con envío propio, cero, aceptación positiva pendiente de ejecución, conciliación tras recarga, evidencia manual escaneada, inglés y móvil a 390 px. Se inspeccionó visualmente la vista previa móvil, sin desbordamiento.
- `git diff --check` sin errores de contenido/espacios. No se hizo push, PR ni merge.

Las ejecuciones iniciales detectaron y corrigieron expectativas antiguas de los fixtures, conservación de feedback en ediciones internas, validación tipada de la cita manual y ajuste de texto largo en móvil. El test de OAuth se actualizó al contrato existente `purpose=send` y al estado conectado; el callback sigue comprobando sesión y estado. No se modificó la implementación OAuth.

## Regresiones ajenas y límites de validación

La selección amplia de la simulación histórica (`tests/browser/refunds.spec.cjs`) no está completamente aprobada: seis recorridos fallaron inicialmente por la espera de 5 segundos del worker; al ampliar la espera solo como diagnóstico, un recorrido sí avanzó hasta la autorización pero quedó en la pantalla «Reembolso pendiente» sin ofrecer los controles de resultado esperados. Se restauró el archivo de tests y no se modificaron `refund-preview.mjs`, `simulation-threads.mjs` ni el worker. Esta incidencia previa queda separada del flujo conectado de esta tanda; no se cuentan esos seis casos como aprobados.

La suite histórica completa de `backend/` tampoco se da por aprobada: cinco pruebas del workflow antiguo necesitan `.venv/bin/python` en la raíz, ausente en este entorno. Se revirtió un ajuste diagnóstico del intérprete. La suite específica PayPal sí pasó y las 265 pruebas de la API están aprobadas. No se instalaron versiones alternativas de dependencias para ocultar estos fallos.

No se ejecutaron envíos Gmail reales, consultas reales de capturas ni reembolsos. SQL usa un scaffold explícito de Auth/Storage y fixtures con rollback: no prueba el JWT/Storage HTTP de Supabase. Chromium usa API de prueba; PDF y MIME se verificaron además mediante código real. Falta desplegar las migraciones y probar el recorrido conectado con cuentas y destinatario autorizados. La autorización de esta tanda no autoriza envíos a clientes ni movimientos financieros.

El registro inicial exige una orden/captura Sandbox completadas, pagador del cliente, merchant configurado y `reference_id` y `custom_id` iguales a `initial-{project_uuid}`. Este lote no crea el checkout inicial ni convierte pagos históricos sin ese vínculo en ingresos verificados. Si falta esa captura, debe prepararse su cobro/registro antes de la prueba integral; no se inventa el anticipo. La disponibilidad actual y comisión de cada captura se comprobarán en tanda 5; lo que muestra el borrador es el registro local.

## Reproducción y recursos

API: `PYTHONPATH=repos/trato-api:backend repos/trato-file-processor/.venv/bin/python -m unittest discover -s repos/trato-api/tests -v` (Python 3.12 y dependencias del proyecto). PayPal: `PYTHONPATH=backend repos/trato-file-processor/.venv/bin/python -m unittest discover -s backend -p 'test_paypal*.py'`. Frontend: `npm run check`, `npm test`, `node --test tests/*.test.mjs`.

Navegador: `playwright test` con `playwright.config.cjs`; suites `refunds-connected.spec.cjs`, `project-overview.spec.cjs` y selecciones por nombre de `connected.spec.cjs`, `gmail.spec.cjs`, `proposals.spec.cjs` y los tres casos de límites/acceso de `refunds.spec.cjs`. Chromium de la versión fijada de Playwright se descargó del CDN oficial en `/tmp/trato-refund-browser`; `libasound2` se extrajo allí desde Ubuntu, sin instalación global ni perfil personal.

SQL: scaffold `supabase/tests/fixtures/postgres_supabase_scaffold.sql`, migraciones ordenadas y los cinco tests indicados, con `ON_ERROR_STOP=1`. `scripts/test-refund-concurrency.py` exige socket dentro de `/tmp/trato-refunds-pg` y marcador de base aislada. PostgreSQL solo usó socket privado, sin TCP.

Se detuvieron la web y PostgreSQL temporal con sus sesiones. La comprobación final no encontró procesos propios de Chromium ni del worker de simulación. Se eliminaron los runtimes temporales (aproximadamente 1.110 MiB de archivos), bases sintéticas, capturas y logs de esta ejecución. Se conservan código, pruebas y esta documentación. Redis ajeno en 6379, credenciales y configuración privada permanecieron intactos.

## Siguiente tanda

Tanda 5 requiere análisis de autorización/reserva financiera por captura, consulta canónica de remanente/comisiones, adaptador de reembolso y manejo de resultados parciales; luego aprobación explícita del usuario. Tanda 6 concilia y proyecta historial; tanda 7 verifica el flujo financiero Sandbox completo. La aceptación documental de esta tanda no sustituye esas verificaciones.
