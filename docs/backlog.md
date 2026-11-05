# Trato — backlog de colaboración

Actualizado: 31 de octubre de 2026. Se incorpora el cierre del flujo de renegociación validado localmente por el usuario; las demás prioridades conservan el estado de la revisión del 26 de octubre. Este documento no activa servicios, gasto, modelos, correos ni operaciones financieras. Las asignaciones se acuerdan entre los integrantes humanos; no se presume que alguien ya tomó una tarea.

## Opcional: verificación OAuth de Google para Gmail

Añadido el 4 de noviembre de 2026. **Por hacer, si queda tiempo después de cerrar y probar los flujos principales.** No bloquea las pruebas autorizadas del buzón central del equipo.

**Objetivo:** completar la revisión de Google para retirar el aviso de aplicación no verificada al autorizar el buzón de Trato. Publicar la app OAuth no equivale a verificarla. Los usuarios normales de Trato no deben conectar su Gmail personal.

**Preparación:** revisar permisos mínimos de envío y lectura, excepciones aplicables al uso real, marca y contacto, dominio verificable, política de privacidad pública y video del consentimiento y uso de cada permiso. Presentar la solicitud desde Google Auth Platform y atender observaciones de Google.

**Dependencia y costo:** la lectura de Gmail usa permisos restringidos. Confirmar si Google exige evaluación de seguridad y su costo antes de contratar o activar algo; cualquier compra requiere autorización del responsable del proyecto. No prometer fecha de aprobación ni eliminar el aviso mediante cambios de interfaz.

**Mientras siga en Testing:** conservar el buzón central como usuario de prueba y revisar la vigencia de su autorización; Google establece siete días para autorizaciones de prueba con estos permisos. Si vence, reconectar explícitamente. No cambiar de transporte automáticamente.

**Criterio de cierre:** Google aprueba los permisos y la autorización deja de mostrar el aviso, conservando envío, lectura y asociación de respuestas a sus proyectos.

Referencias: [verificación de permisos restringidos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) y [audiencia y autorizaciones de prueba](https://support.google.com/cloud/answer/15549945).

## Lote del 4 de noviembre: terminado y en publicación

- Ensayos: configuración simplificada, conversación y análisis, repetición con feedback y comparación de intentos. Diseño revisado por el usuario.
- Reputación: selección de clientes registrados, experiencias y adjuntos, tarjetas y detalle flotante, análisis con fecha del servidor y recomendaciones agrupadas. Diseño revisado por el usuario.
- Registro: confirmación por correo con plantilla de marca; retorno a la instalación de origen e inicio de sesión tras verificar la cuenta, probado manualmente. Detección de una cuenta ya existente comprobada.
- Correo de Trato: envío y recepción centralizados implementados, sin exigir Gmail personal a cada usuario. SMTP de confirmación y OAuth del buzón son conexiones independientes. Buzón conectado localmente; falta repetir envío de adenda y recepción de respuesta tras configurar producción.
- Inicio y demostraciones: navegación y botón de demostración corregidos, introducción y carga con mascota, máximo dos clientes en la vista general.
- Publicación: preparar snapshot conjunto y desplegar sobre la infraestructura existente. No acreditar el recorrido financiero por pasar comprobaciones de arranque.

### TRATO-19: implementado localmente; pendiente de prueba manual Sandbox

La ruta `POST /projects/{project_id}/initial-payments` registra una captura ya completada y verificada; no crea un checkout. `project_received_payments` exige captura única, importe positivo y verificación, por lo que no debe usarse para guardar solicitudes pendientes.

Construir una solicitud de pago inicial persistente y separada de las revisiones de adenda. Reutilizar creación y verificación de órdenes PayPal, permisos, idempotencia y checkout, manteniendo referencia del proyecto y validaciones de pagador y comercio. Tras verificar la captura, registrar el dinero recibido para permitir devoluciones. No crear una adenda ficticia. Probar concurrencia, reintentos, propietario incorrecto, estado incierto y captura duplicada.

TRATO-19 dispone de solicitud persistente, checkout independiente, verificación de orden y captura, correo central revisado e interfaz en resumen y plan. Las pruebas técnicas de permisos, idempotencia y estados pasaron; falta reiniciar los servicios locales con el nuevo código y validar manualmente el recorrido Sandbox completo. No está publicado ni desplegado. TRATO-18 (cierre del proyecto) sigue pendiente.

Diseño: primera mejora local de Clientes y listado de proyectos mediante tarjetas, identidad legible y acciones separadas. El interior del proyecto se revisará por bloques con el responsable del proyecto; no se modificaron los flujos de cambios y devoluciones.

## Asistente con memoria persistente — 4 de noviembre de 2026

Implementado localmente: historial por propietario/proyecto en Supabase, resumen acumulado con corte por posición, contexto reciente exacto, herramienta para recuperar mensajes antiguos y checkpoints reales de LangGraph mediante el backend. Ya no depende de los últimos seis IDs del navegador ni de Redis para leer respuestas archivadas. Se conserva la evidencia documental y el aislamiento de Weaviate. No añade proveedor, servicio o dependencia. Ver [memoria del asistente](asistente-memoria-proyecto.md).

Verificación técnica en curso; pendiente prueba manual de conversación real, compactación y documentos con Gemini. No marcar el flujo como probado E2E por pasar las pruebas unitarias o SQL.

## Cierre de devoluciones — 3 de noviembre de 2026

TRATO-13, TRATO-14, TRATO-15 y TRATO-16: **implementados y validados en el alcance Sandbox aprobado, sin IA**. Dos recorridos manuales confirmados (cierre global parcial e individual total de adenda) y prueba conectada de entrega/deduplicación de eventos genuinos completados. Los apartados siguientes conservan el historial de tandas; sus pendientes históricos se resuelven en [el acta de cierre](cierre-validacion-devoluciones.md). La IA, un checkout inicial integrado y el uso Live no forman parte de este cierre. No se autoriza PR ni merge por publicar esta rama.

## Nuevo lote: IA en expedientes — 3 de noviembre de 2026

Requerimiento ampliado: asistentes para cambios, precios con antecedentes, renegociaciones y devoluciones; trazabilidad documental en Neo4j e interfaz conversacional con actividad real. Ver [backlog por tandas](backlog-ia-expedientes.md) y [plan de tanda 1](tanda-1-ia-expedientes-plan.md). Estado: plan de tanda 1 aprobado e implementación realizada; pruebas y validación real en curso según [acta](tanda-1-ia-expedientes-validacion.md). Cada tanda exige pruebas de código, integración real en la app y validación antes de continuar.

## Hallazgos de pruebas de devoluciones — 3 de noviembre de 2026

Dos tareas nuevas reportadas por el usuario durante sus pruebas. Estado: **Por hacer**, sin responsable asignado. Son pendientes del producto; el cierre Sandbox de TRATO-13 a 16 no acredita que estas capacidades estén resueltas.

### TRATO-18 — Materializar el cierre del proyecto en Trato

**Contexto:** el flujo de devoluciones permite preparar una devolución por cierre de proyecto, pero ese cierre no se refleja de forma efectiva en el proyecto. El usuario no puede reconocer claramente que terminó ni qué acciones siguen disponibles. Finalizar una devolución individual de adenda tampoco debe confundirse con cerrar todo el proyecto.

**Alcance:** definir y persistir el estado de cierre del proyecto, su motivo, fecha y expediente de respaldo; mostrarlo en el listado, detalle e historial. Acordar el hito de negocio que materializa el cierre y las acciones que quedan bloqueadas o permitidas. Separar el cierre del proyecto del estado técnico del reembolso y conservar la consulta del historial, documentos y pagos.

**Criterios de aceptación:**

- Un cierre confirmado se reconoce en el listado y detalle, permanece después de recargar y registra el evento una sola vez.
- Las restricciones acordadas se aplican tanto en la interfaz como en el backend; una petición HTTP directa no puede abrir operaciones incompatibles con un proyecto cerrado.
- Preparar o enviar una propuesta de cierre no cierra el proyecto por sí solo. Un reembolso pendiente, fallido o incierto no se presenta como devolución confirmada; se define explícitamente cómo afecta al cierre y cómo continuar su seguimiento.
- Una devolución individual de adenda conserva el proyecto abierto cuando no existe un cierre global acordado. Los cambios pagados y las revisiones enviadas mantienen su inmutabilidad.
- Estados, mensajes, ayudas y acciones tienen traducciones ES/EN. Se verifican cierre global, devolución individual, reintentos y permisos.

**Prioridad propuesta:** P0 para completar el recorrido de cierre. **Dependencias:** TRATO-13 a 16 y definición del ciclo de vida del proyecto. No implementar reapertura automática ni cerrar unilateralmente aceptaciones registradas.

### TRATO-19 — Cobrar el pago inicial del proyecto

**Contexto:** actualmente se pueden cobrar adendas, pero el usuario no encuentra un recorrido para solicitar y cobrar el pago inicial del proyecto. Registrar un pago inicial externo para una devolución no equivale a disponer de un checkout inicial integrado.

**Alcance:** incorporar una acción de cobro inicial asociada al proyecto y a las condiciones revisadas del acuerdo, con importe y moneda explícitos, checkout PayPal Sandbox y seguimiento persistente. Mantener ese pago separado de los adicionales de adendas y disponible como origen de una devolución cuando corresponda.

**Criterios de aceptación:**

- Desde el proyecto se puede revisar el importe inicial, su moneda y condiciones, y solicitar explícitamente el cobro; no se crea una adenda ficticia para cobrarlo.
- El backend valida propietario, proyecto e importe, y conserva la relación entre solicitud de cobro, orden, captura y pago inicial. Reintentos y concurrencia no duplican el cobro ni el registro del pago.
- Solo una confirmación verificada por backend acredita el pago. Volver de PayPal, abrir el enlace o enviar un correo no lo confirma; cancelar o abandonar el checkout conserva el estado de negocio pendiente.
- El proyecto muestra pendiente/pagado y el historial correspondiente, conserva los identificadores financieros para conciliación y permite recuperar el seguimiento después de recargar.
- El pago inicial confirmado puede consultarse y seleccionarse en devoluciones según su saldo disponible, sin duplicar pagos externos ya registrados ni modificar adendas pagadas.
- Interfaz y errores tienen traducciones ES/EN. Se verifica en Sandbox el recorrido inicial completo y los casos de reintento, cancelación y resultado incierto; no se habilita Live como parte de esta tarea.

**Prioridad propuesta:** P0 para completar el recorrido de cobro del proyecto. **Dependencias:** condiciones iniciales revisadas, integración PayPal existente y coordinación con TRATO-13 a 16 y TRATO-18.

## Objetivo de la entrega

Completar un recorrido real: acuerdo y fuentes → pedido del cliente → análisis con IA y citas → revisión humana → adenda versionada → aceptación registrada → cobro PayPal Sandbox confirmado por backend.

Las devoluciones, la búsqueda híbrida y el grafo amplían ese recorrido. Una maqueta o respuesta simulada no se presenta como integración de IA real.

La revisión final TRATO-09 se realiza contra [bases y lista de evaluación del hackathon](bases-y-evaluacion-hackathon.md), con evidencia por requisito y contraste de los cinco criterios. No marcar cumplimiento sin probar la versión de entrega.

## Ya implementado: no repetir

- [x] Repositorio público con frontend oficial, API, procesador y worker; guía de instalación.
- [x] Supabase Auth, clientes/proyectos, documentos privados y aislamiento por propietario.
- [x] Ingesta PDF real asíncrona: Storage, outbox, Redis propio, worker, procesador, resultados y progreso.
- [x] Propuestas manuales, PDF exacto por instantánea, borradores editables antes de enviar y versiones tras ajustes del cliente.
- [x] Gmail OAuth y envío explícito de adenda/cobro revisados por el usuario.
- [x] Lectura de respuestas de Gmail bajo demanda, con consentimiento incremental, vínculo al hilo y versión enviados, validación de participantes y persistencia sin duplicados en Supabase.
- [x] Consulta de la respuesta del cliente sin la conversación anterior citada, conservando el correo completo como evidencia.
- [x] Vista previa, descarga e importación de adjuntos PDF del cliente; los documentos importados deben terminar su lectura antes de usarse como fuentes de una revisión.
- [x] Renegociación del mismo pedido: feedback del cliente → revisión humana de alcance, adicional y plazo → nueva versión de adenda → envío explícito → aceptación o nueva ronda de ajustes. Cada versión conserva su historial y requiere su propia aceptación.
- [x] Aceptación documental revisada por una persona; no certificación criptográfica.
- [x] Cobro y pago PayPal Sandbox comprobados. Cambios pagados de solo consulta.
- [x] Un pedido abierto por proyecto y borrado lógico de clientes.
- [x] Carga bajo demanda y sincronización de estados al regresar a la pestaña.
- [x] Seguimiento con historial real y mapa alternativo de ejemplo.
- [x] Flujos simulados de cambios/devoluciones, checkpoints, aprobación humana y ausencia de fallbacks automáticos.
- [x] Fuentes oficiales PayPal en la devolución simulada, diferenciadas de documentos del proyecto.

### Renegociaciones — Hecho, validado el 31/10/2026

El usuario completó la prueba local del flujo de renegociación con Gmail y trato-dev, recorriendo nuevas versiones de adenda a partir de contraofertas. Se comprobó la persistencia de respuestas, la recuperación de adjuntos reales y la conservación de las versiones anteriores. La aceptación sigue siendo documental y revisada por una persona; una respuesta de Gmail no acepta automáticamente una propuesta ni autoriza un cobro.

Entrega publicada en la rama `codex/renegociacion-cambios-cotizaciones`, commit [fdd35c7](https://github.com/sebascs04/trato/commit/fdd35c7bbaf30b3a7fc8209a439cf8ef99dd5f3a). Validación: 199 pruebas de API, 42 de frontend y paridad ES/EN aprobadas. Detalles técnicos y alcance local en [integración de Gmail](gmail-integracion.md).

Este cierre corresponde al flujo de negocio de cambios y renegociaciones, sin IA. TRATO-02 a 07 conservan sus criterios de análisis conectado con IA y evaluación completa. Las devoluciones reales TRATO-13 a 16 siguen pendientes; la lectura de Gmail para desarrollo no acredita habilitación para producción.

## Prioridades

- **P0:** necesario para cerrar y demostrar el recorrido real.
- **el equipo:** ampliación elegida del producto; tomar después de asegurar el recorrido P0.
- **el equipo:** fuera del primer cierre, salvo nueva decisión explícita.

Todos los pendientes siguientes están **Por hacer** al publicar. Antes de empezar una tarea, anotar responsable y marcarla **En curso** en el tablero acordado.

## P0 — recorrido real y entrega

| ID | Tarea | Dependencia | Terminado cuando |
| --- | --- | --- | --- |
| TRATO-01 | Preparar el entorno del compañero | Ninguna | Instala desde un clon limpio siguiendo colaboradores.md; entra con sus accesos autorizados, arranca los servicios sin reutilizar recursos de otro proyecto y registra problemas de instalación. |
| TRATO-02 | Definir contrato de referencia inicial revisada y resultado de análisis | Ninguna | API y worker acuerdan IDs, versión de base, fuentes, citas, datos ausentes, estados y traspaso a propuesta. Todo queda en DTO/esquema y pruebas; el modelo no decide permisos ni aceptación. |
| TRATO-03 | Configurar Gemini de forma explícita | Decisión y acceso del responsable del proyecto | Backend, proyecto/región y modelo quedan fijados; se verifica cuota/costo y se autoriza la primera llamada. No autodetecta otro proveedor ni usa Gemini desde el navegador. |
| TRATO-04 | Conectar evaluación semántica y análisis de cambios | TRATO-02 y 03 | Texto real autorizado produce JSON validado, citas literales verificables y clasificación por elemento, o pide aclaración. No usa fixture, precio inventado ni aprobación automática. Conecta analyze-change v3 al contrato acordado. |
| TRATO-05 | Integrar el flujo real de análisis con los threads persistentes | TRATO-02 y 04 | Usa la cola y sobre genéricos; start/resume, idempotencia, contexto y revisión vigente se validan. Sobrevive a reinicio y no duplica propuestas. Las instantáneas del worker se mapean al UUID real de revisión de la API. |
| TRATO-06 | Mostrar análisis real y fuentes en la interfaz | TRATO-04 y 05 | El usuario ve pedido, comparación, citas y aclaraciones del backend; puede revisar antes de crear adenda. No confunde error técnico con pedido ajeno, ni mezcla información de clientes. |
| TRATO-07 | Evaluar y probar el recorrido completo | TRATO-06 | Casos en español cubren incluido, extra, ambiguo, ajeno, instrucción maliciosa en documento, ajustes del cliente e importe cero. Un caso conectado llega al pago sandbox y otro exige aclaración; se conserva evidencia de las pruebas. |
| TRATO-08 | Preparar alojamiento y configuración de la demo | Servicios definidos | URLs, orígenes OAuth/CORS y callbacks son accesibles al evaluador; el enlace de pago no depende de localhost. Se documentan secretos y procesos requeridos sin publicarlos ni contratar planes no autorizados. |
| TRATO-09 | Preparar entrega de hackathon | TRATO-07 y 08 | README reproducible, descripción fiel, cuentas/instrucciones de evaluación y video que muestra el mismo comportamiento del código; revisar duración, idioma, elegibilidad y plazo contra bases vigentes. |

## el equipo — recuperación, relaciones y devoluciones

| ID | Tarea | Dependencia | Terminado cuando |
| --- | --- | --- | --- |
| TRATO-10 | Elegir embeddings y conectar Weaviate | Contratos de fuentes y autorización de recursos | Chunking de documentos reales conserva documento/versión/página; modelo/revisión de embeddings fijados. Búsqueda híbrida con filtros de propietario, cliente y proyecto antes del top-k. Probar pesos y recuperación; no afirmar calidad por sólo crear la colección. |
| TRATO-11 | Conectar Neo4j AuraDB y proyección del grafo | Modelo documentado y autorización de recursos | Proyecta relaciones desde Supabase con IDs estables, actualización idempotente y bajas/permisos. No escribe estados financieros desde Neo4j. Se prueba aislamiento. |
| TRATO-12 | Cambiar el mapa de ejemplo por datos autorizados | TRATO-11 | Mapa e historial corresponden al proyecto abierto, citan fuentes reales y distinguen vínculos confirmados de propuestas. El ejemplo permanece separado y no aparece como respaldo ante un fallo. |
| TRATO-13 | Persistir solicitudes y propuestas de devolución reales | Contrato del cierre acordado | Solicitud ligada a pago/captura y proyecto; evidencia de trabajo y aceptación, importes enteros, devoluciones anteriores y revisión exacta. No se modifica el cambio pagado ni se inventa un valor por porcentaje de tareas. |
| TRATO-14 | Enviar y registrar aceptación del cierre | TRATO-13 | PDF exacto por versión, vista previa de correo, envío explícito y aceptación revisada de esa versión. Editar después de enviar exige feedback y otra versión. |
| TRATO-15 | Conectar reembolso PayPal Sandbox | TRATO-13 y 14 | Backend verifica captura, moneda, titular y remanente; aprobación explícita e idempotencia. PENDING/FAILED/resultado incierto no completan. Confirmación verificada sin duplicar devoluciones. |
| TRATO-16 | Integrar UI de devolución y fuentes oficiales aplicables | TRATO-13 a 15 | Usa estados reales, documentos y condiciones verificadas por país/producto, con URL/fecha/ámbito de las fuentes. Separa comisión, neto y devolución; no garantiza saldo global, conversión ni fecha de abono. Sólo hitos confirmados van al historial único. |
| TRATO-17 | Convertir Word a PDF antes de la ingesta | Conversor y alcance elegidos | Modal de consentimiento/previsualización, conversión explícita y PDF resultante relacionado con el original. Un fallo conserva el estado y no usa otro conversor automáticamente. Hoy DOCX devuelve PDF_CONVERSION_REQUIRED. |

## el equipo — ideas posteriores

- OCR para documentos escaneados, después de elegir motor y evaluar calidad/costo.
- Asistente general y por cliente con fuentes y aislamiento de contexto.
- Recordatorios de cobro autorizados e idempotentes; no amenazas ni envíos autónomos.
- Expediente para disputas y conciliación de bruto, comisiones, conversiones y reembolsos.
- Modo ensayo para comparar escenarios antes de negociar.
- Portada cinematográfica/movimiento y otras mejoras de presentación.
- Predicción de devoluciones únicamente cuando haya datos y evaluación adecuados; no inventar probabilidades.
- Monetización, créditos y suscripciones del producto; no son el foco de la entrega actual.

## Cómo repartir el trabajo

El [estado de implementación y próximos pasos](tareas-p1-p2.md) resume las capacidades actuales y los pendientes de Ensayos, modelo y Reputación.

Propuesta inicial por especialidad, conservada como referencia:

- **IA/worker:** TRATO-02 a 05 y recuperación de fuentes.
- **Backend de negocio/PayPal/Gmail:** contratos del traspaso, TRATO-13 a 15 y callbacks de demo.
- **Frontend:** TRATO-06, 12 y 16; coordinar cambios de connected-workspace.mjs y proposal-workspace.mjs antes de editar.
- **Verificación/entrega:** TRATO-01, 07 y 09. Son un buen primer bloque para quien acaba de incorporarse, sin cambiar a ciegas las migraciones compartidas.

Una tarea puede requerir colaboración, pero debe tener un responsable principal. No asignar dos implementaciones simultáneas del mismo contrato o migración.

## Tablero y reglas de colaboración

Usar una sola herramienta para los estados: **Por hacer → En curso → En revisión → Hecho**, con **Bloqueado** cuando falte una dependencia concreta. Cada tarjeta conserva el ID TRATO, prioridad, responsable, criterio de aceptación y enlace al PR.

Como ya está el código en GitHub, se puede trasladar este listado a Issues/Projects. Trello también sirve si el equipo lo prefiere; no mantener ambos tableros con estados independientes. Este archivo es la base inicial, no un segundo tablero que deba actualizarse manualmente a la vez.

Antes de tomar una tarea: confirmar responsable, carpeta y dependencias. Trabajar en rama y proponer PR; quien revisa comprueba el criterio de aceptación y las pruebas apropiadas. Cambios de base de datos mediante migraciones coordinadas y revisadas, no modificaciones manuales paralelas sin registro.

Mantener secretos fuera de Git. Los permisos de Supabase del colaborador no convierten las simulaciones en datos reales. No activar facturación ni usar infraestructura de otro proyecto. Un fallo se muestra; no añadir fallbacks sin autorización explícita.

## Referencias

- [Preparación del entorno](colaboradores.md)
- [Ingesta conectada](ingesta-conectada.md)
- [Arquitectura IA](arquitectura-ia-trato.md)
- [Flujo de cambios simulado](worker-flujo-cambios.md)
- [Flujo de devoluciones simulado](worker-flujo-devoluciones.md)
- [Modelo del grafo](grafo-conocimiento-trato.md)
