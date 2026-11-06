# Mapa de documentos e hitos clave

Decisión del responsable del proyecto, 5 de noviembre de 2026. Preparado localmente, pendiente de publicación y revisión visual.

El mapa explica las relaciones importantes del proyecto. El Historial conserva el detalle de movimientos. Evitar reproducir registros técnicos como nodos del mapa.

## Presentación acordada

- Mantener proyecto, acuerdo inicial, pedido, cada versión de adenda, aceptación y pago como elementos de negocio.
- Una sola tarjeta por versión de adenda. Su PDF exacto se abre desde el detalle; no aparece como otro nodo con el mismo nombre.
- La aceptación conserva su nodo y ofrece su documento de respaldo en el detalle, sin duplicar ese documento como otra aceptación.
- El pedido conecta directamente con sus versiones de adenda. El registro intermedio de propuesta se pliega cuando su vínculo al pedido es único y verificable.
- Mostrar Creada, Enviada o Aceptada según los registros reales. Enviada exige correo de tipo adenda con estado accepted_by_gmail; un cobro enviado o un envío incierto no lo acredita.
- No mostrar extracciones, revisiones internas de lectura ni instantáneas reemplazadas como hitos nuevos. Cada flecha conserva sus puertos exclusivos y espacio alrededor del verbo.
- PDFs compartidos entre varios registros y fuentes originales no se fusionan por coincidencias de títulos. Solo se pliegan vínculos explícitos y unívocos.

## Integración del responsable de cambios y devoluciones

Cuando exista un rechazo o retiro guardado por su flujo, deberá exponerse con el ámbito exacto de pedido/versión y su respaldo. La interfaz no debe deducir un rechazo por ausencia de aceptación, error técnico, cancelación del checkout ni respuesta aún no clasificada.

Ejemplo deseado, únicamente cuando sus estados existan: Pedido → Adenda v1 enviada → rechazo → Adenda v2 enviada → aceptación → pago recibido. El rechazo puede ser estado de la versión o un hito vinculado según el contrato definitivo del responsable de cambios y devoluciones; no se creó uno ficticio en esta tarea.

Aplicar el mismo criterio al futuro mapa conectado de devoluciones, utilizando sus expedientes, versiones, aceptación y devolución confirmada. No tratar una devolución como otro pedido de cambio ni reutilizar identificadores financieros.

Este ajuste afecta la presentación de graph-live.mjs. No modifica la proyección persistida de Neo4j, versiones, PDFs, correos, aceptación, pagos ni lógica de rechazo/devolución.

## Verificación

Pruebas unitarias con grafos de contrato: pliegue de PDFs, fuentes exactas, ámbitos/versiones distintos, evidencia de envío, instantáneas reemplazadas, layout y rutas. Catálogos ES/EN verificados. Pruebas visuales de navegador pendientes del responsable del proyecto; los escenarios existentes se actualizaron para el nuevo diseño sin ejecutarlos.


## Colores por solicitud

el responsable del proyecto aprobó diferenciar cada historia con un color y una etiqueta breve del pedido. Las adendas, aceptación y pago heredan el color a través de sus relaciones reales; no por el número de versión ni por el título. Dos solicitudes pueden tener una Adenda v1 aceptada y conservar colores distintos.

La leyenda muestra color y nombre del pedido. Las tarjetas relacionadas repiten el nombre brevemente. Los estados siguen escritos: el color identifica la historia y no significa aprobado, rechazado o pagado. Proyecto y fuentes iniciales compartidas permanecen neutrales. Un documento vinculado a varias historias no se asigna arbitrariamente a una sola.

La paleta se calcula sobre todas las solicitudes del proyecto antes de aplicar el filtro, ordenadas por fecha de registro e ID. Se conserva al filtrar o refrescar los mismos datos. Tarjetas y conexiones usan el mismo color, sin alterar los puertos exclusivos ni las reglas de separación de etiquetas.


## Lectura de flechas y relaciones paralelas

Ajuste aprobado tras revisar la imagen del responsable del proyecto: Proyecto → Tiene como acuerdo inicial → Acuerdo inicial; Proyecto → Recibe → Pedido; Pedido → Tiene como propuesta → Adenda. La última expresa la relación inversa de «Adenda responde al pedido» solo en la presentación; conserva origen, destino, tipo anterior y IDs de evidencia. No se reescribe Neo4j.

Cuando una misma adenda además usa ese mismo pedido como fuente, se dibuja una sola flecha principal. La relación de fuente sigue en evidence_relations/evidence_edges y se explica en el detalle de la conexión y sus nodos. Las fuentes distintas, como el acuerdo inicial, mantienen sus conexiones. Nunca se inventa una relación directa Pedido → Acuerdo inicial a partir de esta simplificación.

La ayuda «Cómo leer el mapa» muestra origen → relación → destino. Por petición posterior del responsable del proyecto, sus ejemplos usan nombres descriptivos: Web de Café Aurora, acuerdo de diseño web, añadir una tienda en línea y adenda de la tienda. No renombra los registros reales del usuario. Los filtros, colores y layout siguen la orientación del pedido hacia su versión de adenda.
