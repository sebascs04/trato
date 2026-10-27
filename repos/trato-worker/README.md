# Trato Worker

Analiza texto ya extraído, separado de la lectura de PDF/DOCX. Incluye una interfaz de modelo intercambiable y un adaptador para Ollama local, con salida JSON y validación de citas. No usa ni descarga un modelo automáticamente y no activa un proveedor pago alternativo.

Python 3.12. Las dependencias del worker están fijadas en `requirements.lock.txt`. Instalar Ollama y un modelo revisado queda pendiente de elegir modelo/licencia y medir el equipo. No se ejecutó inferencia real en esta entrega.

```bash
export TRATO_MODEL_PROVIDER=ollama
export OLLAMA_MODEL="nombre-del-modelo-local-ya-instalado"
python3 -m trato_worker < entrada.json
```

Entrada: `{"sources":[{"id":"agreement:uuid:p1","kind":"agreement","text":"Texto del acuerdo"},{"id":"request:uuid:p1","kind":"request","text":"Pedido del cliente"}]}`. Los IDs deben mapearse a documento/versión/localizador autorizado por la API; el worker no decide propietario ni tenant. El contexto debe contener las cláusulas aplicables, no solo coincidencias vectoriales.

Valida pertenencia literal de cada cita a la fuente y exige evidencia de acuerdo y pedido para `matches`. Esto no evalúa automáticamente la calidad semántica de la respuesta. No confirma aceptación/firma/pago ni calcula precios inventados. El resultado siempre exige revisión humana.

```bash
python3 -m unittest discover -s tests -v
```

Las pruebas del análisis usan un modelo doble. El recorrido inicial de documentos se implementa por separado en `trato_worker.ingest`, con modo de simulación explícito y transporte stdio o Redis; véase abajo. La CLI de análisis no es un consumidor de cola.

## Gemini con LangChain (adaptador preparado)

El worker incorpora `GeminiLangChainModel`; no se selecciona proveedor, modelo ni backend automáticamente. Instalar las dependencias aisladas:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python -m unittest discover -s tests -v
```

Seleccionar `TRATO_MODEL_PROVIDER=gemini`, el backend `developer`, `vertex_express` o `vertex`, y el modelo exacto en `TRATO_GEMINI_MODEL`. La plantilla `.env.example` lista las variables sin secretos; la CLI no carga ese archivo automáticamente. Developer y Express requieren su propia clave `TRATO_GEMINI_API_KEY`. Vertex con proyecto requiere proyecto, región y archivo privado de credenciales explícitos. No reutilizar credenciales OAuth de Gmail. El worker rechaza configuración global de Google que pueda cambiar implícitamente backend, proyecto o clave.

La salida usa JSON estructurado nativo mediante LangChain y después la validación de citas de `analyze`. No hace reintentos del proveedor ni cambia de modelo/proveedor. El adaptador desactiva trazas implícitas a LangSmith, limita salida/tiempo y conserva contadores de tokens cuando el proveedor los devuelve; no guarda prompts ni secretos en errores.

Para conservar la opción local anterior ahora hay que seleccionar `TRATO_MODEL_PROVIDER=ollama` explícitamente junto con `OLLAMA_MODEL`.

**Verificado:** 13 pruebas locales con dobles de modelo y construcción/binding del SDK real sin red. **No verificado:** inferencia real, acceso a un modelo concreto, cuota gratuita o cobertura de crédito de una cuenta. No se ha realizado ninguna solicitud de generación a Google. Una clave configurada no demuestra que su proyecto sea gratuito; comprobar plan/modelo/cuota antes de la primera llamada.

El adaptador no inicia servidor HTTP, no consume todavía Redis y no sustituye los grafos ni el contrato genérico thread descritos en `docs/arquitectura-ia-trato.md` del workspace coordinador. Son siguientes capas de implementación.

## Primera etapa: ingesta de documentos en el worker

La ejecución genérica `thread` ya tiene un handler `ingest_document`, con LangGraph y etapa determinista LangChain: contexto → extracción → pertinencia/tipo → chunks o aclaración. El modelo generativo todavía no participa. Extracción y pertinencia son casos de prueba declarados, sin inferencia real. Se conservan contexto, documento, extracción y localizador en cada fragmento.

```bash
.venv/bin/python -m trato_worker.ingest --mode simulation --transport stdio < examples/document-upload.thread.json
```

Redis Streams se elige con `--transport redis` y `TRATO_SIMULATION_REDIS_URL`; `--publish` encola, `--once` consume una orden. No hay cambio automático de transporte. Los streams de simulación están separados de cualquier negocio real. Checkpoints y resultados locales permiten consultar y repetir sin reprocesar.

La extracción usa fixtures explícitas; el resultado no se considera un análisis por IA, una firma ni un índice vectorial. La carga real de 5173 sigue su recorrido actual hasta conectar esta etapa de forma acordada. Documentación completa en `docs/worker-ingesta-documento.md` del workspace coordinador.

## Pedidos, propuestas y revisiones simuladas

`workflow=manage_change` añade pausas humanas persistentes, adendas versionadas, comentarios del cliente, nueva revisión/envío/aceptación y cierre con pago simulado o sin adicional. No modifica las propuestas reales de la API ni envía correos o cobra pagos.

```bash
PYTHONPATH=. .venv/bin/python examples/change-lifecycle.py
```

Ver `../../docs/worker-flujo-cambios.md` para el contrato `start/resume/get`, los escenarios, límites y la plantilla futura `prompts/analyze-change.json`.

## Extracción conectada y Gemini simulado

`python -m trato_worker.run --mode connected` consume la cola privada de PDFs reales y llama al file processor sin IA. `PYTHONPATH=. .venv/bin/python examples/gemini-contract.py` comprueba el contrato Vertex con el SDK real y transporte HTTP simulado, sin red. Ver `../../docs/ingesta-conectada.md` para configuración, límites y separación de modos.
