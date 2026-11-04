# Diseño local y conexión de servicios

25 de octubre de 2026. Interfaz oficial: http://localhost:5173/#clientes.

## Entrega actual

El diseño aprobado se está trasladando a `connected-workspace.mjs` y `connected-workspace.css`. La carga de datos, las sesiones y las escrituras de documentos conservan las rutas reales existentes. El prototipo inline sigue siendo una referencia visual separada; sus registros y simulaciones no se importan a la aplicación.

- Clientes → proyectos del cliente → espacio del proyecto, sin repetir Nuevo cliente dentro del proyecto.
- Información inicial primero. Añadir fuentes conserva el paso actual; revisar es una decisión explícita.
- Pedidos separados, con título, fecha, estado, versión y siguiente acción.
- Ver seguimiento abre `tab='seguimiento'`, con `requestId` perteneciente a los documentos del proyecto actual.
- `renderTracking(panel)` muestra el pedido guardado y su fecha real, el original y una sola entrada de historial del registro.
- Revisar cambio conserva la comparación con fuentes reales del proyecto y del pedido. Si se abre desde seguimiento, vuelve al seguimiento; desde pedidos, vuelve a pedidos.
- Gmail y la prueba PayPal del perfil permanecen en sus módulos actuales.

## Puntos de integración para P1

`requestRows(requests)` genera la fila por pedido; `renderTracking(panel)` genera el detalle. Actualmente solo representan hechos disponibles en la API de documentos. Sustituir estado/versión/siguiente acción a partir del contrato real de propuestas cuando exista; no inferir aceptación de un archivo, ni pago a partir de un retorno de PayPal. No convertir la prueba técnica de USD 0.10 en un pago de adenda.

Actualización 25/10: el dominio de propuestas y sus migraciones ya están operativos en Supabase. `proposal-workspace.mjs` conecta el seguimiento al backend real; permite preparar términos manualmente sin fingir análisis de IA. No se enlazaron botones a rutas que devuelven 503 ni se inventaron IDs, adendas o resultados de IA. Los siguientes paneles deben conectarse sobre el mismo espacio cuando sus operaciones estén disponibles:

1. Recomendación del agente con fuentes → revisión humana editable.
2. Adenda guardada con revisión inmutable → revisión del correo y envío explícito mediante Gmail.
3. Respuesta o devolución del cliente → revisión humana de aceptación de esa versión.
4. Aceptación revisada y adicional positivo → Pendiente de pago → pago verificado → Finalizado.
5. Adicional cero → Finalizado después de revisar la aceptación de la misma versión.

## Decisiones aprobadas de presentación

- Un solo estado de negocio Pendiente de pago mientras no se confirme el cobro. Cerrar PayPal, cancelar o volver a intentar no cambia ese estado ni añade eventos al historial del cambio.
- Los estados técnicos, reconciliaciones y errores del proveedor se conservan aparte. Una operación incierta nunca se presenta como pagada.
- Historial: un solo evento «Adenda vN guardada». No separar «generada» y «borrador guardado». El borrador sin guardar no añade un evento; cada envío, respuesta, aceptación y pago se asocia a su revisión.
- Fecha y hora de Lima a partir de timestamps guardados. No fechar retroactivamente eventos sin fecha.
- Solicitudes pagadas solo consulta; todas las versiones conservadas. Ajustes posteriores son otro pedido.
- Envío de Gmail requiere destinatario, mensaje y adjunto revisados, y acción explícita del usuario.
- Evitar dos interfaces de seguimiento: conectar Gmail/PayPal a estas vistas y conservar el perfil para administrar conexiones.

## Validación

Comprobación sintáctica `npm run check`. Pruebas Playwright de espacio conectado, Gmail y prueba PayPal del perfil. Nueva comprobación del regreso seguimiento → comparación → seguimiento y fechas reales del pedido; comprobaciones existentes de aislamiento entre clientes/proyectos y ausencia de fixtures durante carga/fallo.

## Integración de P1 aplicada

- PDF privado inmutable por revisión; generación determinista sin LLM ni extracción del documento generado.
- Revisión humana y vista previa de correo (remitente, destinatario, cuerpo y PDF) antes del envío explícito.
- Gmail y PayPal exclusivamente en backend HTTP; ningún comando financiero pasa por el worker.
- Aceptación: PDF devuelto se almacena sin exigir OCR; revisión humana explícita de esa revisión. No se afirma verificación criptográfica.
- Pago: reserva única por aceptación, importe de la revisión, captura backend verificada, cambio finalizado de solo lectura. Retorno/cancelación no añade un estado de negocio.
- Resultados de proveedores: RPC `proposal_backend` ejecutable exclusivamente por `service_role`; la clave `SUPABASE_SERVER_KEY` solo existe en el servidor.
- Callback del comprador: `paypal-payment.html`, acceso acotado mediante token aleatorio del cobro; no necesita cuenta de Trato. En local, el enlace requiere acceso a localhost del equipo que ejecuta Trato.
- La simulación de IA que desarrolla P2 es explícita y separada; no sustituye pagos, envíos o persistencia fallidos.

### Vista previa de fuentes

«Ver documento» (antes «Leer fuente») abre el PDF original en un modal amplio mediante un blob obtenido de la ruta autenticada `/documents/{id}/file`. No muestra el texto extraído como reemplazo del PDF. El enlace temporal se libera al cerrar/cambiar el modal. DOCX informa expresamente que no dispone de vista previa y permite descargar su original; no se convierte ni envía a servicios externos. Las fuentes del análisis conservan su texto extraído para el agente, independientemente de la vista del usuario.

## Separación entre revisión e historial

Actualización 26/10: las tarjetas muestran título, fecha y estado, con versión solo cuando existe. «Revisar cambio» abre las fuentes comparadas y allí aparece «Preparar propuesta manual»; tras guardar se continúa la gestión de esa propuesta. «Ver historial» abre exclusivamente hechos guardados, de todas las revisiones, sin acciones para proponer, enviar, aceptar ni cobrar. La gestión operativa utiliza `tab=gestion`; la consulta `tab=seguimiento`. Documentos se agrupa en desplegables por kind: fuentes iniciales, solicitudes de cambio, adendas, entregas y referencias; cada grupo conserva orden descendente de subida.

## Borradores editables y versiones para el cliente

Aclaración de Sebastian, 26/10: editar un borrador no enviado conserva su número visible (v1). Cada guardado conserva una instantánea interna y su PDF; la interfaz de versiones agrupa las instantáneas por versión visible. `POST /proposals/{id}/draft` usa CAS por expected_revision_id y rechaza adendas enviadas, envíos inciertos, aceptaciones y pagos. La edición invalida la revisión del correo anterior, genera un PDF nuevo y requiere revisión otra vez. Historial presenta «Borrador vN actualizado», sin fingir una vN+1.

Después de enviar aparece «Registrar ajustes del cliente», que exige PDF de respuesta y notas. `POST /proposals/{id}/revisions` exige feedback_document_id/feedback_notes y que la fuente figure entre las referencias de esa versión. El backend requiere un envío anterior confirmado; v2 no hereda envío ni aceptación. Cambios finalizados siguen solo consulta. Migración editable_proposal_drafts aplicada tras prueba PostgreSQL local y prueba Supabase con rollback; 110 tests API y 4 tests navegador específicos pasan.

## Pedido abierto único por proyecto

26/10: migración `one_open_request_per_project` aplicada y verificada en PostgreSQL local y Supabase con rollback. El registro de email_request bloquea un segundo pedido en el mismo proyecto; la reserva serializa en la fila del proyecto. Reintentos con la misma clave siguen funcionando. Referencias/feedback y otros proyectos del cliente siguen permitidos.

GET `/projects/{id}/request-status` devuelve el pedido abierto, la habilitación de registro y cierres persistidos. POST `/requests/{id}/close` exige motivo (`rejected`/`withdrawn`) y notas; rechaza aceptaciones/pagos y envíos inciertos. La interfaz deshabilita Registrar pedido y permite Cerrar pedido dentro de revisión/gestión, nunca en historial. Al cierre, documentos/instantáneas se conservan de solo consulta. No se cerraron pedidos reales durante las pruebas.

Correos confirmados por Gmail ya no muestran otra acción para enviar la misma adenda/cobro; la deduplicación del backend permanece. Pago real sandbox de la adenda confirmado con consulta canónica: orden 2NP654650A988694U, captura 2H670419K3988292F, USD 0.10, registro completed y versión correspondiente bloqueada. No confundir con el diagnóstico independiente anterior.

## Historial único del proyecto y consulta de pedidos

Actualización final del 26/10: sustituye la separación visual anterior en varios historiales. «Historial del proyecto» reúne los hitos de negocio en desplegables por pedido: registro, envío de adenda, aceptación, envío del cobro, pago confirmado o cierre. Tanto los pedidos como sus hitos muestran lo más reciente primero. La API `/projects/{id}/activity` obtiene los hechos persistidos; el pago aparece únicamente cuando el backend lo confirmó. Los eventos de extracción y los guardados internos no se muestran aquí.

La tarjeta del pedido finalizado utiliza «Ver detalles», sin otro botón de historial. La revisión y las acciones operativas permanecen en la gestión del pedido. Documentos conserva una biblioteca compacta agrupada por finalidad, con las fuentes iniciales diferenciadas de solicitudes, adendas y aceptaciones; grupos y archivos se ordenan por incorporación más reciente.

## Carga bajo demanda y tipografía local

26/10: el directorio inicial solicita sesión y clientes en paralelo. La lista de proyectos se consulta al abrir el primer cliente y se reutiliza durante esa sesión de la vista; no se descargan documentos al consultar únicamente clientes/proyectos. El endpoint actual de proyectos sigue devolviendo los proyectos autorizados del usuario: el filtrado por cliente se realiza en la interfaz.

Al abrir un proyecto se solicitan en paralelo los metadatos de documentos, propuestas y admisión de pedidos, necesarios para el acuerdo y las tarjetas visibles. Los PDF originales y el texto extraído siguen obteniéndose sólo cuando se abren. La biblioteca se renderiza al desplegarla. Se eliminó la consulta de eventos técnicos no utilizada por esta pantalla.

El historial se consulta únicamente al desplegarlo. Cerrar y reabrir reutiliza el resultado, sin nueva petición. Recargar el proyecto tras una operación invalida esa consulta; respuestas de un proyecto/sesión anterior se descartan. Un error se muestra y requiere reapertura explícita para reintentar, sin datos de reemplazo. El polling de documentos conserva una generación que impide aplicar respuestas anteriores a una recarga.

Manrope variable se sirve localmente desde assets/fonts, con licencia OFL, precarga y caché de un día. Se eliminó la importación externa de Google Fonts. Estas modificaciones reducen consultas y dependencias; no constituyen una medición de mejora de latencia real.

### Estado backend al regresar de otra pestaña

Revisión de sólo lectura del proyecto de prueba: el backend devuelve Finalizado, revisión bloqueada, ambos envíos aceptados por Gmail, aceptación registrada y pago completed USD 0.10. El front usa business_status del backend para la tarjeta y locked_at para su consulta sin acciones de edición/cobro.

Se corrigió la falta de actualización al completar el pago en otra pestaña: al regresar de una pestaña oculta, Trato consulta propuestas/admisión y, si está abierto el detalle, esa revisión. No vuelve a descargar documentos ni confirma un pago desde el navegador. Invalida el historial para que, si está abierto, lea los nuevos hitos. La sincronización no se solapa consigo misma, no se ejecuta durante formularios/operaciones y descarta resultados de otro contexto. Los fallos se muestran sin sustituirlos por estados inventados. «Verificar pago» también invalida el historial tras la consulta al backend.

## Separación visual entre cambios y devoluciones

26/10, por solicitud de Sebastian: navegación contextual del proyecto con tres secciones persistentes: Proyecto (acuerdo/fuentes), Cambios (alcance/precio/plazo) y Devoluciones (dinero de un pago recibido). Mantiene contexto del cliente/proyecto y una etiqueta accesible estable en escritorio/móvil. No se usa sólo color para distinguir la selección.

Se aplican las guías recogidas en investigacion-ux-trato-2026-10-25.md: espacio persistente separado de tareas, etiquetas según intención y recursos secundarios bajo demanda. La vista Cambios explica que solicitudes de dinero de vuelta corresponden a Devoluciones; ésta distingue cancelación del proyecto y existencia de un reembolso.

Devoluciones tiene únicamente la explicación del proceso y aviso de registro aún no disponible. No simula datos, no muestra un falso saldo/cantidad de solicitudes y no presenta botones financieros inoperantes. Su dominio, formularios y API siguen pendientes. Archivos e historial del proyecto se mantienen únicos y compartidos; navegar entre secciones no crea documentos, aceptaciones, cobros ni devoluciones.

## Recorrido de devolución elegido explícitamente

La pestaña Devoluciones permite abrir «Probar flujo de devolución». Importa refund-preview.mjs y su CSS sólo al pulsar. No usa datos financieros del proyecto abierto. Conserva la navegación, el mapa y el historial reales; éstos no reciben eventos de la prueba. El panel de respaldo separa documentos ficticios e información oficial de PayPal con ámbito/fecha/enlace. Véase worker-flujo-devoluciones.md para contrato, pausas, cálculos y límites.

## Creacion al final de la configuracion

Elegir proyecto nuevo o en marcha inicia un borrador local. No se llama POST/projects ni se suben PDFs antes de confirmar el ultimo paso. La opcion final se llama Crear proyecto. Los originales seleccionados se conservan en memoria y se envian despues de la creacion confirmada; cancelar antes no genera registros remotos.

El comando final lleva Idempotency-Key UUID. El backend lo usa como ID del proyecto bajo el JWT/RLS actual, y ante un conflicto solo devuelve el mismo proyecto si cliente y nombre coinciden. No se requiere migracion. Una respuesta incierta se puede reintentar con la misma clave sin duplicar. Si falla una subida posterior, el modal conserva el proyecto creado y las claves de los archivos pendientes; Completar guardado reintenta esas subidas, no la creacion. Los planes por etapas siguen siendo borradores de sesion y no constituyen un acuerdo persistido ni un cobro.
