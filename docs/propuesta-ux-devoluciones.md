# Propuesta de UX para devoluciones conectadas

Fecha: 3 de noviembre de 2026. Estado: propuesta aprobada e implementada localmente; pendiente de recorrido visual por el usuario.

## Problema observado y alcance

El recorrido principal permitió devolver USD 18 en PayPal Sandbox. Esa evidencia valida ese caso financiero, no todas las variantes ni la facilidad de uso. El usuario necesitó acompañamiento para elegir acciones, interpretar conceptos y distinguir una revisión documental de una autorización financiera.

La mejora debe permitir que una persona continúe con una sola acción principal visible, sepa qué falta y entienda cuándo se envía un correo o se devuelve dinero. Mantener las validaciones del servidor, la evidencia original, las versiones, la idempotencia y las confirmaciones explícitas. Sin IA para clasificar una aceptación ni sustituciones ante errores.

## Hallazgos del código

- `refund-workspace.mjs`, `detailHtml`: concatena conceptos, fuentes, editor, instantáneas, documentos, finanzas y cierre por retiro/rechazo. No existe una etapa principal que ordene qué debe hacer el usuario.
- `refund-documents.mjs`, `renderRefundDocuments`: agrupa generar/abrir PDF, revisión, correo, consulta de respuestas, ajustes y aceptación. Las acciones se habilitan por estado, pero no explican un siguiente paso único.
- La respuesta se muestra junto con sus adjuntos mediante párrafos y botones en línea. `refund-workspace.css` no define un diseño específico de `.refund-response` o de sus acciones. Esto explica la falta de separación; el solapamiento concreto requiere inspección visual antes de atribuirlo a una regla CSS determinada.
- `refund-preview.css` y `refund-workspace.css` comparten selectores como `.refund-evidence`. Los estilos del ejemplo pueden afectar el recorrido conectado. Aislar sus selectores.
- `refund-finance.mjs`: su sección principal y su formulario de confirmación renderizan ambos los hechos de la comprobación, duplicando capturas, comisiones y fuentes.
- `trato_api/gmail/service.py`, `reply_text`: solo elimina un bloque final con líneas `>` y algunas cabeceras ES/EN. Un correo con otra forma de cita puede devolver el cuerpo completo.
- `message_content` reúne las partes `text/plain`; no extrae una respuesta HTML independiente. `refunds/repository.py` calcula `reply_text` sobre el cuerpo preservado. La vista usa ese texto, pero no sabe si la separación fue concluyente.
- `connected-workspace.mjs`, `show`: cierra y reemplaza el diálogo compartido. Usar sin adaptación ese mismo diálogo para el asistente, un PDF y la subida de evidencia perdería el contexto de navegación/formulario.
- `refund-preview.mjs` ya aporta una referencia visual de etapas en modal. Reutilizar su lenguaje visual, manteniendo sus datos simulados y sus llamadas separados del flujo conectado.

## Recorrido propuesto: un asistente con seis etapas

Desde la lista se abre **Gestionar devolución**. Un expediente existente ofrece **Continuar devolución**, directamente en la etapa pendiente obtenida del servidor. La lista permanece como resumen de estado, importe y siguiente acción.

| Etapa | Lo que ve y decide la persona | Acción principal |
| --- | --- | --- |
| 1. Solicitud | Cerrar el proyecto o devolver un cobro, motivo y respaldo. Cobros con nombres e importes comprensibles. | Guardar solicitud y continuar |
| 2. Propuesta | Qué parte se conserva y por qué; condiciones y fuentes. Total a devolver siempre visible. Reparto calculado automáticamente. | Guardar propuesta y continuar |
| 3. Revisar y enviar | PDF exacto, destinatario y texto del correo, dentro de la misma etapa. Primero confirmar revisión del PDF; después confirmar envío. | Confirmar revisión → Enviar propuesta |
| 4. Respuesta del cliente | Estado de espera, última consulta y resultado. Texto de respuesta separado del mensaje citado; adjuntos en su propia zona. La persona revisa aceptación o ajustes. | Consultar respuestas → Registrar aceptación o ajustes |
| 5. Autorizar devolución | Importe aceptado y resultado de la consulta a PayPal. Capturas y comisiones en un único detalle desplegable. | Comprobar disponibilidad → Autorizar importes |
| 6. Ejecutar y resultado | Confirmación final con importe y destinatario; después, estado confirmado/pendiente de cada cobro y cierre del proyecto cuando corresponda. | Ejecutar devolución de USD X → Ver resultado |

Las flechas de esta tabla expresan acciones sucesivas dentro de una etapa, no un botón que las ejecute todas. Navegar o abrir una etapa no genera envíos, aceptaciones, autorizaciones ni reembolsos. La autorización y la ejecución siguen separadas.

## Organización de la modal

- Diálogo amplio en escritorio, aproximadamente 960 px, con cabecera de proyecto/cliente, etapas y resumen «Cliente recibirá USD 18».
- Cuerpo con una sola tarea activa; fuentes, historial y comprobaciones técnicas se consultan mediante paneles secundarios plegables.
- Pie visible con Volver, Guardar y salir cuando corresponda, y la acción principal específica. Evitar el genérico «Continuar» en acciones con efectos externos.
- En móvil, presentación de pantalla completa y progreso «Paso 2 de 6»; sin desplazamiento horizontal ni múltiples capas de diálogos.
- PDF y evidencias en una zona de lectura del propio asistente, con retorno al formulario sin borrarlo. La subida debe conservar el estado del paso y la fuente seleccionada.
- Al cerrar con cambios sin guardar, ofrecer guardar borrador o conservar la edición mientras siga abierta la sesión. No prometer persistencia que el servidor no confirmó. Al reabrir, recuperar el expediente y sus operaciones desde el servidor.
- Nunca restaurar un checkbox financiero como consentimiento nuevo. Tras timeout o recarga, consultar la operación existente; ninguna reejecución automática.
- Foco contenido en el diálogo, títulos accesibles, navegación por teclado y errores junto al campo. ES/EN y Lucide conforme al proyecto.

## Respuesta de Gmail

La tarjeta debe presentar, en este orden:

1. Remitente, fecha y propuesta a la que responde.
2. Respuesta nueva del cliente, sin el texto anterior cuando pueda separarse de forma fiable.
3. «Ver correo completo», plegado, con el contenido preservado.
4. Adjuntos en filas independientes: nombre, formato, tamaño y acciones con texto que se ajusten al ancho disponible.
5. Acción contextual «Revisar aceptación» o «Registrar ajustes», elegida por la persona. No inferir aceptación automáticamente.

No cortar por una palabra genérica como «De:» o «El» que pueda pertenecer a la respuesta. Mejorar la separación mediante estructura MIME/HTML y delimitadores de citas reconocibles. Conservar siempre cuerpo y mensaje originales. Cuando no se pueda separar con confianza, mostrar un aviso y el correo completo para revisión, sin ocultar texto ni presentar una extracción incierta como exacta.

Consultar respuestas debe informar actividad en curso, cantidad nueva y total disponible, además de un estado vacío comprensible. La revisión puede iniciarse desde la tarjeta con esa respuesta ya seleccionada, evitando volver a buscarla en un selector.

«Importar PDF» pasaría a «Usar como respaldo» y mostraría claramente el resultado. «Ver» o «Descargar» dependerá de la capacidad real; no llamar vista previa a una descarga. Mantener estas acciones fuera del área de texto y desactivar duplicados mientras una importación está en curso.

## Menos carga y términos más claros

- Explicar «Trabajo reconocido» como «Trabajo realizado que conservarás». La penalidad es opcional y requiere respaldo; nunca preseleccionarla como consecuencia automática de cancelar.
- Resumen de tres líneas: recibido, retenciones/ajustes y devolución. Las comisiones del proveedor son un detalle separado, sin modificar el importe aceptado.
- Historial de borradores, UUID, hashes, fuentes de políticas y detalles de intentos en consulta secundaria. El PDF exacto y la evidencia siguen disponibles.
- Mostrar una sola comprobación financiera. Si caduca o falla, explicar qué ocurrió y ofrecer comprobar nuevamente; no permitir ejecutar sobre datos supuestos.
- «Retirar o rechazar solicitud» en un menú de otras acciones, con explicación y confirmación propias. No mezclarlo visualmente con el cierre exitoso del proyecto.
- El recorrido de ejemplo se accede desde ayuda/lista; no aparece junto a las acciones del expediente conectado.

## Etapas derivadas de hechos reales

No basta con mantener un número de paso en memoria. Derivar la etapa de solicitud, snapshot actual, PDF, revisión, envío, respuesta revisada, aceptación, autorización y operaciones financieras.

- Borrador guardado puede volver a editarse; conserva v1 e instantáneas internas.
- Enviado permite consultar, no editar el contenido histórico.
- Ajustes revisados reabren la preparación de una versión nueva con su propio envío y aceptación.
- Cero a devolver termina documentalmente, sin mostrar un checkout o ejecución financiera.
- Devolución individual conserva abierto el proyecto.
- Parcialmente confirmado muestra cada resultado y el saldo pendiente; jamás reinicia un cobro ya completado.
- Incertidumbre muestra «Estamos comprobando el resultado» y una consulta explícita. Replay, aplicación externa y nueva autorización permanecen en una recuperación guiada con sus requisitos reales.

## Orden de implementación propuesto

1. Corregir respuesta/citas y composición de adjuntos; aislar estilos y quitar la duplicación de comprobaciones. Estas mejoras son necesarias también dentro de la futura modal.
2. Crear el contenedor del asistente y el cálculo de etapa a partir del expediente. Resolver PDF/subidas y conservación del formulario antes de migrar las pantallas.
3. Integrar solicitud y propuesta con resumen constante, campos progresivos y evidencia contextual.
4. Integrar revisión/envío y respuesta/aceptación, con todas las confirmaciones explícitas y estados de espera.
5. Integrar autorización y ejecución, incluyendo cero, parciales, errores y recuperación. Resultado e historial legibles.

Antes de implementar, revisar y aprobar este diseño. La comprobación posterior debe centrarse en el recorrido conectado, reapertura del asistente, seguridad de las confirmaciones y tamaños de pantalla; no repetir por defecto todas las suites financieras.

## Criterio de entrega

Un usuario puede completar el caso principal sin una guía externa: cada pantalla indica dónde está, qué falta, cuál es el siguiente paso y si la acción enviará un correo, guardará un registro o devolverá dinero. Los pasos financieros conservan confirmación explícita, las respuestas no quedan tapadas por botones y la interfaz puede retomarse sin duplicar operaciones.

## Entrega local para la segunda prueba

- Asistente conectado en diálogo propio con seis etapas, navegación a etapas anteriores, resumen de importe y ayudas según la etapa. El paso pendiente se obtiene del expediente, snapshot, aceptación y autorización reales; las operaciones siguen usando las rutas existentes.
- El PDF se consulta en el propio asistente. Las evidencias abren un selector dedicado conservando el formulario en memoria. La carga común de documentos suspende el asistente y vuelve al mismo paso al cerrar la ventana de carga, evitando dos diálogos superpuestos.
- Cerrar permite retomar la edición durante la misma sesión; el texto visible indica que es necesario guardar antes de recargar o salir. No se añadió guardado automático al servidor. Las confirmaciones financieras se descartan al cerrar o cambiar de etapa y no se ejecuta dinero por navegación.
- Respuestas en tarjetas con texto, correo completo plegado, adjuntos en filas y acciones separadas. La revisión de aceptación/ajustes puede abrirse con la respuesta ya seleccionada. Importar un PDF muestra «Usar como respaldo» y conserva la revisión humana posterior.
- Vista de respuesta derivada de MIME/HTML preservado cuando hay bloques de citas reconocibles; mejora de delimitadores de respuesta ES/EN. El cuerpo y mensaje originales se conservan. Se avisa si se detecta texto citado que no pudo separarse con certeza. No se usa IA ni se registra aceptación automáticamente.
- Desglose financiero renderizado una sola vez durante la confirmación; detalles técnicos e historial plegados. Estilos del ejemplo aislados para no aplicarse a las evidencias del flujo conectado.
- Retiro/rechazo dentro de otras acciones y recorrido de ejemplo fuera del diálogo conectado. Interfaz ES/EN y disposición adaptable a móvil.

Comprobaciones realizadas: sintaxis JavaScript mediante `npm run check`, compilación Python de los módulos modificados y paridad de 1.823 traducciones ES/EN. Web, API y procesador reiniciados y comprobados con HTTP 200. No se ejecutaron nuevos cobros, reembolsos ni envíos de correo ni una repetición de las suites financieras. La inspección visual y el recorrido completo de esta interfaz siguen pendientes de la prueba solicitada por el usuario. El túnel público continúa apagado.
