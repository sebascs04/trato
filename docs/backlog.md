# Trato — backlog de colaboración

Actualizado: 26 de octubre de 2026. Estado contrastado entre los dos chats que desarrollan el proyecto. Este documento no activa servicios, gasto, modelos, correos ni operaciones financieras. Las asignaciones se acuerdan entre los integrantes humanos; no se presume que alguien ya tomó una tarea.

## Objetivo de la entrega

Completar un recorrido real: acuerdo y fuentes → pedido del cliente → análisis con IA y citas → revisión humana → adenda versionada → aceptación registrada → cobro PayPal Sandbox confirmado por backend.

Las devoluciones, la búsqueda híbrida y el grafo amplían ese recorrido. Una maqueta o respuesta simulada no se presenta como integración de IA real.

## Ya implementado: no repetir

- [x] Repositorio público con frontend oficial, API, procesador y worker; guía de instalación.
- [x] Supabase Auth, clientes/proyectos, documentos privados y aislamiento por propietario.
- [x] Ingesta PDF real asíncrona: Storage, outbox, Redis propio, worker, procesador, resultados y progreso.
- [x] Propuestas manuales, PDF exacto por instantánea, borradores editables antes de enviar y versiones tras ajustes del cliente.
- [x] Gmail OAuth y envío explícito de adenda/cobro revisados por el usuario.
- [x] Aceptación documental revisada por una persona; no certificación criptográfica.
- [x] Cobro y pago PayPal Sandbox comprobados. Cambios pagados de solo consulta.
- [x] Un pedido abierto por proyecto y borrado lógico de clientes.
- [x] Carga bajo demanda y sincronización de estados al regresar a la pestaña.
- [x] Seguimiento con historial real y mapa alternativo de ejemplo.
- [x] Flujos simulados de cambios/devoluciones, checkpoints, aprobación humana y ausencia de fallbacks automáticos.
- [x] Fuentes oficiales PayPal en la devolución simulada, diferenciadas de documentos del proyecto.

## Prioridades

- **P0:** necesario para cerrar y demostrar el recorrido real.
- **P1:** ampliación elegida del producto; tomar después de asegurar el recorrido P0.
- **P2:** fuera del primer cierre, salvo nueva decisión explícita.

Todos los pendientes siguientes están **Por hacer** al publicar. Antes de empezar una tarea, anotar responsable y marcarla **En curso** en el tablero acordado.

## P0 — recorrido real y entrega

| ID | Tarea | Dependencia | Terminado cuando |
| --- | --- | --- | --- |
| TRATO-01 | Preparar el entorno del compañero | Ninguna | Instala desde un clon limpio siguiendo colaboradores.md; entra con sus accesos autorizados, arranca los servicios sin reutilizar recursos de otro proyecto y registra problemas de instalación. |
| TRATO-02 | Definir contrato de referencia inicial revisada y resultado de análisis | Ninguna | API y worker acuerdan IDs, versión de base, fuentes, citas, datos ausentes, estados y traspaso a propuesta. Todo queda en DTO/esquema y pruebas; el modelo no decide permisos ni aceptación. |
| TRATO-03 | Configurar Gemini de forma explícita | Decisión y acceso de Sebastian | Backend, proyecto/región y modelo quedan fijados; se verifica cuota/costo y se autoriza la primera llamada. No autodetecta otro proveedor ni usa Gemini desde el navegador. |
| TRATO-04 | Conectar evaluación semántica y análisis de cambios | TRATO-02 y 03 | Texto real autorizado produce JSON validado, citas literales verificables y clasificación por elemento, o pide aclaración. No usa fixture, precio inventado ni aprobación automática. Conecta analyze-change v2 al contrato acordado. |
| TRATO-05 | Integrar el flujo real de análisis con los threads persistentes | TRATO-02 y 04 | Usa la cola y sobre genéricos; start/resume, idempotencia, contexto y revisión vigente se validan. Sobrevive a reinicio y no duplica propuestas. Las instantáneas del worker se mapean al UUID real de revisión de la API. |
| TRATO-06 | Mostrar análisis real y fuentes en la interfaz | TRATO-04 y 05 | El usuario ve pedido, comparación, citas y aclaraciones del backend; puede revisar antes de crear adenda. No confunde error técnico con pedido ajeno, ni mezcla información de clientes. |
| TRATO-07 | Evaluar y probar el recorrido completo | TRATO-06 | Casos en español cubren incluido, extra, ambiguo, ajeno, instrucción maliciosa en documento, ajustes del cliente e importe cero. Un caso conectado llega al pago sandbox y otro exige aclaración; se conserva evidencia de las pruebas. |
| TRATO-08 | Preparar alojamiento y configuración de la demo | Servicios definidos | URLs, orígenes OAuth/CORS y callbacks son accesibles al evaluador; el enlace de pago no depende de localhost. Se documentan secretos y procesos requeridos sin publicarlos ni contratar planes no autorizados. |
| TRATO-09 | Preparar entrega de hackathon | TRATO-07 y 08 | README reproducible, descripción fiel, cuentas/instrucciones de evaluación y video que muestra el mismo comportamiento del código; revisar duración, idioma, elegibilidad y plazo contra bases vigentes. |

## P1 — recuperación, relaciones y devoluciones

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

## P2 — ideas posteriores

- OCR para documentos escaneados, después de elegir motor y evaluar calidad/costo.
- Asistente general y por cliente con fuentes y aislamiento de contexto.
- Recordatorios de cobro autorizados e idempotentes; no amenazas ni envíos autónomos.
- Expediente para disputas y conciliación de bruto, comisiones, conversiones y reembolsos.
- Modo ensayo para comparar escenarios antes de negociar.
- Portada cinematográfica/movimiento y otras mejoras de presentación.
- Predicción de devoluciones únicamente cuando haya datos y evaluación adecuados; no inventar probabilidades.
- Monetización, créditos y suscripciones del producto; no son el foco de la entrega actual.

## Cómo repartir el trabajo

Propuesta inicial, para confirmar con el equipo:

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
