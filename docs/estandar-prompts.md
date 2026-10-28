# Estándar de prompts de Trato

Solicitado por Sebastian el 26 de octubre de 2026. Referencia leída: `<project-root>/Utiles/prompt-construction-guide.md`. Esta adaptación no modifica otros proyectos ni activa un modelo.

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

## Idioma de instrucciones y respuestas

Acuerdo de Sebastian, 27/10/2026:

- Mantener una sola versión de las instrucciones de cada agente. El idioma acordado para las instrucciones canónicas es inglés; la interfaz sigue con catálogos ES/EN.
- El backend proporciona `output_language`, validado como `es` o `en`, a partir del idioma configurado por el usuario. El idioma del documento no decide el idioma de la explicación generada.
- Generar explicaciones, mensajes y feedback directamente en `output_language`, sin una llamada intermedia de traducción.
- Conservar documentos y citas textuales en su idioma original. Mantener claves de JSON, enums e identificadores del contrato sin traducir.
- Separar las instrucciones internas de los textos de interfaz. No duplicar prompts en los catálogos ES/EN de la interfaz.
- La migración debe hacerse explícitamente por agente, con pruebas de ambos idiomas; esta regla no significa que los prompts existentes ya estén migrados ni que la simulación ejecute un modelo.
- Conservar ROLE, CONTEXT, PRE-TASK CHECKLIST, TASK y FORMAT según este documento. No aplicar límite fijo de 5.000 caracteres ni truncar instrucciones para cumplirlo.


### Migración aplicada

`practice-workspace.mjs` prepara instrucciones únicas en inglés con `output_language`, sin dependencia del idioma de la interfaz para construir sus reglas. El ensayo sigue utilizando un guion explícito, sin inferencia. `repos/trato-worker/prompts/compare-sources.json` y `analyze-change.json` usan instrucciones únicas en inglés; `analysis.analyze()` y su entrada stdin requieren `output_language` explícito. La plantilla de cambios aún no está integrada al flujo real y la UI todavía no llama a ese análisis de modelo. Las citas originales se mantienen y se validan como fragmentos exactos, incluso cuando el texto generado se solicita en otro idioma.
