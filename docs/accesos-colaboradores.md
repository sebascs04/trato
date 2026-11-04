# Accesos que prepara el equipo para una colaboradora

Este documento acompaña al [manual de instalación](colaboradores.md). No contiene correos privados, claves ni credenciales. La auditoría o este checklist no acreditan que una invitación ya se haya enviado/aceptado. Registrar esos estados por un canal privado.

## 1. GitHub y cuenta de Trato

En GitHub, confirmar que aceptó la invitación al repositorio. El permiso Write permite contribuir mediante ramas y PR; no hace falta convertirla en administradora. Mantener la regla del equipo: rama compartida por lote, un responsable de publicación y autorización explícita para abrir/fusionar PR.

Después de arrancar localmente, ella registra/confirma su propia cuenta dentro de Trato. La invitación a GitHub o al panel Supabase no la registra como usuaria de la aplicación ni comparte los clientes de otra cuenta.

## 2. Supabase

1. Abrir [Supabase](https://supabase.com/dashboard), seleccionar la organización que contiene el proyecto y entrar a Team/Manage members.
2. Invitar su cuenta de Supabase con rol **Developer**. Ella acepta desde su correo. No compartir la contraseña del propietario.
3. Revisar el alcance: en Free, el rol de organización se aplica también a los otros proyectos de esa organización; la limitación por proyecto requiere Team/Enterprise. Developer puede gestionar contenido, incluidos datos y archivos. No necesita Owner o Administrator para desarrollar sobre la base.
4. Facilitar por privado la URL del proyecto y publishable key para `repos/trato-api/.env`.
5. Facilitar por privado una clave server apropiada para el backend local de una desarrolladora de confianza. `SUPABASE_SERVER_KEY` tiene permisos amplios y no está limitada por las políticas de usuario de la misma forma que la publishable key. No colocarla en web, worker, procesador, documentos públicos ni Git.
6. Confirmar migraciones del proyecto compartido, sin volver a aplicarlas en su equipo ni ejecutar reparaciones de historial automáticamente. Para cambios SQL posteriores, coordinar migración con los demás colaboradores.

La conexión MCP de su asistente se autoriza desde su propia cuenta, si quiere usarla. No necesita una conexión MCP para ejecutar Trato. [Roles oficiales](https://supabase.com/docs/guides/platform/access-control), [claves de API](https://supabase.com/docs/guides/api/api-keys).

## 3. Gemini mediante Vertex

1. Confirmar el proyecto Google Cloud existente del equipo y su API/modelo/región acordados. No crear otro proyecto facturable ni activar un servicio de pago como parte de este checklist.
2. En IAM → Service Accounts del proyecto, preparar una identidad de desarrollo separada de la de los otros colaboradores. Asignar al proyecto el rol `roles/aiplatform.user` necesario para el adaptador actual; no Owner/Editor de todo el proyecto.
3. Si se usa el mismo método local que el código actual, preparar un JSON de esa cuenta de servicio y entregarlo únicamente por un canal privado. Si la política de la organización no permite claves, parar y acordar un adaptador de autenticación compatible; no cambiar a otra cuenta/proveedor automáticamente.
4. Ella configura solo el worker con `TRATO_GEMINI_BACKEND=vertex`, proyecto, región, modelo y ruta absoluta a su JSON. `TRATO_GEMINI_API_KEY` queda vacío.
5. Mantener registro privado de la identidad para revocarla individualmente cuando deje de colaborar. Las llamadas consumen cuota/crédito del proyecto compartido; crear el acceso no garantiza disponibilidad de todos los modelos.

No necesita acceso al buzón del propietario ni la contraseña de su cuenta Google. Trato actualmente carga el JSON explícitamente; la configuración genérica ADC de otro programa no sustituye esa variable. [Configuración implementada](modelos-gemini.md), [roles de Agent Platform](https://docs.cloud.google.com/iam/docs/roles-permissions/aiplatform).

El selector de modelos es un permiso adicional de Trato. Si el equipo autoriza darle esa función, agregar su correo **confirmado** a `TRATO_MODEL_TESTER_EMAILS` en su API local y en el entorno compartido que vaya a usar. No está implícito en crear una cuenta de servicio. Sin selector usa el modelo predeterminado configurado.

## 4. Weaviate

1. Abrir el clúster existente de Trato en [Weaviate Cloud](https://console.weaviate.cloud/).
2. Preparar una clave de desarrollo propia, identificable y revocable para esta colaboradora. No reutilizar la clave personal de otro colaborador como si fuera una identidad independiente. Revisar el alcance que ofrezca el plan; una clave admin permite acceso directo a todo el clúster.
3. Compartir por privado URL HTTPS y clave. Ella las guarda en `.local/weaviate/connection.env` y ejecuta el configurador normal, sin `--provision`.
4. No crear colección ni tenant nuevo: se comparte `TratoSourceChunks`, con `projects_private` y `reputation_public`. La aplicación obliga filtros y vigencia; las claves cloud no son el mecanismo de autorización por proyecto del agente.
5. Si el plan no permite otra clave, consultar al equipo antes de revocar o compartir una existente. No contratar otro plan ni crear otro clúster para resolverlo.

No poner la clave en `TRATO_GEMINI_API_KEY`, en API/worker ni en el frontend. [Configuración vectorial](configuracion-vectorial-colaboradores.md).

## 5. Gmail

1. En Google Auth Platform del proyecto que contiene el cliente OAuth, agregar el Gmail que ella conectará a Audience/Usuarios de prueba, mientras la app permanezca en testing.
2. Comprobar Gmail API habilitada y cliente OAuth Web con redirect exacto `http://localhost:5173/gmail-callback.html`. Conservar otros redirects válidos del equipo, no sustituirlos.
3. Confirmar permisos `openid`, correo, `https://www.googleapis.com/auth/gmail.send` y `https://www.googleapis.com/auth/gmail.readonly`. El código pide lectura adicional cuando el usuario elige buscar respuestas.
4. Entregar el client ID/secret del cliente acordado por un canal privado; ella ejecuta `scripts/configure-gmail.py` y obtiene su propia clave de cifrado/bóveda local.
5. Ella conecta su propio Gmail desde su perfil de Trato. No copiar el SQLite, refresh tokens ni la clave de cifrado de otro equipo. Registrar credenciales OAuth no envía correos por sí solo.

Tener permiso para Gemini no agrega automáticamente su correo a los usuarios de prueba Gmail. Confirmar que es el correo que realmente seleccionará en la pantalla de consentimiento, aunque su cuenta Trato use otro.

## 6. PayPal Sandbox

El equipo acuerda qué aplicación Merchant Sandbox y vendedor usará esta instalación. Entregar su client ID, secret y merchant ID por privado, junto con un comprador Personal Sandbox distinto del vendedor para completar pruebas.

El email/contraseña de Login Info pertenecen al comprador ficticio de PayPal Sandbox, no al Gmail real. Configurar return/cancel locales de la plantilla API. No invitarla a cuentas PayPal live, no compartir la contraseña personal del propietario ni crear una cuenta Business real para instalar el repo.

Si se requiere webhook, coordinar una URL accesible/ID de webhook con la implementación real; localhost no recibe notificaciones desde PayPal. No considerar un regreso de checkout ni un correo enviado como pago confirmado.

## 7. Neo4j y recursos locales

Para probar grafos, facilitar los campos privados de conexión a la instancia Neo4j de Trato para API y worker. Acordar la credencial de desarrollo que permita el plan existente; no crear otro recurso de pago. Para trabajar solo en Ensayos no hace falta abrir el módulo de grafos hasta configurar ese acceso.

Redis, `FILE_PROCESSOR_TOKEN`, `TRATO_WORKER_TOKEN`, bóveda Gmail y rutas de archivos se preparan en su PC. No compartir tu Redis, copiar `.local` completo ni mandar un ZIP indiscriminado de tus `.env`. El repositorio ya incluye las cinco fuentes de Ensayos: solo debe seleccionar su ruta local mediante el script.

## Cierre de incorporación

Antes de decir «ya tiene todo», confirmar: invitaciones aceptadas, login Trato, tres `.env` propios, permisos Gemini/Weaviate correctos, guías validadas, cola/consumidores locales y módulos que realmente probará. Empezar con datos propios y coordinar el pump de Supabase compartido. La primera prueba conectada debe verificar el proveedor correspondiente; un `/health` correcto no acredita permisos de todas las integraciones.
