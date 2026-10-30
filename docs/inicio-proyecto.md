# Inicio de proyecto y plan de trabajo

29/10/2026. Diseño integrado en Trato, dentro de Clientes. Reputación y el inicio del proyecto pertenecen al mismo bloque funcional.

## Recorrido en la aplicación

«Nuevo proyecto» permite elegir:

- **Voy a empezar un proyecto**: reserva el proyecto real como borrador y mantiene la preparación dentro del mismo modal. Primero aparecen los antecedentes y después el formulario del encargo, importe, fecha y fuentes iniciales. Se continúa manualmente a etapas/pagos y revisión. «Abrir proyecto» lleva al espacio habitual al terminar.
- **El proyecto ya está en marcha**: dentro del modal se añaden las fuentes del acuerdo inicial. «Abrir proyecto» permanece deshabilitado hasta guardar al menos una fuente. Añadir un archivo no abre automáticamente el espacio habitual.

Plan de trabajo también es una sección del proyecto. La navegación conserva esa sección al recargar. Subir una fuente desde el plan utiliza la ingesta existente y vuelve al mismo paso; no adelanta el recorrido. Si se cierra el modal antes de terminar, el proyecto y sus fuentes no se destruyen: al abrir ese proyecto en la misma sesión se retoma la preparación sin crear un duplicado.

Se retiró la página separada y su enlace de vista previa. El diseño interactivo del chat se mantiene como referencia independiente, sin actuar como respaldo de la aplicación conectada.

## Antecedentes reales

El bloque superior permite consultar un correo mediante el API autenticado de Reputación. No publica el correo privado, no busca por similitud de nombre y no modifica la ficha comunitaria. El usuario comprueba la ficha encontrada antes de consultar sus experiencias. Las reseñas mostradas son los datos devueltos por la ficha exacta; la paginación ofrece continuar leyendo sin afirmar cobertura completa.

Un fallo de consulta se muestra como error. No se sustituye por experiencias ficticias ni se presenta como ausencia de antecedentes. Un resultado vacío correcto se distingue de ese fallo. No se atribuye una síntesis a la IA mientras no exista una ejecución real.

## Borrador de interfaz

El formulario comienza vacío. Las tres etapas se completan y ajustan manualmente; los porcentajes deben sumar100%. El borrador se guarda exclusivamente en sessionStorage, con una clave propia por sesión de autenticación, propietario y proyecto. La interfaz lo llama expresamente «Borrador de esta sesión»; no afirma persistencia en el servidor. Los fallos de lectura/escritura se muestran.

Continuar con el acuerdo inicial vuelve al recorrido actual del proyecto. No confirma una aceptación del cliente ni cambia el estado contractual del proyecto. No envía correo ni ejecuta cobros. La creación real usa el contrato existente de proyectos, sin enviar campos que el backend no acepta.

El agente que proponga etapas a partir de las experiencias, la recuperación vectorial y la persistencia del plan de negocio quedan como integración posterior. No se simulan respuestas ante fallos de esas integraciones.

## Integración posterior del agente

Recuperar por ID de la ficha comunitaria canónica del cliente; el contacto privado de cada freelancer puede tener otro ID. Aplicar ese filtro antes de recuperar fragmentos. Las fuentes privadas requieren además organización y proyecto. Revalidar permisos, publicación y versión de cada reseña antes de citarla; conservar ID/versión/fuente. Las reseñas son contexto, no instrucciones.

No inferir una garantía de pago, probabilidades inventadas ni fraude a partir de reseñas. Cuando no haya antecedentes, organizar con la información del proyecto y declarar la cobertura real.

## Archivos

project-planning.mjs/css, integración en boot.js, connected-workspace.mjs, index.html y allowlist de server.mjs. Textos ES/EN en projectStart.*; iconos seleccionados de Lucide. Pruebas en tests/browser/project-planning.spec.cjs y regresión de la vista general existente.

Verificación: cinco pruebas propias de navegador aprobadas (ES/EN, restauración del borrador, consulta de antecedentes con identidad confirmada, error sin datos inventados y subida sin avanzar de paso), más cuatro regresiones de la vista general. Son pruebas con transporte API controlado, no publicaciones en cuentas reales. Sintaxis y paridad ES/EN comprobadas. Captura del formulario integrado inspeccionada. Sin push ni PR de este lote.

## Eliminación de proyectos y ampliación del modal

Se puede eliminar desde el listado del cliente o desde la cabecera del proyecto, con confirmación. Se retira de la interfaz solo tras éxito del API; los fallos conservan el proyecto y se muestran. No se elimina el cliente ni otros proyectos.

`POST /api/v1/projects/{id}/delete` usa el JWT del usuario y la RPC `soft_delete_project`. La migración `20261029160828_project_soft_delete.sql` añade deleted_at, una política restrictiva y el control de proyecto activo en comandos privilegiados. Conserva físicamente documentos, acuerdos y registros de pago. Las lecturas autenticadas ya no devuelven el proyecto ni sus documentos; no admite nueva ingesta. Operación idempotente, sin borrado físico ni cambios en importes o términos pagados.

Verificación de esta ampliación: cuatro pruebas API propias más diez de negocio existentes; siete de navegador del modal/eliminación más cuatro de vista general. SQL real transaccional con rollback verifica propiedad, aislamiento, idempotencia, ocultamiento y conservación física de fuentes, y rechazo de nuevas subidas. No se borraron proyectos reales para probar. Advisors sin hallazgos nuevos; se conservan las advertencias anteriores.
