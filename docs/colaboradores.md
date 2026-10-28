# Preparar Trato en otro equipo

Esta guía corresponde al código publicado el 26 de octubre de 2026. El frontend oficial vive en la raíz; los servicios están en `repos/`.

## 1. Dependencias

Node.js 18+, Python 3.12, Redis para la ingesta conectada y las bibliotecas de sistema de Chromium si vas a ejecutar pruebas de navegador.

Desde la raíz:

```bash
npm ci
python3 -m venv repos/trato-file-processor/.venv
repos/trato-file-processor/.venv/bin/pip install -r repos/trato-file-processor/requirements.lock.txt
repos/trato-file-processor/.venv/bin/pip install -r repos/trato-api/requirements.lock.txt
python3 -m venv repos/trato-worker/.venv
repos/trato-worker/.venv/bin/pip install -r repos/trato-worker/requirements.lock.txt
```

El supervisor de desarrollo usa el entorno del procesador para API y procesador, con dependencias compatibles. El worker usa el suyo. No copies `.venv` desde otra máquina. Para el prototipo anterior opcional, instala por separado `backend/requirements.lock.txt` en `.venv` de raíz; no es necesario para el nuevo flujo simulado de devoluciones.

## 2. Configuración privada

```bash
cp repos/trato-api/.env.example repos/trato-api/.env
cp repos/trato-file-processor/.env.example repos/trato-file-processor/.env
cp repos/trato-worker/.env.example repos/trato-worker/.env
```

Rellena sólo los servicios que vayas a probar. No publiques esos archivos ni mandes secretos por chat.

- **Supabase:** URL del proyecto y publishable key para la API. `SUPABASE_SERVER_KEY` es exclusiva del servidor para operaciones internas; nunca se expone al frontend. Para un proyecto nuevo, revisar y aplicar las migraciones de `repos/trato-api/supabase/migrations` en orden, con Supabase CLI y el procedimiento de revisión del equipo. No ejecutes automáticamente la migración histórica de `supabase/` de raíz sobre un proyecto existente.
- **Procesador:** `FILE_PROCESSOR_TOKEN` debe coincidir en API y procesador.
- **Web:** `WEB_ORIGIN=http://localhost:5173`.
- **Gmail:** cliente OAuth de aplicación web, Gmail API y usuario de prueba autorizado. Callback `http://localhost:5173/gmail-callback.html`. Las variables son `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` y `GMAIL_TOKEN_ENCRYPTION_KEY`. El envío requiere conexión de la cuenta y confirmación del usuario.
- **PayPal:** credenciales de aplicación Merchant Sandbox propias. Las variables son `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` y `PAYPAL_MERCHANT_ID`. El flujo de cobro usa enlaces de la aplicación y una captura verificada por backend. No utilices credenciales live para estas pruebas.
- **Gemini:** está preparado como adaptador, no se activa por clonar el repositorio. Selecciona proveedor/backend/modelo sólo después de acordar acceso y costos. No uses el OAuth de Gmail como credencial de IA.
- **Ollama/Qwen local:** para Flores y su asistente, seguir [la instalación aislada y comprobaciones](ollama-para-flores.md). Los pesos no están incluidos en GitHub. El modelo fue probado en GPU, pero todavía no está conectado a Ensayos; no activar ese recorrido sin revisar fuentes y calidad.

El configurador de ingesta genera secretos locales para el Redis y el acceso del worker, manteniendo lo ya configurado:

```bash
python3 scripts/configure-ingestion.py
```

Lee sus requisitos y el archivo `.env.example` antes de ejecutarlo. Requiere instalar Redis en el sistema para arrancarlo después.

## 3. Arranque

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

| Servicio | Puerto |
| --- | --- |
| Interfaz oficial | 5173 |
| API | 8100 |
| Procesador | 8101 |
| Redis propio | 6380 |

Si un puerto está ocupado, el supervisor se detiene. No mata otro proceso ni cambia de puerto. Consulta `local-ports.json` y `docs/puertos-locales.md`. La opción `--tools` abre la herramienta técnica en 5174 en lugar del frontend oficial.

## 4. Qué probar primero

1. Entrar con una cuenta autorizada de Trato y crear cliente/proyecto.
2. Guardar un acuerdo y una solicitud en PDF; esperar lectura y abrir sus fuentes.
3. Preparar la propuesta manual, revisar su PDF y, con Gmail configurado, revisar y enviar el correo.
4. Registrar la aceptación de esa versión y probar el cobro Sandbox con un comprador Sandbox distinto del vendedor.
5. Devoluciones → Probar flujo de devolución: caso simulado independiente, sin reembolsos reales y sin agente.

Los datos del equipo no están incluidos. Un entorno nuevo empieza con su propio espacio; las simulaciones se eligen explícitamente y nunca se usan como respaldo de un error.

## 5. Pruebas

```bash
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Con los entornos instalados:

```bash
cd repos/trato-worker
.venv/bin/python -m unittest discover -s tests
```

Desde `repos/trato-api`, usa su entorno propio o el del procesador instalado arriba para `python -m unittest discover -s tests`. Las pruebas de integración Redis se ejecutan con su configuración documentada y un servicio aislado; algunas se omiten si ese entorno no está disponible.

## Límites actuales

No hay conversión Word→PDF ni OCR conectados. El análisis real con Gemini, los índices Weaviate y el grafo Neo4j aún requieren integración. El mapa es una vista de ejemplo. La aceptación documental se revisa por una persona, no se certifica criptográficamente. El flujo simulado de devolución no acredita movimientos de dinero. Los enlaces de pago a localhost sólo sirven en el equipo que ejecuta Trato hasta configurar un despliegue público.
