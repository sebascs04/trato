# Ensayos: interfaz y configuración

## Alcance actual

Ensayos aparece debajo de Clientes. Permite preparar un cliente ficticio para practicar una conversación: trabajo adicional, retraso en el pago o devolución. El usuario autorizó probar una conversación simulada. El botón «Comenzar ensayo simulado» guarda la configuración e inicia directamente un guion local de tres turnos. No hay una llamada a un modelo.

Cada situación utiliza un caso de práctica independiente de los proyectos privados. Las fuentes originales se conservan internamente; cambiar el idioma de la interfaz no traduce esos documentos. No se presenta una personalidad estimada de un cliente real.

## Temperamento

Tres controles independientes de 1 a 5:

- Paciencia: desde pedir respuestas directas hasta permitir explicaciones extensas.
- Flexibilidad: desde mantener la posición inicial hasta explorar alternativas.
- Sensibilidad al precio: desde priorizar el resultado hasta cuestionar el adicional y pedir justificación.

Los controles tienen etiqueta accesible, valor anunciado, uso por teclado y una descripción distinta por nivel. El personaje mantiene un trato respetuoso en todos los niveles. Se puede escribir un objetivo de práctica.

## Guardado y futura integración

La configuración se guarda al pulsar Guardar configuración o al comenzar el ensayo. Si se modifica un valor, el botón cambia a «Guardar cambios», se resalta y aparece el aviso de cambios pendientes. Volver a los valores guardados elimina el aviso; guardar lo limpia sin mostrar un mensaje permanente. Usa `sessionStorage`, separada por el ID de usuario verificado por el backend; dura la sesión del navegador. No se guarda todavía en Supabase. Una configuración inválida muestra un error y requiere restablecimiento explícito.

`validatePracticeSettings()` valida escenario, tres enteros de 1 a 5 y objetivo. `buildPracticeContext()` comprueba las relaciones normalizadas entre solicitud, conversación, proyecto, versión y documento antes de preparar el contexto.

Al guardar, `cloud.practiceContext` contiene `mode: rehearsal`, idioma ES/EN, valores de personalidad, objetivo y fuentes con sus IDs. `allowed_tools` está vacío y `affects_business_state` es falso. Cerrar la sesión limpia ese contexto en memoria. El contexto no envía correos, no modifica acuerdos ni permite pagos.

## Conversación simulada

La introducción explica para qué sirve el ensayo. El pedido y acuerdo del ejemplo se conservan internamente, sin una tarjeta adicional en la configuración ni otro desplegable durante la conversación.

El usuario escribe sus tres respuestas; el guion presenta objeciones predefinidas según escenario y controles. Paciencia cambia la apertura, sensibilidad al precio añade una objeción de costo/valor y flexibilidad cambia la última pregunta. El guion no interpreta el contenido escrito ni genera una puntuación. El cierre ofrece una pregunta de reflexión, reinicio y regreso a la configuración. Los mensajes se conservan solo en memoria; recargar inicia de nuevo la conversación conservando los ajustes guardados.

`buildPracticePrompt()` expone las instrucciones preparadas con ROLE, CONTEXT, PRE-TASK CHECKLIST, TASK y FORMAT. Incluye idioma, fuentes, niveles y descripción de comportamiento. Se consulta desde un desplegable; la simulación no ejecuta este prompt. Nunca se activa como alternativa ante un fallo de proveedor.

La conexión posterior al agente deberá seguir `docs/estandar-prompts.md`, interpretar cada nivel según la conducta descrita y mantener el aislamiento respecto al flujo real. No utilizar respuestas prefabricadas como sustitución de una integración fallida.

## Verificación

`tests/browser/i18n-practice.spec.cjs` comprueba idiomas, navegación, integridad del contenido privado, bloqueo de edición pagada, controles accesibles, persistencia y ausencia de escrituras de negocio. `tests/i18n-practice.test.cjs` comprueba valores inválidos y rechazo de fuentes de otro proyecto.
