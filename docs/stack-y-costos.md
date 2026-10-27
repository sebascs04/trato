# Stack y costos — investigación del 21 de octubre de 2026

## Decisión para este prototipo

HTML, CSS y JavaScript sin dependencias de aplicación. Servidor local Node.js. Ninguna cuenta, consumo de modelos, pago ni despliegue externo. Costo adicional de servicios contratados por este prototipo: US$0.

Los límites y promociones pueden cambiar. Los créditos descritos abajo están publicados; no se han reclamado, y no se ha confirmado su aplicación a la cuenta del equipo.

## Qué ofrece el hackathon

- PayPal sandbox gratuito, para probar operaciones de pago sin mover dinero real. No equivale a infraestructura gratuita para todo el producto.
- Render anuncia US$50 en créditos para participantes en su página oficial del hackathon. Hay instrucciones de activación y facturación; antes de utilizarlos hay que revisar condiciones, vigencia y consumo. No confundir con los premios de Render otorgados a ganadores.
- PayPal ofrece Agent Toolkit y MCP como herramientas de integración con sus capacidades. No sustituyen el modelo ni garantizan inferencia gratuita.

Fuentes:
- https://paypalaihackathon.devpost.com/details/render
- https://paypalaihackathon.devpost.com/resources
- https://developer.paypal.com/sandbox-testing/overview
- https://developer.paypal.com/ai-tools/get-started

## Opciones consideradas

| Herramienta | Función | Evidencia de precio / límite | Recomendación provisional |
|---|---|---|---|
| Vercel | Alojamiento web | Hobby gratuito para uso personal y no comercial. No asumir que cubre cualquier uso futuro de una app para freelancers. | Opción a evaluar; no desplegado. |
| Render | Alojamiento y procesos | US$50 promocionales publicados para este hackathon; créditos finitos. | Evaluar para el backend con créditos activados. |
| Supabase | Postgres, autenticación, archivos | Free incluye base de 500 MB, archivos de 1 GB y 50.000 MAU; máximo 2 proyectos activos y pausa tras una semana inactivo. | Puede concentrar persistencia y búsqueda vectorial en un servicio. |
| LangChain | Librería de integración/orquestación | Código abierto con licencia MIT; proveedores de modelos y servicios de observabilidad tienen condiciones aparte. | Opcional; no es un proveedor de modelos gratuitos. |
| Weaviate | Base vectorial | La página actual anuncia Free US$0, sin tarjeta, un clúster, 100.000 objetos, 1 colección y hasta 3 tenants. | Alternativa válida; no es necesario usarla junto a pgvector por defecto. |
| pgvector en Supabase | Almacenar embeddings y buscar por similitud | Extensión disponible en Postgres de Supabase; usa los recursos del proyecto. Generar embeddings puede tener costos aparte. | Si hace falta RAG, comenzar aquí evita un servicio adicional. |

Fuentes originales:
- https://vercel.com/docs/plans/hobby
- https://supabase.com/pricing
- https://supabase.com/docs/guides/database/extensions/pgvector
- https://github.com/langchain-ai/langchain
- https://weaviate.io/pricing

## Modelos y recuperación de documentos

No se ha seleccionado ni contratado un modelo. Un plan gratuito de base de datos no cubre llamadas de generación. Antes de decidir proveedor, verificar cuota, uso de datos, contexto y disponibilidad durante la evaluación. La arquitectura deberá impedir llamadas que generen gasto no autorizado.

Para el primer flujo, enviar el presupuesto y el mensaje completos a un modelo puede bastar si son cortos; una base vectorial no es requisito del hackathon ni condición para usar IA. La necesidad de RAG se evaluará con documentos y casos concretos.

## Reparto de responsabilidades propuesto

Frontend → backend → proveedor de modelo / PayPal sandbox / Supabase.

El backend valida importes y permisos; el profesional aprueba las acciones. El estado financiero proviene de respuestas verificadas de PayPal. No se considera completado un pago o un reembolso por una afirmación del LLM.

Esta arquitectura es una propuesta para una futura versión funcional; el código actual es exclusivamente el prototipo visual.
