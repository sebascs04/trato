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
