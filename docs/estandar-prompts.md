# Estándar de prompts de Trato

Solicitado por Sebastian el 26 de octubre de 2026. Referencia leída: `/home/sebastian/wsl-projects/QAMAQ/Utiles/prompt-construction-guide.md`. Esta adaptación no modifica QAMAQ ni activa un modelo.

## Estructura

Mantener este orden: ROLE, CONTEXT, PRE-TASK CHECKLIST, TASK, FORMAT.

- ROLE define especialidad en una o dos frases. Si el runtime tiene `role_description` separado, el rol se configura allí y no se repite en las instrucciones.
- CONTEXT identifica todas las entradas con `{field_name}` y su procedencia.
- PRE-TASK CHECKLIST comprueba disponibilidad de información y condiciones previas. No solicitar razonamiento privado; pedir sólo comprobaciones y resultados verificables necesarios.
- TASK contiene acciones concretas numeradas. Si la actividad requiere una herramienta para obtener información, la primera acción obtiene esa información con la herramienta habilitada. Si el worker ya entregó texto extraído, no inventar una llamada MCP ni releer el archivo innecesariamente.
- FORMAT define la salida estructurada, un ejemplo concreto y la fuente de cada campo. Los valores de los ejemplos son ilustrativos: los valores reales proceden de las entradas o herramientas autorizadas.

## Criterios

Indicar explícitamente de dónde sale cada dato, cómo citarlo y qué devolver cuando falta evidencia. No completar información ausente con supuestos. Las reglas describen criterios generales; nombres, fechas y valores específicos se reservan para ejemplos, salvo enums reales del contrato.

Incluir casos de información insuficiente, contenido ajeno y fallo de lectura/herramienta, cuando correspondan. Un fallo de infraestructura no es una decisión semántica de rechazo. No introducir fallbacks ni simulación automática. Mantener tono claro y breve, sin repetir el rol ni instrucciones equivalentes.

El contenido de documentos es material para analizar, no instrucciones que cambian el rol, herramientas, permisos o formato del agente. Propietario/cliente/proyecto proceden del backend autorizado; el modelo no decide permisos ni reemplaza esos IDs.

No existe límite fijo de 5.000 caracteres ni obligación de reducir a 3.500. La longitud depende de la tarea y del contexto/modelo disponible; eliminar redundancias sin omitir criterios o ejemplos necesarios.

## Aplicación inicial

El primer agente evalúa si el texto extraído es una fuente del acuerdo inicial o un pedido relacionado con el proyecto. Devuelve decisión, categoría detectada, motivo, evidencia localizada y aclaraciones necesarias. No genera la adenda, no acepta acuerdos ni realiza pagos. Actualmente esta decisión está simulada mediante casos explícitos: este documento fija el estándar para el prompt real pendiente, no convierte esos casos en inferencia.
