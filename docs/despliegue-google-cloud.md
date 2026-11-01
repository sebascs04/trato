# Despliegue de Trato en Google Cloud

Preparación del 1 de noviembre de 2026. No acredita que exista una demo pública.
No se creó infraestructura, no se subieron secretos ni se ejecutaron inferencias
al preparar estos archivos. No publicar este lote sin autorización nueva.

## Arquitectura sin comprar dominio

- Cloud Run ejecuta únicamente `server.mjs` y entrega la URL HTTPS `run.app`.
  Mínimo 1 y máximo 1 instancia: no depende de visitas de un guardián.
- Compute Engine: VM estándar `e2-standard-2` (2 vCPU / 8 GiB), Debian 12,
  disco persistente balanced de 30 GB, región Iowa `us-central1`.
- Dentro de la VM: API, file processor, Redis, backend pump, ingesta, trabajos IA
  y evaluador de Ensayos como procesos/contenedores separados.
- Redis: AOF, sincronización cada segundo, `noeviction` y volumen persistente.
  Puede perder aproximadamente el último segundo ante una caída abrupta; no
  confundir persistencia con respaldo o alta disponibilidad.
- Gmail y la prueba de PayPal tienen volúmenes persistentes separados. Los datos
  de negocio permanecen en Supabase. Neo4j y Weaviate conservan sus servicios.
- Una VM es un punto único de caída. Reinicios, backups y recuperación deben
  verificarse antes de entregar; no se promete alta disponibilidad.

Cloud Run accede por Direct VPC egress a `10.40.0.10:8100`. La regla `trato-web-to-api`
permite solo el tag de origen `trato-web` al tag de destino `trato-backend`.
No publicar Redis, file processor, SSH o API a Internet. SSH usa IAP.
La VM tiene IPv4 externa para salida a servicios externos; no necesita un balanceador
ni Cloud NAT para este diseño. Solo la URL de Cloud Run es pública.

## Archivos y estado de verificación

- `deploy/google-cloud/Dockerfile.*`: imágenes separadas. Contexto raíz con
  `.dockerignore`; secretos, `.local`, entornos virtuales y documentos privados no
  entran en el contexto. No requiere instalar Python en la imagen de la web.
- `compose.yaml`: proyecto/red/volúmenes propios `trato`; sin volúmenes externos.
- `prepare.py`: por defecto verifica configuración y hashes de las cinco guías
  sin escribir ni mostrar claves. `--write` copia exclusivamente parámetros
  conocidos a una carpeta nueva bajo `.local`; nunca modifica los `.env` vivos.
- `provision.sh`: muestra un plan sin llamadas remotas. `--apply` habilita APIs y
  crea recursos: ejecutar solo con autorización y presupuesto revisados.
- `deploy-web.sh`: publica una imagen revisada por digest, con origen HTTPS fijo,
  Direct VPC, mínimo/máximo 1 y sin secretos de proveedores en la web.

Verificado: sintaxis Node/shell, cuatro pruebas de proxy HTTP/HTTPS/firma PayPal,
contratos de secretos/aislamiento y esquema oficial Compose. Docker daemon no
está disponible en esta instalación WSL: imágenes todavía NO construidas ni
arrancadas. Sin pruebas desde interfaz ni E2E del proveedor durante esta etapa.

## Acceso necesario

El permiso Billing Account Viewer permite leer facturación, no desplegar.
La consulta a Compute Engine y Cloud Run devolvió SERVICE_DISABLED el 1/11.
El intento de habilitar las APIs también quedó bloqueado porque Service Usage API
está deshabilitada; no hubo cambios remotos. Después de habilitarla, verificar
los permisos efectivos antes de intentar crear recursos.
Revisar también vencimiento del crédito antes de crear recursos facturables.

Preferir una identidad administrativa de despliegue separada del worker. El runtime
web `trato-web` no recibe roles del proyecto; el worker solo recibe la credencial
Vertex ya autorizada. No conceder Owner/Editor al worker por comodidad. Se puede
aprovisionar desde Cloud Shell con la identidad de Sebastian, sin exportar su clave.
Quien ejecute necesita permisos para habilitar servicios, administrar instancias/
redes/firewall, Cloud Run, Artifact Registry, crear el runtime service account y
actuar como él. Consultar las guías oficiales de IAM antes de conceder esos roles.

## Secuencia de instalación

1. Verificar saldo/vencimiento, permisos y presupuesto hasta el 25 de diciembre.
   Comprobar el saldo real y vencimiento en la cuenta propia antes de activar recursos.
2. Preparar un snapshot revisado de todos los servicios y sus dependencias. El
   último `main` conocido era `81c7ee7`; hay cambios IA/vectoriales locales que no
   deben omitirse ni darse por publicados. Coordinar con P1/Flores. No usar `git pull`
   ni resetear la raíz sintética ni checkouts anidados para aparentar una rama.
3. En una identidad de despliegue autorizada:

   ```bash
   export TRATO_CLOUD_PROJECT=ID_DEL_PROYECTO
   bash deploy/google-cloud/provision.sh
   # Tras revisar el plan y autorizar recursos:
   bash deploy/google-cloud/provision.sh --apply
   ```

   Si falla a mitad, inventariar recursos existentes y continuar de manera explícita.
   No borrar/redimensionar recursos ajenos ni repetir creación a ciegas.
4. Instalar Docker Engine + Compose **2.30 o superior** en la VM dedicada mediante
   el repositorio oficial de Docker para Debian. No ejecutar esta instalación ni
   el stack contra el host local de QAMAQ. Verificar listeners y contenedores antes.
5. Construir las imágenes con contexto público revisado. Registrar el digest de
   la web en Artifact Registry. No usar `gcloud builds submit` sobre el workspace
   original: `.dockerignore` no sustituye `.gcloudignore` para una subida de fuentes.
   Ejemplo de construcción/publicación explícita de la web:

   ```bash
   gcloud auth configure-docker us-central1-docker.pkg.dev
   docker build -f deploy/google-cloud/Dockerfile.web \
     -t "us-central1-docker.pkg.dev/$TRATO_CLOUD_PROJECT/trato/web:REVISION" .
   docker push "us-central1-docker.pkg.dev/$TRATO_CLOUD_PROJECT/trato/web:REVISION"
   ```

   Este push de imagen requiere autorización; no equivale a un push o PR Git.
6. Obtener la URL canónica creando primero una revisión Cloud Run **privada**,
   con la imagen por digest, `--no-allow-unauthenticated`, `--min=0 --max=1`,
   origen temporal `https://pending.invalid` y mismos parámetros VPC del script.
   Consultar `status.url` con `gcloud run services describe trato-web`. No abrir
   tráfico público hasta fijar WEB_ORIGIN y configurar los callbacks.
7. Con la URL real, preparar archivos privados:

   ```bash
   python3 deploy/google-cloud/prepare.py
   python3 deploy/google-cloud/prepare.py --write \
     --origin https://URL_REAL.run.app \
     --destination /RUTA_DEL_WORKSPACE/.local/deploy/google-cloud-REVISION
   ```

   Transferir **por separado y de forma privada** esa carpeta a `/opt/trato-private`
   en la VM. El padre debe ser 0700 y los env 0600. El JSON Gemini es
   solo lectura dentro del mount del worker; no convertirlo en asset. Las cinco
   guías de Ensayos aprobadas para el repositorio se incluyen en la imagen API
   desde `repos/trato-api/resources/rehearsal-sources`; el manifiesto se fija en
   `/app/resources/rehearsal-sources/manifest.json`. No dependen de archivos WSL
   ni de un montaje privado. Esta autorización no incluye documentos de usuarios.
   En API/worker nunca debe aparecer WEAVIATE_API_KEY; solo processor.env la recibe.
   No copiar bases SQLite vivas de Gmail desde el portátil: volver a conectar Gmail
   en la nueva instalación. Si se migra una bóveda, hacer backup SQLite consistente
   y conservar su clave de cifrado con procedimiento revisado.
8. Copiar `.env.example` a una configuración privada para Compose y fijar
   TRATO_PRIVATE_DIR y TRATO_API_BIND_IP. Construir los tres tipos de imágenes
   backend y arrancar únicamente en la VM dedicada:

   ```bash
   docker compose --env-file /opt/trato-private/compose.env \
     -f deploy/google-cloud/compose.yaml config --quiet
   docker compose --env-file /opt/trato-private/compose.env \
     -f deploy/google-cloud/compose.yaml build
   docker compose --env-file /opt/trato-private/compose.env \
     -f deploy/google-cloud/compose.yaml up -d
   ```

   Nunca imprimir `docker compose config` sin `--quiet`: puede revelar los env.
   Comprobar estado/health, logs acotados y heartbeats Redis
   `trato:ai:consumer:ready` y `trato:rehearsal:consumer:ready`. El backend pump y
   connected ingestion son necesarios para indexar tras confirmar una extracción.
9. Registrar en Google OAuth el redirect EXACTO
   `https://URL_REAL.run.app/gmail-callback.html`, conservando el local como entrada
   separada. Registrar el origen/redirect en Supabase Auth. Mantener modo/testing y
   usuarios autorizados Gmail coherentes; no cambiar permisos ni tokens locales.
   Verificar URLs return/cancel de PayPal Sandbox y, si procede, webhook de la
   implementación realmente activa. El proxy conserva sus cabeceras de firma;
   eso no acredita que una ruta de webhook sin repositorio esté conectada.
10. Publicar la web mediante `deploy-web.sh` con TRATO_WEB_IMAGE por digest y
    TRATO_WEB_ORIGIN real. Revisar la ruta pública y callbacks cuando el usuario
    autorice las pruebas de interfaz. No declarar despliegue completado solo porque
    `/health` responda: no comprueba Supabase, Gemini, pagos ni las colas.

## Costos y operación

El cálculo anterior de US$156–166 hasta el 21/12 correspondía a VM/disco/IP,
reserva de tráfico/backups y US$50 para Gemini. Cloud Run mínimo1 añade costo idle,
builds y registro de imágenes también tienen consumo: recalcular con las tarifas
oficiales y reservar margen adicional antes de activar. No repetir aquella cifra
como costo cerrado para esta variante. Referencia de idle Cloud Run a 1 vCPU /
256 MiB durante 55 días: 4,752,000 segundos × (0.0000025 + 0.25 × 0.0000025)
≈ US$14.85 antes de descuentos/free tier; tiempo activo, solicitudes y tráfico
se añaden aparte. Reservar inicialmente unos US$180–210 en conjunto, sujeto a
carga/uso de Gemini y al saldo/vencimiento real. Limitar Cloud Run a una instancia reduce
expansión, no limita el gasto total. Verificar saldo y cuotas periódicamente.

Configurar alertas presupuestarias y monitorización de caídas. Las alertas no son
por sí solas un interruptor de todo el proyecto. No apagar al cerrar la entrega:
la evaluación termina el 15/12 y los ganadores se anuncian alrededor del 21/12.

Redis AOF y volúmenes Gmail/PayPal requieren backups consistentes y prueba de
restauración antes de la entrega. Programar snapshots del disco fuera del periodo
de cargas; para copiar AOF/bóvedas tomar un snapshot consistente o parar SOLO Trato
con un procedimiento acordado. No borrar volúmenes con `down -v`.

## Fuentes oficiales

- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/run/docs/configuring/min-instances
- https://docs.cloud.google.com/run/docs/securing/security
- https://docs.cloud.google.com/compute/docs/access/iam
- https://docs.cloud.google.com/artifact-registry/docs/docker/authentication
- https://docs.docker.com/compose/how-tos/startup-order/
- https://docs.docker.com/reference/compose-file/services/
- https://docs.docker.com/engine/install/debian/

- https://cloud.google.com/run/pricing
