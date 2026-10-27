# Vista previa del mapa del proyecto

Diseño implementado el 26 de octubre de 2026. Entrada desde **Seguimiento del proyecto**, junto al **Historial**, mediante **Ver mapa · vista previa**, o directamente en `http://localhost:5173/grafo.html`.

- Mapa con tarjetas seleccionables y relaciones etiquetadas, manteniendo la identidad Manrope/púrpura de Trato y los iconos Lucide existentes.
- Panel lateral con descripción, cita, fechas, estado, conexiones y acceso al PDF fuente.
- Recorridos de todo el proyecto, origen del pedido y adenda con respaldo. Atenúan el resto sin mover los elementos.
- Desde el proyecto se abre en un diálogo independiente; volver/Esc conserva cliente, proyecto y vista anterior. Abrir un PDF no abandona el mapa.
- Los módulos, estilos y datos del mapa se cargan sólo cuando se abre. No se consultan APIs de negocio ni Neo4j, no se escribe ni se ejecutan operaciones.

## Fuente del ejemplo

Usa exclusivamente el caso existente SP-001 de `data/demo.json` (Luna Studio / Campaña de lanzamiento), con sus documentos, mensaje, solicitud y cobro base. Se identifica como **Vista previa · ejemplo**, separado de los registros conectados del proyecto desde el que se abre. No crea un grafo ficticio si falla la carga.

El pago USD600 corresponde al acuerdo inicial de la fixture, no al adicional propuesto USD180. La adenda permanece como borrador; no se inventa aceptación o pago de ese adicional. Las relaciones de presentación con la propuesta ilustran el modelo futuro; no son una sincronización Neo4j implementada. No se muestran UUID ni ediciones internas.

## Archivos y verificación

`graph-preview.html`, `graph-preview.mjs`, `graph-preview.css`. Enganche mínimo en connected-workspace.mjs y rutas estáticas en server.mjs; sin cambios de CSS global, dominio, base de datos o worker.

Tres pruebas Chromium aprobadas: interacciones/fuente PDF, fallo de carga visible sin fallback y apertura bajo demanda con regreso al proyecto original. Captura inspeccionada en `.local/browser-tests/graph-design.png`. No se probaron modelos de IA ni se creó una instancia Aura.

## Proyecto con devolución

Ampliación solicitada por Sebastian. El selector superior permite alternar **Con un cambio** (SP-001 / Luna Studio) y **Con una devolución** (SP-003 / Casa Oliva), sin cruzar información entre proyectos. También puede abrirse directamente `/grafo.html?scenario=refund`.

El segundo escenario usa REF-SP-003, su solicitud REQ-SP-003, el pago INV-SP-003-BASE y el mensaje MSG-SP-003-3 de la fixture existente. El cobro original USD90 conserva estado Pagado; la devolución USD90 conserva estado solicitado/pendiente, sin fecha o referencia de ejecución inventada. El mensaje de cancelación se muestra como texto fuente, no como un PDF genérico de otra temática. El acuerdo de reserva conserva acceso a su PDF.

Se añade un cierre por acordar, marcado Por preparar, y conexiones discontinuas para los pasos aún no acordados. Es una propuesta visual futura, sin registro de cierre creado. El recorrido Pago y devolución enlaza ambas operaciones de forma independiente; Motivo y condiciones permite revisar el mensaje y el acuerdo. No calcula un saldo neto suponiendo una devolución completada.

Cuatro pruebas del mapa aprobadas: se mantienen las dos iniciales y se añaden separación cobro/devolución, cambio de escenario sin mezclar proyectos y consulta de la fuente. Captura inspeccionada `.local/browser-tests/graph-refund-design.png`. No se modificaron backend, worker, Supabase ni PayPal.

## Seguimiento del proyecto

Historial y acceso al mapa reunidos en un solo apartado desplegable. Se retira el acceso duplicado de la barra superior. El historial mantiene su carga bajo demanda y caché; cerrar el mapa conserva el apartado abierto, el proyecto y devuelve el foco al botón de entrada. El mapa sigue siendo un ejemplo explícito independiente de los datos conectados.
