# Correo central de Trato

Decisión del responsable del proyecto, 4 de noviembre de 2026: Trato envía adendas y cobros desde su buzón central, recibe allí las respuestas y las presenta en el proyecto. Sustituye la propuesta de exigir Gmail antes de crear la cuenta.

## Registro e identidades

Cualquier proveedor de correo sirve para registrarse y recibir la confirmación de Supabase. No se piden permisos sobre el buzón personal del freelancer ni del destinatario. Se conserva correo/contraseña y confirmación SMTP con la plantilla de Trato.

El equipo autoriza una vez el buzón central mediante Google OAuth con envío y lectura. La cuenta de administración del buzón se fija mediante UUID verificado por backend; no se obtiene de formularios ni user_metadata. El servicio valida que Google confirme el correo central configurado antes de guardar sus credenciales.

## Configuración explícita

- GMAIL_DELIVERY_MODE=trato: usa exclusivamente el buzón central. personal conserva el modo anterior en instalaciones aún no migradas; no es un fallback.
- GMAIL_TRATO_ACCOUNT_OWNER: UUID Supabase de la cuenta del equipo autorizada a conectar/desconectar el buzón.
- GMAIL_TRATO_ACCOUNT_EMAIL: dirección del buzón central.
- Se reutilizan GOOGLE_GMAIL_CLIENT_ID/SECRET/REDIRECT_URI, GMAIL_TOKEN_ENCRYPTION_KEY y GMAIL_VAULT_PATH. El SMTP de Supabase es independiente.


Para autorizar el buzón central en cada instalación, la administración entra con la cuenta compartida y elija Conectar el correo de Trato en Perfil. Elegir exactamente el Gmail central del proyecto. El cliente OAuth de Google debe permitir esa cuenta (usuario de prueba si sigue en modo de pruebas).

## Envío y seguimiento del responsable de cambios y devoluciones

El usuario revisa y autoriza cada envío. ProposalWorkflow conserva el propietario de negocio, proyecto, cliente, revisión, outbox e idempotencia. Solo las credenciales del transporte se resuelven contra el buzón central.

Se conservan Gmail message ID, thread ID y Message-ID RFC vinculados al envío. La búsqueda recibe únicamente los hilos que el backend autoriza para ese propietario/proyecto, valida el remitente del envío original, destinatario, remitente de la respuesta y References/In-Reply-To antes de guardar. No se identifica un proyecto por el asunto o por el correo del cliente solamente.

Un usuario normal puede consultar la disponibilidad y enviar a través del flujo autorizado, pero no obtener tokens, sustituir la cuenta central ni desconectarla. El perfil muestra Correo de Trato; los controles administrativos aparecen solo para la identidad configurada.

Los mensajes históricos y documentos guardados permanecen. Los hilos enviados desde buzones personales anteriores no pasan a existir en el buzón central: no se cambia de transporte automáticamente ni se inventan respuestas. La consulta de esas fuentes requiere conservar explícitamente la instalación anterior o una migración acordada; no se ha ejecutado una migración histórica.

## Presentación de correos

Los correos de propuesta y cobro comparten marca Trato, mascota, tarjetas y botón de acción. El texto plano, destinatarios, importes, fechas, PDF exacto, hashes e identificadores se conservan. El cobro sigue identificado como Sandbox y su enlace se valida contra PayPal Sandbox. La devolución conserva su implementación del responsable de cambios y devoluciones.

## Validación y publicación

Pruebas de permiso administrativo, identidad de Google, ausencia de fallback personal, destinatario Outlook, contratos de envío, pertenencia de respuestas al proyecto y conservación de PDFs. No se hicieron nuevas pruebas desde la interfaz, envíos reales de adendas, cobros o cambios de permisos en Google por cuenta del usuario.

El entorno local se actualizará con este modo. No hay push, PR ni deploy implícitos. Para producción, configurar el modo y autorizar el buzón en su propio vault; no copiar tokens o archivos privados a Git. No se deshabilitaron las altas públicas de Supabase: con este diseño vuelve a ser correcto el registro normal con confirmación de correo.

## Google en modo de pruebas

Si aparece 403 access_denied indicando que la app sigue en pruebas, añadir el Gmail central a Google Auth Platform > Audience > Test users del proyecto OAuth configurado. No es un permiso que deban conceder los usuarios de Trato. El consentimiento del equipo no puede omitirse. En Testing, Google caduca la autorización y su refresh token a los siete días; revisar su vigencia durante la evaluación y renovar explícitamente cuando corresponda. Referencia: https://support.google.com/cloud/answer/15549945

La app detecta si se cierra la ventana de autorización y permite reintentar, sin esperar diez minutos. Una vez autorizado el buzón, el servicio renueva los access tokens con el refresh token mientras este siga válido. El envío conserva la revisión explícita del freelancer.

## Preparación para la evaluación y el despliegue

La configuración local conectada no equivale a autorización en la instalación publicada. prepare.py copia las tres variables del modo central y valida su identidad/dirección. Compose conserva el vault en el volumen propio gmail, montado en /var/lib/trato/gmail, y conserva la clave de cifrado en la configuración privada. No reemplazar esa clave al recrear contenedores ni borrar el volumen.

El bundle establece GOOGLE_GMAIL_REDIRECT_URI con el origen HTTPS publicado. La URI ya configurada para Trato es https://trato-web-68896425401.us-central1.run.app/gmail-callback.html. Tras desplegar el código y configuración nuevos, autorizar el buzón central desde el perfil de la cuenta de administración en la web publicada. Los evaluadores no necesitan conectar Gmail.

El servicio ya renueva access tokens antes de usarlos cuando faltan menos de 60 segundos para su vencimiento. No hace falta un cron para renovarlos. Un refresh token revocado o caducado no puede recuperarse con un trabajo automático: requiere nuevo consentimiento. Los fallos temporales no se presentan como éxito ni se sustituyen por otro buzón.

Para evitar la caducidad de siete días propia de Testing, revisar Google Auth Platform > Audience > Publishing status y la opción In production. Cambiar ese estado no despliega código de Trato ni garantiza que Google dispense de verificación para los scopes solicitados. Si se cambia, emitir una autorización nueva del buzón y comprobar las condiciones vigentes; no asumir que el token anterior de Testing ganó duración ilimitada.

No se cambió el estado OAuth ni se publicó la aplicación desde este trabajo. Referencias oficiales:
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/identity/protocols/oauth2/web-server#offline
- https://support.google.com/cloud/answer/13464323

## Revisión de integración con el MVP de cambios — 4 de noviembre

La rama de trabajo del MVP incorporó main d740d30 conservando los cambios locales. Se mantiene el propietario del envío mientras el transporte resuelve las credenciales del buzón central; el agente prepara campos, y guardar/enviar continúa siendo una acción humana en el flujo existente. Devoluciones manuales conserva ese mismo servicio de transporte, aunque su agente esté deshabilitado.

Se corrigieron dos defectos reproducidos con transporte de pruebas: comparación del remitente sensible a mayúsculas que rechazaba la misma dirección, y aceptación de respuestas a otra revisión por encontrar una referencia ancestral. Se conserva la identidad/dirección guardada y se valida el destino inmediato de la respuesta (In-Reply-To o última References cuando no hay cabecera directa), como en devoluciones. Se añadieron seis regresiones; 45 pruebas de envío/recepción/devolución manual aprobadas sin correos reales ni cambios OAuth.

La configuración privada del entorno de esta revisión todavía usa GMAIL_DELIVERY_MODE=personal y no contiene GMAIL_TRATO_ACCOUNT_OWNER/EMAIL. Esto no acredita disponibilidad del correo central local: hay que indicar sus identidades, configurar explícitamente trato y autorizar el buzón desde su cuenta administradora. No se eligió una cuenta por inferencia ni se copiaron tokens o datos privados. Tampoco se probó un envío central real ni se migraron hilos personales históricos.

Después de recibir las identidades indicadas por el responsable, se verificó la cuenta administradora directamente en Supabase Auth: UUID único, correo confirmado, activa y no anónima. Se configuró el entorno privado local en modo trato con ese UUID y el buzón solicitado, conservando un respaldo privado. La validación de configuración pasó. El vault local no tiene autorización de ese buzón (sin permisos de envío/lectura guardados); la administración debe completar Conectar el correo de Trato en Perfil y consentir con la cuenta central. Esto no acredita un envío/recepción reales ni configuración del entorno publicado. No se solicitó contraseña ni se publicaron identidades o credenciales en este documento.

Comprobaciones finales de la actualización: 435 pruebas API, 121 frontend aprobadas; worker 187 ejecutadas (176 aprobadas y 11 omitidas); sintaxis, 3196 claves ES/EN y diff --check aprobados. La prueba de portada se actualizó al intervalo de cuatro segundos ya cambiado en main, conservando su comprobación de pausa/navegación. Se mantuvo el stash de respaldo del MVP; los conflictos del backlog y package.json quedaron resueltos sin descartar funciones de main o del agente. No se publicó la rama ni se creó un PR.
