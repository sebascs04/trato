# Tanda 3: interfaz conectada para revisión y aprobación

Estado: diseño aprobado, implementado y verificado localmente. Pruebas de código/API/SQL y 18 casos de navegador aprobados. Despliegue compartido pendiente; ver `tanda-3-devoluciones-validacion.md`.

## Hallazgos

`ConnectedWorkspace.renderRefunds()` contiene información introductoria y el botón de simulación. `proposal-workspace.mjs` instala el seguimiento de pedidos y `requestStatus`; `boot.js` monta los módulos y `server.mjs` permite explícitamente servir sus archivos. Los documentos ya tienen consulta privada del texto extraído y descarga del original.

La API de tanda 2 permite expedientes e instantáneas pero todavía no ofrece un listado específico de pagos elegibles ni consulta del resultado de una clave idempotente tras una respuesta incierta. Consultar todas las propuestas y revisiones desde el navegador sería innecesario y dejaría la selección de elegibilidad dispersa.

La migración de tanda 2 no está desplegada en Supabase compartido. Las pruebas de navegador con API doblada se identificarán como tales. Una prueba conectada real requiere coordinar y aplicar las migraciones pertinentes; no se sustituirá por la simulación ante error.

## Recorrido propuesto

1. Abrir Devoluciones y cargar bajo demanda los expedientes reales y los pagos locales elegibles. Mostrar carga, lista vacía y fallo como estados distintos, con reintento explícito. Conservar la simulación en una sección diferenciada y elegida expresamente.
2. Registrar solicitud: elegir pago recibido, motivo, solicitante y evidencia. El cupo de pedido abierto deshabilita un alta nueva, pero permite consultar/editar el expediente propio abierto. Bloqueo definitivo en backend/SQL.
3. Elegir un documento terminado del proyecto, consultar sus segmentos y seleccionar una cita literal. Obtener UUID de documento/extracción y hash desde la respuesta autorizada, no introducirlos manualmente. Permitir ir a Documentos para añadir una referencia y esperar su lectura.
4. Abrir el expediente y preparar el desglose: conceptos identificables de trabajo reconocido, gasto, penalidad u otro ajuste; beneficiario, descripción, importe y respaldo de cada uno. Para porcentajes: base monetaria y tasa; mostrar redondeo y resultado. No inferir penalidades ni precio por tareas. Confirmación de revisión humana del desglose antes de guardar.
5. Mostrar resumen preliminar de importes registrados y devolución propuesta. Comisión y remanente externos desconocidos se presentan como pendientes de comprobación, nunca como cero. La previsualización del formulario ayuda a revisar; el resultado SQL guardado es la autoridad. No habilitar envío, aceptación ni ejecución financiera.
6. Guardar primera propuesta o editar borrador con snapshot esperado. Mantener v1 y añadir instantáneas internas. Consultar las anteriores en modo lectura, sus condiciones y fuentes. Tras recarga, recuperar el expediente y borrador guardados desde backend.
7. Permitir retiro/rechazo del borrador mediante acción explícita con motivo y confirmación; refrescar el cupo de pedidos. Ninguna aceptación ni propuesta enviada será editable/cerrable por estas acciones.

## Ajustes mínimos de API

- Listado de pagos locales elegibles por proyecto: autorización y proyecto activo, pago contractual completado, USD y captura registrada; DTO mínimo con importe, fecha y referencia de propuesta/revisión. No exponer tokens de checkout, merchant interno o credenciales. No consulta PayPal ni afirma elegibilidad financiera actual.
- Consulta por proyecto y clave del resultado de una operación de devolución: acceso solo al propietario, resultado privado sin permitir ejecutar nuevas acciones. Validación también en SQL; no conceder lectura directa de la tabla privada de comandos.
- Mantener la clave de una operación incierta y consultar su resultado antes de permitir otra alta/edición. Conservar solo identificadores y contexto mínimo por usuario/proyecto en sesión; no guardar contratos, citas o credenciales en almacenamiento del navegador. No reintentar escrituras automáticamente.
- Si se precisa una migración adicional para la consulta idempotente, será nueva y se verificará junto con la de tanda 2; no editar migraciones ya aplicadas en un entorno compartido.

## Archivos previstos

- Nuevos `refund-workspace.mjs` y CSS propio para formularios, listas, detalle y fuentes; utilidades puras para dinero/desglose si corresponde.
- `connected-workspace.mjs`, `boot.js`, `server.mjs`, `index.html`: integración y carga de recursos. Coordinar estos archivos si hay otro chat editándolos.
- `locales/es.mjs`, `locales/en.mjs`: textos, estados, errores, accesibilidad y ayudas mediante `uiText()`/`uiLocale()`; Lucide para acciones funcionales.
- API/repositorio de devoluciones y migración adicional limitada a las lecturas necesarias; tests correspondientes.
- Tests unitarios de formulario/cálculo y navegador; documentación y avance de backlog.

## Condiciones de verificación

- Paridad ES/EN, sintaxis, accesibilidad básica, botones principales con texto, navegación por teclado y formatos por locale sin cambiar USD/zona horaria.
- Importes inválidos, porcentajes/redondeo, penalidad sin fuente, cita inexistente, edición de concepto sin duplicar identidad y discrepancia con cálculo del servidor.
- Alta → propuesta parcial/total/cero → guardar → editar → historial → recarga → consulta. Retiro/rechazo con motivo libera el cupo solo tras respuesta confirmada.
- Doble clic, respuesta incierta, consulta/replay de operación, edición obsoleta y errores de API. Conservar el formulario ante fallo y evitar nuevas identidades de operación automáticas.
- Cambio rápido de proyecto, cierre de sesión y respuestas tardías no muestran ni guardan datos en otro contexto. No mezclar simulación y expedientes reales.
- Tests API de lecturas nuevas, SQL de aislamiento y resultado idempotente. Fixtures de navegador expresamente dobladas; no equivalen a registros en Supabase ni reembolsos Sandbox.

No usar IA, Weaviate, Gmail ni PayPal en esta tanda. No publicar, crear PR ni desplegar automáticamente en Supabase. Finalizada la implementación, presentar resultados y detenerse para revisión antes de tanda 4.
