# Repetir Ensayos y comparar feedback

Actualización vigente del 3 de noviembre: el responsable del proyecto autorizó recuperar la biblioteca mediante Weaviate y herramientas internas en dos nodos. El texto posterior sobre lectura completa obligatoria describe el diseño anterior; queda sustituido por [ensayos-busqueda-vectorial.md](ensayos-busqueda-vectorial.md). La autorización de fuentes y verificación literal continúan.


## Estado vigente: selección de citas por el agente

Instrucción del responsable del proyecto del 3 de noviembre, posterior a la prueba de citas: eliminar presupuestos artificiales de palabras por fuente/cita y el número máximo de citas por hallazgo. El agente elige los pasajes que considere pertinentes. El esquema conserva los IDs de referencias existentes; el host resuelve texto, autor y localizador y comprueba coincidencia literal. Las frases se conservan completas, sin cortes por cantidad de palabras. El registro citations_resolved mide uso sin rechazar por conteos. Continúan las verificaciones de JSON, cobertura de respuestas, origen y contenido exacto.

Los apartados posteriores sobre un presupuesto de 25 palabras describen estados anteriores y quedan sustituidos por esta decisión. Las evaluaciones ya guardadas no se recalculan solas. La búsqueda vectorial para la biblioteca se revisa por separado; retirar el presupuesto de citas no activa ni reemplaza herramientas o índices.


3 noviembre 2026. Implementación local, pendiente de publicación y prueba conjunta desde la interfaz. No se realizaron inferencias para comprobar estos contratos.

Después de recibir una evaluación completa, el botón «Practicar de nuevo con este feedback» conserva una instantánea del intento anterior. Repite situación, temperamento, fuentes de escenario, idioma y la misma pregunta inicial del cliente. Las siguientes respuestas del cliente sí se obtienen del flujo habitual de Gemini; no se reproduce una conversación fija ni se envía el feedback anterior como si fuera un mensaje nuevo del usuario.

La nueva evaluación usa el flujo existente y sus cinco guías completas. El agente no recibe una instrucción de aparentar mejora ni tiene un límite fijo de intercambios. Una vez completada, la interfaz compara los resúmenes y recuentos de fortalezas, aspectos por mejorar y evidencia insuficiente. Muestra el total de respuestas de cada intento y permite contrastar ambas respuestas a la misma primera pregunta. No produce notas ni deduce que menos observaciones equivalgan automáticamente a mejor desempeño.

Si cambia modelo, biblioteca de fuentes o contexto, aparece una advertencia de comparación no directa. Los textos de usuario y citas se mantienen originales. Los errores no se convierten en feedback simulado.

Solo se guarda el intento inmediatamente anterior como base de comparación, sin encadenar indefinidamente todas las conversaciones. Los datos viven en el almacenamiento local del navegador bajo la clave de sesión/propietario del espacio de Ensayos. No se comparten con otro usuario ni equivalen a historial central persistente de la plataforma; borrar ese almacenamiento pierde la comparación. La restauración valida los registros y conserva idioma explícito. Restablecer Ensayos elimina su configuración, diálogo y evaluación locales.

El helper de comparación se exporta desde `practice-workspace.mjs`; `practice-comparison.mjs` lo reexporta para contratos. La pantalla ya servida no depende de cargar un módulo nuevo antes de reiniciar el servidor.

Comprobaciones de contrato: `node --test tests/practice-comparison.test.mjs tests/i18n-practice.test.cjs`. Cubren evidencia literal, cobertura de turnos, aislamiento de instantáneas, longitud distinta y cambios de modelo/fuentes/contexto. La calidad real del coaching sigue requiriendo prueba con Gemini y conversaciones de varios turnos.

### Diagnóstico de citas, 3 de noviembre

El análisis conectado registrado a las 18:37 UTC seleccionó referencias repetidas de la misma guía. La validación acumulada de palabras citadas utilizaba el mismo error que una cita no verificable, ocultando la diferencia. Ahora `REHEARSAL_QUOTE_BUDGET_EXCEEDED` identifica el exceso de reproducción; referencias desconocidas y citas no literales siguen siendo errores independientes de verificación. No se elimina, trunca ni sustituye una cita fallida para publicar el resultado.

El prompt recibe `citation_word_counts` calculado por el host y un presupuesto por guía. Debe contabilizar todas las apariciones, incluidas las repetidas entre respuestas. Los eventos `citation_budget_checked` y `citation_rejected` registran conteos, IDs y motivo sin contenido de conversaciones. Las pruebas cubren 24 palabras válidas y 32 rechazadas al repetir referencias; no se ejecutaron llamadas a modelos durante esta comprobación. Se recargó exclusivamente el consumidor local de Ensayos tras comprobar que no tenía trabajos activos.

### Pasajes citables y referencias agrupadas

El evaluador conserva todo el texto original como contexto. Las referencias se preparan por límites de frases y, para frases largas, por cláusulas. No se dividen cada ocho palabras. Los pasajes de menos de tres palabras, de más de 25 palabras o de más de 320 caracteres no son seleccionables como cita; permanecen en el material leído. El esquema JSON enumera únicamente referencias citables y el host vuelve a comprobarlo, por lo que etiquetas sueltas como «Conditions» y «Timing adjustments» no pasan como evidencia textual. Se mantiene el presupuesto acumulado de 25 palabras por fuente, incluidas repeticiones.

La interfaz agrupa por identidad de documento y metadatos originales. Cada fuente presenta una vez autor, título y enlace; conserva sus extractos literales y los localizadores disponibles. Solo elimina duplicados de visualización con texto y localizador idénticos. No rellena citas antiguas ni modifica evaluaciones guardadas; la nueva preparación corresponde a nuevas evaluaciones. Pruebas: `tests/practice-citations.test.mjs` y `test_rehearsal_evaluation.py`. Sin llamadas a modelos para comprobar estos cambios.

### Control temporal para comprobar citas

el responsable del proyecto autorizó un botón temporal «Volver a analizar esta conversación» y pidió retirarlo después de pulsarlo y completar la comprobación. Está al pie del análisis, antes de «Practicar de nuevo con este feedback». Crea un trabajo nuevo con los mismos mensajes/contexto y conserva la base de comparación; no reproduce la conversación ni ejecuta un modelo hasta la acción explícita. El análisis anterior y su registro se respaldan bajo la misma clave privada de sesión/propietario en evaluation-before-reanalysis. Restablecer Ensayos elimina también ese respaldo. Pendiente: retirar botón, handler, helper, estilos, claves y prueba temporal cuando el responsable del proyecto confirme la prueba.

### Resultado de la comprobación y criterio sobre fuentes

La evaluación conectada del 3 de noviembre, 20:39 UTC, terminó validada: leyó las cinco selecciones y citó dos documentos con tres referencias. Los conteos de reproducción fueron 18 y 10 palabras por fuente, dentro del presupuesto. el responsable del proyecto confirmó el nuevo resultado en la interfaz; se retiraron el botón temporal de reanálisis, su helper, estilo, traducciones y prueba específica. Se conserva el respaldo privado anterior hasta restablecer Ensayos.

La longitud de las citas no depende de los chunks vectoriales de documentos de proyecto. El evaluador lee su biblioteca fija completa fuera de Weaviate y el host selecciona extractos por frase/cláusula con presupuesto acumulado. Ya hay un resumen PDF de ocho páginas sobre conversaciones difíciles y una selección de la tercera página de Seven Elements. Los 431 bytes de esta última corresponden a una selección deliberada de compromiso/cierre, documentada en fuentes-evaluador-ensayos.md, no acreditan un fallo de extracción. No reprocesar el PDF completo a ciegas ni incorporar como instrucciones secciones excluidas del criterio.

Una ampliación del corpus debe buscar pertinencia, autoría, cobertura y localizadores verificables. El formato PDF o un número de páginas no acreditan mayor calidad. Reprocesar o aumentar el tamaño de chunks no cambia por sí solo la explicación pedagógica ni el presupuesto de reproducción de fuentes. No se cambiaron fuentes, chunks ni se ejecutó otro análisis por esta revisión.

## Salida de Ensayos y comparación compacta, 3 de noviembre

el responsable del proyecto pidió una salida única «Terminar ensayo». Si falta el feedback del intento actual, se confirma mediante diálogo antes de volver a configurar; el feedback de un intento anterior no evita esta confirmación. Con el análisis actual terminado, se vuelve directamente. Se eliminó «Terminar conversación y analizar»: el cierre normal lo determina la conversación del agente; salir antes termina la sesión de práctica sin pedir una evaluación nueva. No se afirma que una llamada al proveedor ya en curso haya sido cancelada.

La salida marca la sesión local como cerrada bajo una clave privada de propietario. Se conservan los registros locales previos y los trabajos remotos; recargar muestra configuración. Iniciar otro ensayo elimina el marcador y usa el flujo existente. Se detienen los temporizadores de seguimiento y las respuestas tardías no pueden reabrir la sesión terminada.

El análisis queda al lado de un panel compacto de comparación en pantallas anchas. Se muestran los recuentos de antes/ahora; resúmenes completos y respuesta inicial quedan desplegables. Se retiró la frase «no son una calificación ni demuestran por sí solos una mejora». No cambian el cálculo de recuentos ni los datos comparados. Referencia de diseño: Nielsen Norman Group, Progressive Disclosure, https://www.nngroup.com/articles/progressive-disclosure/.

Verificación: contratos de salida, comparación e idioma13pruebas y npmcheckcorrectos. Se actualizó el escenario de navegador que dependía del cierre manual antiguo; no se ejecutaron pruebas desde la interfaz, por la instrucción vigente de dejar esa comprobación a el responsable del proyecto.

### Ajuste de anchura y detalle flotante

Por solicitud posterior del responsable del proyecto el 3 de noviembre, el panel lateral usa hasta 400px y el contenedor puede aprovechar hasta 1440px. Se amplían tipografías de título, explicación y recuentos. Los dos controles de detalle abren un diálogo nativo de lectura: resumen de ambos intentos o respuestas a la misma pregunta inicial, con antes/ahora en columnas. Cerrar/Escape devuelve el foco al control que lo abrió. La salida del ensayo, cambio de pestaña y cierre de sesión limpian el diálogo. No se modifican mensajes ni evaluaciones y abrirlo no realiza llamadas de IA. La explicación de repetir se acorta para evitar otra fila extensa de texto. Comprobación de contratos de comparación/escape de contenido y salida correcta, sin ejecución de navegador.
