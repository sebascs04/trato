# Ensayos: interfaz y configuración

## Alcance actual

Ensayos aparece debajo de Clientes. Permite preparar un cliente ficticio para practicar una conversación: trabajo adicional, retraso en el pago o devolución. El usuario autorizó probar una conversación simulada. El botón «Comenzar ensayo simulado» guarda la configuración e inicia directamente un guion local de tres turnos. No hay una llamada a un modelo.

Cada situación utiliza un caso de práctica independiente de los proyectos privados. Las fuentes originales se conservan internamente; cambiar el idioma de la interfaz no traduce esos documentos. No se presenta una personalidad estimada de un cliente real.

## Temperamento

Tres controles independientes de 1 a 5:

- Paciencia: desde pedir respuestas directas hasta permitir explicaciones extensas.
- Flexibilidad: desde mantener la posición inicial hasta explorar alternativas.
- Sensibilidad al precio: desde priorizar el resultado hasta cuestionar el adicional y pedir justificación.

Los controles tienen etiqueta accesible, valor anunciado, uso por teclado y una descripción distinta por nivel. El personaje mantiene un trato respetuoso en todos los niveles. El objetivo queda definido por la situación seleccionada; no hay un campo de objetivo libre.

## Guardado y futura integración

La configuración se guarda al pulsar Guardar configuración o al comenzar el ensayo. Si se modifica un valor, el botón cambia a «Guardar cambios», se resalta y aparece el aviso de cambios pendientes. Volver a los valores guardados elimina el aviso; guardar lo limpia sin mostrar un mensaje permanente. Usa `sessionStorage`, separada por el ID de usuario verificado por el backend; dura la sesión del navegador. No se guarda todavía en Supabase. Una configuración inválida muestra un error y requiere restablecimiento explícito.

`validatePracticeSettings()` valida escenario, tres enteros de 1 a 5 y escenario. `buildPracticeContext()` comprueba las relaciones normalizadas entre solicitud, conversación, proyecto, versión y documento antes de preparar el contexto.

Al guardar, `cloud.practiceContext` contiene `mode: rehearsal`, idioma ES/EN, valores de personalidad, la clave del objetivo de la situación y fuentes con sus IDs. `allowed_tools` está vacío y `affects_business_state` es falso. Cerrar la sesión limpia ese contexto en memoria. El contexto no envía correos, no modifica acuerdos ni permite pagos.

## Conversación simulada

La introducción explica para qué sirve el ensayo. El pedido y acuerdo del ejemplo se conservan internamente, sin una tarjeta adicional en la configuración ni otro desplegable durante la conversación.

El usuario escribe sus tres respuestas; el guion presenta objeciones predefinidas según escenario y controles. Paciencia cambia la apertura, sensibilidad al precio añade una objeción de costo/valor y flexibilidad cambia la última pregunta. El guion no interpreta el contenido escrito ni genera una puntuación. El cierre ofrece una pregunta de reflexión, reinicio y regreso a la configuración. Los mensajes se conservan solo en memoria; recargar inicia de nuevo la conversación conservando los ajustes guardados.

`buildPracticePrompt()` prepara instrucciones únicas en inglés con ROLE, CONTEXT, PRE-TASK CHECKLIST, TASK y FORMAT. Incluye `output_language` validado como es/en, fuentes originales, niveles, descripción de comportamiento y objetivo de la situación en inglés. Solo el mensaje generado se solicita en el idioma configurado. Las instrucciones ya no proceden de los catálogos de interfaz. Permanece como preparación interna; no se muestra en la interfaz y la simulación no ejecuta este prompt. Nunca se activa como alternativa ante un fallo de proveedor.

La conexión posterior al agente deberá seguir `docs/estandar-prompts.md`, interpretar cada nivel según la conducta descrita y mantener el aislamiento respecto al flujo real. No utilizar respuestas prefabricadas como sustitución de una integración fallida.

## Verificación

`tests/browser/i18n-practice.spec.cjs` comprueba idiomas, navegación, integridad del contenido privado, bloqueo de edición pagada, controles accesibles, persistencia y ausencia de escrituras de negocio. `tests/i18n-practice.test.cjs` comprueba valores inválidos y rechazo de fuentes de otro proyecto.

## Vista del evaluador simulado

El recorrido tiene dos pasos en una barra horizontal: Conversación y Análisis del ensayo. El segundo paso permanece deshabilitado hasta terminar; entonces reemplaza el chat en el mismo panel, sin añadir una evaluación debajo de los mensajes. Se puede volver al primer paso para consultar el intercambio, sin editarlo ni perder respuestas. El chat usa desplazamiento interno para no alargar toda la página.

Al terminar los tres turnos se muestran criterios de escucha/comprensión, condiciones/límites y alternativas/siguiente paso. Cada tarjeta conserva un fragmento literal de una respuesta del usuario, una pregunta de revisión predefinida y un enlace a la guía de Harvard aplicable. Vincular un turno a una tarjeta organiza la revisión; no afirma que una técnica se haya detectado semánticamente en ese turno.

La vista incluye una respuesta alternativa de práctica según escenario, sin inventar importes o fechas, y declara que aún no hay evaluación semántica ni puntuación automática. No se invoca un segundo agente ni un proveedor como resultado de completar el guion. El futuro evaluador deberá justificar cada valoración con evidencias y fuentes; esta vista no sustituye ese trabajo por un diagnóstico ficticio del usuario.

### Feedback por mensaje

La vista se organiza ahora por respuesta del usuario: mensaje original, mensaje previo del cliente, hallazgo de ejemplo, reescritura sugerida y explicación breve de la mejora con fuente. Ya no pide al usuario que investigue o compruebe si lo hizo bien. El agente real deberá realizar esa comprobación, considerando toda la conversación, y citar evidencia específica para cada hallazgo.

En el modo actual, tanto el hallazgo como la reescritura son ejemplos predefinidos por situación y posición del turno. La interfaz lo indica expresamente: no se deben interpretar como un diagnóstico semántico del texto que el usuario escribió. No se asignan puntuaciones ni se presentan verificaciones de IA inexistentes.


### Navegación entre mensajes

El paso Análisis presenta un solo mensaje a la vez. Un selector horizontal y los botones Anterior/Siguiente cambian el mensaje, manteniendo su texto, hallazgo de ejemplo, reescritura y fuente juntos. El primer y último mensaje deshabilitan el avance fuera de rango. La selección se conserva al volver a consultar la conversación; repetir el ensayo comienza desde el primer mensaje. Este ajuste no cambia las fuentes ni introduce un evaluador real.
