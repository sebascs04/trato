# Gmail en Trato: implementación y configuración

25 de octubre de 2026.

## Estado y reparto

P1 implementa correo, propuesta de adenda, puente de aceptación y PayPal. P2 mantiene acuerdo inicial, fuentes, extracción, IA, análisis y alternativas. El freelancer revisa explícitamente antes de enviar. La propuesta de adenda se envía primero; solo una aceptación real registrada habilitará crear un cobro adicional.

Ya hay código de conexión OAuth Gmail montado en la API y el perfil de la interfaz oficial5173. **No hay cliente OAuth de Google configurado todavía; no se autorizó una cuenta Gmail ni se enviaron mensajes reales.** El usuario confirmó que necesita crear ese cliente, y pidió guía paso a paso.

## Archivos y rutas

- `repos/trato-api/trato_api/gmail/vault.py`: SQLite local privado, tokens cifrados con Fernet y estado OAuth de un solo uso/caducidad10min, ligado al usuario autenticado.
- `repos/trato-api/trato_api/gmail/service.py`: código de autorización + PKCE/S256, intercambio/renovación, verificación de correo de Google, desconexión y transporte Gmail. Solo endpoints Google fijos, sin seguir redirecciones HTTP.
- `repos/trato-api/trato_api/gmail/routes.py`: conexión con JWT de Trato; las respuestas nunca incluyen access/refresh tokens de Google.
- `gmail-connection.mjs`: panel del perfil con conectar/desconectar. Valida origen, ventana y estado del callback; la conexión no envía un correo.
- `gmail-callback.html`: callback mínimo, sin recursos externos, limpia código/state de URL y los comunica a la ventana que inició la conexión.
- `scripts/configure-gmail.py`: configuración local interactiva; secreto oculto, clave de cifrado generada o conservada, escritura privada y atómica de `.env` sin mostrar secretos. No crea credenciales de Google.

Rutas API (todas requieren JWT):

- `GET /api/v1/integrations/gmail`: configured/connected/email.
- `POST /api/v1/integrations/gmail/connect`: cuerpo vacío, URL de consentimiento.
- `POST /api/v1/integrations/gmail/complete`: code+state, o error+state; sin dueño/destinatario/redirección arbitrarios.
- `POST /api/v1/integrations/gmail/disconnect`: elimina tokens locales e intenta revocar el permiso. Si Google no respondió, `revoked:false`; la UI aclara que el usuario puede revisar el acceso desde Google.

Permisos: `openid`, `email` y `https://www.googleapis.com/auth/gmail.send`. No lectura de Gmail. Identidad verificada usando userinfo; es independiente del correo usado para iniciar sesión a Trato.

## Configuración que falta

1. Crear/seleccionar proyecto Google Cloud para Trato y habilitar Gmail API.
2. Configurar Google Auth Platform, nombre/app/contacto, audiencia y usuarios de prueba cuando corresponda. Añadir la cuenta que hará la demo como usuario de prueba si se mantiene la app en pruebas.
3. Configurar los permisos anteriores, sin solicitar lectura de la bandeja.
4. Crear un cliente OAuth de tipo Aplicación web. URI de redirección exacta: `http://localhost:5173/gmail-callback.html`.
5. Ejecutar localmente, desde la raíz:

```bash
repos/trato-file-processor/.venv/bin/python scripts/configure-gmail.py
```

El script pide ID y secreto del cliente, y conserva las variables Supabase/procesador existentes. Nunca pegar secretos en el chat ni subir `.env`, SQLite o clave de cifrado a GitHub.

6. Reiniciar el supervisor y abrir el perfil de Trato → Conectar Gmail → completar consentimiento personalmente en Google.

Variables privadas API: `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, `GOOGLE_GMAIL_REDIRECT_URI`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_VAULT_PATH`. Plantilla sin valores secretos en `repos/trato-api/.env.example`.

## Correo y pagos: qué está conectado y qué falta

Los cuatro módulos originales de correo/propuestas/rutas se trasladaron a `repos/trato-api/paypal/`. `GmailMailer` implementa los mismos métodos `send` y `send_proposal` que el transporte SMTP. El generador conserva texto/HTML y PDF. Las outbox de propuesta y cobro reconocen `accepted_by_gmail` para deduplicar igual que SMTP. Una respuesta Gmail exitosa indica aceptación de envío por el proveedor; no acredita lectura, firma o pago.

**Falta el repositorio persistente de propuestas/aceptaciones/outbox/pagos y su montaje.** Las rutas de envío de adenda/cobro siguen503 cuando no hay ese servicio. No se habilita un endpoint de correo libre para eludir revisión o enviar a destinatarios arbitrarios. La UI de vista previa de cobros sigue separada del envío conectado.

El vault actual es para desarrollo local, proceso API único y disco privado persistente. No es una tabla Supabase de negocio. Para Render/múltiples procesos se necesita persistencia privada compartida o disco durable y coordinación de renovación, además de mover redirectURI a HTTPS y registrar esa URI en Google. No desplegar asumiendo persistencia del filesystem efímero.

## Verificación

Suite API75 pruebas aprobadas, incluidas17 OAuth/Gmail: estado/caducidad/replay/dueño/PKCE, cifrado, scopes, identidad, refresh, MIME/PDF, desconexión, ausencia de reintentos tras envío incierto, rutas autenticadas y parámetros restringidos. No se hicieron llamadas Google/PayPal reales ni envíos.

Navegador: pruebas Gmail conectan mediante un proveedor interceptado, validan callback y desconexión, y dejan el botón deshabilitado cuando falta configurar. La intercepción de la primera navegación del popup debe registrarse en browserContext, no solo page. Pruebas locales npm28 aprobadas; las de proxy necesitan permisos de puertos fuera del sandbox en este entorno.

Supervisor actualizado en sesión exec74195: web5173, API8000, procesador8001. Verificar puertos al retomar.

## Fuentes oficiales consultadas

- OAuth de servidor: https://developers.google.com/identity/protocols/oauth2/web-server
- Permisos Gmail: https://developers.google.com/workspace/gmail/api/auth/scopes
- MIME y adjuntos: https://developers.google.com/workspace/gmail/api/guides/sending
- Endpoint de envío: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send

### Actualización de configuración local

El usuario descargó el JSON de su cliente OAuth web. Se importó el archivo local correspondiente al proyecto esperado y al redirect exacto a `repos/trato-api/.env`, con permisos0600 y clave Fernet local generada. No se imprimieron las credenciales. Se comprobó que `.env` y `.local/gmail/vault.sqlite3` están ignorados por Git. Se reiniciaron los servicios para cargar la configuración. Quedan pendientes añadir la cuenta de prueba en Google si corresponde y completar personalmente el consentimiento desde el perfil. Esta actualización sustituye la afirmación anterior de que faltaba un cliente OAuth, pero no acredita una cuenta Gmail conectada ni un envío real.

### Conexión Gmail real verificada · 25 de octubre de 2026

El usuario completó el consentimiento. Se comprobó en el filesystem que usa el servidor (fuera de la vista aislada del sandbox) que existe una conexión cifrada, corresponde al remitente que seleccionó y conserva gmail.send y credencial de renovación. El vault tiene permisos0600. No se mostraron tokens, no se llamó a Google durante esta comprobación y no se enviaron correos. Una lectura anterior dentro del sandbox mostró0 filas; no usar esa vista aislada para concluir que falta la conexión del servidor. Pendiente: integrar persistencia de propuestas/aceptación/outbox/pagos y probar un envío solo cuando el usuario lo solicite explícitamente.


### Envío de revisiones conectado, 25/10

`proposal-workspace.mjs` muestra el correo y PDF de una revisión. El backend compara el digest de destinatario/contenido/PDF/remitente con la vista revisada; Gmail verifica el remitente dentro del lock de credenciales. El outbox Supabase deduplica por revisión/tipo. Un envío `sending` o incierto no se reenvía automáticamente. Una adenda enviada no autoriza el pago: requiere retorno del PDF y revisión humana. Aún no se ha enviado un correo real en esta integración.
