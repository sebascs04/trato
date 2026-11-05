# Tanda 1 — evidencia y asistente del expediente

Estado: plan aprobado e implementación realizada; pruebas y validación del recorrido real en curso. Fecha: 3 de noviembre de 2026. Ver [acta](tanda-1-ia-expedientes-validacion.md).

## Resultado propuesto

Abrir un cambio o devolución existente y consultar al agente sobre sus documentos desde ese contexto. El panel muestra qué expediente/revisión está analizando, actividad real, respuesta con pasajes originales y documentos navegables, preguntas pendientes o fallo visible. No crea un nuevo pedido ni altera una propuesta al responder. Todavía no estima precios ni ejecuta acciones de negocio: esas capacidades se conectan en sus tandas.

Esto deja una entrega vertical comprobable con Gemini y Weaviate reales antes de incorporar recomendaciones económicas. La falta de documentos preparados debe mostrarse con su estado y acción explícita de preparación; nunca rellenarse con fixtures.

## Hallazgos

Ya existe un asistente documental del proyecto con herramientas y validación de fuentes. Su ámbito es proyecto, no pedido/revisión/devolución. Los trabajos viven en Redis con TTL de 24 horas; sus IDs en navegador no son persistencia contractual. Hay que enlazar el contexto real y conservar conversación/procedencia sin depender de ese TTL. La ingesta por propósito incluye handlers de devolución, pero la documentación indica que los productores del dominio de devoluciones aún no están enlazados; ese enlace integral corresponde a tanda 5 y debe verificarse en código, no darse por existente.

## Plan de implementación tras aprobación

1. Definir DTOs estrictos de sesión, mensaje y evidencia. Contexto: propietario, cliente, proyecto, tipo de expediente, ID real y revisión/instantánea vigente. Resolverlo en API, nunca desde instrucciones del modelo. Resultado: respuesta, suficiencia, preguntas, citas y referencias al contexto autorizado.
2. Persistir sesión/mensajes/contexto/evidencia en Supabase con RLS e idempotencia. Mantener los trabajos/leases de Redis existentes como ejecución técnica. Precisar migración antes de aplicarla a la base compartida; revisar instalaciones/migraciones pendientes y coordinar cambios comunes.
3. Extender/reutilizar project_assistant y sus herramientas, extrayendo funciones comunes cuando proceda. Conservar contexto contractual obligatorio y ámbitos de fuentes; citas de resúmenes diferenciadas y citas originales para afirmaciones sobre cláusulas. Revalidar estado y generaciones al recuperar resultados.
4. Añadir entrada al asistente desde propuesta y devolución. Conversación vinculada al expediente, restauración al recargar, citas que abren originales y actividad con ai-activity. Reutilizar panel/componentes existentes; diferenciarlo del robot de ayuda. Textos ES/EN y accesibilidad.
5. Verificar contratos y aislamiento, sesión ajena, referencias de otro proyecto, revisión obsoleta, documentos insuficientes, citas alteradas, pérdida de job y reentrega idempotente. Comprobar regresión en propuestas y devoluciones sin inferencia financiera.
6. Preparar y recorrer en app un expediente acordado con documentos permitidos, Gemini/Weaviate reales, pregunta con cita y caso de insuficiencia. Comprobar recarga y apertura del original. Registrar servicio/modelo efectivo y resultados sin publicar contenido privado. No confundir dobles de prueba con esta validación.

## Archivos previstos

- API: trato_api/project_assistant.py, ai_jobs.py, ai_routes.py y módulos nuevos de contexto/persistencia según el DTO; llamadas autorizadas a propuestas y devoluciones, sin cambiar sus reglas financieras.
- Worker: trato_worker/project_assistant.py, ai_jobs.py y esquemas/prompts canónicos de este ámbito.
- Web: project-assistant.mjs/css y puntos de entrada en proposal-workspace.mjs/refund-workspace.mjs; ai-activity reutilizado, locales/es.mjs y locales/en.mjs.
- Supabase: una migración nueva y pruebas de RLS/idempotencia si el diseño final exige tablas; no modificar migraciones aplicadas.
- Pruebas específicas API/worker/web y acta de validación real de la tanda.

Lista orientativa, no reserva frente a otros chats. Coordinar antes de editar archivos compartidos si otro chat trabaja en ellos.

## Aceptación de la tanda

- Solo el usuario autorizado consulta la sesión y sus fuentes; cambiar de proyecto/expediente no arrastra contexto ajeno.
- Respuesta real con cita verificable y apertura del documento; insuficiencia explícita cuando corresponde.
- Conversación y procedencia recuperables tras recarga y fuera del TTL del trabajo.
- Actividad solo mientras hay ejecución real; error visible y reintento explícito.
- No modifica revisiones enviadas/pagadas, ni registra aceptación, correo o movimiento de dinero.
- Pruebas de código e integración real documentadas; validación final del usuario antes de iniciar tanda 2.

El usuario aprobó el plan y el uso de agentes. Durante la implementación se habilitaron explícitamente los interruptores locales de IA/procesamiento, con respaldo privado, y se reinició solo Trato tras autorización específica. Migraciones y resultados de las pruebas se registran en el acta. La validación final del usuario sigue pendiente; no iniciar tanda 2.
