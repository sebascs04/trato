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

Permisos base de conexión/envío: `openid`, `email` y `https://www.googleapis.com/auth/gmail.send`; la conexión inicial no pide lectura. Identidad verificada usando userinfo; es independiente del correo usado para iniciar sesión a Trato.

La lectura de respuestas usa consentimiento incremental: solo se solicita después de que la persona elige **Buscar respuestas en Gmail**, con la conexión de envío existente. Añade `https://www.googleapis.com/auth/gmail.readonly` y conserva los permisos concedidos (`include_granted_scopes=true`). La lectura no es necesaria para enviar. `gmail.readonly` es un permiso restringido de Gmail; almacenar o transmitir esos datos desde un servidor exige completar la verificación de Google y el security assessment aplicable antes de habilitarlo públicamente.

## Configuración que falta

1. Crear/seleccionar proyecto Google Cloud para Trato y habilitar Gmail API.
2. Configurar Google Auth Platform, nombre/app/contacto, audiencia y usuarios de prueba cuando corresponda. Añadir la cuenta que hará la demo como usuario de prueba si se mantiene la app en pruebas.
3. Para el envío, configurar `openid`, `email` y `gmail.send`. No añadir `gmail.readonly` a la conexión inicial; el flujo de lectura lo pedirá en forma incremental y solo por acción explícita.
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

## MVP de lectura de respuestas Gmail (no habilitado para producción)

El flujo nuevo se ejecuta bajo demanda, sin polling ni Gmail push. `POST /api/v1/projects/{project_id}/gmail-replies/sync` usa solo los `threadId` guardados por envíos de adenda conocidos; no hace búsquedas ni listados de la bandeja. Por ejecución consulta como máximo los 5 hilos elegibles más recientes y guarda como máximo 25 respuestas nuevas, con hasta 100 mensajes por hilo y 4 MiB por respuesta de hilo (hasta 20 MiB de respuesta de Google en el peor caso). La respuesta de sync solo devuelve el conteo, no el texto. La búsqueda no es exhaustiva: puede haber respuestas en hilos que no se revisaron y la interfaz lo advierte. La lista muestra como máximo 50 respuestas recientes por propuesta. Solo conserva respuestas posteriores al envío cuando coinciden el hilo, el `Message-ID` RFC de la adenda citada por `In-Reply-To` o `References`, el remitente registrado del cliente y el buzón destinatario. El asunto no sirve como prueba de vínculo. No se aceptan respuestas automáticamente, no se cambia el estado comercial y una respuesta jamás autoriza cobro.

La conexión de envío continúa disponible si se deniega `gmail.readonly`. El token debe conservar la identidad Google previamente vinculada y se valida el conjunto de permisos realmente concedidos. Las consultas de mensajes y adjuntos usan HTTPS y rutas Gmail fijas. Se procesa solo texto `text/plain`, con límite por hilo/mensaje, 20 niveles de anidación MIME y 100 partes; HTML no se presenta ni se ejecuta. El mensaje se muestra como texto escapado y debe tratarse como evidencia no confiable, nunca como instrucciones para el sistema. Los PDFs se validan por tipo, tamaño y firma `%PDF-`, pero este incremento no incluye antivirus, análisis de malware ni sanitización de contenido activo.

La tabla privada `gmail_inbound_messages` queda con RLS habilitado y sin acceso directo de cliente: el servidor valida propietario, proyecto, propuesta, versión y entrega. La unicidad por propietario, buzón y `messageId` hace idempotente la sincronización. Se guarda el texto plano acotado (máximo 50 KB), hashes y encabezados necesarios; no se guarda el cuerpo HTML ni bytes de adjuntos durante la sincronización. Los adjuntos PDF pueden importarse individualmente mediante el almacenamiento privado de documentos existente, que vuelve a comprobar tipo, tamaño y firma PDF. El documento importado no se asocia como fuente de revisión hasta que termina su extracción.

Al usar una respuesta como feedback, el RPC vuelve a comprobar bajo bloqueo que el mensaje pertenece al mismo propietario/proyecto/propuesta, está vinculado a la revisión enviada vigente y aún no fue consumido. La revisión conserva `feedback_email_id`; si se importó un PDF y su extracción está lista, también puede conservarlo como fuente/documento. Para respuestas solo de prosa se usa el email guardado como evidencia; no se inventa un PDF. Si el cuerpo supera los 4.000 caracteres del campo editable, la interfaz conserva el email completo y pide resumirlo para la nota de feedback.

La retención automática todavía no está implementada y **bloquea la habilitación en producción**. Propuesta para decidir con producto/legal: conservar la evidencia mientras el proyecto siga activo y eliminarla al borrar el proyecto; además fijar un plazo máximo tras el cierre (recomendación inicial: 12 meses), con un mecanismo de eliminación verificable. La política y su plazo deben cubrir los mensajes, documentos importados y respaldos.

La limitación de frecuencia y exclusión mutua actual vive en memoria del proceso API: hay un lock por propietario/proyecto y una ventana de 30 segundos. No coordina varias instancias o workers; producción requiere enforcement compartido/persistente, no solo este lock local.

**Este incremento no está habilitado ni verificado en Google para producción.** No se ha iniciado OAuth ni se han hecho llamadas externas en esta implementación. Antes de exponer el flujo a usuarios reales hay que aprobar la pantalla de consentimiento, verificar la aplicación y completar cualquier evaluación de seguridad requerida por Google para `gmail.readonly`, implementar y revisar la política de retención/borrado, y mover la limitación por propietario/proyecto a coordinación compartida. La autorización previa de `gmail.send` no cubre el nuevo permiso restringido; también se debe evaluar el control de malware de PDFs antes de permitir su uso en producción.

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

### Respuestas y adjuntos: correcciones del 31/10/2026

La lista de respuestas entrega `reply_text` para presentar la respuesta sin el bloque final de conversación citado por Gmail (cabeceras ES/EN). `body_text` y su hash se conservan completos como evidencia. El feedback usa el texto de respuesta; esta separación es determinista y no ejecuta IA.

Los identificadores de adjuntos admiten hasta 2048 caracteres ASCII de URL segura, separados del límite de 256 del ID de mensaje. El correo de prueba contenía un ID de adjunto de 404 caracteres: el límite anterior lo omitía. Un identificador inválido ahora produce un error explícito.

Una búsqueda explícita vuelve a comprobar hasta 25 mensajes conocidos con adjuntos, además del límite existente de 25 respuestas nuevas. La migración `20261031103500_gmail_missing_attachment_metadata.sql` permite completar una lista de adjuntos vacía mediante el mismo comando validado e idempotente, conservando fila, texto y hash. No reemplaza metadatos existentes ni modifica respuestas usadas; mantiene los controles de propietario, versión actual, envío y cambio sin finalizar.

La interfaz permite abrir y descargar un PDF adjunto mediante la ruta autenticada existente, antes de importarlo. La vista previa no añade documentos ni inicia extracción. Los archivos siguen sujetos a los límites y validaciones existentes; no se presenta HTML del correo.

### Validación local de la entrega, 31/10/2026

El usuario validó el ciclo de renegociación con respuestas reales del buzón de prueba y nuevas versiones de adenda. Se verificó la persistencia en trato-dev y la lectura de un adjunto PDF real de 4933 bytes; recuperar sus metadatos conservó la misma fila, el cuerpo original y su hash. Esto actualiza las afirmaciones históricas de este documento sobre pruebas todavía sin llamadas a Google. La habilitación para producción continúa fuera de esta entrega.
