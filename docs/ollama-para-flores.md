# Ollama y Qwen para el responsable de cambios y devoluciones y su asistente

Actualizado el 28/10/2026. Esta guía reproduce la instalación **local en WSL/Linux** realizada para Trato. No configura un servidor compartido ni Gemini. Leer primero `AGENTS.md`, `docs/puertos-locales.md`, `local-ports.json` y `docs/estandar-prompts.md`.

## Qué hay instalado en el equipo del responsable del proyecto

- Ollama 0.40.12, runtime en `.local/ollama/runtime`.
- Modelo `qwen3:4b`, cuantización Q4_K_M, descarga aproximada de 2,5 GB.
- Modelos en `.local/ollama/models`; puerto propio `127.0.0.1:11435`.
- Arranque con `python3 scripts/serve-local-model.py`.
- Nube desactivada, plantilla Go seleccionada explícitamente, una ejecución concurrente y contexto 8192.
- GPU comprobada: RTX 5060 8 GB. Una muestra de `/api/ps` informó unos 3,88 GB cargados enteramente en GPU.

El programa y los pesos no se suben a GitHub: `.local/` está ignorada. Clonar el repositorio no los instala. Cada instalación local usa el hardware de ese equipo; una conexión al servidor del responsable del proyecto requeriría una integración remota explícita que todavía no existe.

## Antes de instalar en el otro equipo

Comprobar GPU/driver, espacio en disco y herramientas `curl`, `tar`, soporte zstd y Python3. No asumir que tiene el mismo hardware. Consultar [instalación oficial Linux](https://docs.ollama.com/linux) y [GPU compatibles](https://docs.ollama.com/gpu).

Revisar listeners y recursos existentes conforme a AGENTS. El puerto debe coincidir con `local-ports.json`. Si está ocupado, identificar el servicio e informar; no detenerlo ni elegir otro puerto automáticamente. No reutilizar recursos o credenciales de otros proyectos locales.

## Instalación aislada en WSL/Linux

Desde la raíz del clon de Trato, con el puerto confirmado libre y sin otra instalación propia en esas rutas:

```bash
mkdir -p .local/ollama/runtime
curl --fail --location https://ollama.com/download/ollama-linux-amd64.tar.zst \
  --output .local/ollama/ollama-linux-amd64.tar.zst
tar --zstd -xf .local/ollama/ollama-linux-amd64.tar.zst \
  -C .local/ollama/runtime
.local/ollama/runtime/bin/ollama --version
```

La URL oficial ofrece la versión vigente, no fija 0.40.12. Registrar la versión obtenida y verificar compatibilidad; no afirmar que reproduce exactamente el runtime del responsable del proyecto si cambia. El equipo original extrajo ese mismo archivo con Python zstandard en vez de tar porque disponía de esa biblioteca. No se instala un servicio del sistema.

En una terminal dedicada:

```bash
python3 scripts/serve-local-model.py
```

En otra terminal, descargar el modelo en ese servidor:

```bash
OLLAMA_HOST=127.0.0.1:11435 .local/ollama/runtime/bin/ollama pull qwen3:4b
```

No hace falta cuenta de Ollama para descargar y ejecutar este modelo local. El script fija la carpeta de modelos del servidor y desactiva la nube. No configurar un perfil cloud ni exponer el puerto públicamente.

## Comprobación de una respuesta real

```bash
python3 - <<'PY'
import json
from urllib.request import Request, urlopen
url = 'http://127.0.0.1:11435'
payload = {
    'model': 'qwen3:4b',
    'messages': [{'role': 'user', 'content': 'Responde únicamente HOLA.'}],
    'think': True,
    'stream': False,
    'options': {'num_ctx': 8192, 'num_predict': 1024, 'num_gpu': 99},
}
request = Request(url + '/api/chat', data=json.dumps(payload).encode(),
                  headers={'Content-Type': 'application/json'})
with urlopen(request, timeout=75) as response:
    result = json.load(response)
if result.get('done_reason') != 'stop':
    raise RuntimeError('Generación incompleta; no usar como respuesta válida.')
print('Respuesta final:', result['message']['content'])
with urlopen(url + '/api/ps', timeout=5) as response:
    running = json.load(response)['models']
active = next(model for model in running if model['name'] == 'qwen3:4b')
print('Memoria total:', active['size'], 'memoria GPU:', active['size_vram'])
if active['size_vram'] < active['size'] * .99:
    raise RuntimeError('No se cumple la ejecución completamente en GPU requerida para esta prueba.')
PY
```

`num_gpu` solicita offload, pero la evidencia es `/api/ps`: no afirmar uso de GPU solo porque el driver existe. Si falla, informar; no cambiar a CPU, otro modelo o proveedor de forma automática. La respuesta privada `thinking` no se imprime ni se entrega al usuario.

## Estado de la integración en Trato

El servicio `repos/trato-api/trato_api/rehearsal.py` prepara el cliente ficticio y un evaluador separado. La ruta es `POST /api/v1/rehearsals/local`, autenticada con la sesión existente de Trato. El ejemplo de configuración tiene `TRATO_REHEARSAL_ENABLED=false` deliberadamente. No cambiarlo solo para ocultar un error: fuentes y calidad del evaluador todavía se están revisando.

El perfil descargado en el responsable del proyecto anunció `thinking.values=[true]`; `think:false` dio resultados incorrectos. Se usa `think:true` y hasta 4096 tokens de generación, consumiendo únicamente el JSON final validado. Ante una versión distinta, consultar `/api/show` y verificar su contrato; no copiar supuestos.

Las muestras reales del personaje respondieron en español e inglés, conservaron el contexto y tardaron entre 21 y 39 segundos. Eso no acredita un evaluador fiable ni equivalencia con modelos de frontera. **La vista de Ensayos todavía usa su simulación explícita: no está conectada a Qwen.**

Las fuentes del evaluador y la integración de Ensayos pertenecen al equipo, según [tareas-p1-p2.md](tareas-p1-p2.md). Gemini sigue siendo la opción deseada; su acceso y eventual cobertura por créditos se comprueban por separado.

## Nota para el ChatGPT del responsable de cambios y devoluciones

> Lee AGENTS.md, docs/tareas-p1-p2.md, docs/ollama-para-flores.md y docs/qwen-local.md antes de intervenir. Verifica el estado actual del código, el hardware y los puertos. No supongas que Ollama está instalado por haber clonado el repositorio. El compañero humano continúa cambios/devoluciones; coordina antes de editar Ensayos, prompts, reputación o contratos compartidos. No reutilices `.env` ni credenciales del responsable del proyecto. No publiques modelos, documentos privados, `.local`, claves ni entornos virtuales. No actives proveedores, CPU u otras respuestas como fallback. Los prompts son únicos en inglés y reciben output_language es/en. No crees ni fusiones PR sin autorización específica para esa publicación.

## Pruebas del adaptador

Con los entornos Python instalados según la guía de colaboradores:

```bash
PYTHONPATH=repos/trato-api repos/trato-file-processor/.venv/bin/python \
  -m unittest discover -s repos/trato-api/tests -p test_rehearsal.py -v
```

Ocho pruebas usan dobles explícitos, sin inferencia ni llamadas a Supabase. Comprueban autenticación, validación, historial, fallos sin simulación, citas, contexto excesivo y separación de respuesta/razonamiento. No sustituyen la prueba real del modelo.
