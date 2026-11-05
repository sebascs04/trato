# Confirmación de cuenta e inicio automático

4 de noviembre de 2026. El retorno de confirmación se captura antes de que la navegación normalice el hash a Inicio. Los tokens se retiran de la URL y quedan en memoria hasta verificar la identidad con Supabase /auth/v1/user. Solo entonces se guardan y se solicita el espacio privado al backend.

El registro envía redirect_to con location.origin, sin añadir barra ni ruta: coincide con las dos entradas que el responsable del proyecto confirmó en Redirect URLs, http://localhost:5173 y https://trato-web-68896425401.us-central1.run.app. No cambiar Site URL para probar local.

La confirmación tiene type=signup. Un enlace vencido, incompleto o rechazado no abre el espacio ni utiliza silenciosamente una sesión antigua. Los mensajes tienen ES/EN. Los tokens no se imprimen, no se envían como query ni se aceptan como identidad sin verificación del servidor.

Las pruebas de código cubren captura, limpieza de URL, validación del usuario, rechazo de tokens inválidos, ausencia de fallback a otra cuenta y orden de carga de datos privados. No sustituyen una prueba desde la interfaz por el responsable del proyecto.

Los enlaces emitidos antes del ajuste mantienen su dirección original y pueden haberse consumido. Probar el recorrido nuevo desde la interfaz local recién recargada y con un correo de prueba distinto. La web publicada recibirá el cambio solo mediante un despliegue autorizado.

## Prueba manual confirmada por el responsable del proyecto

4 de noviembre de 2026: el responsable del proyecto confirmó que el recorrido desde la interfaz local funciona: alta desde la pantalla, recepción de confirmación, enlace de vuelta a localhost e inicio de sesión automático en Inicio. Esta validación corresponde al registro; no acredita por sí sola envíos de adendas, detección de respuestas o pagos.

## Correo ya registrado

El formulario muestra «Esta cuenta ya existe. Inicia sesión» cuando Auth devuelve un código explícito de duplicado o su respuesta de alta repetida con identities vacío. Se comprobó este último formato en el proyecto con la cuenta compartida ya confirmada. No se consulta un listado público de usuarios ni se interpreta un error de conexión como cuenta existente. Los registros nuevos conservan su confirmación de correo.
