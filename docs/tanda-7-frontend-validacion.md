# Tanda 7 — Interfaz financiera validada antes de la prueba integral

Fecha: 2 de noviembre de 2026. Rama: `codex/devoluciones-reales`.

Alcance autorizado: completar el frontend y ejecutar únicamente sus comprobaciones necesarias. No se modificó el backend, no se levantó PostgreSQL ni se conectó PayPal. La prueba integral del recorrido real sigue pendiente.

## Implementación

- Panel financiero conectado a las rutas existentes, con autorización y ejecución como confirmaciones independientes.
- Importes acordados, confirmados y reservados; detalle por pago, intentos ordenados por `attempt_no` y comprobantes. Bruto, comisión, neto y remanente se muestran al obtener la comprobación del servidor, sin inventar importes no disponibles ni deducir automáticamente la comisión.
- Consulta y conciliación separadas de las acciones que pueden enviar dinero. Replay requiere su propia confirmación y conserva la identidad anterior. Un intento nuevo requiere comprobación y consentimiento nuevos; su ejecución permanece separada.
- Aplicación explícita de un comprobante externo y revisión del saldo restante, conservando el importe total acordado. Incidencias bloquean acciones financieras en pantalla, además de los controles del backend.
- Diario de solicitud por propietario/proyecto: conserva clave, acción y cuerpo exactos de solicitudes financieras sin respuesta. Recargar o consultar no reenvía dinero. Repetir una solicitud requiere otra confirmación visible y reutiliza la misma clave y el mismo cuerpo.
- Versiones antiguas e importes cero no ofrecen acciones financieras. Respuestas de otro propietario se rechazan y respuestas tardías después de abandonar el proyecto se ignoran.
- ES/EN, monedas/fechas por locale, controles con texto y foco visible, vista móvil y distinción entre confirmación del reembolso y abono visible en el banco.

Archivos principales: `refund-finance.mjs`, integración en `refund-workspace.mjs`, estilos, catálogos ES/EN y registro del módulo en `server.mjs`.

La API financiera actual no incluye el detalle de la comprobación histórica en su GET. Por eso comisión/neto y fuentes de la comprobación se presentan durante la revisión en la que se obtienen; tras una recarga no se reconstruyen ni se presentan valores inventados. Su evidencia sigue persistida por el backend. Esta entrega no añade una ruta nueva para recuperar ese detalle.

## Verificación necesaria realizada

- `npm run check`: sintaxis y paridad de 1.788 traducciones ES/EN aprobadas.
- `node tests/refund-finance.test.mjs`: 4 pruebas de lógica aprobadas: importe cero/versiones antiguas y secuencia, bloqueo por vencimiento/incidencias, confirmación y caducidad, aislamiento de respuestas.
- Chromium, solo `tests/browser/refund-finance.spec.cjs`: 7 pruebas aprobadas en 55,3 segundos. Recorrido de autorización/ejecución separado en ES y EN/móvil; respuesta perdida después de ejecutar y consulta tras recarga; respuesta perdida antes de registrar y repetición explícita con la misma clave; aplicación externa parcial y nuevo intento por el saldo; fallo de lectura visible; conciliación sin replay automático y replay confirmado aparte.
- `git diff --check`: sin errores de whitespace.

Los fixtures HTTP son explícitos y usan un dominio `.invalid`. Los importes y comprobantes mostrados en estas pruebas son sintéticos: no representan reembolsos reales ni transacciones conectadas de Sandbox. No se repitieron las suites API/SQL ni se hizo una limpieza de servicios ajenos.

## Estado de cierre

Frontend implementado y validado localmente para pasar a la prueba integral. TRATO-13 a 16 no se marcan como aceptación conectada hasta verificar migraciones compartidas, servicios y recorrido PayPal Sandbox con una captura y autorización concretas. Continúan documentadas por separado las comprobaciones pendientes del cierre de tanda 6; estas pruebas de frontend no las sustituyen.

Al cerrar se detienen la web de prueba y los procesos de navegador propios y se eliminan los binarios, registros y capturas temporales. No hay commit, push, PR ni publicación autorizados por este trabajo.
