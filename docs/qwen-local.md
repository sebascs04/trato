# Adaptador local de Ensayos

Este documento describe el código público de la integración opcional con Ollama. Para instalar en un nuevo equipo, seguir [la guía de colaboración](ollama-para-flores.md). No se publican inventarios de hardware, resultados privados ni mediciones de una instalación particular.

## Contrato y aislamiento

`scripts/serve-local-model.py` toma el puerto de `local-ports.json`, comprueba disponibilidad y usa almacenamiento propio del proyecto. Escucha en loopback y deshabilita la nube. Si el puerto está ocupado, falla sin detener otro proceso ni elegir uno distinto. El runtime y los pesos no forman parte del repositorio.

El adaptador prepara un cliente ficticio y un evaluador separado en `repos/trato-api/trato_api/rehearsal.py`. Usa el modelo configurado por el proyecto, solicita el modo de razonamiento soportado y consume únicamente el JSON final validado. El campo privado de razonamiento no se devuelve al usuario. Comprobar el contrato del perfil con `/api/show` cuando cambie el runtime o el modelo.

El servicio rechaza generación incompleta, JSON inválido, citas que no pertenecen al contexto, ejecución fuera de los requisitos de GPU y contexto excesivo. No recorta el historial silenciosamente ni sustituye un error por un guion simulado.

## Activación y límites

`POST /api/v1/rehearsals/local` requiere autenticación de Trato y activación explícita mediante `TRATO_REHEARSAL_ENABLED`. El ejemplo de configuración la mantiene deshabilitada. La interfaz conserva su simulación explícita; no está conectada al modelo local.

Las fuentes del evaluador y la calidad de sus recomendaciones requieren revisión antes de habilitar el recorrido. Instalar un modelo no acredita que sus respuestas sean fiables ni que igualen a otro proveedor. No cambiar de proveedor, activar consumo ni exponer un servidor remoto sin autorización.

## Pruebas reproducibles

```bash
PYTHONPATH=repos/trato-api repos/trato-file-processor/.venv/bin/python \
  -m unittest discover -s repos/trato-api/tests -p test_rehearsal.py -v
```

Las pruebas con dobles cubren autenticación antes de inferencia, idiomas y roles, historial, errores sin sustitución, servicio deshabilitado, citas inválidas, separación de respuesta y razonamiento, y contexto excesivo. No sustituyen una evaluación real del modelo.

## Uso por un equipo

El navegador se comunica con el backend autenticado; no necesita conectarse directamente a Ollama. Una instalación compartida exigiría definir y autorizar acceso remoto, autenticación y aislamiento antes de desplegarla. Este repositorio no publica un túnel ni configura ese servicio compartido.

Referencias técnicas: [razonamiento en Ollama](https://docs.ollama.com/capabilities/thinking) y [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B).
