# Instrucciones del proyecto Trato

## Estándar de prompts

- Los prompts de agentes deben seguir `docs/estandar-prompts.md`, adaptado de la guía compartida por Sebastian en QAMAQ.
- No imponer un límite fijo de 5.000 caracteres: la extensión depende de la responsabilidad del agente, sin redundancia.
- No modificar archivos de QAMAQ para aplicar este estándar en Trato.

## Aislamiento de QAMAQ

- Los puertos locales de Trato están fijados en `local-ports.json` y documentados en `docs/puertos-locales.md`. Consultar ambos antes de iniciar o añadir servicios.
- Antes de arrancar un servicio o publicar un puerto de Docker, revisar listeners y contenedores existentes. Si hay conflicto, detener el arranque e informar; nunca matar procesos ajenos ni elegir otro puerto automáticamente.
- No detener, reiniciar ni modificar procesos, contenedores, redes, volúmenes, configuración o datos de QAMAQ desde este proyecto.
- Todo futuro Docker Compose de Trato debe usar proyecto `trato`, redes y volúmenes propios. No reutilizar Redis, Weaviate, bases de datos, índices, buckets ni credenciales de QAMAQ. No ejecutar limpiezas globales de Docker.
- Las reservas Redis/Weaviate no significan que estén desplegados o conectados. Revisar disponibilidad nuevamente antes de iniciarlos.

## Sin fallbacks sin autorización

Preferencia explícita de Sebastian, 25 de octubre de 2026:

- No implementar ni activar fallbacks sin autorización explícita del usuario para esa alternativa concreta.
- Si una integración, proveedor, modelo o paso falla, mostrar el fallo y conservar el estado correcto. Sebastian prefiere un error visible a un plan B que no autorizó.
- No sustituir respuestas fallidas por fixtures, simulaciones, datos inventados, otro modelo/proveedor, otro transporte o una ejecución local alternativa.
- No presentar una operación como completada si falló o su resultado es incierto.
- Los modos de demostración deben ser elegidos explícitamente y permanecer separados del funcionamiento conectado; no pueden actuar como respaldo ante un error.

Esta instrucción se aplica a todas las partes del proyecto y a los chats que colaboran en él.

## Cambios pagados: solo consulta

- Una solicitud de cambio ya pagada conserva su propuesta, importes, adenda, aceptación y pago como un registro de solo consulta.
- No permitir editarla ni crear una nueva revisión sobre esa misma solicitud. El backend debe rechazarlo aunque el cliente HTTP intente saltarse la interfaz.
- Los ajustes posteriores se registran como solicitudes independientes dentro del proyecto, conservando el historial anterior.
- Esta regla no impide incorporar nuevas fuentes o nuevos pedidos al proyecto; protege el cambio finalizado.

## Historial de adendas y revisiones

- Aclaración de Sebastian, 26/10/2026: un borrador aún no enviado se puede editar conservando su número de versión. Guardar instantáneas internas de sus cambios sin sobrescribir PDFs anteriores ni presentarlas como nuevas versiones para el cliente.
- Una nueva versión para el cliente nace de ajustes solicitados por él después de recibir la anterior, con respaldo de su respuesta. Las versiones enviadas permanecen inmutables.
- Cada revisión conserva su alcance, precio, plazo, condiciones, PDF exacto, referencias a fuentes y eventos de envío, aceptación y pago que le correspondan.
- Una revisión nueva requiere su propio envío y aceptación; no hereda la autorización de una versión anterior.
- Las revisiones anteriores permanecen disponibles para consulta. Una solicitud pagada sigue siendo inmutable: los cambios posteriores corresponden a otra solicitud.

## Seguimiento del pago

- Mantener una sola vista de estados de negocio para cada cambio; los detalles técnicos del proveedor pertenecen al registro de pago.
- No añadir cancelaciones o abandonos del checkout de PayPal al historial del cambio ni mostrarlos como estados de negocio. Sin pago confirmado, conservar el estado pendiente que corresponda.
- El regreso desde PayPal, abrir el enlace o enviar un correo no acreditan un pago. Solo el resultado verificado por el backend puede finalizar un cambio con adicional.

## Iconos de interfaz

- Usar exclusivamente Lucide (`lucide-static`, versión fijada en package.json) para los iconos funcionales. No añadir React Icons ni otra biblioteca de iconos.
- Los SVG seleccionados se generan en icons.mjs con `npm run icons:build`; importar icon() o usar data-ui-icon en HTML estático. No cargar bibliotecas completas ni CDN.
- Los botones con solo icono llevan aria-label descriptivo y title, foco visible y área mínima de 36px. Mantener texto en acciones principales como enviar, guardar o confirmar una eliminación.
- Logotipo de Trato, nombres/marcas de proveedores y etiquetas de formato PDF/DOCX no se consideran iconos de acciones.

## Un pedido abierto por proyecto

- Regla de Sebastian, 26/10/2026: no registrar otro pedido mientras haya uno abierto en ese mismo proyecto. Otros proyectos del mismo cliente son independientes.
- El bloqueo comienza con el documento email_request, incluso antes de preparar la adenda. Reintentos de la misma subida conservan su idempotencia; fuentes adicionales y feedback del mismo pedido siguen permitidos.
- Un pedido finalizado con pago verificado, uno aceptado sin adicional o un cierre explícito por rechazo/retiro libera el proyecto. No cerrar unilateralmente una aceptación registrada ni alterar cambios finalizados.
- El backend y la base de datos deben imponer la regla bajo bloqueo del proyecto, no solo ocultar/deshabilitar el botón. Historial y documentos permanecen consultables.

## Idiomas de la interfaz

Preferencia de Sebastian, 27/10/2026:

- Trato admite únicamente español (`es`) e inglés (`en`), seleccionables desde el perfil.
- Todo texto nuevo o modificado de interfaz debe tener ambas traducciones en los catálogos de `locales/`, incluidos errores, estados, formularios, ayudas, títulos, etiquetas accesibles y tooltips.
- Utilizar `uiText()` y `uiLocale()` de `i18n.mjs`. No añadir textos visibles directamente en un solo idioma ni traducir identificadores de rutas, enums del backend, claves de almacenamiento o nombres de campos.
- Formatear fechas, cantidades y monedas con el locale seleccionado; no cambiar la moneda ni la zona horaria por cambiar de idioma.
- No traducir automáticamente nombres, mensajes de clientes, documentos, citas, contratos o el contenido exacto de un correo que se va a enviar. Esos son datos, no etiquetas de la interfaz.
- La configuración de idioma se incluye al preparar un ensayo/agente. No presentar un mensaje del cliente ficticio como comunicación o aceptación real.
- Validar paridad de claves ES/EN antes de entregar cambios. Una traducción faltante es un error que debe corregirse; no incorporar fallbacks de idioma.
