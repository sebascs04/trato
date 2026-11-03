# Tanda 3: interfaz implementada y validada localmente

Alcance aprobado por el usuario. Código, API, SQL e interfaz verificados localmente. Sin IA, correo ni ejecución de reembolsos. Pendiente de revisión del usuario y despliegue coordinado en Supabase; no autoriza avanzar automáticamente a tanda 4.

## Cambios

- `refund-workspace.mjs/css`: pestaña Devoluciones con expedientes reales, solicitud y selección de pago, fuentes leídas, citas literales, propuesta con conceptos justificados, porcentajes y redondeo, borradores e instantáneas anteriores de solo consulta. Retiro/rechazo explícito con motivo.
- `refund-form.mjs`: cálculo en centavos sin floats para entrada y porcentajes; SQL sigue siendo autoridad al guardar. La comisión y disponibilidad externa se muestran pendientes de verificación, sin inventar cero.
- Referencias PDF adicionales desde Documentos o el selector de evidencia: se guardan como `reference`, no abren otro `email_request` ni modifican el registro pagado. Reutilizan la ingesta existente; deben terminar de leerse antes de citarse.
- Claves y estado incierto: el navegador conserva solo identificadores por cuenta/proyecto en sessionStorage. No guarda documentos ni condiciones allí. Un fallo incierto bloquea escrituras nuevas; permite consulta y reintento explícito con la misma clave y copia inmutable del payload mientras la página siga abierta. No hay reintentos financieros.
- Si se recarga después de una respuesta incierta, se consulta la operación por su clave. Si no hay resultado confirmado y se perdió el payload de memoria, no se genera otra identidad ni se reconstruyen datos: queda bloqueado y requiere revisión. Esto se comunica al usuario, sin declarar que el intento falló definitivamente.
- Respuestas tardías no cambian el estado de otro proyecto o cuenta. La simulación sigue siendo una elección expresa separada del módulo conectado.
- Catálogos ES/EN, fechas y moneda por locale, foco visible y acciones principales con texto. El JSON de los documentos y sus citas no se traducen.

## Consultas nuevas de API

- GET `/api/v1/projects/{id}/refund-payments`: pagos contractuales locales completados en USD, con captura registrada. Datos mínimos, sin tokens de checkout ni credenciales; añade devoluciones previas confirmadas registradas en Trato. No consulta PayPal ni afirma disponibilidad financiera actual. Lista de hasta 100 pagos.
- GET `/api/v1/projects/{id}/refund-operations/{key}`: resultado confirmado de un comando propio de ese proyecto o `unconfirmed`. La migración nueva `20261101170000_refund_operation_lookup.sql` valida identidad/proyecto y no concede lectura directa de comandos privados. Un resultado ausente no prueba fracaso definitivo.

Las migraciones de tandas 2 y 3 no están aplicadas al Supabase compartido. Si faltan, el error de persistencia queda visible. No hay datos ficticios como sustituto.

## Resultados comprobados

- **242 pruebas de API aprobadas**, incluidas las lecturas nuevas y sus contratos. Ejecución fuera del sandbox por la limitación conocida de TestClient.
- **45 pruebas CJS y 6 MJS de frontend aprobadas** fuera del sandbox. Incluyen 9 pruebas específicas nuevas de dinero, porcentajes, revisión con evidencia, render de instantáneas, escape de datos, respuesta tardía de otro proyecto y referencia sin abrir pedido y retención de identidad ante conflicto idempotente. No son pruebas de navegador.
- `npm run check` aprobado y **1.622 claves ES/EN** con paridad y parámetros comprobados.
- **26 migraciones aplicadas desde cero** en PostgreSQL temporal aislado por socket, sin puerto TCP. Aprobados `refund_settlements.sql`, `refund_operations.sql`, `one_open_request.sql` y `proposal_lifecycle.sql`, con fixtures sintéticas y rollback. La consulta no revela resultados de otra cuenta/proyecto ni escribe eventos.
- `git diff --check` sin errores.

## Verificación de interfaz en Chromium

**18 casos únicos aprobados**, con el navegador Chromium de la versión fijada de Playwright y API de prueba explícita. No se crearon registros en Supabase ni se usaron sus credenciales.

- 11 casos de `tests/browser/refunds-connected.spec.cjs`: propuestas total/parcial/cero y recarga; identidad estable de conceptos, instantáneas e historial de solo consulta; resultado incierto consultado tras recarga; reintento con la misma clave y payload; conflicto de versión conservando el formulario; etiquetas en inglés y cierre explícito; penalidad porcentual respaldada y rechazo de cita inventada; bloqueo de escrituras ante resultado no confirmado; ausencia de condiciones/documentos en sessionStorage; respuestas tardías al cambiar de proyecto y cierre de sesión; PDF adicional como referencia sin abrir otro pedido.
- 4 casos de `project-overview.spec.cjs`: resumen, navegación, proyecto vacío y recuperación del proyecto abierto.
- 2 regresiones de `connected.spec.cjs`: agrupación de documentos por pedido y separación de cambios/devoluciones sin operaciones financieras.
- 1 regresión de `refunds.spec.cjs`: acceso a simulación solo por elección explícita, sin iniciar su worker.

Además, se comprobó a 390 px que el formulario no desborda el ancho y que Tab desde la confirmación de revisión lleva a Guardar borrador. Se inspeccionó la captura móvil de una propuesta con penalidad porcentual. Las capturas se eliminan al documentar los resultados.

La primera ejecución de 7 casos pasó; la siguiente ejecución de 14 incluyó esos 7 más casos adicionales y resumen; la última añadió 4 casos. Se informan 18 casos únicos, sin contar dos veces las repeticiones.

Comandos usados: `playwright test tests/browser/refunds-connected.spec.cjs tests/browser/project-overview.spec.cjs` y selección por `--grep` de las regresiones adicionales, con `--config=playwright.config.cjs`. Chromium se descargó mediante el CLI del paquete del proyecto desde `cdn.playwright.dev` en `/tmp/trato-refund-browser`. La biblioteca Linux faltante `libasound2` se descargó de Ubuntu y se extrajo en ese mismo directorio, sin instalación global; `LD_LIBRARY_PATH` solo se aplicó a las pruebas. Se usaron perfiles de navegador temporales, sin abrir el perfil personal.

## Límite de la validación

Estas comprobaciones verifican interfaz y contratos con dobles de API; no prueban por sí solas un recorrido conectado contra Supabase/PayPal. Falta coordinar las migraciones y comprobar un expediente real en la app conectada. La ejecución financiera, PDF, correo y aceptación continúan en sus tandas futuras. No es una auditoría completa de seguridad ni un análisis antivirus de los binarios descargados.

## Recursos y publicación

La web y PostgreSQL usados para tests quedan detenidos; los entornos temporales de PostgreSQL y Chromium y las capturas de estas pruebas se eliminan después de documentar los resultados. Se conservan código, tests y documentación. No se hizo push, PR, despliegue ni llamadas a Gemini, Weaviate, Gmail o PayPal.
