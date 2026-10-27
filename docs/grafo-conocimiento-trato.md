# Grafo de conocimiento de Trato — modelo inicial

Propuesta del 26 de octubre de 2026, derivada de las migraciones vigentes. Proveedor elegido por Sebastian: Neo4j AuraDB Free, junto con Weaviate. Este documento define el modelo; no crea una instancia, conexión ni sincronización.

## Preguntas que debe resolver

1. Desde una propuesta o un pago, encontrar el pedido que los originó y las fuentes exactas utilizadas por esa revisión.
2. Desde una adenda enviada, identificar el PDF exacto, sus eventos de envío, la aceptación registrada y el pago de esa misma revisión.
3. Desde una v2, recuperar la respuesta del cliente que motivó el ajuste y distinguirla de una edición interna de un borrador v1.

No se necesita inferencia para proyectar estas relaciones, porque ya existen claves foráneas y registros de negocio. El grafo no debe inferir conexiones a partir de coincidencias de nombres, correos o texto.

## Nodos procedentes de registros reales

| Etiqueta propuesta en Neo4j | Fuente de Supabase | Identificador |
| --- | --- | --- |
| User | auth.users, únicamente identidad referenciada | id; sin copiar credenciales o perfil privado |
| Client | clients | id |
| Project | projects | id |
| Document | documents | id |
| Extraction | document_extractions | id |
| Proposal | change_proposals | id |
| Revision | proposal_revisions | id de cada instantánea real |
| Review | proposal_reviews | revision_id |
| Acceptance | proposal_acceptances | id |
| Delivery | proposal_deliveries | id |
| Payment | proposal_payments | id |

Un documento `kind=email_request` puede llevar además la etiqueta Request. Es **el mismo nodo Document**, con el mismo ID, no una copia ni una tabla requests inexistente. El título de un pedido no es su identificador. Los documentos initial_agreement/reference/addendum conservan su kind real.

`proposal_artifacts` se proyecta como relación entre revisión y documento PDF; `proposal_revision_sources`, como relación con la extracción exacta utilizada. No se crean nodos de factura, entrega de trabajo, reembolso o persona autorizada que todavía no tengan registros de dominio equivalentes. `Delivery` significa envío de correo registrado, no entrega de un servicio freelance.

## Relaciones y su procedencia

| Origen → relación propuesta → destino | Campo o registro que la demuestra |
| --- | --- |
| User → OWNS → Client | clients.owner_id |
| Client → HAS_PROJECT → Project | projects.client_id y owner_id |
| Project → HAS_DOCUMENT → Document | documents.project_id y owner_id |
| Document → HAS_EXTRACTION → Extraction | document_extractions.document_id |
| Proposal → RESPONDS_TO → Document:Request | change_proposals.request_document_id |
| Project → HAS_PROPOSAL → Proposal | change_proposals.project_id |
| Proposal → HAS_REVISION → Revision | proposal_revisions.proposal_id |
| Proposal → CURRENT_REVISION → Revision | change_proposals.current_revision_id |
| Revision → SUPPORTED_BY → Extraction | proposal_revision_sources.extraction_id, document_sha256 y extraction_result_hash |
| Revision → HAS_PDF → Document | proposal_artifacts.document_id y sha256 |
| Revision → HAS_REVIEW → Review | proposal_reviews.revision_id |
| Review → REVIEWED_PDF → Document | proposal_reviews.addendum_document_id y addendum_sha256 |
| Review → RECORDED_BY → User | proposal_reviews.reviewer_id |
| Acceptance → ACCEPTS_REVISION → Revision | proposal_acceptances.revision_id |
| Acceptance → EVIDENCED_BY → Document | proposal_acceptances.returned_document_id y returned_sha256 |
| Acceptance → RECORDED_BY → User | proposal_acceptances.reviewer_id |
| Revision → REPLACES_DRAFT → Revision | proposal_revisions.replaces_draft_id |
| Revision → REQUESTED_CHANGES_FROM → Document | proposal_revisions.feedback_document_id y feedback_notes |
| Revision → BASED_ON_ACCEPTANCE → Acceptance | proposal_revisions.base_acceptance_id, si existe |
| Project → CURRENT_ACCEPTANCE → Acceptance | project_agreement_heads.acceptance_id, si existe |
| Delivery → FOR_REVISION → Revision | proposal_deliveries.revision_id; conservar kind, status y fecha |
| Payment → FOR_REVISION → Revision | proposal_payments.revision_id |
| Payment → FOLLOWS_ACCEPTANCE → Acceptance | proposal_payments.acceptance_id |

El pago puede existir pendiente; sólo status=completed representa un pago confirmado por el dominio backend. Un envío accepted_by_gmail indica aceptación de la solicitud por Gmail, no lectura del destinatario ni aceptación contractual.

La aceptación actual es una revisión manual de documento devuelto. Conservar `method=manual_document_review` y `cryptographic_signature_verified=false`; no dibujar una relación de firma criptográfica ni afirmar identidad/representación del cliente a partir de ese registro.

## Versiones y evidencia

Cada fila de proposal_revisions es una instantánea identificable. revision_no es el número visible v1/v2; draft_sequence distingue guardados previos al envío. REPLACES_DRAFT conecta esos guardados sin convertirlos en versiones nuevas para el cliente. El grafo puede conservarlos internamente; la interfaz no debe mostrar cada edición como un hito.

Un envío, aceptación o pago apunta al UUID de la instantánea real correspondiente. No reasignarlo al borrador vigente por compartir revision_no. Las versiones enviadas y las solicitudes finalizadas conservan sus registros.

SUPPORTED_BY demuestra que una extracción/documento se utilizó como fuente. No demuestra que una cláusula concreta sostenga una afirmación. Ese vínculo con una cita o segmento sólo se incorporará cuando exista una referencia validada del análisis real; no se rellenará con todo el texto o con una relación inventada.

## Propiedades e identidad

- Usar `entity_key` compuesto por tabla y PK para distinguir identidades de tablas diferentes, especialmente Review y Revision. Su unicidad se impondrá al conectar Neo4j.
- Conservar owner_id y el project_id real en los nodos y relaciones que pertenecen al proyecto. User y Client no reciben un project_id inventado, porque abarcan varios proyectos.
- Guardar referencias a tabla/PK, hashes y timestamps procedentes de Supabase para conocer la procedencia de cada relación.
- No copiar PDF, claves, tokens de checkout, enlaces de aprobación o acceso privado. El texto de los chunks y vectores pertenece al índice Weaviate; el original y texto autorizado, a Supabase.
- Los importes siguen en unidades menores y moneda; Neo4j no recalcula ni acredita dinero.
- Distinguir fechas originales del negocio de fechas de sincronización del índice.

## Aislamiento y sincronización por diseñar después

Supabase es la fuente de verdad. Neo4j es una proyección reconstruible; no se editan allí aceptaciones, pagos o adendas como si fueran registros independientes.

La API autoriza propietario/proyecto antes de cualquier recorrido. Las consultas parten de un Project autorizado y mantienen ese ámbito durante cada salto. No permitir salir por Client hacia proyectos ajenos ni confiar en owner_id enviado por el navegador. Usar consultas parametrizadas permitidas, no Cypher arbitrario escrito por el agente.

Al implementar la sincronización se añadirá un workflow/handler al contrato thread y la infraestructura genérica, sin publicador por entidad. El handler tomará una instantánea coherente autorizada de Supabase y actualizará nodos/relaciones con claves estables. Deben definirse control de concurrencia/generación, reintentos, eliminación de relaciones obsoletas y archivado antes de activarlo. Un proyecto archivado deja de ser consultable inmediatamente por autorización de la API aunque la proyección todavía no haya procesado el evento.

Primera visualización propuesta: un recorrido pequeño pedido → revisión → aceptación → pago, con las fuentes al abrir cada conexión. No cargar el grafo completo del estudio ni mostrar las instantáneas internas por defecto.

## Qué sigue

Revisar este modelo con Sebastian, crear AuraDB Free propio de Trato y guardar sus credenciales de forma privada. Después implementar constraints, consultas de evidencia y sincronización acotada. Ningún paso utiliza Neo4j de QAMAQ ni añade operaciones financieras.
