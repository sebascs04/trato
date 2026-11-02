# Auditoría de instalación para colaboradores

Revisada el 1 de noviembre de 2026 contra código, plantillas y scripts de Trato. Base publicada: PR #8. La corrección posterior de la imagen API y este manual pertenecen al siguiente lote de trabajo; comprobar su publicación antes de usarlos desde otro equipo.

## Resultado

Clonar el repositorio entrega código y las cinco fuentes del evaluador, pero no credenciales ni datos privados. Para desarrollar y probar el recorrido completo hacen falta los accesos indicados en [el manual](colaboradores.md). Gemini y Weaviate son solo parte de la configuración.

| Área revisada | Evidencia de código | Resultado y acción |
| --- | --- | --- |
| Instalación anterior | Versión previa de `docs/colaboradores.md` y README | Desactualizada: presentaba Gemini/Weaviate/Neo4j como desconectados. Manual actualizado sin dar por verificada la calidad E2E. |
| Extracción PDF | `file_processor` y su README | Requiere Poppler (`pdftotext`), también en la ruta actual; no es solo una dependencia del prototipo antiguo. |
| Entornos Python | `scripts/dev-polyrepo.py` | Usa el entorno del procesador para API/FP y otro para el worker. Deben instalarse ambos lockfiles API/FP en el primero. |
| Variables privadas | `.env.example` de cada servicio | El supervisor lee esos archivos; no basta editar `.env` de raíz. Gemini se configura solo en worker; Weaviate solo en FP. |
| Supabase | `app.py`, `thread_store.py`, RLS y RPCs | URL/publishable para autenticación y clave server exclusiva del backend para trabajos/persistencia interna. Invitar al panel no crea una cuenta de Trato. |
| Redis y tokens | `configure-ingestion.py` | Cola AOF local, puerto 6380, contraseña y token worker propios. No compartir Redis entre equipos ni copiar archivos de estado. El script exige API/FP token y clave server ya configurados y rechaza sobrescribir una cola existente. |
| Gemini | `trato_worker/gemini.py` | Perfil acordado Vertex con proyecto, región, modelo y JSON de cuenta de servicio. `TRATO_GEMINI_API_KEY` debe quedar vacío en este modo. No admite credenciales Google implícitas de otro proyecto. |
| Selector de modelos | `model_preferences.py` | Autorización por correo confirmado en configuración privada del backend. La cuenta nueva puede usar el modelo predeterminado sin ser probadora del selector. No ampliar la lista sin acuerdo. |
| Weaviate | `configure-vector.py`, `vector_store.py` | Clúster/colección compartidos, clave propia por desarrollador. Configurador valida sin inferencia y sin recrear esquema; no usar `--provision` en una instalación normal. |
| Cinco fuentes | `resources/rehearsal-sources`, configurador | Incluidas en Git con manifiesto/hashes. Instalar no requiere otra transferencia privada de las guías. |
| Gmail | `gmail/service.py`, `configure-gmail.py` | OAuth independiente de Gemini. Usuario de prueba, callback exacto, conexión desde perfil. Cifrado y tokens del buzón se generan/guardan localmente, no se copian de otro equipo. |
| PayPal | `paypal/config.py`, `proposals/workflow.py` | Aplicación Merchant Sandbox y comprador Sandbox distinto. El configurador exige return/cancel; se documentan y añaden a la plantilla API. No necesita credenciales live. |
| Neo4j | `graph_routes.py`, `graph_projection.py` | API lee, worker proyecta. Configuración TLS en ambos; no confundir proyección con base principal de negocio. |
| Arranque | `dev-polyrepo.py` | `--with-worker` inicia ingesta/pump; los consumidores IA solo arrancan con sus flags. `--with-ai` no inicia la ingesta/pump. No ejecutar dos supervisores simultáneamente. |
| Docker | Recibos locales de construcción/pruebas y `deploy/google-cloud/` | Las cuatro imágenes pasaron comprobaciones individuales Linux amd64. API necesitó corregir su layout para resolver recursos. Siete servicios backend también arrancaron juntos en una red interna sin puertos publicados. Las dependencias reales y el recorrido de instalación local de usuario siguen sin validar. |
| Acceso financiero | API y PayPal Sandbox | Volver del checkout o enviar Gmail no prueba pago. Los enlaces localhost funcionan en el equipo que los sirve; otra persona no accede al localhost del desarrollador. |

## Estado de verificación

- Contratos comprobados en el lote publicado: API 239, procesador 26, Node 38, despliegue 3; worker 128 ejecutadas con 11 omisiones explícitas; 1.559 traducciones ES/EN emparejadas.
- el equipo comprobó por separado web/API/FP/worker en Docker local con red aislada, sin puertos publicados ni proveedores externos. Se verificaron recursos del evaluador, casos de Ensayos, disponibilidad de `pdftotext` e imports del worker; no se inició el consumidor real.
- Posteriormente pasaron arranque conjunto de siete servicios backend, conectividad HTTP interna API/FP, heartbeats IA y persistencia Redis al reiniciar su contenedor de prueba. Se usaron credenciales sintéticas sin red externa ni trabajos de modelo; el pump reportó Supabase inaccesible, conforme al aislamiento. Esto no equivale a instalación fresca Windows/macOS, conexiones remotas reales ni calidad de una conversación/evaluación completa con Gemini.
- No se han creado accesos de la nueva colaboradora por redactar este documento. Confirmar invitaciones aceptadas y entrega privada de credenciales antes de declarar su entorno listo.
- Adjuntos privados de reputación y adaptación de expedientes monetarios del colaborador que lleva devoluciones siguen separados. Instalar dependencias no completa esas integraciones.

## Recursos compartidos y recursos locales

Supabase, proyecto Google Cloud, clúster Weaviate y Neo4j son compartidos cuando el equipo entrega esos accesos. Cola Redis, preferencias de modelo, bóveda Gmail, tokens internos y rutas a credenciales son propios de cada instalación. Un workspace local no contiene automáticamente las conversaciones o trabajos guardados en el Redis de otro equipo.

Los procesos con permisos server pueden consumir trabajos de la outbox compartida de Supabase. No arrancar un pump con configuración a medias: puede reclamar trabajos del equipo y dejarlos en error. Coordinar el primer arranque y probar con registros propios; no reejecutar migraciones ni limpiar colas/índices para resolver un error de instalación.

## Referencias verificadas

- [Supabase: roles y alcance de organización/proyecto](https://supabase.com/docs/guides/platform/access-control). Developer permite trabajar con contenido; los roles por proyecto requieren Team/Enterprise. En Free el alcance organizacional incluye los demás proyectos de la organización.
- [Google Cloud: autenticación de desarrollo local](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment). Trato actualmente implementa lectura explícita de JSON de cuenta de servicio; otros métodos no se activan automáticamente.
- [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/). La instalación depende de arquitectura y requisitos WSL/virtualización; construir una imagen amd64 no acredita soporte nativo ARM.


## Corrección detectada al seguir un clon nuevo

`configure-vector.py` rechazaba cambiar `TRATO_VECTOR_SEARCH_ENABLED=false` de las plantillas a `true`, aun cuando el usuario ejecutaba expresamente el configurador. Ahora esa activación es el único cambio de valor existente permitido por esas llamadas: una URL/clave distinta sigue produciendo error antes de escribir. Las pruebas usan archivos temporales y comprueban activación, idempotencia y conservación de credenciales; no llaman al clúster ni a embeddings.
