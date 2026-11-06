# Reuniones en Trato: viabilidad sin activación

Investigación del 3 de noviembre de 2026. Propuesta, no función implementada ni servicio activado.

La visión solicitada es una reunión dentro de Trato con asistencia en vivo. El análisis de una transcripción después de la reunión es una posible etapa de implementación, no un reemplazo acordado de esa visión.

## Capacidades documentadas

Gemini Live API en Google Cloud admite audio en streaming, transcripciones y configuración de instrucciones de sistema. Algunos modelos permiten actualizar instrucciones y herramientas durante una sesión; el mecanismo concreto depende del modelo. Esto permite diseñar modos de requisitos, negociación, alcance o general. Cambiar instrucciones no modifica los pesos del modelo.

Fuente oficial consultada: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/start-manage-session .

## Trabajo de Trato

La aplicación debe construir o integrar la sala entre participantes, invitaciones, captura autorizada del audio y entrega al servicio. Debe mostrar requisitos, dudas, decisiones y posibles extras con referencias a la transcripción y al acuerdo inicial. El contexto privado, la elección de tools y las autorizaciones pertenecen al backend/worker existentes. No sustituir sus colas, ni enviar claves al navegador.

Al terminar, una propuesta de proyecto o cambio sigue siendo un borrador revisable. Una transcripción no equivale a adenda aceptada ni autoriza cobros o devoluciones. Las comunicaciones y pagos conservan sus confirmaciones existentes.

## Pendiente de verificar en nuestra cuenta

Modelo Live y región habilitados, permisos, cuotas, tarifa por audio/texto, duración prevista y elegibilidad de cada SKU para el crédito promocional. El SDK Google GenAI ya es dependencia del worker; eso no implica que exista integración Live ni un modelo de audio autorizado. La documentación establece viabilidad técnica, no acredita acceso en este proyecto.

No se han habilitado APIs, creado recursos, efectuado inferencias, cambiado modelos ni activado facturación para esta investigación.

## Comprobación de cuenta del 3 de noviembre

Se hicieron exclusivamente consultas de metadatos y permisos, sin sesiones Live ni inferencia:

- API aiplatform ya habilitada; no se activó ningún servicio.
- Proyecto con facturación vinculada activa; esto no demuestra saldo de créditos ni cobertura de cada SKU.
- El catálogo autenticado de Iowa devuelve publishers/google/models/gemini-3.8-live, versión default y etapa GA. Esto acredita lectura del catálogo, no una sesión de inferencia exitosa.
- Consulta completa de cuotas: 380 métricas en dos páginas. La cuota bidi específica de gemini-3.8-live en us-central1 devuelve effectiveLimit=1000; no equivale a capacidad reservada ni disponibilidad garantizada.
- La identidad del worker devuelve aiplatform.endpoints.predict en testIamPermissions. No devuelve serviceusage.services.use entre los permisos consultados; revisar necesidad de ese permiso antes de una prueba autorizada, sin concederlo automáticamente.

Las primeras consultas con scope cloud-platform.read-only dieron403 para algunos recursos; al usar el scope cloud-platform habitual con los mismos GET, catálogo y vínculo de facturación respondieron200. No se cambiaron roles ni cuentas. El endpoint de cuotas correcto es v1beta1, no v1.

Tarifas documentadas para Gemini3.8Live, por millón de tokens en región no global: audio entranteUSD3; texto entranteUSD0.75; texto saliente/razonamientoUSD4.50; audio salienteUSD12. Fuente: https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing . A25tokens/segundo de audio,30min de entrada serían45000tokens≈USD0.135 solo de entrada; no incluye respuesta, contexto, infraestructura de llamada ni almacenamiento. Es una estimación de una parte del consumo, no un precio de reunión ni una garantía de cobertura promocional.

La documentación oficial de la plataforma anuncia que el crédito inicial puede aplicarse a consultas de modelos: https://cloud.google.com/products/gemini-enterprise-agent-platform . Falta validar condiciones/saldo y aplicación al SKU concreto en la cuenta antes de consumir. No confundir con las tarifas o créditos de Gemini Developer API/AI Studio.

Recibos completos privados en .local/live-feasibility-check-results.json, .local/live-quota-results.json y .local/live-worker-permissions-results.json; no publicar credenciales ni esos archivos automáticamente.
