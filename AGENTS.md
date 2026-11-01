# Instrucciones del proyecto Trato

## Ramas y publicación

Preferencia de Sebastian, 27/10/2026:

- La rama principal es `main`. Todo cambio debe prepararse en una rama de trabajo separada, publicarse en esa rama y después integrarse mediante un pull request y merge a `main`.
- No crear commits directamente sobre `main` ni actualizarla directamente para publicar cambios. Esta regla también aplica a publicaciones mediante el conector de GitHub cuando la raíz local no tenga un checkout Git operativo.
- Coordinar las publicaciones entre chats para evitar pisar cambios. Verificar los cambios y las pruebas antes del merge; no interpretar esta regla como una orden de publicar o fusionar trabajo pendiente.
- Aclaración explícita de Sebastian: no crear ni abrir un pull request hasta que él lo solicite expresamente. Trabajar en una rama, pedir cambios o autorizar un push no autoriza crear un PR.
- Aceptar o fusionar un PR requiere autorización explícita de Sebastian para ese PR. Autorizar su creación no autoriza su aceptación ni su merge; los chats solo realizan esas acciones en su nombre cuando él lo indique.

### Rama compartida y push conjunto

Preferencia explícita de Sebastian, 28/10/2026:

- P1 y P2 trabajan siempre sobre la misma rama de trabajo acordada para cada lote, creada desde `main` actualizado. No preparar ramas independientes por chat salvo nueva instrucción expresa de Sebastian.
- Mantener el reparto de tareas y las reservas de archivos aunque la rama sea compartida; coordinar antes de editar archivos comunes.
- Nombrar un único responsable de publicación por lote. Ese responsable reúne los cambios terminados de ambos chats, revisa el snapshot y las pruebas, y realiza un solo push conjunto cuando Sebastian lo autorice. El otro chat no publica en paralelo.
- No subir secretos, archivos privados ni trabajo ajeno pendiente por interpretar «todos los cambios» como una copia indiscriminada del workspace.
- Antes de cambiar de rama o actualizar un checkout, comprobar su estado y conservar cambios pendientes. Si la raíz no tiene Git operativo, acordar la misma rama remota sin resetear ni modificar los checkouts anidados para aparentar un cambio local.
- Esta preferencia no autoriza por sí sola un push, crear un PR ni fusionarlo. Se mantienen las autorizaciones explícitas indicadas arriba; un permiso de un lote anterior no se extiende al siguiente.

## Estándar de prompts

- Los prompts de agentes deben seguir `docs/estandar-prompts.md`, adaptado de la guía compartida por Sebastian en QAMAQ.
- No imponer un límite fijo de 5.000 caracteres: la extensión depende de la responsabilidad del agente, sin redundancia.
- No modificar archivos de QAMAQ para aplicar este estándar en Trato.
- Mantener instrucciones de agentes únicas en inglés, separadas de los catálogos de interfaz. Pasar `output_language` validado como `es` o `en` para el texto generado, sin traducir citas, claves de JSON, enums o IDs. No inferir el idioma de salida a partir del documento.

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

## Conexiones de grafos

- Regla de Sebastian: cada flecha tiene un punto de salida y un punto de entrada exclusivos en sus nodos. Ninguna conexión puede compartir puerto con otra, aunque una entre y otra salga o conecten el mismo par de nodos.
- Separar también los tramos cercanos a las tarjetas para que las flechas no se fusionen visualmente en una única entrada/salida. Aplicar esta regla a todos los grafos, conservando la dirección y las relaciones reales.
- Los verbos de las relaciones deben tener espacio libre alrededor: ninguna línea ni punta de flecha puede atravesar su etiqueta. Calcular su colocación contra todas las conexiones del mapa, además de tarjetas y otras etiquetas, y reservar un margen visible alrededor del texto.

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


## Objetivo de entrega anticipada

Preferencia de Sebastian, 31/10/2026:

- Objetivo interno: enviar el proyecto bastante completo el 4 de noviembre de 2026 para la revision anticipada del 5.
- La revision requiere pulsar Submit project; guardar un borrador no basta. El envio temprano sigue siendo editable hasta el cierre final del 12 de noviembre, 12:00 Pacifico (15:00 Peru).
- Priorizar un recorrido funcional verificable con PayPal e IA, instrucciones de ejecucion y materiales de entrega. El video puede completarse antes del cierre final, aunque una entrega completa permite una revision mas util.

## Selector privado de modelos de prueba

- El perfil permite elegir modelo solo a probadores autorizados por el backend mediante identidad confirmada; nunca autorizar con user_metadata, datos de formulario ni ocultacion de frontend.
- La preferencia se guarda por usuario y se fija en cada trabajo antes de encolarlo. El worker valida su propia lista permitida; no reemplazar un modelo fallido o retirado.
- Alcance conectado: Ensayos, Reputacion y planificacion inicial. Los agentes de cambios/devoluciones siguen siendo responsabilidad separada de Flores. Consultar docs/modelos-gemini.md.
- Credenciales y correos de probadores permanecen en configuracion privada; no publicarlos en el repo.

## Contratos de agentes y espera de IA

- Todas las salidas de agentes deben ser JSON con esquema y validacion en codigo. No aceptar texto libre como sustituto ante un fallo de formato.
- Usar ai-activity.mjs/css para actividad real en curso; reutilizar el componente en lugar de duplicar animaciones. Ver docs/indicador-ia.md.
- Prioridad acordada: validar conversacion real de Ensayos y contexto entre turnos antes de ampliar su evaluador/fuentes; el plan inicial con reputacion sigue pendiente de integracion al agente.

## Creacion de proyectos al confirmar

- Elegir Nuevo proyecto o Proyecto en marcha abre un borrador; no crea registros remotos.
- Crear el proyecto unicamente al confirmar la configuracion final. Los originales seleccionados permanecen locales hasta ese momento y cancelar antes no sube archivos ni deja proyectos incompletos.
- Mantener una clave idempotente para el comando final. Si falla una subida posterior a crear el proyecto, conservar su ID y reintentar solo archivos pendientes, sin crear duplicados ni declarar exito parcial como completo.

## Prioridad de integracion IA (1 noviembre 2026)

- Completar Ensayos, Reputacion y proyecto inicial antes de ampliar documentos/vectorial y corpus del evaluador.
- No realizar pruebas desde la interfaz durante esta etapa; el usuario las hara despues. Se permiten comprobaciones de codigo, contratos y aislamiento. No confundir esos resultados con validacion E2E del modelo.
- API aporta resenas publicadas, worker produce JSON validado; tratar experiencias como opiniones, no hechos garantizados.
- El plan inicial revisado se guarda con sus etapas al crear el proyecto al final. No ejecutar pagos ni correos desde agentes. Ver docs/integracion-ia-flujos.md.

## Operaciones vectoriales y tenants (1 noviembre 2026)

- El worker orquesta. El backend autoriza propietario/cliente/proyecto, determina IDs/generaciones y valida fuentes/resultados. El file processor ejecuta tanto guardado/embeddings como busqueda en Weaviate. No poner el SDK ni las credenciales de Weaviate en API, worker o frontend.
- Recorrido de herramientas: worker → backend → file processor → Weaviate y vuelta. Un documento o prompt no puede seleccionar tenant ni ampliar permisos.
- Una coleccion compartida; tenants `projects_private` y `reputation_public`; tercer tenant libre. No crear un tenant por usuario/cliente/proyecto. Toda consulta privada impone owner/client/project y fuentes vigentes, aunque comparta tenant con otros usuarios.
- Las cinco guias de Ensayos siguen siendo obligatorias y se leen completas fuera de Weaviate. La recuperacion vectorial no sustituye ese control.
- Comunicar nuevos parametros de entorno y dependencias a Flores antes de publicar; `.env.example` y docs/configuracion-vectorial-colaboradores.md deben acompanarlos. No subir claves ni biblioteca privada. Crear un tenant no acredita su flujo de indexacion conectado.


## Sin compras ni activacion de recursos facturables

Instruccion explicita de Sebastian, 1 de noviembre de 2026:

- No realizar compras, contratar planes/suscripciones/dominios ni activar recursos que puedan generar cargos. No interpretar los creditos promocionales ni una indicacion general de continuar el despliegue como autorizacion para esas acciones.
- Aclaracion posterior del mismo dia: Sebastian acepta usar servicios que consuman los creditos, pero antes de cada activacion facturable se debe explicar el recurso, su configuracion, costo estimado y efecto sobre los creditos, y esperar su aprobacion concreta. Una consulta sobre opciones o una indicacion general de continuar no equivale a aprobar el recurso.
- Se permite preparar configuracion y consultar estado/permisos sin crear recursos facturables. No se ha autorizado crear alojamiento en este lote.
- Alojamiento previsto en Google Cloud. Conservar Supabase, Neo4j y Weaviate existentes; no migrarlos ni contratar alternativas por asumir que todo debe estar en Google.
