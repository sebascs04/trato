# Carga bajo demanda del proyecto

Actualizado: 6 de noviembre de 2026.

Plan de trabajo, Historial y Mapa se consultan al abrir su pestaña. Los detalles del plan se presentan al abrir su diálogo. El mapa importa su módulo al seleccionarlo y conserva el panel entre vistas del mismo proyecto. Cambiar propietario o proyecto invalida los resultados pendientes.

## Entrega y pago

El diálogo muestra inmediatamente el nombre e importe de la etapa con un skeleton accesible. No se agrega una espera artificial de tres segundos. Primero consulta el checkout de esa etapa. Si existe, no consulta documentos ni índices de otras etapas. Si no existe, pide `GET /api/v1/projects/{project}/stages/{position}/evidence`.

El backend autoriza propietario/proyecto y filtra `delivery_evidence` por `stage_position` antes de consultar documentos, resultados e inventario vectorial. El filtro se impone antes de leer extracciones: no recorre el proyecto completo. Los documentos retirados quedan excluidos. La autorización y validación del cobro permanecen en el backend; esta optimización no habilita pagos por su cuenta.

Cerrar el diálogo mientras vuelve la primera consulta evita iniciar la consulta adicional. Las lecturas llevan generación y ámbito para no aplicar resultados al navegar a otro proyecto. Las evidencias nuevas se incorporan al estado del proyecto sin sustituir documentos de otras etapas. Al cerrar el diálogo se invalidan historial, mapa y progreso; se consultarán de nuevo al abrirlos.

El progreso del plan comparte solicitudes simultáneas y conserva una lectura durante quince segundos en memoria, separada por propietario/proyecto. Un error no se transforma en datos ni se conserva como éxito. Cerrar el diálogo de cobro o cerrar sesión invalida esa lectura. Las operaciones de pago siempre usan el backend, no esta memoria de presentación.

## Revisión de un cambio

La creación de una propuesta conserva un solo formulario y sus controles originales, distribuidos en cuatro vistas:

1. Recomendación de TeTrato, basada en el resultado real del agente.
2. Alcance y condiciones precargados y editables.
3. Tarifa, horas, cálculo existente del adicional y fecha.
4. Resumen exacto de los campos editados y las acciones originales de guardar o enviar.

Avanzar no guarda, envía ni ejecuta IA adicional. Se validan los campos de cada vista y el envío continúa usando la lógica existente. La primera vista no avanza mientras no exista una propuesta lista. Retroceder conserva los controles y sus valores. Los ajustes de versiones ya enviadas mantienen su flujo separado.

## Verificación

Pruebas Node de consultas bajo demanda, cancelación antes de la segunda lectura, ámbito/caducidad del progreso, mezcla de evidencias y navegación/validación del formulario. Pruebas API de autorización y filtrado por etapa antes de consultar extracciones. La verificación de interfaz, Gemini y PayPal por el usuario sigue siendo una comprobación separada.

## Tarjetas del historial

Los grupos del historial empiezan cerrados. La cabecera muestra título, cantidad de movimientos y última fecha. La cronología de un grupo se construye al desplegar su tarjeta, y se recuerda qué tarjetas abrió o cerró el usuario dentro del proyecto. Esta carga diferida corresponde al renderizado: la consulta `/activity` sigue obteniendo los eventos al entrar a Historial. Los PDFs conservan su descarga explícita al abrir el documento. No presentar este cambio como paginación o consulta HTTP individual por grupo.
