# Modelos Gemini para pruebas de Trato

El worker llama a Gemini mediante Google Cloud (backend `vertex`), no mediante AI Studio. El API y la interfaz nunca reciben las credenciales del modelo.

## Modelos comprobados

El 31 de octubre de 2026 se verificaron respuestas estructuradas con el adaptador real de Trato para estos ocho modelos de texto:

- gemini-3.8-flash (predeterminado, thinking_level MEDIUM explicito).
- gemini-3.5-flash-lite.
- gemini-3.1-flash-lite.
- gemini-3.5-flash.
- gemini-3.6-flash.
- gemini-3.7-flash.
- gemini-3.1-pro-preview (preview).
- gemini-4-argon.

La primera llamada a Argon fallo, pero la comprobacion posterior estructurada fue correcta; ya esta habilitado. Gemini 2.5 Pro devolvio404 y figura retirado desde20oct2026. Este catalogo contiene modelos de texto comprobados para agentes, no modelos especializados de imagen/audio/embeddings ni todos los productos de Model Garden. Una respuesta correcta de conexion no garantiza la calidad de todos los flujos.

P3 recomienda 3.8 Flash MEDIUM como aproximacion funcional a GPT-6 Luna medio, sin equivalencia demostrada ni prueba head-to-head. Debe evaluarse conversacion, citas y consistencia con casos reales de Trato. La tarifa Cloud y el credito son independientes de las tarifas de OpenAI. Fuentes: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking y https://cloud.google.com/model-garden/pricing


Referencias: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions y https://docs.cloud.google.com/free/docs/free-cloud-features

## Perfil y alcance

El selector se muestra a los usuarios de prueba autorizados por el servidor. Afecta a las respuestas y evaluaciones de Ensayos, al analisis de Reputacion y a la propuesta inicial de Nuevo proyecto. No altera los agentes de cambios ni devoluciones. Se guarda por ID de usuario en el Redis privado persistente de Trato. Cambiar el modelo no modifica trabajos ya encolados ni resultados anteriores. La cola fija el ID de modelo antes de ejecutarlo. Un modelo retirado o un fallo de Redis/proveedor produce error, nunca sustitucion.

El backend verifica el usuario con Supabase Auth y usa su correo confirmado para la lista privada de probadores. Nunca se autoriza con user_metadata ni un correo enviado por el navegador. El worker vuelve a comprobar su propia lista de modelos permitidos.

## Configuracion local

API `.env`:

```dotenv
TRATO_DEFAULT_MODEL=gemini-3.8-flash
TRATO_TEST_MODEL_IDS=gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.1-pro-preview,gemini-4-argon
TRATO_MODEL_TESTER_EMAILS=correos-confirmados-autorizados
```

Worker `.env`:

```dotenv
TRATO_MODEL_PROVIDER=gemini
TRATO_GEMINI_BACKEND=vertex
TRATO_GEMINI_MODEL=gemini-3.8-flash
TRATO_GEMINI_API_KEY=
TRATO_GOOGLE_CLOUD_PROJECT=ID_DEL_PROYECTO
TRATO_GOOGLE_CLOUD_LOCATION=global
TRATO_GOOGLE_CREDENTIALS_FILE=/ruta/privada/cuenta-de-servicio.json
TRATO_TEST_MODEL_IDS=gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.1-pro-preview,gemini-4-argon
```

Cada instalacion local necesita sus credenciales de cuenta de servicio con `roles/aiplatform.user`, dependencias del worker y los servicios privados de Trato. Preferir credenciales separadas para poder revocarlas individualmente. Mantener el mismo proyecto Cloud si se quiere compartir su facturacion/credito. Compartir Git no comparte archivos `.env`, JSON privados ni preferencias del Redis local. Los correos autorizados se configuran localmente, no en el codigo publico.

Gmail OAuth es independiente de esta autenticacion. No modificar sus claves ni callbacks. No activar una cuenta de facturacion de pago para seguir estas instrucciones. Si el modelo devuelve falta de permisos/cuota, revisar el error antes de cambiar la cuenta o el modelo.

## Mensaje para el colaborador

Usamos Gemini mediante Vertex/Agent Platform en el worker local, con cuenta de servicio y JSON privado, no una clave de AI Studio. Actualiza el codigo compartido y las dependencias del worker. Configura las variables de API y worker de este documento. Recibe la credencial separada por un canal privado, guardala fuera del repo y usa una ruta absoluta local en TRATO_GOOGLE_CREDENTIALS_FILE. No se comparte por git. El proyecto Cloud, modelos y facturacion son comunes; los archivos .env y Redis son propios de cada instalacion. Inicia sesion con el correo confirmado autorizado para que aparezca el selector. Verifica primero una llamada breve. No cambiar la configuracion Gmail ni activar cuenta de pago.

## Comparacion independiente, 31 octubre 2026

Artificial Analysis, Intelligence Index v5.0, lectura directa del dia: GPT-6 Luna medium18; Gemini3.8 Flash medium30; Gemini3.5 Flash-Lite12. Tarifas por millon de tokens input/output: Luna0.10/0.50USD; Flash3.8 0.75/3.75USD; Lite3.5 0.30/2.50USD. No usar el valor41 de snippets antiguos de Flash3.8 high: la pagina directa actual muestra31 para high y30 para medium. No mezclar versiones del indice, niveles o clases de precio para afirmar equivalencia. Estos agregados no evaluan directamente negociacion ni validez de citas en Trato; medir calidad con nuestros casos. Un puntaje30 tampoco significa un porcentaje de calidad mayor en produccion.

Fuentes directas:
- https://artificialanalysis.ai/models/gpt-6-luna-medium
- https://artificialanalysis.ai/models/gemini-3-8-flash-medium
- https://artificialanalysis.ai/models/gemini-3-5-flash-lite

El enlace compartido por Sebastian compara GPT5.6 Luna LOW con GPT5mini MEDIUM; es un ejemplo del comparador y no una medicion de GPT6 Luna MEDIUM. Precio por token no equivale a costo por caso: contar texto de entrada, salida y razonamiento facturado.

## Arranque de los flujos integrados

`python3 scripts/dev-polyrepo.py --with-ai` inicia los consumidores de Ensayos y de Reputacion/planificacion. La API necesita `TRATO_AI_WORKFLOWS_ENABLED=true`; consultar `docs/integracion-ia-flujos.md`. Esta integracion no implica que se hayan validado los recorridos desde la interfaz ni la calidad de sus respuestas reales.
