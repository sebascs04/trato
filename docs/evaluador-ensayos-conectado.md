# Evaluador final de Ensayos

Flujo de Ensayos separado de acuerdos, cobros y devoluciones. El proveedor se configura explicitamente; ver modelos-gemini.md para la conexion actual de Google Cloud.

## Recorrido

Al terminar la conversación, **Analizar con IA** solicita una evaluación real. La API autentica al usuario, valida las entradas y obtiene el caso de práctica del servidor. Encola un trabajo privado e idempotente en el Redis propio existente de Trato. La interfaz consulta su estado sin mantener abierta una petición de inferencia larga.

El consumidor dedicado `trato_worker.rehearsal_jobs` ejecuta el análisis en el worker, separado de ingesta para no bloquear la extracción de documentos. Primero lee obligatoriamente las cinco guías mediante worker → backend → procesador. Entrega al modelo todo su texto una sola vez, con IDs estables de archivo/segmento, la conversación completa y el caso. No resume ni recorta guías para hacerlas caber.

El evaluador devuelve una conclusión y un elemento por respuesta del usuario: evidencia literal, acierto/mejora/evidencia insuficiente, alternativa opcional, explicación y citas. Se comprueban cobertura, índices, archivo/segmento y citas textuales. Autoría, enlace y página/sección se resuelven desde las fuentes reales; el modelo no genera esos metadatos. Antes de guardar, se vuelve a comprobar que el ámbito de las guías no haya cambiado.

La interfaz conserva las dos etapas horizontales, navegación por mensajes, estados de carga y citas desplegables. Se escapan los textos antes de insertarlos en HTML. Las etiquetas tienen ES/EN y el análisis utiliza el idioma solicitado, conservando citas y mensajes originales.

**El personaje también responde mediante el worker y el modelo local.** `/replies` encola cada turno con el historial completo y devuelve el cierre indicado por el personaje. No hay un número fijo de turnos; el usuario también puede terminar explícitamente la conversación. Los límites técnicos de contexto se informan sin truncar el historial. Se retiró el feedback fijo de la interfaz y se bloqueó el antiguo evaluador de API basado en principios escritos sin lectura de fuentes.

## Privacidad, persistencia y fallos

- Jobs en `trato:rehearsal:evaluation:<UUID>` y stream `trato:rehearsal:evaluations`, separados de ingesta. Redis propio con AOF; retención del trabajo/conversación de 24 horas, sin sustituir registros contractuales.
- El backend verifica propietario. Otro usuario recibe no encontrado. La misma clave y carga no generan otro trabajo; con datos distintos producen conflicto.
- La interfaz conserva en su espacio de sesión el ID y la conversación para recuperar el resultado tras recargar. No ejecuta el modelo al cambiar de mensaje ni al recuperar un análisis guardado.
- Ante un envío incierto, el reintento explícito conserva clave y carga. Una evaluación fallida solo se repite por acción explícita con un nuevo trabajo.
- Una lectura fallida, contexto excesivo, salida incompleta o cita inválida produce error; nunca se sustituye por ejemplos. Una redelivery no vuelve a inferir un trabajo fallido. Si el proceso se interrumpe durante la inferencia, la recuperación marca ese límite en lugar de repetirla a ciegas.
- Una coincidencia textual valida la existencia de la cita, no la corrección semántica de su interpretación. Mantener evaluación con casos y revisión humana; no se ofrecen puntuaciones certificadas ni determinaciones legales.

## Configuración

API y worker requieren `TRATO_REHEARSAL_EVALUATOR_ENABLED=true` y el Redis privado configurado. El worker utiliza `TRATO_REHEARSAL_OLLAMA_URL`; la API mantiene `TRATO_REHEARSAL_SOURCE_MANIFEST` con las cinco guías. El supervisor `scripts/dev-polyrepo.py --with-worker` monta el consumidor dedicado solo cuando se habilita expresamente. No se añade un puerto HTTP ni se entregan credenciales al navegador.

El adaptador elige explícitamente `qwen3:4b`, thinking habilitado, contexto de 57.344 tokens y hasta 12.288 de salida. Un límite conservador de 40.000 bytes para prompt y esquema reserva margen para plantilla y salida. Si se supera, falla, sin truncar ni estimar tokens como caracteres divididos entre cuatro.

El servidor propio usa Flash Attention y caché KV `q8_0` para reducir memoria del contexto. Son opciones del mismo modelo, no un proveedor alternativo. El adaptador precarga ese contexto y comprueba GPU antes de inferir; rechaza offload a CPU, sin descargar ni seleccionar otro modelo. Referencia: [FAQ oficial de Ollama](https://docs.ollama.com/faq).

## Endpoints

- `POST /api/v1/rehearsals/evaluations`: acción `evaluate`, escenario, persona, idioma y mensajes; cabecera `Idempotency-Key` UUID. Respuesta 202 con ID/estado.
- `GET /api/v1/rehearsals/evaluations/<UUID>`: solo su propietario; `queued`, `running`, `completed` o `failed`. Solo un resultado completado contiene feedback validado.
- `/api/v1/rehearsals/local` conserva el personaje experimental; rechaza evaluar para impedir el recorrido antiguo sin guías.

## Verificación

Se prueban falta de fuentes, citas inventadas, cobertura por mensaje, límite de contexto, rechazo de CPU, salida incompleta, idempotencia y lectura ajena. La prueba de Redis usa servidor temporal aislado y modelo doble; no toca datos de la aplicación.

Navegador: solicitud explícita, mensajes originales, citas y paginación ES/EN, fallo de fuente sin feedback inventado y recarga sin duplicar evaluación. Usa transporte Auth/API controlado, no una sesión real de Supabase.

La primera inferencia real en español leyó las cinco guías y produjo un elemento con cita literal válida. Las comprobaciones posteriores de cola real se registran por separado; no se deducen de las pruebas con dobles.

### Resultado registrado

29/10/2026: API180pruebas aprobadas; navegador13aprobadas con transportes controlados y cuatro repeticiones focalizadas tras ajustes visuales; paridad1434claves ES/EN. Worker:80aprobadas y8omitidas en la suite previa a una prueba adicional de cobertura de cuatro turnos; las seis pruebas específicas del evaluador pasaron. Redis temporal: dos pruebas de cola aprobadas.

Inferencia real ES y EN con cinco fuentes y citas válidas. Además, un trabajo real en inglés atravesó la cola y el consumidor, se guardó completado y se consultó por su propietario sintético de prueba; después se eliminó únicamente ese registro sintético. No equivale a un E2E de sesión real Supabase en navegador. Un primer resultado inglés con cita inválida fue rechazado correctamente; el esquema de evidencia del usuario se endureció para seleccionar textos originales. No se reintentan trabajos fallidos automáticamente.

### Cierre de la prueba completa

El esquema interno usa un objeto con una clave obligatoria por turno del usuario y su evidencia original como enum. El worker asigna los índices, valida y entrega la lista habitual a la interfaz; el modelo no puede omitir o duplicar índices. Cada respuesta puede citar una guía pertinente, con citas breves y un máximo total de25palabras por fuente. No se omiten guías: las cinco siguen formando el contexto completo.

La reserva de salida se amplió en el mismo modelo para permitir su razonamiento y el JSON final de varios turnos. Ensayo real completo ES: tres respuestas, índices1/3/5, cinco guías y una cita válida por respuesta, completado en85.82s; sin truncación observada. El worker actualizado quedó activo tras recarga propia coordinada; API/procesador/web respondieron200 y endpointsprivados rechazaron peticiones sinJWT401. Ollama permaneció intacto. Los resultados son locales; no equivalen a una publicación de código.

Suite final del worker tras los ajustes:90ejecutadas,82aprobadas y8omitidas. Las siete específicas del evaluador y las dos de Redis aislado también pasaron.

## Cliente de práctica y atribución de recomendaciones

El prompt del personaje vive en `trato_worker/rehearsal_dialogue.py`, en inglés y con output_language explícito. El backend aporta el caso canónico; el cliente HTTP no decide acuerdos, fuentes ni herramientas. Cada turno usa un job idempotente, privado y recuperable por su propietario. La interfaz conserva el ID ante respuestas inciertas y vuelve a consultar ese mismo trabajo; no genera una respuesta de guion ante un error. El consumidor reutiliza el modelo local configurado y un presupuesto de salida menor para las intervenciones del cliente.

El evaluador sigue leyendo las cinco guías completas. Su instrucción `why` distingue el principio de la fuente de su aplicación a la conversación. La interfaz presenta ese fundamento junto a autor, título, localizador, cita literal y enlace al documento original; no atribuye consenso a expertos ni ofrece una certificación de negociación. Se mantienen validación literal y límites de citas por fuente.

La espera usa una animación CSS de IA sin progreso porcentual inventado, con estado accesible y soporte de movimiento reducido. El estado pendiente se consulta automáticamente y no muestra un botón redundante para comprobarlo. La interfaz no se vuelve a construir en cada poll si el estado sigue igual, para conservar la animación.

## Estado actual de la conexion Cloud

El personaje funciona mediante Gemini en el worker; el modelo se fija por trabajo y el selector privado se documenta en modelos-gemini.md. Se comprobaron respuestas reales por cola con Flash3.8 y Flash-Lite3.5 y acceso estructurado basico a otros modelos del catalogo. Esto no acredita una evaluacion completa con las cinco fuentes bajo Gemini. Los resultados Qwen anteriores son historicos; no son pruebas de calidad del proveedor nuevo.

Las citas del evaluador ahora se generan como IDs de referencias extractivas. El host resuelve cada ID a texto literal y metadatos del segmento original; toda la guia se conserva sin resumen. Los limites de citas y la validacion semantica pendiente siguen vigentes.

Prioridad de trabajo: conversacion real JSON e historial completo antes de ampliar o dar por validado el evaluador. El indicador comun de actividad esta en ai-activity.mjs/css, documentado en indicador-ia.md.
