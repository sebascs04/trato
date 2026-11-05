# Qwen local de Trato

## Instalación y aislamiento

Ollama 0.40.12 y Qwen3 4B Q4_K_M están descargados en `.local/ollama/`, ignorada por Git. No necesitan cuenta de Ollama para inferencia local. Trato reserva el puerto 11435, independiente de otros proyectos locales. El servidor escucha solo en loopback y deshabilita la nube con `OLLAMA_NO_CLOUD=1`.

Arranque explícito, tras comprobar que no existe otro listener en el puerto:

```bash
python3 scripts/serve-local-model.py
```

El script rechaza un puerto ocupado, sin detener procesos ni elegir otro puerto. Usa la carpeta de modelos propia del proyecto. Una conexión en TIME_WAIT no se trata como un servidor activo. Se configura `OLLAMA_GO_TEMPLATE=1` para seleccionar explícitamente la plantilla del perfil, evitando selección implícita por capacidades del runtime.

## Estado al 28/10/2026

- GPU NVIDIA RTX 5060 detectada; la prueba real `/api/ps` informó 3.877.571.133 bytes tanto en size como en size_vram, con contexto 8192.
- El perfil original `qwen3:4b` declara `thinking.values=[true]`. Pedir `think:false` produjo razonamiento dentro de content o resultados incorrectos. El cliente pide explícitamente el modo soportado `think:true`, con hasta 4096 tokens de generación.
- El backend solo consume el JSON final; nunca devuelve el campo thinking. La prueba de unidad comprueba esta separación.
- La respuesta simple HOLA terminó en 1,25 segundos. Una prueba estructurada tardó 29,95 segundos y confundió cliente/freelancer. La primera intervención con el prompt completo tardó 38,94 segundos. Estas mediciones son puntuales; no acreditan calidad suficiente ni un tiempo garantizado.
- Se ensayó un perfil con plantilla sin razonamiento, pero no resolvió el problema. No se selecciona ni se usa como alternativa automática.
- El servicio rechaza respuestas incompletas, JSON incorrecto, citas ajenas, CPU/offload y contexto excesivo. No recorta silenciosamente el historial ni devuelve el guion simulado ante errores.
- La ruta autenticada `/api/v1/rehearsals/local` está preparada; requiere `TRATO_REHEARSAL_ENABLED=true`. El ejemplo conserva false. No se ha conectado a la interfaz ni se ha activado para usuarios.
- Las fuentes del evaluador todavía requieren la revisión acordada con el responsable del proyecto. No se presenta esta instalación como un evaluador fiable ni como equivalente a un modelo de frontera.

## Pruebas reproducibles

```bash
PYTHONPATH=repos/trato-api repos/trato-file-processor/.venv/bin/python -m unittest discover -s repos/trato-api/tests -p test_rehearsal.py -v
```

Ocho pruebas con dobles explícitos: autenticación antes de inferencia, idiomas y roles, historial completo, fallos sin simulación, servicio deshabilitado, cita inválida, modo soportado con salida privada separada y contexto excesivo sin truncar. Las pruebas unitarias no sustituyen las mediciones reales ni validan la calidad del feedback.

## Compartir el modelo con el equipo

Un único servidor puede recibir consultas del backend de Trato y atender a distintos usuarios; los navegadores no necesitan instalar Ollama. Se mantiene autenticación y aislamiento de conversaciones en la aplicación. No exponer directamente el puerto 11435 a Internet.

Opciones consultadas el 28/10/2026; no se ha desplegado ninguna:

- Hugging Face ZeroGPU: cuentas personales verificadas con más de 30 días pueden alojar hasta dos Spaces sin suscripción; Gradio es obligatorio, hay colas y cuota diaria de GPU (5 minutos para cuentas Free). Requiere adaptar la ejecución; no es un servidor Ollama permanente. https://huggingface.co/docs/hub/spaces-zerogpu
- Una PC propia compartida puede servir durante pruebas coordinadas, pero depende de que permanezca encendida y conectada. No se ha publicado un túnel ni autorizado acceso remoto.
- Hugging Face Inference Providers incluye solo USD 0,10 mensuales para cuentas gratuitas, sujeto a cambios. Es un servicio distinto de alojar nuestro propio modelo. https://huggingface.co/docs/inference-providers/main/pricing
- Colab restringe servicios web ajenos al cómputo interactivo y no garantiza GPU/duración; no se propone como backend permanente. https://research.google.com/colaboratory/faq.html

Referencias técnicas: https://docs.ollama.com/capabilities/thinking y https://huggingface.co/Qwen/Qwen3-4B . No se activa otro modelo, proveedor o transporte sin autorización explícita.

### Comprobación de continuidad

Con `think:true`, el prompt completo produjo dos intervenciones en español. Después de ofrecerle una sola versión, el modelo respondió que necesitaba tres y preguntó por ajustar el presupuesto, en 21,17 segundos. Conservó el papel del cliente y atendió la oferta en esta muestra. Los resultados están en `.local/ollama/configured-client-test.json` (solo caso ficticio). Esto resuelve el fallo de repetición observado en esa prueba, pero no demuestra fiabilidad general del personaje ni del evaluador.

La prueba real en inglés, con fuentes originales en español e historial en inglés, produjo una objeción del cliente en inglés en 31,01 segundos. `/api/ps` confirmó otra vez size_vram=size=3.877.571.133 bytes. Resultado: `.local/ollama/configured-client-en-test.json`. No se ejecutó una nueva evaluación del feedback: queda pendiente revisar sus fuentes antes de usarlo.

el responsable del proyecto aclaró que Qwen es una opción local para avanzar mientras intenta habilitar los créditos de Google Cloud; Gemini sigue siendo la opción deseada. La investigación de ZeroGPU no autoriza desplegarlo, cambiar proveedor ni activar consumo. No se verificó ni se prometió que los créditos cubran una API concreta de Gemini.
