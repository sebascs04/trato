# Trato Copilot — Handoff para integración

Actualizado: 9 de noviembre de 2026. No se hicieron llamadas a Google, cambios de producción, deploy, push, merge ni PR.

## 1. Arquitectura final

`meeting-copilot.html` carga la interfaz con `styles.css` de Trato y su hoja específica. El navegador autentica con el `SessionClient` compartido, solicita un ticket efímero a `/api/v1/meeting-copilot/sessions`, captura micrófono o audio de pestaña/pantalla, procesa PCM con `meeting-copilot-audio-processor.js` y abre `/ws/copilot` del mismo origen. `server.mjs` valida el origen y reenvía al WebSocket del API configurado. El router canónico vive en `repos/trato-api/trato_api/meeting_copilot.py`; el ejecutable `meeting-copilot-live.py` solo es un wrapper local de ese router, no otro backend de negocio.

El proveedor `GeminiMeetingProvider` está en `repos/trato-api/trato_api/meeting_copilot_provider.py`. Mantiene la sesión Live de transcripción y realiza generación de texto para sugerencias/resumen solo cuando el usuario pide una acción. El doble local existe únicamente en `tests/meeting_copilot_e2e_server.py` y se inyecta desde los tests.

## 2. Implementado y probado

- Captura de micrófono real del navegador y selección de audio de pestaña/pantalla; la prueba automatizada usa el dispositivo de micrófono falso de Chromium, no una voz real.
- AudioWorklet, Float32 → PCM16, tramas limitadas, relay al FastAPI y cierre/pausa/reanudación.
- Ticket de un uso, TTL de 15 minutos, vinculación de origen, rechazo de ticket ausente/inválido/expirado/reutilizado y límite de una conexión.
- Transcripción parcial/final, etiqueta de fuente, detección de pregunta/objeción, respuesta contextual, modos General/Ventas/Negociación/Requisitos/Soporte y resumen estructurado.
- Autenticación de API reutilizada; lista autorizada de clientes, proyectos y metadatos de documentos se carga desde endpoints existentes de Trato. La prueba local verifica que el proyecto/documento seleccionado llega a la sugerencia.
- Diseño comprobado en capturas Playwright de escritorio y móvil; sin overflow horizontal.
- Los modos Práctica y En vivo están separados. En vivo no cae silenciosamente a una respuesta de demo si falla el backend/proveedor.

Verificaciones locales:
- `npm test`: 45 aprobados, 0 fallidos, 1 omitido porque `pdftotext` no está instalado.
- `npm run check`: sintaxis y 3.714 pares de traducción ES/EN aprobados.
- `python -m unittest discover -s tests -p test_meeting_copilot.py -v` desde `repos/trato-api`: 9 aprobados.
- `npm run test:browser:meeting`: 1 E2E Chromium aprobado con dispositivo fake y proveedor local; no es una prueba de Gemini.
- `python -m pip check`: sin conflictos.
- La suite API completa se ejecutó: 476 pruebas; 2 fallidas y 61 con error por entorno Windows, módulos opcionales/repositorios hermanos ausentes y SQLite temporal bloqueado. La suite raíz backend: 48 pruebas, 43 aprobadas y 5 errores porque `test_workflow.py` intenta ejecutar `.venv/bin/python` (ruta POSIX). No presentar esas suites completas como aprobadas.

## 3. Implementado, pendiente de validación real

- Integración del SDK oficial `google-genai==3.0.0`, Live audio PCM streaming, lectura de eventos parciales/finales y generación de texto JSON desde Gemini. Los campos y firmas se verificaron localmente contra el SDK instalado y la documentación oficial.
- No se ha abierto una sesión con Google ni se ha probado calidad/latencia/transcripción real. No declarar Gemini Live funcional hasta completar esa prueba.
- El selector de contexto obtiene metadatos de documentos y estado de extracción, no el texto contractual ni pasajes del alcance. Recuperación del alcance, documentos y contexto conversacional debe conectarse al servicio autorizado de Trato; hoy no se envía texto de documentos al modelo.
- El selector de idioma de transcripción usa `es-419` o `en-US`; precisión y códigos preferidos para la audiencia deben confirmarse en prueba real.

## 4. Bloqueado por credenciales o infraestructura

- Clave Google aprobada, proyecto/cuenta de facturación y cuota disponible.
- Acceso a un entorno Supabase de prueba con usuario autenticado y JWT válido; no usar service role en el navegador.
- URL final de API, origen HTTPS y WebSocket seguro (`wss://`) en staging.
- Confirmación de cómo obtener el alcance/documentos vigentes con permisos por propietario, cliente y proyecto.
- Revisión legal/operativa de consentimiento para grabar, aviso a participantes, retención y eliminación de transcripciones.

## 5. Variables de entorno

Configurar solo en el entorno privado del backend, no en frontend ni en Git:

- `TRATO_API_URL`: destino HTTP fijo del API Trato que usa el proxy Node; local por defecto `http://127.0.0.1:8100`.
- `TRATO_MEETING_BACKEND_URL`: destino del WebSocket FastAPI; local por defecto `http://127.0.0.1:8100`.
- `TRATO_MEETING_ALLOWED_ORIGINS`: lista separada por coma de orígenes exactos del frontend.
- `TRATO_MEETING_SECRET`: variable legacy del wrapper; los tickets actuales se generan aleatoriamente y no dependen de este valor.
- `TRATO_MEETING_HOST`, `TRATO_MEETING_PORT`: bind del wrapper local; puerto reservado del API Trato: `8100`.
- `TRATO_GEMINI_API_KEY`: clave Gemini Developer API. No usar credencial de producción en pruebas locales.
- `TRATO_GEMINI_LIVE_MODEL=gemini-3.5-transcribe-live`.
- `TRATO_GEMINI_ANALYSIS_MODEL=gemini-3.8-flash`.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `WEB_ORIGIN`: configuración existente de Trato; el endpoint público solo acepta clave `sb_publishable_`.

`TRATO_GEMINI_MODEL`, `TRATO_GEMINI_PROJECT` y `TRATO_GEMINI_LOCATION` pertenecen a otras rutas/entornos de Trato; este adaptador usa Developer API por API key y no implementa Vertex. No cambiar esas variables compartidas para habilitar Copilot.

## 6. Google y compatibilidad

- Servicio usado por el adaptador actual: Gemini Developer API / Generative Language API. El proyecto/cuenta debe habilitar acceso a Gemini API y una clave autorizada. Vertex AI no está cableado en este adaptador.
- Transcripción: `gemini-3.5-transcribe-live`, `response_modalities=["TEXT"]`, `input_audio_transcription` con pista de idioma y PCM16. Google documenta streaming bidireccional, texto parcial/final, audio raw PCM y límite de 10 minutos por sesión.
- Análisis/resumen: `gemini-3.8-flash`, salida texto, JSON estructurado. El endpoint no soporta Live; se usa con `models.generate_content` para las acciones explícitas.
- Google documenta que Live Transcribe no ofrece diarización de hablantes ni timestamps palabra por palabra. La etiqueta `micrófono` o `pestaña/pantalla` indica el origen capturado, no identifica a una persona.
- Referencias: [Live Transcription](https://aistudio.google.com/docs/live-api/live-transcribe), [Live API capabilities](https://aistudio.google.com/docs/live-api/capabilities), [Gemini 3.5 Transcribe](https://aistudio.google.com/docs/models/gemini-3.5-transcribe), [Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash), [precios](https://aistudio.google.com/docs/pricing).

## 7. Costos y límites

Según la tabla pública consultada el 9/11/2026, Gemini 3.5 Transcribe Live estima ~$0.005/min de audio de entrada más ~$0.004/min de texto de transcripción, aproximadamente **$0.009 por minuto** de streaming continuo. Una sesión al límite actual de 10 minutos sería ~$0.09. Gemini 3.8 Flash indica nivel gratuito sujeto a cuota; en Standard pagado publica $0.75/1M tokens de entrada y $3.75/1M tokens de salida hasta el 31/12/2026. Las tarifas, disponibilidad y condiciones pueden cambiar; confirmar en la cuenta de Sebas antes de enviar audio.

Límites implementados: 10 minutos por sesión Live, mensaje WebSocket de hasta 64 KiB, frame PCM de hasta 64 KiB, transcript acotado y hasta 10 acciones de sugerencia por minuto. Recomendación antes de staging: fijar 4 sugerencias/minuto, máximo de sesión y presupuesto diario/proyecto con alertas de consumo. No hay un límite presupuestario automático en el código.

## 8. Autenticación y Supabase

En el API central, `build_meeting_copilot_router(require_user)` reutiliza el `require_user` de Trato, que valida el JWT con Supabase y deriva el propietario confirmado. El navegador recupera el JWT mediante `SessionClient`; el ticket WebSocket de un uso no sustituye la autenticación para crear/cerrar la sesión. La prueba E2E usa credenciales y fixture falsos, no Supabase real.

`meeting-copilot-live.py` sirve para desarrollo local aislado y acepta cualquier Bearer no vacío como identidad local; **no desplegar ese wrapper**. En staging/producción montar exclusivamente el router canónico en el API Trato con su dependencia real `require_user`.

## 9. WebSocket y arranque

1. En `trato`, instalar dependencias Node según el lockfile: `npm install`.
2. En `trato/repos/trato-api`, preparar Python 3.12 y dependencias: `py -3.12 -m venv .venv` y `.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt` en PowerShell.
3. Arrancar el API Trato en el puerto reservado `8100` con la configuración privada y el modo de ejecución acordado.
4. Desde `trato`, ejecutar `npm start`; abre `http://localhost:5173`. Si se ejecuta desde el directorio padre `C:\Users\maria\OneDrive\Desktop\Trato`, `node server.mjs` falla porque el archivo está en la subcarpeta `trato`.
5. El navegador conecta a `ws(s)://<origen>/ws/copilot`; el proxy Node reenvía a `/api/v1/meeting-copilot/ws/copilot` del API. El ticket viaja en el query string y es de un uso/TTL; no registrar query strings de handshake. El API y proxy deben aceptar solo `Origin` exactos y WSS en cualquier entorno remoto.

Pruebas locales: `npm test`, `npm run check`, `npm run test:browser:meeting` y desde `repos/trato-api`, `.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_meeting_copilot.py -v`. El spec de Copilot usa un API y proveedor exclusivamente locales; `npm run test:browser` permanece reservado para la suite Playwright general.

Nota para Sebas: revisar el comando de Windows de instalación; el lock del API es el archivo `repos/trato-api/requirements.lock.txt`, no el lock POSIX de backend raíz.

## 10. Integración de contexto

Se reutilizan `/api/v1/clients`, `/api/v1/projects?client_id=…` y `/api/v1/projects/{id}/documents`; el API impone usuario/propietario en el repositorio. El Copilot envía al proveedor IDs, nombres/estado y estado de extracción de documentos seleccionados. No manda originales ni afirma conocer texto del alcance.

Pendiente: definir el endpoint/tool autenticado que recupere texto o pasajes vigentes de acuerdo, adendas y requisitos con validación de propietario/cliente/proyecto, control de versiones y citas. No conectar Weaviate/file processor directamente desde navegador ni permitir al modelo elegir tenant/IDs de acceso.

## 11. Riesgos de seguridad pendientes

- Ocultar query strings de WebSocket en logs/proxy/APM; reemplazar el ticket por cookie o mecanismo seguro si la infraestructura lo permite.
- El manager de sesiones es memoria local: reinicio de API invalida sesiones; acordar escalado/afinidad antes de múltiples réplicas.
- Añadir cuotas duras por usuario y presupuesto del proveedor; el límite actual de peticiones no fija gasto máximo.
- Hacer revisión de consentimiento, tratamiento, retención y borrado del audio/transcript antes de piloto.
- Cerrar autorización sobre documentos de alcance usando el repositorio y las políticas existentes; los metadatos visibles no son evidencia contractual.
- El wrapper standalone local no valida JWT de Supabase y no es una frontera de seguridad de despliegue.

## 12. Pendiente de desarrollo

- Recuperación autorizada del contenido contractual y citas de documentos.
- Persistencia/historial de reuniones solo si producto y privacidad lo aprueban.
- Manejo de rotación/reconexión de sesión más allá del límite Live, sin reintentar en otro proveedor automáticamente.
- Control de cuota/costo por usuario y comportamiento de auditoría.
- No implementar estas piezas en un backend paralelo; acordar dueño y contrato con el API Trato.

## 13. Pedido concreto para Sebas

1. Proveer URL de API y origen HTTPS/WSS de staging, y confirmar que `build_meeting_copilot_router` se monta en el API compartido con `require_user` real.
2. Confirmar si se autoriza Gemini Developer API con API key o si debe migrarse a Vertex; indicar proyecto, acceso/servicio y fuente de credenciales. No enviar secretos por chat/PR.
3. Habilitar un usuario Supabase de prueba, JWT y datos no productivos de cliente/proyecto/documento con permisos de lectura mínimos.
4. Definir endpoint/tool del backend para recuperar alcance/documentos vigentes y citas, con contrato de autorización y versión.
5. Confirmar presupuesto, cuota, límite de duración/sugerencias y aprobación concreta antes de ejecutar la primera llamada facturable.
6. Confirmar consentimiento de grabación, aviso a participantes, retención y eliminación.

## 14. Prueba real de llamada y checklist pre-PR

Con aprobación y credenciales de staging: habilitar las variables anteriores en el backend privado; comprobar auth JWT y `Origin`; iniciar API y frontend; abrir Copilot en Chrome; seleccionar cliente/proyecto; revisar metadata del documento; escoger micrófono o pestaña con audio; iniciar y otorgar permiso; decir una pregunta/objeción no sensible; verificar transcripción parcial/final con `source`, solicitar respuesta, pausar/reanudar, finalizar y validar resumen; registrar modelo, cuota/uso, latencia y errores sin guardar audio ni transcripción sensible en logs. Confirmar facturación medida después en consola del proyecto.

Checklist previo al PR:
- [ ] E2E de proveedor local y suites Python enfocadas verdes.
- [ ] Una llamada real de Gemini ejecutada con aprobación, sin presentar el doble local como resultado real.
- [ ] Auth/orígenes, ticket, límites de consumo, logs y política de grabación revisados.
- [ ] Alcance/documentos recuperados solo desde herramienta autenticada del API y citas/versiones verificadas.
- [ ] Capturas escritorio/móvil revisadas y paridad ES/EN validada.
- [ ] Fallos restantes de suites no relacionadas clasificados; no declarar toda la suite Python aprobada.
- [ ] Variables, permisos Google, cuotas y rollback revisados por Sebas.
- [ ] Revisar el diff/archivos en `feature/meeting-copilot`; no hacer push, PR ni deploy sin autorización.
