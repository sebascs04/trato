# Grafo conectado de Trato

Implementado el 27 de octubre de 2026. AuraDB Free propio; Supabase conserva la autoridad de negocio. Neo4j no acepta decisiones de pago, firma o aprobación desde el navegador ni desde un modelo.

## Recorrido

1. Abrir el mapa o pulsar Actualizar solicita `POST /api/v1/projects/{id}/graph/sync` con la sesión del usuario.
2. La RPC `project_graph` autoriza propietario/proyecto activo y captura en una consulta SQL una instantánea coherente de metadatos permitidos. Bajo bloqueo de proyecto reutiliza el mismo trabajo si su contenido no cambió; si cambió, asigna una generación nueva. Trabajo, snapshot privado y outbox se guardan en una transacción.
3. El publicador y consumidor Redis existentes envían el mismo contrato `thread`, workflow `sync_project_graph`. No se añade otro transporte ni un publicador por entidad.
4. El worker valida la orden exacta contra el outbox; obtiene la instantánea mediante token interno y lease, construye relaciones deterministas desde las FK y escribe Aura. No usa IA ni embeddings para inventar enlaces.
5. La escritura mantiene un constraint de identidad y un bloqueo por proyecto en Neo4j; nodos, relaciones y eliminación de conexiones obsoletas del proyecto se confirman en una sola transacción. Una generación antigua no puede reemplazar una nueva.
6. El resultado pasa por el mismo consumidor backend, verificaciones de contexto/lease y deduplicación inbox antes del ACK. `graph_ready` significa que terminó la proyección, no un nuevo evento financiero.
7. `GET /api/v1/projects/{id}/graph` vuelve a autorizar y verificar el hash de la fuente antes y después de leer una generación exacta en Aura. Fuente cambiada: GRAPH_STALE; indisponibilidad: error visible. No se carga demo.json como respaldo.

## Alcance y límites

- Project, Document, Extraction, Proposal, Revision, Review, Acceptance, Delivery y Payment con sus referencias exactas. El cliente figura como contexto del proyecto, sin recorrer otros proyectos a través de un nodo compartido. User y Client como nodos separados quedan para una ampliación.
- Texto de alcance/condiciones y metadatos permitidos; sin PDF, rutas Storage, credenciales, correos de destinatarios, tokens, enlaces de checkout ni chunks/vector. Las fuentes se abren desde el endpoint privado de documentos con JWT.
- Identidad `tabla:PK`, owner/project por nodo y relación, hashes de fuentes y artifacts. Los envíos y pagos quedan ligados a la instantánea exacta de revisión, no a su número visible.
- Se conservan snapshots internos en la proyección; la UI muestra el último borrador por versión y snapshots asociados a envíos/aceptaciones. Filtro por pedido y detalle de conexiones.
- Sincronización bajo demanda al abrir/actualizar; no hay trigger de negocio ni actualización automática continua. Si el proyecto cambia mientras el mapa está abierto, se actualiza explícitamente. No afirmar sincronización en tiempo real.
- Archivar un cliente bloquea de inmediato la lectura desde la API aunque Aura conserve la proyección. El borrado físico de proyecciones archivadas y la retención de snapshots/jobs son trabajo posterior; no exponen los registros archivados mediante la aplicación.
- Devoluciones aún no tienen registros reales de dominio: no se proyecta el simulador como si fueran reembolsos confirmados. Ejemplos antiguos permanecen únicamente en `/grafo.html`.
- Máximo snapshot2MB, consulta2000nodos/5000relaciones. Un exceso falla explícitamente; no se presenta una respuesta truncada como completa.

## Configuración

Credenciales en `.env.neo4j` privado; ejecutar `python3 scripts/configure-graph.py` para copiarlas a `.env` privados de API y worker. `neo4j==6.4.1` y dependencia pytz fijados en ambos lockfiles. El frontend nunca recibe secretos. No se añade puerto local: conexión TLS a Aura, servicios reservados en local-ports.json. No utilizar Neo4j de otros proyectos.

Migración `20261027165842_project_graph_threads.sql`: tabla private.graph_jobs con RLS sin acceso directo para usuarios, wrappers autorizados y extensión del dispatcher backend. La implementación de ingesta anterior se conserva como handler; relay y transporte siguen compartidos.

## Verificación

- Todas las migraciones compilan en PostgreSQL temporal PGlite; pruebas SQL de ingesta y grafo pasan. Grafo probado además en Supabase real con ROLLBACK: cola atómica/idempotente, acceso ajeno, contexto falso, lease, dedup/conflicto, fuente desactualizada y cliente archivado.
- API128pruebas y una regresión posterior de serialización Neo4jDateTime (6pruebas del módulo grafo) aprobadas. Worker67pruebas:61aprobadas y6Redis optativas; las6Redis ejecutadas aparte y aprobadas.
- Trece Chromium de mapa conectado/historial/ejemplo aprobadas, con dobles explícitos de API/Auth. Incluyen datos ajenos, error sin fallback, espera de thread, PDFprivado y regreso al proyecto.
- Smoke real: proyecto existente→SQLjob/outbox→Redis→worker→Aura→inbox listo. 31nodos/48relaciones consultados por GraphReader. Sin modificar propuesta/aceptación/pago. Captura privada desde respuesta real de Aura, con transporte de navegador controlado; no es E2E de sesión real automatizada. La integración visual puede ampliarse por el otro chat conservando los endpoints.
- Advisors: INFO por RLS sin políticas en graph_jobs/outbox/inbox, intencionalmente cerradas a usuarios; aviso Auth de protección de contraseñas filtradas preexistente, sin cambios.

Recarga final realizada con el fix de fecha serializable: salud200, consulta de mapa sin sesión401 y recursosgraph-live200. La vista admite contenedor embebido para el selector Historial/Mapa (ampliación coordinada de P1), conservando modal por defecto para pruebas/reutilización.


## Navegación y disposición del mapa — 27/10/2026

El mapa muestra el proyecto en el centro y organiza las ramas hacia afuera usando un árbol de presentación derivado de relaciones reales: documento/pedido → propuesta → adenda → aceptación → pago. El árbol solo determina posiciones; todas las relaciones originales conservan su origen, destino y verbo, incluso si apuntan hacia dentro. No se añade ni invierte una relación por su apariencia.

Arrastre con puntero, zoom mediante rueda/botones, Ajustar, Ir al proyecto y Ampliar/Reducir mapa. En el lienzo enfocado, flechas desplazan, +/− amplían/reducen y Home vuelve al proyecto. Escape sale de la ampliación. El lienzo usa todo el ancho; los detalles son un panel superpuesto que puede cerrarse. Seleccionar una conexión muestra origen/verbo/destino y permite navegar a sus nodos. No hay nuevas consultas por pan/zoom/selección ni escrituras de datos.

Se conservan el filtro por pedido, fuentes privadas, limpieza de polling/observadores/URLs, modo embebido y modal. Los verbos aparecen sobre las flechas y las relaciones se pueden seleccionar por ratón o teclado. El trazado termina en el borde de las tarjetas para que las flechas sean visibles. Sin nuevas bibliotecas ni puertos.


## Vista de negocio, etiquetas y leyenda — 27/10/2026

La vista del usuario muestra Project, Document, Proposal, Revision, Acceptance y Payment. Extraction, Review y Delivery se conservan en Neo4j para trazabilidad pero no se dibujan: lectura/extracción, revisión interna y eventos de envío no son el objetivo del mapa. Las fechas de eventos se consultan en Historial.

Una relación Revision→SUPPORTED_BY→Extraction se presenta como Revision→Usa como fuente→Document únicamente cuando existe el camino exacto Document→HAS_EXTRACTION→Extraction y coincide su document_id si está presente. Se conservan las referencias de las dos aristas originales en evidence_edges de la proyección visual. Sin ese respaldo no se inventa la conexión. No se alteran datos de Supabase/Neo4j ni el flujo de ingesta.

Los verbos sobre aristas aparecen solo en conexiones activas del nodo seleccionado, o en la arista seleccionada. Las líneas restantes siguen disponibles para consulta sin llenar de texto el lienzo. El inspector explica ← Entra al nodo seleccionado / → Sale hacia otro nodo. Leyenda y contadores usan claves graph.* ES/EN con uiText/uiLocale; títulos y documentos del usuario permanecen intactos.

## Distribución compacta y versión actual — 27/10/2026

HAS_REVISION y CURRENT_REVISION entre la misma propuesta y adenda se presentan como una sola flecha «Tiene adenda». La tarjeta de destino indica «Versión actual» / «Current version»; current_revision_edge conserva la referencia a la relación original. Neo4j no se modifica. Las versiones anteriores siguen visibles según las reglas de negocio existentes.

La disposición se calcula automáticamente: ramas desde el proyecto, atracción entre registros relacionados, separación de tarjetas rectangulares y conservación del orden hacia afuera. No requiere posiciones manuales. Ampliar/reducir ajusta el encuadre al espacio disponible; Ajustar considera el panel de detalles. Quince pruebas Chromium de mapa conectado y navegación aprobadas, incluida una distribución determinista de 25 elementos sin solapamientos. Sintaxis y paridad ES/EN aprobadas (949 claves, incluyendo Ensayos de P1).

## Legibilidad del mapa — 27/10/2026

La distribución compacta anterior podía juntar ramas y superponer verbos; ajustar todo el grafo reducía demasiado las tarjetas. La vista actual usa un árbol horizontal por niveles: cada rama reserva su espacio vertical y mantiene un orden estable. Las posiciones expresan la jerarquía de presentación; las flechas siguen conservando la dirección real de cada relación.

La apertura usa zoom 100% y el proyecto queda a la izquierda; arrastrar permite recorrer las ramas. Ampliar conserva un tamaño legible y centra el elemento seleccionado en el espacio libre del inspector. Ajustar sigue ofreciendo una vista general explícita. Las conexiones no seleccionadas se atenúan; las etiquetas activas se colocan en huecos sin colisionar con tarjetas ni otras etiquetas. Cuando no hay un hueco, el texto se conserva en el inspector y en la etiqueta accesible de la conexión, sin inventar ni eliminar relaciones de datos.

Validación: 15 pruebas de mapa conectado/navegación, y después 11 de navegación con regresiones ES/EN para tamaño mínimo de tarjeta, separación de etiquetas y selección visible fuera del inspector. npm run check y 949 traducciones emparejadas aprobados. Preparado en fix/graph-readability; sin cambios en Ensayos de P1 ni en servicios o puertos.

## Acuerdo inicial como referencia y flechas ortogonales — 27/10/2026

A pedido de Sebastian, si existe un documento initial_agreement, ese documento se coloca en el centro del encuadre inicial y el proyecto queda a su izquierda. Si hay varios, el orden estable por created_at/entity_key determina la referencia visual; todos siguen disponibles. Esta alineación no crea relaciones acuerdo→pedido: se dibujan únicamente las aristas reales. Los demás elementos mantienen ramas y niveles separados. Ir al proyecto centra realmente el nodo de proyecto.

Las flechas usan tramos horizontales/verticales, con puertos laterales y carriles entre columnas. Los recorridos que atravesarían otras tarjetas se desvían por el borde de la distribución. Se mantiene la dirección de cada arista y la colocación de etiquetas sin colisiones. Se corrigió además el bloqueo accidental de los controles al pulsarlos justo después de arrastrar el lienzo.

Verificado con 21 pruebas navegador (incluido centrado ES/EN, segmentos ortogonales y conservación de relaciones) y npm run check (949 traducciones). Último ajuste de separación vertical revisado con pruebas específicas. Estos cambios quedan locales; no se publicó otra revisión del PR existente ni se creó o fusionó ningún PR, conforme a la autorización explícita requerida por Sebastian.

## Puertos exclusivos por conexión — 27/10/2026

Cada extremo de una flecha tiene un puerto propio. La asignación agrupa entradas y salidas por nodo/lado y las ordena de forma estable; incluye conexiones recíprocas y repetidas entre el mismo par. Los tramos cercanos usan carriles separados. Las tarjetas crecen cuando requieren más espacio para sus puertos; las puntas mantienen un tamaño fijo dentro del SVG para no solaparse por el grosor del trazo. Etiquetas y flechas reutilizan exactamente la misma geometría.

Regla registrada en AGENTS.md y comunicada a P1. 22 pruebas Chromium aprobadas, incluida una tarjeta con25 extremos distintos, conexiones recíprocas, orden de entrada independiente y extremos dentro de la tarjeta. npm run check aprobado. Cambios exclusivamente locales, sin push/PR/merge.

## Espacio reservado para los verbos — 27/10/2026

Las etiquetas se colocan comprobando todos los segmentos de todas las conexiones, incluso las no seleccionadas. Se mantiene un margen adicional de8unidades respecto a trazos/puntas y se reserva una caja de fondo con espacio alrededor del texto. La geometría consultada es la misma que se dibuja. Ninguna flecha puede atravesar el espacio de una etiqueta. Regla general registrada en AGENTS.md.

Validación:14 pruebas de navegación aprobadas, más2 regresiones ES/EN que recorren los trazos SVG reales para detectar intersecciones con las cajas de los verbos; npm run check aprobado (945 traducciones tras ajustes de P1). Revisión visual con respuesta real del grafo y transporte de prueba explícito. Cambios locales, sin publicación ni operaciones sobre PR.
