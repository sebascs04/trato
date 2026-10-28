# Auditoría de cargas — 27/10/2026

Se revisaron directorios, apertura de proyecto y adendas, versiones, subida de fuentes, generación de PDF, revisión/envío Gmail, aceptación, creación/conciliación PayPal, lectura de documentos, historial, mapa y consultas periódicas de ingesta. No se añadieron proveedores, transportes alternativos ni simulaciones como respaldo.

## Cambios aplicados

| Recorrido | Ajuste |
| --- | --- |
| Clientes/proyectos | La aplicación solicita `/projects?client_id=...` al abrir ese cliente, guarda resultados en memoria por cliente y comparte una petición en curso. El backend filtra por el ID bajo el JWT/RLS vigente. No carga los proyectos de otros clientes para filtrarlos después. |
| Crear cliente/proyecto o eliminar cliente | Se utiliza la respuesta confirmada para actualizar el directorio local. No se vuelve a pedir sesión, clientes y proyectos completos. Abrir otro cliente o Actualizar conserva su consulta explícita. |
| Ver detalles | Se elimina volver a descargar el listado de propuestas cuando ya se conoce su revisión. La vista pasa a carga antes del primer await, con indicador visible y bloqueo de resultados tardíos. |
| Listar propuestas | Después de autorizar el proyecto, cuatro lecturas independientes van en paralelo con máximo cuatro hilos. Se elimina una lectura de pagos cuyo resultado no se utilizaba. |
| Consultar una revisión | Se lee directamente la propuesta autorizada y la revisión solicitada; no se carga antes el historial completo de versiones. Las ocho colecciones independientes se leen en grupos de hasta cuatro. |
| PDF/correo/aceptación/pago | Cada operación pide únicamente sus colecciones: PDF usa partidas/fuentes/artefactos; correo de adenda, artefactos/revisión; correo de cobro añade pagos; PDF devuelto usa envíos; preparar/conciliar cobro sólo necesita la cabecera/revisión antes de sus verificaciones específicas. El endpoint de detalle conserva su respuesta completa. |
| PDF recién generado | Tras registrar su vínculo se consulta únicamente el artefacto confirmado; no se vuelve a cargar toda la revisión. Se conserva comprobación de hash e inmutabilidad. |
| Selector de versiones | `summary=true` obtiene IDs, número de versión, secuencia, importe y fecha; evita traer condiciones y todas las instantáneas completas para un selector. |
| Guardar una adenda o aceptación | Después de actualizar documentos/propuestas/estado del proyecto, se reutiliza el listado recibido al recuperar el detalle; no se pide otra vez. |
| Enviar correo | Se actualiza propuesta/detalle e invalida historial; no se recargan los documentos que no cambió el envío. |
| Operaciones PayPal | Se refresca también el estado del pedido en paralelo con el listado cuando corresponde. La confirmación financiera sigue en el backend; no se deduce de regresar del checkout. |
| Documentos e historial | Pestañas independientes. El historial sólo consulta actividad al abrirse; los documentos usan los metadatos ya necesarios para el resumen. Originales y texto se solicitan al consultar su fuente. |
| Historial/Mapa | El selector mantiene ambas vistas dentro del proyecto. Cambiar de una a otra conserva el mapa y no repite sincronización. Actualizar mapa sigue siendo una acción explícita. Salir cancela el uso de respuestas tardías y libera el visor/URLs PDF. |

## Cargas conservadas intencionalmente

- Restaurar/validar la sesión y autorizar el padre antes de leer datos privados.
- Verificar en el servidor remitente/destinatario, revisión, PDF exacto y digest antes del envío.
- Refrescar el estado de negocio después de una operación confirmada, sin reutilizar estados financieros antiguos.
- Leer documentos, propuestas y bloqueo del proyecto al abrir su resumen: sus previews utilizan esos metadatos. No se descargan originales, texto, actividad ni Neo4j por abrirlo.
- Paginar segmentos para no perder texto. Las fuentes del comparador usan lotes limitados, no descargas sin límite.
- Consultar avance de los documentos que continúan procesándose sólo en el proyecto activo; se detiene al salir, ante error o al terminar. El mapa mantiene su propio hilo de sincronización solicitado por el usuario.
- Los errores se muestran; no se completan respuestas parciales ni se usan fixtures ante fallo de red.

## Validación

135 pruebas API aprobadas, incluyendo concurrencia máxima de cuatro, acceso rechazado antes de lecturas hijas, aislamiento de versión, fallo visible sin éxito parcial, selector ligero y filtro por cliente. 40 pruebas Chromium de workspace/propuestas y tres de overview aprobadas. Se verificaron carga inmediata con respuesta demorada, caché de historial/mapa, salida antes de terminar sincronización, PDF privado y ausencia de recargas globales tras crear registros.

Se inspeccionó visualmente Historial con el mapa embebido. Las pruebas del navegador doblan explícitamente las APIs de negocio; no enviaron correos ni generaron pagos/reembolsos. No se ha medido un porcentaje de mejora de latencia real: los resultados demuestran menos consultas y menos dependencias secuenciales, no una promesa de tiempo de respuesta.

## Reintento y abandono de detalles

Se añadió una salida explícita cuando falla la consulta de una adenda: un único error, Reintentar y Volver a los pedidos. El reintento conserva la revisión elegida y no vuelve a descargar el listado del proyecto. Una respuesta fallida que llega después de abandonar esa vista se ignora; no reemplaza la pantalla actual ni deja el indicador de carga activo. El identificador de reintento se limpia al cambiar de contexto.

La vista marca el error que ya presenta para evitar repetirlo en el aviso global; la excepción sigue interrumpiendo los pasos posteriores. No se convierte una carga fallida en éxito. 14 pruebas de propuestas aprobadas, incluyendo reintento sin escrituras y abandono con respuesta demorada.
