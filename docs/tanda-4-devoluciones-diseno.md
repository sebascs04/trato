# Tanda 4: PDF, envío y aceptación del cierre

Estado al 2 de noviembre de 2026: diseño y ampliación multipago aprobados por el usuario; implementados y verificados localmente. Ver `tanda-4-devoluciones-validacion.md`. La revisión de código siguiente conserva el diagnóstico previo al cambio. Migraciones compartidas y prueba real de Gmail pendientes.

## Objetivo

Completar el cierre documental de TRATO-14 y su interfaz de TRATO-16: PDF privado de la propuesta exacta, revisión humana, vista previa y envío explícito por Gmail, respuesta del cliente y aceptación de la versión correspondiente. Sin IA ni ejecución de reembolsos. Los expedientes de importe positivo aceptados quedan pendientes de autorización financiera en tanda 5; importe cero aceptado cierra este expediente sin devolver dinero.

## Revisión del código

- `proposals/pdf.py` genera PDFs con ReportLab, fuente local, bytes deterministas y control de hash; guarda el archivo privado y devuelve el original almacenado cuando ya existe. Reutilizar utilidades de representación/almacenamiento, sin presentar el cierre como otra revisión de la adenda pagada.
- `proposals/workflow.py` calcula un digest de la vista previa, reserva el envío antes de llamar a Gmail, valida el remitente conectado y conserva un resultado incierto sin reenviar automáticamente.
- `gmail/service.py` limita endpoints y permisos; su envío actualmente selecciona plantillas de adenda o cobro. Añadir un envío específico de cierre mediante DTO del servidor, sin permitir correo arbitrario enviado desde HTTP ni introducir SMTP como respaldo.
- La lectura de respuestas de propuestas está vinculada a `proposal_deliveries`: devolución necesita un vínculo propio. Reutilizar el transporte y las validaciones de participantes, hilo y RFC Message-ID, sin atribuir una respuesta al expediente incorrecto.
- Las instantáneas de devolución son inmutables y la edición SQL solo admite `draft`. Faltan tablas de archivos, revisión humana, envíos, respuestas y aceptación; faltan transiciones después de enviar.
- La biblioteca de documentos reconoce enlaces a propuestas de cambio. Deberá reconocer también documentos de devolución para no mostrarlos como adendas del cambio pagado ni archivos sin relación.

## Sección A — Persistencia y transiciones

Crear una migración nueva para artefactos PDF por instantánea, revisión humana, envíos/intentos, respuestas vinculadas y aceptación documental. FK compuestas, RLS y permisos mínimos. Las operaciones internas de envío se ejecutan solo desde el servidor; un cliente HTTP no puede declarar un envío como completado ni falsificar resultados de Gmail.

Cada envío y aceptación referencia expediente, snapshot y PDF/hash exactos. La aceptación conserva evidencia, actor revisor, notas y método documental; no afirma firma criptográfica. Un envío incierto bloquea la edición y una segunda identidad de envío hasta revisión/conciliación; una respuesta de Gmail no acepta automáticamente.

La creación de nuevas versiones tras envío requiere feedback real vinculado a la versión enviada. Si hay una aceptación registrada, no se permite revocarla o sustituirla unilateralmente por una versión nueva. Todos los comandos comparan la cabeza esperada bajo bloqueo del proyecto/expediente y conservan idempotencia. Una reserva y su finalización no mantienen una transacción DB abierta durante HTTP.

## Sección B — PDF privado exacto

Generar la propuesta de cierre con proyecto, cliente, referencia al pago, versión, desglose, conceptos y su evidencia, importe propuesto y condiciones. No convertir comisión o remanente desconocidos en cero. Indicar que el documento no acredita por sí solo un reembolso ejecutado.

Elegir explícitamente idioma ES/EN al reservar el primer PDF de una instantánea; conservarlo junto con la plantilla, metadatos y hash. El idioma de la interfaz después no regenera ni traduce el archivo ya guardado. No traducir nombres, condiciones aportadas, documentos ni citas. No inferir idioma desde un documento.

Una edición antes de enviar crea otra instantánea interna de la misma versión pública y puede generar otro archivo con ruta propia. Nunca sobrescribir el PDF anterior. Los nombres y referencias usados para representar el PDF se fijan en el artefacto; no cambiar sus bytes por renombrar después un cliente/proyecto. La descarga verifica hash. Los documentos se relacionan explícitamente con su expediente en la biblioteca.

## Sección C — Revisión, vista previa y envío

El usuario ve/descarga el PDF y confirma su revisión. La vista previa muestra remitente, destinatario del cliente, asunto, cuerpo y adjunto exactos. Su digest incluye instantánea, contenido del mensaje, destinatario/remitente, idioma y hash del PDF. Si algo cambia, exigir revisar otra vista previa.

Enviar solo mediante acción explícita y conexión Gmail existente, conservando idempotencia, participante, RFC Message-ID, provider message/thread ID y resultado. Un éxito de Gmail indica que Gmail aceptó el envío, no que el cliente lo leyó. Fallo o incertidumbre quedan visibles, sin respuesta ficticia, transporte alternativo ni reintento automático. Un fallo definitivo solo admite un reintento explícito controlado; una incertidumbre requiere comprobar el envío antes de repetir.

Cambiar de cuenta o proyecto mientras llega una respuesta no debe actualizar otra pantalla. El remitente se revalida antes de enviar; no alterar OAuth, secretos ni callbacks de Gmail.

## Sección D — Respuesta, ajustes y aceptación

Consultar respuestas de Gmail bajo demanda y con permiso de lectura vigente, deduplicando por identidad del mensaje y comprobando hilo, participantes y referencias al envío exacto. Conservar correo completo como evidencia y mostrar por separado la respuesta sin conversación anterior citada. No promover texto citado antiguo a aceptación de una versión nueva.

Permitir evidencia documental aportada manualmente, vinculada por el usuario al envío y versión correctos. Un PDF de aceptación revisado manualmente conserva sus bytes/hash aunque sea escaneado; no inventar OCR ni certificación de firma. Las fuentes textuales que se usen para preparar otra revisión sí deben haber terminado su extracción. Adjuntos importados no se vuelven fuentes automáticamente antes de su lectura.

La acción explícita de registrar ajustes conserva feedback, versión de origen y respaldo; habilita v2 como borrador. V1 y su PDF siguen de consulta. V2 necesita revisión, envío y aceptación propios.

La aceptación exige versión vigente enviada y evidencia revisada por humano. Un mensaje o un PDF subido no la registra por sí solo. Importe positivo: estado `accepted`, sin PayPal. Importe cero: `closed_without_refund`, con historial conservado. En alcance individual libera el cupo de pedido; en cierre global marca el proyecto cerrado y bloquea nuevos pedidos. Un saldo adicional propuesto requiere un cobro independiente; este paso no crea ni acredita ese cobro.

## Sección E — Interfaz, documentos e historial

Añadir a `refund-workspace.mjs/css` acciones de PDF, revisión, correo, consulta de respuestas, registro de aceptación y nueva versión por ajustes. Mantener instantáneas anteriores accesibles sin confundirlas con versiones públicas enviadas. Deshabilitar edición/cierre donde el backend lo prohíbe; mostrar errores e incertidumbres con acción de consulta.

Ampliar API/repositorio de devoluciones y el DTO/biblioteca de Documentos para sus relaciones propias. Las descargas y adjuntos siguen privados por propietario/proyecto. No asociar estos archivos a la propuesta pagada original para reutilizar sus botones. Conservar metadatos y eventos necesarios para la futura proyección al historial único; no añadir una segunda lista de estados financieros ni afirmar recepción/aceptación/pago sin evidencia.

Todos los textos nuevos, errores y ayudas accesibles tendrán ES/EN. Mantener Lucide y acciones principales con texto. No introducir actividad de IA en un flujo sin IA.

## Archivos previstos

- Nueva migración SQL y pruebas en `repos/trato-api/supabase/`.
- Nuevos módulos `trato_api/refunds/pdf.py` y `workflow.py`; ampliación de dominio, repositorio y rutas de devoluciones.
- Extensión limitada de envío/lectura en Gmail y plantillas, con regresión de adendas/cobros. No refactorizar de forma amplia los flujos ya existentes.
- Biblioteca de documentos/referencias en `persistence.py` y frontend; integración y recursos de módulos nuevos cuando corresponda.
- Catálogos ES/EN, tests de dominio/API/SQL/PDF/correo y navegador; documentación y backlog.

## Verificación y límites

1. PDF: consistencia de importes, contenido y citas; determinismo, hash almacenado, acceso privado y archivos anteriores inmutables. Cambio de idioma o nombre no sobrescribe un archivo ya generado.
2. SQL/API: propietario/proyecto, fuentes cruzadas, edición obsoleta, revisión del PDF exacto, estado enviado/aceptado inmutable, feedback inexistente/ajeno, nueva versión sin heredar aceptación, cero y liberación de cupo, invocación directa de comandos internos denegada.
3. Envío con transporte doble: digest cambiado, remitente cambiado, destinatario correcto, doble clic, llamadas simultáneas, fallo definitivo e incertidumbre sin reenvío automático. No convertir una confirmación de Gmail en lectura del cliente.
4. Respuestas: hilo o participante incorrectos, correo repetido, referencias ambiguas, texto citado, adjunto no leído y evidencia de otra versión. Revisar aceptación siempre manualmente.
5. Navegador: PDF/vista previa, envío explícito con API doblada, ajustes v1→v2, consulta de versión anterior y aceptación de la nueva; importe cero; recarga y respuestas tardías; ES/EN y móvil. Regresión de propuestas de cambio, Gmail y biblioteca de documentos.

Las pruebas locales usan fixtures y transportes dobles identificados; no sustituyen al funcionamiento conectado ante un error. Las migraciones siguen pendientes de despliegue coordinado. Cualquier prueba de envío Gmail real requiere destinatario concreto y autorización de esa acción. Esta aprobación de código no autoriza envíos a personas, llamadas financieras, push, PR ni merge.

Los recursos temporales de pruebas se detienen y eliminan después de documentar resultados, conforme a la preferencia del usuario. Si falta Chromium nuevamente tras su eliminación, informar y gestionar su instalación temporal para pruebas; no presentar validaciones no ejecutadas como aprobadas.

## Salida de la tanda

Propuesta de cierre enviada y aceptación de su versión exacta trazables mediante contratos y pruebas; errores visibles y ausencia de cobro/reembolso automático. Presentar evidencia y detenerse para revisión del usuario antes de tanda 5. El recorrido financiero Sandbox completo se verifica en tanda 7.
