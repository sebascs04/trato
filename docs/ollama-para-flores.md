# Instalación de Ollama para colaborar en Trato

Guía para una instalación nueva en WSL/Linux. Describe la configuración del código del proyecto; no contiene inventario ni mediciones de un equipo personal. Leer `AGENTS.md`, `local-ports.json`, `docs/puertos-locales.md` y `docs/estandar-prompts.md` antes de comenzar.

## Preparación

Comprobar compatibilidad de GPU y driver, espacio libre, Python3, curl y tar con soporte zstd. Consultar [instalación oficial](https://docs.ollama.com/linux) y [compatibilidad de GPU](https://docs.ollama.com/gpu). No suponer que clonar el repositorio instala el runtime o descarga los pesos.

Revisar listeners antes de arrancar. El puerto propio está definido en `local-ports.json`; si está ocupado, informar sin detener procesos ajenos ni buscar un puerto alternativo. No reutilizar servicios, credenciales o datos de otros proyectos.

## Instalación aislada

Ejecutar desde la raíz del clon, después de comprobar que las carpetas de destino no contienen otra instalación que deba conservarse:

```bash
mkdir -p .local/ollama/runtime
curl --fail --location https://ollama.com/download/ollama-linux-amd64.tar.zst \
  --output .local/ollama/ollama-linux-amd64.tar.zst
tar --zstd -xf .local/ollama/ollama-linux-amd64.tar.zst \
  -C .local/ollama/runtime
.local/ollama/runtime/bin/ollama --version
```

La URL oficial ofrece la versión vigente; registrar la versión instalada y verificar compatibilidad con el adaptador. Estas instrucciones no instalan un servicio del sistema. Los pesos y el runtime se conservan en `.local/`, excluido de Git.

En una terminal dedicada:

```bash
python3 scripts/serve-local-model.py
```

En otra terminal, descargar el modelo que utiliza la configuración de Trato:

```bash
OLLAMA_HOST=127.0.0.1:11435 .local/ollama/runtime/bin/ollama pull qwen3:4b
```

El puerto y el identificador del modelo de este ejemplo corresponden a la configuración pública del proyecto; comprobarlos en el código antes de ejecutar. El servidor debe permanecer en loopback y con su almacenamiento propio. No exponerlo directamente a Internet ni activar un proveedor cloud como alternativa automática.

## Verificación

Consultar `/api/show` para comprobar el contrato del perfil y `/api/ps` para comprobar el uso efectivo de GPU después de una generación. La presencia del driver no demuestra que la inferencia se ejecute en GPU. Si no se cumplen los requisitos del adaptador, informar del error; no cambiar silenciosamente a CPU, otro modelo o proveedor.

El adaptador de Ensayos solicita `think:true`, valida el JSON final y no entrega el razonamiento privado al usuario. Una respuesta incompleta, un JSON inválido o fuentes ajenas son errores visibles. Las pruebas del adaptador usan dobles explícitos y no acreditan calidad del modelo:

```bash
PYTHONPATH=repos/trato-api repos/trato-file-processor/.venv/bin/python \
  -m unittest discover -s repos/trato-api/tests -p test_rehearsal.py -v
```

## Integración y coordinación

La ruta autenticada `POST /api/v1/rehearsals/local` se controla con `TRATO_REHEARSAL_ENABLED`; el archivo de ejemplo la conserva deshabilitada. La interfaz de Ensayos todavía usa su simulación explícita. Habilitar la ruta no conecta por sí solo la interfaz ni valida las fuentes del evaluador.

Para el asistente del colaborador: revisar `docs/tareas-p1-p2.md` antes de editar Ensayos, prompts o contratos compartidos. No copiar credenciales de otra persona, publicar documentos privados ni subir `.local/`, modelos o entornos virtuales. Mantener instrucciones únicas en inglés y `output_language` validado como `es` o `en`. Crear PR y hacer merge requieren la autorización específica correspondiente.
