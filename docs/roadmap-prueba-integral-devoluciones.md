# Roadmap de prueba integral de devoluciones

Fecha: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

**Estado: guía preparada; recorrido conectado todavía no ejecutado.** Esta guía no aplica migraciones, registra listeners, envía correos ni ejecuta pagos. Cada casilla comienza pendiente. El objetivo es validar TRATO-13 a 16 con pasos observables, sin repetir las suites completas de código.

La preparación técnica realizada posteriormente está registrada en [el acta de preparación](preparacion-prueba-integral-devoluciones.md): migraciones aplicadas, servicios, Gmail y listener Sandbox listos; quedan la confirmación de cuentas de prueba y la carga del documento desde la sesión del usuario. Las casillas financieras A–E siguen pendientes.

## Cómo recorrerlo

1. Completar la preparación técnica una sola vez.
2. Recorrer A, el caso principal completo, y avanzar solo cuando cada control pase.
3. Recorrer B–E para las variantes que A no cubre.
4. Cerrar con permisos, idiomas, móvil y acta de resultados.

**PayPal:** todas las cuentas, credenciales, cobros y reembolsos de esta guía deben ser **Sandbox**. Ese ambiente usa transacciones ficticias y no toca cuentas live, según la [guía oficial de Sandbox](https://developer.paypal.com/sandbox-testing/overview). Gmail sí envía correos reales: usar exclusivamente un buzón de prueba autorizado.

No elegir «Recorrido de ejemplo» para acreditar el recorrido conectado. La IA de devoluciones sigue fuera del alcance; las propuestas y revisiones de esta prueba son humanas.

## 0. Preparación — acompañamiento técnico

| Control | Qué preparar o verificar | Aprobado cuando |
| --- | --- | --- |
| P0.1 | Checkout de la rama de trabajo y migraciones de `repos/trato-api/supabase/migrations`, coordinadas con quien administra Supabase. Comparar historial aplicado con archivos locales. | No faltan tablas/RPC de devoluciones ni las migraciones de conciliación; RLS sigue activo. No ejecutar las migraciones históricas de la carpeta raíz por duplicado. |
| P0.2 | Completar únicamente las comprobaciones pendientes del cierre de tanda 6: intento esperado que ya no es el último, regresión de retroceso del reloj y persistencia tras reinicio con la revisión final de `attempt_no`. | Resultado registrado sobre SQL temporal aislado. No cambiar la hora de la laptop ni usar la base compartida para inyectar fallos. No repetir todas las suites. |
| P0.3 | Configuración privada de API: Supabase y clave exclusiva de servidor, Gmail y PayPal con `PAYPAL_ENVIRONMENT=sandbox`, app Sandbox y merchant correctos. | El backend reconoce sus integraciones; ninguna clave está en frontend, Git o capturas. No copiar secretos al acta. |
| P0.4 | Dos sesiones: profesional en Trato y cliente de prueba. Cuenta Business Sandbox del vendedor y Personal Sandbox del comprador. Para el pago inicial, correo de contacto del cliente igual al correo del pagador Sandbox. | Se identifican las cuentas de prueba y el destinatario autorizado de Gmail; no se usa una cuenta PayPal live para aprobar pagos. |
| P0.5 | Servicios propios de Trato. Consultar `local-ports.json` y `docs/puertos-locales.md`; revisar listeners/contenedores antes de arrancar. | Web 5173, API 8100 y procesador 8101 disponibles; worker y su Redis propio si son necesarios para leer documentos. No se tocan servicios ajenos ni se eligen otros puertos silenciosamente. |
| P0.6 | Abrir `http://localhost:5173`, iniciar sesión y conectar Gmail desde el perfil. Autorizar lectura si se consultarán respuestas o envíos inciertos. Subir un PDF y esperar que termine su lectura. | El documento puede abrirse y citarse desde el proyecto; el correo conectado es el esperado. |
| P0.7 | Listener de devoluciones con HTTPS accesible: `/api/v1/refunds/webhooks/paypal`, registrado en la misma app Sandbox; su ID exacto en `PAYPAL_REFUND_WEBHOOK_ID`. | La URL pública llega a la API y el backend puede verificar eventos del listener dedicado. No reutilizar el ID de checkout. |

Para combinar Gmail con la verificación del pago inicial, el correo de contacto debe ser un buzón de prueba accesible y coincidir con el pagador Sandbox. Si la cuenta Sandbox usa un correo autogenerado sin buzón accesible, resolver ese dato en la preparación de cuentas; no desactivar la validación de identidad para continuar.

Actualización del recorrido: para la cuenta ficticia generada por PayPal se configuró una correspondencia privada, explícita y exclusiva de Sandbox por propietario (`TRATO_SANDBOX_INITIAL_PAYER_BINDINGS`). Está documentada en el acta de preparación y permite conservar el buzón real de comunicaciones. No desactiva la verificación del pagador ni se permite en Live.

Para el arranque habitual del proyecto, el procedimiento documentado es `python3 scripts/dev-polyrepo.py --with-worker`, después de revisar puertos y configuración. No se requiere invocar un modelo de IA para calcular una devolución.

Para P0.7, revisar las suscripciones implementadas: `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.FAILED` y `PAYMENT.CAPTURE.REVERSED`. La reversión se trata como incidencia, no como devolución autorizada. Registrar el HTTPS/listener es una preparación coordinada; el código por sí solo no lo publica.

**Si faltan migraciones o servicios, detenerse antes de A. Si falta la captura inicial, no acreditar el cierre multipago.** Puede probarse el recorrido individual con una adenda cobrada, anotando el multipago como bloqueado. Sin listener, se pueden verificar resultados por consulta explícita, pero webhook y descubrimiento externo por evento quedan pendientes.

Fuentes técnicas: [Sandbox](https://developer.paypal.com/sandbox-testing/overview), [endpoints de API](https://developer.paypal.com/api/rest/requests/) y [registro/verificación de webhooks](https://developer.paypal.com/api/rest/webhooks/rest/), revisadas el 2 de noviembre de 2026.

## 1. Datos de prueba y resultados esperados

Usar proyectos separados para que un cierre o una devolución previa no alteren los importes de otro caso.

| Caso | Cobros Sandbox | Resultado esperado |
| --- | --- | --- |
| A — cierre global parcial | Inicial USD 10 + adenda pagada USD 20 | Trabajo reconocido USD 9 + penalidad respaldada USD 3 = retención USD 12. Devolver USD 18: USD 6 del inicial + USD 12 de la adenda. |
| B — individuales, mismo proyecto | Inicial USD 10 + adenda pagada USD 20 | Primero devolver la adenda completa, USD 20, conservando el inicial. Después, en otra solicitud, devolver el inicial completo, USD 10. El proyecto permanece abierto por tratarse de devoluciones individuales. |
| C — cero | Adenda pagada USD 20 | Trabajo reconocido USD 20, devolución USD 0. Cerrar el expediente sin operación financiera. |
| D — externo parcial | Adenda pagada USD 20 | Devolución acordada USD 15. Aplicar un comprobante externo de USD 5 y ejecutar solo USD 10 mediante un intento nuevo autorizado. |
| E — nueva versión | Adenda pagada USD 20 | v1 reconoce USD 10 y propone devolver USD 10; feedback revisado acuerda reconocer USD 8 y v2 propone USD 12. Aceptación nueva de v2, sin heredar la de v1. No es necesario ejecutar otro reembolso para acreditar el versionado. |

Los importes son **ejemplos ficticios para prueba**, no valores calculados por IA ni una política jurídica general. Para A, preparar un PDF de prueba que respalde expresamente trabajo reconocido de USD 9 y una penalidad de cancelación del 10 % de los USD 30 cobrados, es decir USD 3. Confirmar su aplicación en el acuerdo de prueba; la app no determina exigibilidad legal ni impone una penalidad automática.

La comisión real devuelta por la API de Sandbox se anota tal como venga. **No suponer que vale cero, ni restarla de nuevo a los USD 18 del cliente.**

Documentos sugeridos, todos marcados «PRUEBA SANDBOX»: acuerdo/cláusula, respaldo del trabajo, pedido de cancelación, feedback para E y aceptación de la versión final. Se pueden preparar en un editor y exportar a PDF; no requieren generación con IA.

## A. Recorrido principal — cierre global de USD 18

### A1. Crear el contexto del proyecto

1. Entrar en **Clientes**, abrir/crear el cliente de prueba y crear el proyecto «Integral A — cierre multipago».
2. Completar la preparación del proyecto que muestre la aplicación y cargar el acuerdo inicial.
3. Añadir los respaldos como documentos de referencia y esperar a que terminen de leerse.
4. Abrir sus originales y localizar los fragmentos que se usarán como evidencia.

**Validar**

- [ ] Los documentos pertenecen a este proyecto; no aparecen fuentes de otro cliente.
- [ ] El original abre correctamente y la cita puede seleccionarse literalmente.
- [ ] Añadir una referencia no registra por sí mismo otro pedido de cambio.

### A2. Disponer del pago inicial verificado

1. Preparación técnica: obtener una orden y captura **ya completadas** de USD 10 en Sandbox, de ese comprador al merchant configurado.
2. La unidad de la orden debe tener `reference_id` y `custom_id` iguales a `initial-{UUID_REAL_DEL_PROYECTO}`. Preparar esta captura exige coordinación técnica: **todavía no hay un checkout inicial creado por este flujo**.
3. En **Devoluciones**, pulsar **Vincular pago inicial recibido**.
4. Introducir ID de orden y captura, añadir notas y respaldo, marcar la revisión y pulsar **Verificar y vincular pago inicial**.

**Validar**

- [ ] Aparece un ingreso inicial de USD 10 verificado para este cliente y proyecto.
- [ ] Vincular consulta un cobro existente; no cobra otros USD 10.
- [ ] Persisten los IDs de orden/captura tras recargar.
- [ ] El pago de diagnóstico de USD 0.10 del perfil no se utilizó como ingreso contractual.

**Si no existe una captura con estas referencias, detener este paso y prepararla técnicamente.** No introducir números de documento como IDs de PayPal ni crear una fila de ingreso manual en DB para aparentar el cobro.

### A3. Disponer de una adenda pagada

1. Recorrer el flujo conectado de **Cambios**: pedido → propuesta/adenda → PDF → envío revisado → aceptación documental.
2. Preparar el adicional de USD 20 y aprobar el checkout con el comprador **Sandbox**.
3. Volver a Trato y consultar hasta que el backend confirme el pago; abrir el detalle del cobro en Sandbox para contrastar importe y captura.

**Validar**

- [ ] El pago está confirmado por backend, no solo por haber vuelto del checkout o recibido un correo.
- [ ] La adenda pagada queda de solo consulta.
- [ ] Devoluciones reconoce inicial USD 10 y adenda USD 20.
- [ ] El pedido anterior quedó finalizado y permite registrar la devolución.

### A4. Registrar el pedido de devolución

1. En **Devoluciones → Registrar solicitud de devolución**, elegir **Cierre de todo el proyecto**.
2. Revisar ambos cobros y marcar que están registrados todos los ingresos reales del proyecto.
3. Indicar quién solicita el cierre, motivo y evidencia del pedido; guardar.
4. Recargar la página y abrir el expediente.
5. Intentar registrar otro pedido en ese mismo proyecto; comprobar el bloqueo. Otro proyecto del cliente debe seguir siendo independiente.

**Validar**

- [ ] Se conserva un solo expediente con el mismo motivo, respaldo y miembros.
- [ ] No se emitió correo ni se devolvió dinero por registrarlo.
- [ ] Un pedido abierto bloquea otro en ese proyecto; no bloquea proyectos ajenos.

### A5. Preparar la liquidación y comprobar el cálculo

1. Pulsar **Preparar o editar propuesta**.
2. Añadir **Trabajo reconocido**, a favor del vendedor, importe fijo USD 9, con descripción y cita de respaldo.
3. Añadir **Penalidad contractual**, a favor del vendedor, porcentaje: base USD 30, tasa 10 %, con cita de la cláusula y justificación.
4. Añadir condiciones del cierre y distribuir **USD 6 al pago inicial** y **USD 12 a la adenda**.
5. Antes de guardar, cambiar temporalmente el reparto a 6 + 11: debe mostrar el error de suma. Restablecer 6 + 12.
6. Marcar la revisión y **Guardar borrador**. Recargar.
7. Editar una descripción sin cambiar los importes, guardar y abrir la instantánea anterior.

**Validar**

- [ ] Bruto recibido 30; retenciones 9 + 3 = 12; devolución propuesta 18.
- [ ] No se aceptó un reparto que sumara 17 o superara el remanente de una captura.
- [ ] Se mantienen citas y condiciones tras recargar.
- [ ] La edición de borrador conserva v1 y crea otra instantánea interna; no crea una nueva versión pública.
- [ ] Las instantáneas anteriores siguen consultables, sin sobrescribir sus datos.

### A6. Generar, revisar y enviar el PDF exacto

1. Elegir idioma del PDF/correo y pulsar **Generar PDF de esta instantánea**.
2. Abrir **Ver PDF exacto** y comprobar conceptos, citas, condiciones, total y reparto por pago.
3. Pulsar **Revisar el PDF**, añadir notas, marcar la revisión y confirmarla.
4. Abrir **Vista previa del correo**; revisar remitente, destinatario de prueba, cuerpo y archivo/hash.
5. Solo entonces marcar la autorización y **Enviar propuesta de cierre**.
6. Abrir el correo en el buzón del cliente y su adjunto. Recargar Trato y consultar el archivo conservado.

**Validar**

- [ ] Gmail recibió un solo envío autorizado y el PDF adjunto corresponde a la instantánea revisada.
- [ ] Consultar o recargar no envía otro correo.
- [ ] La versión enviada es inmutable. Un cambio de idioma en el perfil no traduce ni regenera el PDF histórico.
- [ ] El historial muestra el envío; todavía no muestra dinero devuelto.

### A7. Registrar la aceptación documental

1. Desde el buzón de prueba, responder al hilo aceptando expresamente esa versión, devolución USD 18 y reparto 6 + 12.
2. En Trato, pulsar **Consultar respuestas de Gmail**.
3. Abrir **Revisar aceptación del cliente**, seleccionar la respuesta vinculada, añadir notas y confirmar la revisión.
4. Alternativa de prueba documental: añadir como referencia el PDF recibido que acepta exactamente esa versión y seleccionarlo en el formulario. No usar el PDF de propuesta como si fuera una aceptación devuelta por el cliente.

**Validar**

- [ ] La aceptación está ligada a la versión enviada, no a un borrador anterior.
- [ ] Leer el correo o importar el PDF no aceptó automáticamente la propuesta.
- [ ] El estado indica aceptación documental; no certifica firma criptográfica.
- [ ] Todavía no hay un refund ID ni una ejecución financiera por este paso.

### A8. Consultar PayPal y autorizar los importes

1. En **Reembolso en PayPal Sandbox**, pulsar **Comprobar pagos para autorizar**.
2. Revisar captura, bruto, comisión original, neto original, remanente y fuentes/país/producto de la comprobación.
3. Confirmar total USD 18 y reparto 6 + 12 en el documento aceptado. Añadir notas y marcar la autorización.
4. Pulsar **Autorizar los importes revisados** dentro de la vigencia de la comprobación.
5. Recargar antes de ejecutar y consultar el estado guardado.

**Validar**

- [ ] La autorización registra operaciones de USD 6 y USD 12: confirmado 0, reservado 18.
- [ ] Autorizar no envió aún las instrucciones de devolución.
- [ ] La comisión original no fue descontada automáticamente al cliente.
- [ ] Las reservas e identidades sobreviven a la recarga.
- [ ] Si la comprobación venció, se obtiene otra; no se omite el control.

**Límite visible actual:** comisión/neto y fuentes de esa comprobación se muestran durante la revisión en que se obtienen. El GET financiero no recupera ese detalle histórico después de recargar. Su ausencia en esa vista no debe sustituirse por importes inventados.

### A9. Ejecutar y contrastar los dos reembolsos

1. Pulsar **Preparar ejecución de reembolsos**.
2. Revisar los USD 18 pendientes y marcar la confirmación separada.
3. Pulsar **Ejecutar los reembolsos autorizados** una sola vez.
4. Anotar el resultado de cada captura. Si aparece pendiente o incierto, usar **Consultar reembolso por su ID** o **Conciliar con PayPal**, según lo disponible. No crear otra solicitud para sustituir la anterior.
5. Abrir las transacciones en la cuenta Business Sandbox y comprobar sus reembolsos e IDs.

**Validar cuando ambos estén canónicamente completados**

- [ ] PayPal Sandbox registra USD 6 sobre la captura inicial y USD 12 sobre la captura de la adenda.
- [ ] Trato muestra confirmado 18, reservado 0 y dos comprobantes atribuibles, sin refund extra por la recarga.
- [ ] El vendedor retiene un total contractual de USD 12; no se repitieron deducciones por captura.
- [ ] El expediente completa y el cierre global cierra el proyecto únicamente al justificar todos los miembros.
- [ ] La adenda pagada sigue de solo consulta; no se reescribió su cobro original.

**Si una captura está pendiente:** el éxito de la otra debe permanecer visible y contado; el padre no completa. Un `PENDING` válido se registra como pendiente, no se fuerza a completado para terminar la prueba. Continuar miembros aún reservados requiere otra confirmación explícita, cuando el backend lo permita; no repetir el miembro exitoso.

### A10. Webhook, recarga e historial único

1. Con el listener preparado antes de A9, revisar técnicamente las entregas auténticas de esos reembolsos y la persistencia del inbox/comprobantes.
2. Confirmar que la firma se verificó con el ID dedicado, el evento quedó procesado y el estado financiero proviene de la consulta canónica.
3. Si la herramienta oficial permite reenviar una entrega auténtica, probar una duplicada y comprobar que no se creó otro comprobante ni aplicación.
4. Abrir **Historial del proyecto → Historial**, recargar y volver a consultar el estado financiero.
5. Abrir **Documentos** y consultar propuesta/aceptación del cierre y adendas anteriores.

**Validar**

- [ ] Un solo historial de negocio, con grupos propios de cambios y devoluciones.
- [ ] Cada comprobante confirmado produce un único hito monetario por su importe.
- [ ] El cierre global es un hito sin volver a sumar USD 18.
- [ ] No aparecen timeouts, reintentos HTTP ni abandono del checkout como estados de negocio.
- [ ] El expediente conserva su PDF y aceptación; las adendas originales siguen accesibles.

El [simulador oficial de eventos](https://developer.paypal.com/api/rest/webhooks/rest/) no acredita esta verificación: el postback elegido por Trato no admite esos eventos ficticios. Necesitamos una entrega auténtica asociada a la app y transacción Sandbox, sin añadir un bypass.

## B. Devoluciones individuales y recuperación antes del envío

Usar otro proyecto con inicial 10 y adenda pagada 20.

1. Registrar devolución de **Un pago individual**, elegir solo la adenda de USD 20 y preparar una propuesta sin deducciones, con condiciones y respaldo: devolución total USD 20.
2. Repetir PDF → revisión → envío → aceptación → comprobación → autorización.
3. Antes de confirmar la ejecución, activar **Offline únicamente en DevTools de esa pestaña**. Confirmar la ejecución: debe fallar la petición y conservar la operación pendiente en el navegador.
4. Volver a **Online**, recargar y **Consultar operación pendiente**. Consultar no debe enviar una ejecución.
5. Si la operación nunca llegó al servidor y queda sin confirmar, abrir **Repetir solicitud con la misma clave**, leer la advertencia y marcar una nueva confirmación. Debe conservar exactamente clave y cuerpo. Si ya está registrada, consultar su resultado; no crear otra identidad.
6. Completar/consultar el reembolso y contrastar los USD 20 con Sandbox. El inicial de USD 10 sigue sin devolver.
7. Con el primer expediente finalizado, registrar otra devolución individual para el inicial de USD 10; recorrer sus confirmaciones y devolverlo completo.

**Validar**

- [ ] La primera devolución no afecta el inicial y la segunda no repite la adenda.
- [ ] El proyecto conserva su estado abierto; finalizar un expediente individual no equivale a cierre global.
- [ ] Una operación sin respuesta conserva su identidad tras recarga y no se reenvía por consultar.
- [ ] Cada ejecución requiere confirmación y tiene su propio resultado atribuible.

El Offline previo acredita pérdida de comunicación **antes** del envío. No demuestra pérdida de respuesta después de procesar. Ese caso se verificó con fixtures controlados de frontend; provocar una caída después del POST o un fallo selectivo del proveedor requiere una prueba técnica aislada, no apagar a ciegas la API durante un reembolso conectado.

## C. Cierre de importe cero

1. En un proyecto distinto con un cobro de USD 20, registrar devolución individual.
2. Documentar trabajo reconocido de USD 20 y condiciones, con respaldo. El resultado debe ser USD 0.
3. Generar/revisar/enviar el PDF y registrar aceptación de esa versión.
4. Recargar y revisar expediente, historial y cuenta Sandbox.

**Validar**

- [ ] Estado de cierre aceptado sin devolución.
- [ ] No aparece autorización/ejecución financiera ni se creó refund ID por ese expediente.
- [ ] No se generó un reembolso negativo ni un cobro adicional automático.
- [ ] El cierre individual del expediente no se presenta como cancelación del proyecto.

## D. Comprobante externo parcial y saldo restante

**Requiere el webhook de devoluciones o descubrimiento técnico mediante el endpoint de conciliación.** «Consultar estado guardado» lee Trato; no descubre por sí solo una operación emitida fuera de él.

1. Proyecto independiente: adenda cobrada USD 20. Acordar retener USD 5 y devolver USD 15; completar documento, envío, aceptación y autorización financiera. **Detenerse antes de ejecutar.**
2. En la cuenta Business **Sandbox**, emitir externamente un reembolso parcial de USD 5 sobre esa misma captura, tras revisar la transacción de prueba.
3. Esperar la entrega auténtica del webhook y consultar el estado guardado en Trato. Si el evento no llega, revisar el listener; no fabricar el comprobante ni el estado en DB. Sin listener disponible, el descubrimiento requiere asistencia técnica de conciliación.
4. Debe mostrarse un comprobante externo: no completar automáticamente el acuerdo por igualdad de importes.
5. Pulsar **Revisar comprobante externo…**; revisar ID/importe, añadir notas, confirmar y **Aplicar este comprobante externo**.
6. Pulsar **Comprobar saldo para un nuevo intento**, revisar USD 10, añadir notas y **Autorizar un nuevo intento por el saldo**.
7. Solo entonces preparar/confirmar su ejecución y contrastar el nuevo comprobante en Sandbox.

**Validar**

- [ ] El comprobante externo figura una sola vez y aplicarlo no transfiere dinero.
- [ ] Total acordado sigue siendo 15: externo aplicado 5 + nuevo reembolso 10.
- [ ] El intento reservado original no enviado queda resuelto; el nuevo tiene otra identidad y secuencia superior.
- [ ] No se repitieron la retención de 5, el externo de 5 ni la devolución completa de 15.
- [ ] El historial no añade un segundo movimiento monetario por pasar el externo a aplicado.
- [ ] Un comprobante `PENDING`, excesivo o de otra captura no se aplica para forzar el cierre; requiere evidencia/revisión.

## E. Feedback, revisión y aceptación por versión

1. Proyecto independiente y adenda cobrada USD 20: preparar v1 con trabajo reconocido 10 y devolución 10, con sus fuentes; generar, revisar y enviar.
2. El cliente responde al hilo solicitando reconocer USD 8 y devolver USD 12; conservar su respuesta como respaldo del nuevo acuerdo de prueba.
3. **Consultar respuestas de Gmail → Registrar ajustes del cliente**; revisar el mensaje y confirmar los ajustes.
4. Preparar la nueva propuesta, cambiar el concepto a 8 con su evidencia y guardar: debe ser **v2**, no una sobrescritura de v1.
5. Generar/revisar/enviar el PDF de v2. Registrar aceptación nueva del cliente de esa versión.
6. Consultar ambos PDFs, correos y estados desde el expediente/documentos.

**Validar**

- [ ] v1 conserva su contenido, PDF y envío exactos; v2 tiene los propios.
- [ ] Un ajuste interno de borrador no se confunde con una versión nueva para el cliente.
- [ ] v2 no hereda autorización ni aceptación de v1; requiere su propio envío y revisión.
- [ ] Se puede dejar E aceptado sin ejecutar dinero: la ejecución ya se valida en A/B/D.

## 2. Controles finales cortos

| Control | Cómo probarlo | Resultado esperado |
| --- | --- | --- |
| Idioma | Desde perfil cambiar a inglés, abrir A/B completados y volver a español. | Etiquetas, errores, fechas y monedas usan el locale; textos del cliente y PDFs históricos no se traducen ni cambian de importe. |
| Móvil | Abrir el panel a un ancho aproximado de 390 px. | Totales, formularios y comprobantes legibles, sin desbordamiento que impida confirmar o consultar. |
| Accesibilidad | Recorrer acciones con Tab/Enter y comprobar foco visible y etiquetas. | Confirmaciones y campos identificables; ninguna acción de dinero depende solo de un icono. |
| Aislamiento | Salir y entrar con otro usuario de prueba; probar una consulta al expediente ajeno con su JWT en una revisión técnica. | No ve datos privados ni puede consultar/autorizar la devolución ajena. Volver al usuario original conserva su historial. |
| Sin duplicados | En A completado, recargar, abrir/cerrar y consultar nuevamente. | Mismos comprobantes e importes; no aparece otra instrucción financiera ni un hito monetario duplicado. |
| Evidencia insuficiente | Consultar una incertidumbre real si aparece; la prueba técnica puede cubrir referencia ausente/ambigua. | Reserva conservada, sin atribución por importe/fecha ni identidad nueva para ocultar el problema. |
| Seguridad del webhook | Revisión técnica con evento de esquema válido pero firma inválida, y eventual duplicado auténtico. | Se rechaza lo no verificado, no altera dinero; la duplicación auténtica no suma otra vez. |

No hace falta provocar artificialmente `FAILED`, `PENDING`, fallos de red posteriores al POST o ventanas de 44 días en la aplicación conectada para repetir pruebas existentes. Si no aparecen naturalmente, registrar su evidencia automatizada previa; las comprobaciones técnicas pendientes de P0.2 sí necesitan su cierre específico. No modificar relojes, estados financieros, capturas ni filas de proveedor para aparentar esos casos.

## 3. Acta mínima por checkpoint

Copiar una fila por paso o caso. Guardar IDs de prueba necesarios y redactar datos sensibles; no almacenar tokens, claves ni capturas con secretos.

| ID | Estado: aprobado / fallo / bloqueado / pendiente | Resultado observado | Evidencia mínima | Próxima acción |
| --- | --- | --- | --- | --- |
| P0.1–P0.7 | Pendiente | | Entorno, revisión/migraciones, listener sin secretos | |
| A1–A10 | Pendiente | | Proyecto, expediente, snapshots, PDF/hash, capturas, refund IDs | |
| B | Pendiente | | Capturas afectadas y clave conservada, sin tokens | |
| C | Pendiente | | Cierre cero sin operación financiera | |
| D | Pendiente | | Externo 5 + nuevo 10, aplicaciones y secuencia | |
| E | Pendiente | | v1/v2, respuestas y aceptaciones | |
| Controles finales | Pendiente | | ES/EN, móvil, aislamiento y ausencia de duplicados | |

Criterios de bloqueo: datos del proyecto incorrectos, importe/reparto distintos de lo aceptado, captura sin verificar, firma no válida, incertidumbre sin resolver o intento de usar credenciales live. Detener el caso afectado, anotar paso/IDs/código del error y conservar la evidencia; no arreglarlo mediante otro pago, borrado de historial o simulación presentada como integración.

## 4. Cuándo damos por terminada la prueba integral

- **TRATO-13:** solicitud, cálculo, fuentes, versiones y pagos persisten con aislamiento y bloqueo de pedido abierto.
- **TRATO-14:** PDF exacto revisado/enviado y aceptación trazable a su versión; feedback no sobrescribe lo enviado.
- **TRATO-15:** reembolsos Sandbox atribuibles y comprobados, totales correctos, sin duplicados y con consulta/recuperación verificadas. Webhook conectado acreditado aparte de la consulta manual.
- **TRATO-16:** interfaz conectada, desglose/fuentes, ES/EN, móvil e historial único muestran lo realmente comprobado.

Un fallo o bloqueo no se marca «Hecho». El cierre de esta acta no autoriza publicar, hacer push, abrir PR ni merge. Después de documentar los resultados se cierran únicamente los servicios de prueba que hayamos iniciado y se eliminan evidencias temporales ya documentadas; se conservan los registros financieros e históricos necesarios de las transacciones de prueba.
