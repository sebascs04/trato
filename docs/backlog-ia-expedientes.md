# IA en cambios, renegociaciones y devoluciones

> Prioridad actual: MVP de agente de cambios únicamente, solicitado el 4 de noviembre. Ver [recorte y plan de dos horas](mvp-agente-cambios.md). Agente de devoluciones: Próximamente, deshabilitado. Las tandas siguientes quedan diferidas.

Fecha: 3 de noviembre de 2026 (America/Lima).
Base inicial: main da18bc2, que incluye el PR #10. Durante la implementación otro trabajo integró main/PR #11 en el checkout compartido (4574ba4); se conservan esos cambios.
Rama del lote: codex/ia-cambios-renegociaciones-devoluciones.
Responsable de preparación local: este chat. Publicación pendiente de autorización; no crear PR ni hacer merge.

## Método acordado

Cada tanda sigue: análisis → plan presentado → validación del usuario → implementación → pruebas de código → integración real en la app → validación del usuario → siguiente tanda. No implementar la tanda siguiente ni dar por aprobado un plan por silencio. Las pruebas reales desde la app están solicitadas para este requerimiento; la restricción histórica de no recorrer la interfaz durante el lote anterior no se extiende a este lote.

Estado actual: plan de tanda 1 aprobado por el usuario e implementación realizada. Pruebas técnicas y validación en curso; integración real desde su sesión pendiente de su resultado. Ver [acta de validación](tanda-1-ia-expedientes-validacion.md).

## Alcance acordado

La IA prepara los campos manuales: análisis, preguntas, alcance, dificultad, esfuerzo, precio, plazo, condiciones, alternativas y textos. El usuario revisa, ajusta y confirma. No crea aceptación, envía correo, cobra ni devuelve dinero por decisión del modelo.

El precio puede proponerse sin tarifa confirmada, mediante una estimación explícita con supuestos y rango. Distinguir evidencia documental, cálculo con entradas confirmadas y estimación. Comparables privados solo del propietario autorizado; experiencias públicas como opiniones, no hechos o precios de mercado. No inventar antecedentes ni activar búsqueda externa o proveedores adicionales.

Neo4j debe ampliar la trazabilidad documental de renegociaciones y devoluciones. El asistente conversacional se integra al expediente y aplica propuestas a borradores editables mediante acción humana. La actividad visual corresponde a trabajos reales y reutiliza ai-activity; el robot de ayuda contextual no acredita inferencia.

## Arquitectura comprobada en la base

- API y worker: ai_jobs, project_assistant y source_tools; trabajos con identidad, execution_id, herramientas y JSON validado. No asumir que el TTL actual de 24 horas sirve como historial durable del expediente.
- Procesador: chunking, embeddings y Weaviate. API autoriza y revalida fuentes. Worker → API → procesador → Weaviate; claves y SDK vectoriales solo en procesador.
- Tenant privado projects_private; reputation_public para experiencias publicadas. La actualización incorporada durante el lote confirma references_shared para la biblioteca administrada de Ensayos (docs/ensayos-busqueda-vectorial.md). No modificar sus herramientas ni tenants; estos expedientes reutilizan exclusivamente su ámbito privado autorizado.
- project_assistant permite buscar resúmenes, leer resúmenes y buscar texto original; valida generación y fingerprint. Reutilizar, sin confundir citas de resumen con texto literal original.
- graph_projection y graph_routes ya proyectan datos autorizados de Supabase a Neo4j. Ampliar el contrato y sus productores, no crear un grafo paralelo.
- Propuestas, Gmail y devoluciones tienen dominio real propio. Los flujos change_flow/refund_flow simulados no se convierten en conectados por añadir un prompt.

Referencias: [asistente actual](asistente-proyecto.md), [búsqueda](busqueda-vectorial-conectada.md), [configuración](configuracion-vectorial-colaboradores.md), [IA existente](integracion-ia-flujos.md), [grafo](grafo-conectado.md), [devoluciones](contrato-devoluciones-v1.md), [prompts](estandar-prompts.md), [actividad](indicador-ia.md).

## Tandas

| Tanda | Entrega | Dependencias | Criterio de cierre | Estado |
| --- | --- | --- | --- | --- |
| 1 | Base documental y asistente vinculado al expediente | Base actual | Desde un cambio o devolución real se consulta evidencia autorizada, con citas originales, estado visible y continuidad persistida; insuficiencia y errores explícitos | Implementada; validación en curso |
| 2 | Cambio asistido y propuesta económica inicial | 1 | IA completa alcance, esfuerzo/dificultad, precio/rango, plazo y condiciones; revisión aplica al borrador existente sin duplicar pedido | Pendiente |
| 3 | Comparables privados para precios | 2 | Herramienta acotada consulta antecedentes del mismo propietario, distingue precios propuestos/aceptados/pagados y explica diferencias; sin comparables informa su ausencia | Pendiente |
| 4 | Renegociación asistida y grafo de revisiones | 2 y 3 | Feedback real y adjuntos se comparan con versión enviada; alternativas revisables; Neo4j enlaza respuesta, documentos y revisión nueva sin heredar aceptación | Pendiente |
| 5 | Documentos de devoluciones y grafo del cierre | 1 y contrato del grafo de 4 | Productores reales incorporan solicitud, política aplicable y respaldos a projects_private; grafo enlaza pagos, evidencia, versiones y confirmaciones reales | Pendiente |
| 6 | Devolución asistida y propuesta de cierre | 5 | IA propone conceptos respaldados y condiciones; backend calcula remanente/reparto multipago y valida; revisión aplica a borrador sin operar PayPal | Pendiente |
| 7 | Cierre integral y UX de los tres recorridos | 1 a 6 | Contexto, recarga, citas, ES/EN, móvil/accesibilidad y errores verificados; recorrido real de cambios, renegociación y devolución validado por usuario | Pendiente |

Cada tanda incluye su UX, traducciones y pruebas pertinentes. La tanda 7 verifica el conjunto, no pospone esos requisitos. Las relaciones de Neo4j se proyectan desde registros autoritativos y distinguen recomendaciones, propuestas y hechos confirmados.

## Condiciones transversales

- Un pedido abierto por proyecto; cambios pagados inmutables; versiones enviadas inmutables y aceptación propia por revisión.
- Identidad/tenant/proyecto y selección autorizada de documentos se derivan en backend; el modelo no amplía permisos. Documentos son datos, no instrucciones.
- Fijar modelo/prompt/esquema/contexto por ejecución; validar allowlist del worker sin extender implícitamente el selector de Ensayos. Sin fallback ni retry de inferencia oculto.
- Guardar propuestas, mensajes y procedencia relevantes en persistencia durable con RLS; separar de caché técnica y estados de negocio. Revalidar al aplicar y rechazar resultado obsoleto.
- Importes enteros en unidad menor, moneda vigente, cálculos deterministas; incertidumbre financiera no se convierte en éxito.
- Citas a versión/extracción/segmento y texto exacto; ausencia de top-k no prueba ausencia de cláusula. Cargar contexto contractual obligatorio además de recuperar pasajes.
- Supabase autoritativo; Weaviate y Neo4j proyecciones. No usar relaciones inferidas como aceptación/pago.
- UI ES/EN, uiText/uiLocale, iconos Lucide, actividad accesible sin porcentajes ficticios. Grafos con puertos exclusivos y etiquetas libres.
- Revisar puertos/listeners/contenedores antes de arrancar; no tocar QAMAQ. No publicar secretos ni cambios locales previos ajenos al lote.
- Registrar por separado pruebas con dobles, integración entre servicios, proveedor real y aceptación en app. Probar recuperación/aislamiento/citas y estado obsoleto, no solo formato JSON.
