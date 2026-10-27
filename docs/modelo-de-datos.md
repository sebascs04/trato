# Modelo de datos de Trato

Fuente de ejemplos: `data/demo.json`, formato `schemaVersion: 1`. Es una fixture frontend, no una API ni una base de datos implementada.

## Entidades y relaciones

| Colección | Clave primaria | Relaciones y finalidad |
|---|---|---|
| freelancers | id | Propietario del espacio. |
| clients | id | freelancerId → freelancers. Nombre y contacto del cliente. |
| projects | id | clientId → clients. Servicio y estado del proyecto. |
| documents | id | projectId → projects. Identidad estable de un documento. |
| documentVersions | id | documentId → documents. Contenido, número de versión, aceptación y fecha. |
| conversations | id | projectId → projects. Canal de conversación. |
| messages | id | conversationId → conversations; sourceVersionId opcional → documentVersions. Autor, contenido y fecha. |
| requests | id | projectId → projects; sourceMessageId → messages; sourceVersionId → documentVersions. Tipo, importe propuesto y estado. |
| invoices | id | projectId → projects; requestId opcional → requests. Importe, moneda, vencimiento y pago. |
| refunds | id | invoiceId → invoices; requestId → requests. Importe solicitado y estado del reembolso. |
| events | id | projectId → projects; sourceVersionId → documentVersions; invoiceId o requestId opcional. Línea de tiempo. |
| demoScenarios | id | requestId → requests. Respuesta predefinida exclusivamente para la demostración. |

Un cliente puede tener varios proyectos. El prototipo incluye uno por cliente, pero no existe un campo projectId en la entidad `clients` ni un límite de relación uno a uno en la fuente. Un documento puede tener varias versiones.

## Reglas para conectar una BD

- Usar claves foráneas reales, no buscar clientes por nombre. Los IDs actuales son legibles para la demo; el backend puede elegir UUID y conservar IDs públicos separados si los necesita.
- No duplicar nombre de cliente, contacto o contenido de términos en cada cobro y evento.
- Los eventos de la fixture no almacenan importes duplicados; la presentación resuelve invoiceId o requestId. Una acción local simulada puede contener un importe provisional hasta que exista una entidad persistida.
- Una versión aceptada debe conservarse inmutable. Los borradores no reemplazan automáticamente acuerdos aceptados.
- En Postgres, utilizar importes `numeric` con escala definida y moneda, o unidades menores enteras. Los números JSON actuales son montos de ejemplo en USD; no establecen un contrato de cálculo monetario de producción.
- `invoices` son solicitudes de pago del producto, no una afirmación de validez tributaria. No confundirlas con comprobantes fiscales.
- Las relaciones cruzadas deben pertenecer al mismo proyecto y propietario. Comprobarlo al escribir y al consultar. Autorización y RLS pendientes; la separación de arrays en el navegador no es seguridad.
- Los campos providerReference son null porque no existen transacciones PayPal reales. En producción habrá referencias verificadas e idempotencia.
- Los timestamps se guardan como ISO 8601 con zona. La UI los presenta en America/Lima. El «hoy» de la fixture está en meta.asOf.
- Estados financieros provienen del backend y PayPal; un mensaje de chat o una aprobación no equivale a pago completado.
- Agregar índices sobre claves foráneas y fechas para consultar historial por proyecto y cobros por vencimiento. Definir restricciones de estados y de importes no negativos.

## Presentación y carga

`boot.js` descarga el JSON y verifica formato de colecciones e IDs. Si falla, muestra un error explícito. `app.js` resuelve relaciones en proyecciones para la UI. Esas proyecciones pueden incluir etiquetas derivadas; no deben convertirse sin revisión en tablas duplicadas.

El historial obtiene eventos por projectId, ordena por fecha, filtra por tipo y calcula cobrado/pendiente a partir de invoices. La vista general calcula importes y conteos a partir de requests. Nuevos registros relacionados pueden poblar estas listas sin agregar tarjetas a mano.

Para un backend real, reemplazar la fixture por repositorios/servicios que retornen el contrato acordado. Todavía no se han implementado endpoints, migraciones, autenticación ni sincronización.

## Datos exclusivamente de demo

Todos los nombres, conversaciones, aceptaciones, pagos y eventos son ficticios. `demoScenarios` no es memoria del agente ni tabla financiera; debe retirarse al conectar el modelo. Los nuevos mensajes, borradores y aprobaciones se guardan solo en memoria y desaparecen al recargar.
