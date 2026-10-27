# Trato: separación en cuatro repositorios

Decisión de Sebastian, 24 de octubre de 2026. Esta decisión sustituye la propuesta previa de desplegar frontend y API como un único monolito. Se conservan los contratos de identidad, dinero e idempotencia acordados con P1.

Actualización posterior: Sebastian confirmó que el **diseño oficial es el de la raíz en localhost:5173/#clientes**. Allí ya se integraron perfil/acceso y Clientes con la API/Supabase, conservando sus estilos. `repos/trato-web`/5174 sigue siendo una herramienta técnica, no el diseño del producto. La extracción a un repositorio web definitivo debe conservar la interfaz original.

## Responsabilidades

| Repositorio local | Responsabilidad | No decide |
|---|---|---|
| `repos/trato-web` | Interfaz y peticiones de usuario | Permisos, importes autoritativos o identidad del cliente |
| `repos/trato-api` | Autenticación y reglas de negocio; futura persistencia, pagos y coordinación de trabajos | Interpretación libre que salte revisiones humanas |
| `repos/trato-file-processor` | Validar tipos, límites, leer PDF/DOCX y devolver texto con localizadores | IA, firma, aceptación o cobro |
| `repos/trato-worker` | Analizar fuentes autorizadas con un modelo; después orquestar LangGraph | Lectura binaria de documentos ni movimiento de dinero |

Cada directorio tiene su propio `.git`, rama `main`, README e ignores. Los repositorios anidados no tienen remotos publicados. P1 publicó por separado la primera versión de raíz en `https://github.com/sebascs04/trato`; esta integración local es posterior y aún no se publicó. La carpeta `repos/` es un contenedor local, no implica submódulos Git configurados. La demo sigue disponible y separada del espacio autenticado.

## Primera entrega implementada

Interfaz original 5173 → proxy de API con JWT → API con sesión Supabase → original privado en Storage → procesador → texto/fragmentos e historial persistentes. El procesador soporta PDF textual y DOCX (incluidas tablas del cuerpo), con hashes y errores explícitos. No hay OCR ni soporte `.doc` antiguo. La ruta de preview `/documents/extract` sigue sin persistencia; la incorporación por proyecto sí guarda el original y el resultado.

El worker incluye adaptador Ollama y validación de citas; se probó con un modelo doble, sin inferencia real. El router PayPal de P1 está montado en API con servicio ausente y errores explícitos hasta implementar el repositorio autoritativo. No se habilitan pagos a partir de aceptaciones simuladas.

Validación de esta entrega: 8 pruebas del procesador, 23 de API/PayPal/correo y 4 del worker aprobadas; comprobación de sintaxis de JavaScript aprobada. Prueba HTTP con procesador real y PDF ficticio: sin credencial privada respondió 401; API → procesador respondió 200 y devolvió fragmentos. La identidad de usuario de esa prueba HTTP fue un doble aislado; no acredita aún una sesión real Supabase. No se realizaron llamadas PayPal, envíos SMTP ni inferencia de pago.

## Flujo objetivo siguiente

La API ya implementa originales/metadatos privados, fragmentos normalizados, estados de extracción y eventos. Pendiente validar el recorrido completo con la primera cuenta real del usuario, que ya está confirmada. Después registrará trabajos de análisis y suministrará al worker fuentes con dueño/proyecto/versión/localizador fijados por backend.

Mantener una cola persistente y trabajos idempotentes entre API, procesador y worker; no fingir que las tareas en memoria son una cola durable. La invocación síncrona de extracción de esta entrega es una primera integración, pendiente de sustituir al conectar trabajos. Acuerdos, aceptaciones y pagos siguen en Postgres; los checkpoints no los reemplazan.

## Estado de Supabase

Proyecto `trato-dev`, ref `dspgazufwtabxnbbyvhz`, organización `sebascs04's Org`, plan Free verificado. Migración `persistent_ingestion`, versión `20261024232244`, aplicada y asesor de seguridad sin lints. RLS probado con dos usuarios sintéticos en rollback. El propio usuario creó/confirmó una cuenta de la aplicación; aún no había clientes/proyectos/documentos al comprobarla. No se recuperaron claves administrativas ni se publicaron datos privados.

## Preparación local

Consulta el README de cada repositorio. La API y el procesador requieren entornos Python separados al distribuirlos; en la verificación de desarrollo se reutilizó el entorno del procesador para ejecutar pruebas de API. Ambos tienen lockfiles completos y Dockerfiles preparados, aún no construidos.

`python3 scripts/dev-polyrepo.py` inicia API8100, procesador8101 e interfaz oficial5173. `--tools` opta por5174. Se usan `.env` locales ignorados sin mostrar credenciales. En5173, el perfil superior controla acceso/cierre de sesión. Las vistas conectadas no muestran importes ni respuestas ficticias; los servicios de IA y pagos aún ausentes se explican como pendientes.

Validación posterior a la integración: 38 pruebas de API/PayPal/correo aprobadas, dos pruebas del proxy aprobadas y seis pruebas Chromium de perfil, acceso, separación de proyectos, escape de fuentes, logout y subida/recarga aprobadas. Chromium usa Auth/API interceptados y fixtures, no prueba una sesión o subida real a Supabase. Smoke sobre servicios reales: recursos de5173 y config200, clientes sin sesión401.

## Pendientes inmediatos

1. Comprobar con la cuenta real login, cliente/proyecto, subida privada, finalización de extracción y recuperación tras recargar.
2. Completar verificaciones de finalización/concurrencia y luego cola persistente de trabajos.
3. Elegir y ejecutar un modelo real con evaluación de citas/abstención; añadir GPT-6 Luna como opción configurable sin fallback pago automático.
4. Conectar aceptación real y repositorio PayPal, pruebas concurrentes y sandbox.
5. Extraer la interfaz oficial conservando su diseño y acordar remotos/despliegues con P1. No mantener dos copias editables de cada módulo tras el traslado definitivo.
