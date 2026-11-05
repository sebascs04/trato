# Instalar Trato en tu equipo

Guía para desarrollar y probar. Actualizada el 1 de noviembre de 2026 tras revisar el código. El frontend oficial está en la raíz y los servicios en `repos/`; son carpetas del mismo repositorio, no submódulos.

El equipo prepara los accesos siguiendo [este checklist](accesos-colaboradores.md). Después se inicia la instalación y, al final, los consumidores. El proyecto usa servicios compartidos: una prueba local puede guardar datos en Supabase, enviar correos reales mediante Gmail o consumir crédito de Gemini. Los pagos permanecen en PayPal Sandbox.

## 1. Qué debemos entregarte

| Acceso | Qué preparal equipo | Dónde se usa |
| --- | --- | --- |
| GitHub | Invitación aceptada y permiso Write para contribuir; no hace falta Admin para abrir PR | Clon, ramas y PR |
| Supabase, panel | Invitación Developer a la organización que contiene el proyecto | SQL, Storage, Auth y herramientas de desarrollo; no cambia el dueño del proyecto |
| Supabase, aplicación | Crear/confirmar tu cuenta propia dentro de Trato | Login y tu espacio privado; independiente de la invitación al panel |
| Supabase, configuración | URL, publishable key y clave server por canal privado | Solo API `.env`; la clave server tiene permisos amplios y nunca va al navegador |
| Gemini Vertex | Cuenta de servicio de desarrollo separada, rol `roles/aiplatform.user` en el proyecto acordado y JSON privado | Solo worker; proyecto/región/modelo según configuración del equipo |
| Weaviate | URL del clúster existente y clave propia revocable | Solo file processor; no crear colección/tenant personal |
| Gmail | Agregar tu Gmail a los usuarios de prueba del OAuth compartido y entregar credenciales OAuth por privado | API, luego conectar tu propio buzón desde el perfil |
| PayPal Sandbox | Aplicación Merchant Sandbox acordada y acceso a un comprador Personal Sandbox distinto del vendedor | API y navegador del comprador; nunca usar tu contraseña de Gmail para PayPal |
| Neo4j | URI TLS y credencial de desarrollo para la instancia existente | API y worker, únicamente para el módulo de grafos |

El rol Developer de Supabase permite modificar y borrar contenido. En Free se aplica a la organización, no solo al proyecto: revisar su alcance antes de aceptar la invitación. [Permisos oficiales](https://supabase.com/docs/guides/platform/access-control).

No hace falta abrir una prueba de facturación propia, contratar servicios ni crear otro clúster. Gemini usa los créditos/cuotas del proyecto acordado; no es uso ilimitado. El equipo puede habilitarte el selector de modelos por tu correo confirmado, pero no es necesario para usar el modelo predeterminado.

Las cinco guías de Ensayos ya vienen en el repositorio. Redis y los tokens internos se generan en tu equipo; no hay una invitación cloud para ellos. No recibes los clientes/proyectos privados de otra cuenta por tener acceso al panel.

## 2. Elegir la instalación

| Sistema | Ruta de desarrollo |
| --- | --- |
| Windows | Usar Ubuntu 24.04 dentro de WSL 2 y ejecutar los comandos Bash de esta guía ahí. Guardar el clon dentro de tu carpeta Linux, no mezclar `.venv` de Windows con WSL. |
| Linux | Ubuntu 24.04 dispone de los paquetes indicados. En otra distribución usar sus equivalentes conservando Python 3.12. |
| macOS | Instalar Git, Node 22, Python 3.12, Redis y Poppler con tu gestor de paquetes. Continuar en Terminal; no ejecutar los comandos `apt` de Ubuntu. Esta ruta aún no fue comprobada en un Mac. |
| Docker | Ver estado al final de esta guía. Las imágenes y el arranque conjunto de siete servicios backend están comprobados en aislamiento; el Compose de Google Cloud no es un instalador local listo para Windows/macOS. |

Windows no necesita instalar un modelo local ni tener GPU para usar Gemini. Si WSL no está preparado, seguir [la instalación oficial de Microsoft](https://learn.microsoft.com/windows/wsl/install). Docker Desktop con backend WSL 2 es una opción para contenedores Linux, cuando validemos la ruta local completa; instalar Docker por sí solo no configura los accesos cloud.

## 3. Dependencias y clon

Necesitas Git, Node.js 22 (línea usada por la imagen web), Python 3.12 con `venv`, Redis 7 o superior y Poppler (`pdftotext`). Redis se ejecutará como proceso propio de Trato en 6380; no usar un Redis ajeno ya activo.

En Ubuntu 24.04/WSL, instalar las dependencias de sistema:

```bash
sudo apt update
sudo apt install git python3.12 python3.12-venv redis-server poppler-utils
```

Instalar Node 22 mediante el método acordado para tu sistema desde [Node.js](https://nodejs.org/en/download). No copiar una carpeta `node_modules` ni un entorno `.venv` de otra máquina.

Comprobar versiones y herramientas antes de continuar:

```bash
git --version
node --version
npm --version
python3.12 --version
redis-server --version
pdftotext -v
```

Desde una carpeta de desarrollo:

```bash
git clone https://github.com/sebascs04/trato.git
cd trato
npm ci
python3.12 -m venv repos/trato-file-processor/.venv
repos/trato-file-processor/.venv/bin/python -m pip install -r repos/trato-file-processor/requirements.lock.txt
repos/trato-file-processor/.venv/bin/python -m pip install -r repos/trato-api/requirements.lock.txt
python3.12 -m venv repos/trato-worker/.venv
repos/trato-worker/.venv/bin/python -m pip install -r repos/trato-worker/requirements.lock.txt
```

El supervisor usa el entorno del procesador para API y procesador; por eso se instalan ambos lockfiles en ese entorno. El worker tiene el suyo. No hace falta instalar el backend histórico de raíz ni Ollama para esta ruta Gemini.

## 4. Crear los tres archivos de entorno

Ejecutar una sola vez en un clon nuevo:

```bash
cp repos/trato-api/.env.example repos/trato-api/.env
cp repos/trato-file-processor/.env.example repos/trato-file-processor/.env
cp repos/trato-worker/.env.example repos/trato-worker/.env
```

Si alguno ya existe, conservarlo: no repetir los `cp` encima de una configuración previa. El supervisor lee estos tres `.env`; el `.env.example` de raíz corresponde al prototipo histórico y no configura los servicios actuales. Editar valores de una sola línea, sin `export` ni comillas envolventes: el lector local no es un intérprete de shell.

En API `.env`, rellenar:

```dotenv
SUPABASE_URL=URL_DEL_PROYECTO_COMPARTIDO
SUPABASE_PUBLISHABLE_KEY=CLAVE_PUBLICABLE
SUPABASE_SERVER_KEY=CLAVE_EXCLUSIVA_DEL_SERVIDOR
FILE_PROCESSOR_URL=http://127.0.0.1:8101
FILE_PROCESSOR_TOKEN=TOKEN_LOCAL_ALEATORIO
WEB_ORIGIN=http://localhost:5173
```

Generar un token interno largo y aleatorio para `FILE_PROCESSOR_TOKEN`, distinto de las claves cloud; por ejemplo, `python3.12 -c "import secrets; print(secrets.token_urlsafe(32))"` en tu terminal privada. Guardar exactamente el mismo en el `.env` del procesador. No pegar secretos en GitHub, tickets ni capturas. La invitación al panel no sustituye `SUPABASE_SERVER_KEY`. El equipo debe confirmar las migraciones de `repos/trato-api/supabase/migrations`; no ejecutar `db push`, reparar versiones o aplicar `supabase/` histórico por iniciar otro equipo.

## 5. Preparar la cola privada y las guías

Con API Supabase/server/token ya completados:

```bash
python3.12 scripts/configure-ingestion.py
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py --configure
```

El primer comando escribe Redis en `.local/redis`, genera su contraseña y el token worker y configura las URLs/tokens compartidos **solo entre tus procesos locales**. Si indica que ya existe configuración, no borrarla para forzar el script: revisar su coherencia. No genera un servicio cloud ni reemplaza una cola existente.

El segundo valida las cinco fuentes y configura la ruta absoluta de tu instalación en `TRATO_REHEARSAL_SOURCE_MANIFEST`. No llama a Gemini. Si falta un archivo o no coincide su hash, hay que corregirlo, no usar una fuente alternativa.

## 6. Conectar Gemini en el worker

Guardar el JSON recibido fuera de Git, por ejemplo en `.local/credentials/google-cloud-worker.json`. Usar su ruta **absoluta dentro de Linux/WSL/macOS**; una ruta `C:\...` no es una ruta Linux.

En `repos/trato-worker/.env`:

```dotenv
TRATO_MODEL_PROVIDER=gemini
TRATO_GEMINI_BACKEND=vertex
TRATO_GEMINI_MODEL=gemini-3.8-flash
TRATO_GEMINI_API_KEY=
TRATO_GOOGLE_CLOUD_PROJECT=ID_DEL_PROYECTO_ACORDADO
TRATO_GOOGLE_CLOUD_LOCATION=global
TRATO_GOOGLE_CREDENTIALS_FILE=RUTA_ABSOLUTA_A_TU_JSON
```

`TRATO_GEMINI_API_KEY` queda vacío porque esta configuración usa el JSON de Vertex. No pegar ahí el contenido del JSON, una clave Weaviate ni credenciales Gmail. El backend del adaptador valida este contrato y no cambia de proveedor cuando falla. No exige instalar `gcloud` para leer este JSON.

Conservar la lista `TRATO_TEST_MODEL_IDS` de las plantillas, igual en API/worker; API usa `TRATO_DEFAULT_MODEL`. La cuenta de servicio y el proyecto deben tener permisos/cuota acordados. No exportar en la terminal otras variables Google genéricas (`GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, etc.): el worker las rechaza para evitar inferir otra configuración. Revisar la terminal sin revelar secretos si ese control falla.

Más detalles en [modelos Gemini](modelos-gemini.md). El selector privado se autoriza por configuración del backend; cambiar `user_metadata` no concede acceso.

## 7. Conectar Weaviate

Crear `.local/weaviate/connection.env` con los dos valores recibidos por privado:

```dotenv
WEAVIATE_URL=URL_HTTPS_DEL_CLUSTER_COMPARTIDO
WEAVIATE_API_KEY=TU_CLAVE_DE_DESARROLLO
```

Después:

```bash
repos/trato-file-processor/.venv/bin/python scripts/configure-vector.py
```

Valida el esquema compartido, configura URL/key solo en el procesador y habilita el flag vectorial de API/FP. No genera embeddings ni indexa documentos durante esa validación. No usar `--provision`, borrar/recrear la colección ni crear un tenant por desarrolladora. La clave tiene el nombre que le dé el panel, pero la variable que lee Trato siempre es `WEAVIATE_API_KEY`.

Tenant privado compartido con filtros obligatorios owner/client/project; reputación publicada en otro tenant. Tener una clave administrativa del clúster concede acceso directo amplio: no equivale a los permisos restringidos de un agente. [Configuración y límites](configuracion-vectorial-colaboradores.md).

## 8. Habilitar los recorridos que vas a probar

Cambiar los valores existentes en los `.env`, sin duplicar las líneas:

| Variable | API | Worker | Procesador |
| --- | --- | --- | --- |
| `TRATO_REHEARSAL_EVALUATOR_ENABLED` | `true` | `true` | No aplica |
| `TRATO_AI_WORKFLOWS_ENABLED` | `true` | `true` | No aplica |
| `TRATO_VECTOR_SEARCH_ENABLED` | `true` | No aplica | `true` |
| `TRATO_FILE_PROCESSING_ENABLED` | `true` para tratamiento completo | El mismo valor que API | No aplica |

`TRATO_REHEARSAL_ENABLED` puede quedarse `false`: corresponde al endpoint local de Ollama, no a la conversación/evaluación conectada por cola de Gemini. El procesamiento completo requiere la migración de artefactos ya confirmada por el equipo. Si aún no se va a probar ese módulo, conservar su flag `false` en ambos, por elección explícita; nunca cambiarlo para ocultar un fallo durante una ejecución.

Cada instalación tiene Redis propio. El backend pump consume una outbox de Supabase compartida, por lo que coordinar el primer arranque **después de tener todos los accesos y consumidores necesarios**. No dejarlo ejecutándose con una configuración incompleta que pueda reclamar trabajos del equipo.

## 9. Gmail, PayPal y grafos

### Gmail

El equipo agrega tu correo a los usuarios de prueba del OAuth, conserva habilitada Gmail API y confirma este redirect exacto: `http://localhost:5173/gmail-callback.html`. Permisos: `openid`, `email`, `gmail.send` y `gmail.readonly`; Trato solicita lectura adicional solo cuando eliges buscar respuestas.

Con las credenciales OAuth entregadas de forma privada:

```bash
repos/trato-file-processor/.venv/bin/python scripts/configure-gmail.py
```

El asistente genera tu clave de cifrado local para la bóveda, conserva la configuración restante y pide el secreto sin mostrarlo. Después del arranque, conectar tu propio Gmail desde el perfil de Trato. No copiar tokens de sesión, SQLite o la clave de cifrado de otro equipo. Gemini y Gmail no comparten credenciales ni consentimiento.

### PayPal Sandbox

En API `.env`, configurar el juego acordado de credenciales:

```dotenv
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=CLIENT_ID_DE_LA_APP_MERCHANT_SANDBOX
PAYPAL_CLIENT_SECRET=SECRETO_DE_LA_MISMA_APP
PAYPAL_MERCHANT_ID=ID_DEL_VENDEDOR_SANDBOX
PAYPAL_RETURN_URL=http://localhost:5173/paypal-sandbox-return.html
PAYPAL_CANCEL_URL=http://localhost:5173/paypal-sandbox-return.html?result=cancel
```

Usar un comprador **Personal Sandbox**, diferente del vendedor **Business Sandbox**, con su email/contraseña de pruebas. No usar dinero ni credenciales live. `PAYPAL_WEBHOOK_ID` se configura únicamente si el equipo prepara un webhook accesible para esta integración; un endpoint localhost no es alcanzable por PayPal desde Internet.

Los enlaces localhost enviados por Gmail se abren correctamente solo en el mismo equipo que ejecuta Trato. Para probar con alguien en otra PC hará falta una URL accesible acordada, no enviarle tu `localhost`. Enviar un correo o volver del checkout no acredita el pago; debe confirmarlo el backend.

### Neo4j

Para grafos, rellenar en API y worker los mismos `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` y `NEO4J_DATABASE` que entregue el equipo para la instancia de Trato. La URI requiere TLS `neo4j+s://...`. Sin esos valores, la función de grafos falla explícitamente; el resto de módulos no necesita inventar otro grafo. No cambiar de base ni crear una instancia de pago para evitar el error.

## 10. Arrancar y comprobar

Antes de iniciar, comprobar listeners de 5173, 8100, 8101 y 6380; por ejemplo, en Linux `ss -ltnp`. Si Docker está activo, revisar también `docker ps`. No detener procesos ajenos ni cambiar puertos automáticamente. Consultar [puertos locales](puertos-locales.md).

Desde la raíz, iniciar un solo supervisor:

```bash
python3.12 scripts/dev-polyrepo.py --with-worker
```

Arranca web/API/FP/Redis, publicador de trabajos y worker de ingesta. Arranca también los consumidores IA cuyos flags estén activados. `--with-ai` sirve para trabajar solo con las colas de IA: no inicia el pump ni la ingesta de documentos; no es la opción para probar nuevas subidas/indexación automática.

En otra terminal:

```bash
curl --fail http://localhost:5173/health
curl --fail http://127.0.0.1:8100/health
curl --fail http://127.0.0.1:8101/health
```

Abrir `http://localhost:5173/#clientes`, crear/confirmar tu cuenta y entrar. Health comprueba procesos, no todos los proveedores externos. No cerrar la terminal del supervisor mientras pruebas; `Ctrl+C` detiene solo sus procesos hijos.

Probar con tus propios registros: cliente/proyecto, acuerdo PDF, nueva solicitud, lectura/fuentes, Ensayos de varios turnos y evaluación, plan inicial con IA, búsqueda y, si están configurados, envío Gmail/pago Sandbox y grafos. Registrar qué recorrido funcionó realmente y sus errores; no usar las pruebas técnicas del equipo como si validaran tu instalación.

## 11. Comprobaciones y problemas habituales

```bash
npm run check
npm test
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py
```

Las pruebas no necesitan llamar a Gemini ni enviar correos. Para las suites Python, seguir los README de los servicios; la API usa el entorno combinado instalado arriba. Las pruebas de navegador son otro paso y requieren Chromium, servidor y bibliotecas del sistema; no son un requisito para abrir la aplicación. Algunas pruebas Redis tienen activación/servicio aislado propios.

| Síntoma | Revisar |
| --- | --- |
| `ERR_CONNECTION_REFUSED` | Supervisor abierto, listeners y primer proceso que terminó; no cambiar de puerto como solución automática. |
| `AUTH_NOT_CONFIGURED` | API `.env`, URL/publishable key; no usar el `.env` de raíz. |
| Error Google 403 al conectar Gmail | Cuenta exacta agregada a usuarios de prueba y permisos OAuth, no rol de Gemini. |
| Modelo sin permisos o configuración inválida | JSON/ruta Linux, rol/proyecto/cuota y variables `TRATO_`; no rellenar API key en modo Vertex. |
| Trabajo en cola que no avanza | Consumidor y flag correctos; `--with-ai` no extrae nuevos documentos. No borrar la cola. |
| `VECTOR_CONFIGURATION_FAILED` | Clave propia, URL y esquema compartido; no recrear el clúster. |
| No aparece el selector de modelos | Correo confirmado y autorización privada del backend; el modelo predeterminado no requiere selector. |
| No veo los clientes de otra persona | Es el aislamiento esperado del espacio privado. La invitación a Supabase no comparte esos registros en Trato. |
| PDF sin texto | El archivo puede ser escaneado; OCR no está conectado. No inventar una extracción. |
| SQL local/remoto no coincide | Consultar `correspondencia-migraciones.md` y al equipo antes de aplicar/reparar historial. |

## 12. Estado de Docker y límites

Las imágenes web/API/FP/worker se construyeron y comprobaron por separado en Linux amd64. La API requirió ajustar el layout para encontrar `data/demo.json` y `local-ports.json`; esa corrección debe estar publicada en tu revisión del repo. Después se comprobó el arranque conjunto de siete servicios backend, HTTP interno API/FP, heartbeats IA y persistencia Redis tras reiniciar su contenedor de prueba. La red era interna, sin puertos publicados y con credenciales sintéticas: no se llamó a Gemini ni a datos reales. El pump informó que Supabase era inaccesible, conforme al aislamiento. Esto no prueba el recorrido con proveedores remotos, una PC nueva ni ARM.

`deploy/google-cloud/compose.yaml` prepara servicios privados para la arquitectura de Google Cloud: no incluye una web local en 5173 y su preparador exige un origen HTTPS. No ejecutar scripts de provisión cloud para instalar Trato en tu laptop. Una ruta Docker local necesita su Compose/URLs/volúmenes propios y una prueba conjunta antes de documentarla como un único comando listo.

Por ahora, la ruta operativa documentada es desarrollo nativo en Ubuntu/WSL. Si eliges Docker o macOS, coordinar su validación sin sustituir silenciosamente la ruta elegida por otra. Instalar Docker no comparte automáticamente claves, la cuenta de Trato ni datos de Redis.

La aceptación documental sigue siendo revisión humana, no certificación criptográfica de firmas. No asumir terminada la integración de devoluciones o adjuntos privados de reputación por haber instalado los servicios. Consulta la [auditoría de instalación](auditoria-instalacion-colaboradores.md) y [notas de integración](notas-para-flores.md).
