# Fuentes concretas para el evaluador de Ensayos


## Selección y propósito

### 1. Escucha y aclaración

[Key Tips for Active Listening](https://hr.mit.edu/learning-topics/comm/articles/active-listening), Jeannette Gerzon, MIT Human Resources. Artículo institucional, sin fecha visible en el cuerpo consultado.

- Localizador: sección `Listening Tips That Aid Understanding`.
- Aporta: preguntar para comprender, comprobar lo entendido mediante paráfrasis y reconocer contenido y emoción.
- Aplicación propia: detectar si la respuesta responde a la preocupación expresada y aclara una ambigüedad relevante. No exigir preguntas cuando la información ya está clara.
- Límite: contacto visual y otros comportamientos presenciales no son observables en nuestro chat.

### 2. Intereses, alternativas y límites

[Principled Negotiation: Focus on Interests to Create Value](https://www.pon.harvard.edu/daily/negotiation-skills-daily/principled-negotiation-focus-interests-create-value/), Katie Shonk, Program on Negotiation, Harvard Law School; fecha visible 30/06/2026. Artículo de divulgación basado en *Getting to Yes*.

- Localizadores: `The 4 Elements of Principled Negotiation` y `Don’t Forget Your BATNA`.
- Aporta: separar personas y problema, explorar intereses, crear opciones y utilizar criterios objetivos; considerar una alternativa a aceptar el acuerdo.
- Aplicación propia: recomendar opciones que respeten alcance, presupuesto y disponibilidad realmente conocidos. Un rechazo razonado puede ser una buena respuesta.
- Límite: no demuestra que aceptar o persuadir sea siempre el mejor resultado; no justifica inventar precios ni condiciones.

### 3. Conversaciones difíciles

[Difficult Conversations: How to Discuss What Matters Most, A High-Level Summary](https://eye.hms.harvard.edu/sites/g/files/omnuum9886/files/eye/files/difficult-conversations-summary.pdf), Office of Human Resources, **The Ohio State University**; resumen del libro de Stone, Patton y Heen. Copia alojada en Harvard, que no es su autor. PDF de ocho páginas; sin fecha propia visible.

- Localizadores: página 2, `Assumptions about Intent`; página 4, herramienta 4; página 6, preparación.
- Aporta: distinguir hechos, impacto e interpretaciones de la intención ajena; preparar una conversación respetuosa.
- Aplicación propia: señalar acusaciones sin evidencia y proponer una formulación basada en lo ocurrido y lo que se necesita aclarar.
- Límite: no diagnosticar personalidad, emociones ocultas o mala fe; reconocer una preocupación no obliga a conceder una devolución.

### 4. Compromisos y cierre, con alcance limitado

[Seven Elements of Effective Negotiations](https://hms.harvard.edu/sites/default/files/Departments/Ombuds%20Office/files/SEVEN%20ELEMENTS%20OF%20EFFECTIVE%20NEGOTIATIONS.pdf), Jerome Slavik, diciembre de 2008; adaptación de Fisher y Ury, alojada en HMS Ombuds. PDF de tres páginas.

- Localizador seleccionado: página 3, sección 7 `COMMITMENT` y sección 8 `CONCLUSION`.
- Aporta: concretar implementación, plazos y pasos; comprobar que el resultado sea realizable.
- Aplicación propia: al cerrar, identificar qué se propone hacer, quién debe confirmar y cuándo, sin atribuir aceptación todavía inexistente.
- Exclusión expresa: la página 2, apartado 5f propone empeorar la alternativa de la contraparte. **No adoptar ese apartado como criterio ni instrucción del evaluador.** No aprobar una ingesta indiscriminada como reglas de conducta.

### 5. Cómo dar feedback y practicar

[Bruce Patton on Teaching the Micro-Skills of Negotiation](https://www.pon.harvard.edu/daily/negotiation-skills-daily/bruce-patton-on-teaching-the-micro-skills-of-negotiation/), PON Staff, 05/06/2010; artículo sobre la presentación de Patton de diciembre de 2009, con crédito a Orlee Rabin.

- Localizadores: párrafos sobre `Joint Learning`, revisión facilitada y práctica de microhabilidades.
- Aporta: practicar conductas concretas mediante ejercicios, revisión y repetición.
- Aplicación propia: el evaluador cita la respuesta real, reconoce un acierto o una mejora específica y muestra una alternativa contextualizada para volver a practicar.
- Límite: la prohibición de expresar la propia opinión pertenece a un ejercicio del artículo; no convertirla en una regla general. La fuente orienta el método pedagógico, no añade puntos obligatorios por mensaje.

## Conjunto aprobado

Las cinco son obligatorias antes de evaluar. Las fuentes 1, 2 y 3 forman la base de comportamiento. La 4 complementa el cierre, únicamente con los apartados indicados. La 5 orienta el diseño del feedback. Preparar los materiales con esos alcances explícitos y conservar atribución y localizadores; no ampliar los apartados admitidos de forma implícita.

Son guías de formación y divulgación, no una escala validada para puntuar freelancers. Los criterios y su adaptación a Trato son nuestros. No sustituyen el acuerdo del caso, las políticas aplicables de PayPal ni una determinación legal sobre devoluciones.

## Preparación y criterios de incorporación

1. Preparar material permitido para su uso, con atribución y localizadores. Este catálogo no reproduce los documentos completos ni acredita permiso de redistribución.
2. Registrar los `file_ids` reales del conjunto elegido en configuración controlada. El modelo no decide omitir una fuente obligatoria ni inventa IDs. Los apartados excluidos permanecen identificados como tales.
3. Ejecutar la lectura obligatoria siguiendo [herramientas-archivos-agentes.md](herramientas-archivos-agentes.md): worker → backend → procesador → backend → worker.
4. Verificar presencia, texto y localizadores de todos los archivos requeridos antes de evaluar. Si falta uno o falla su lectura, mostrar el error y no emitir una evaluación como si se hubieran leído todos.
5. Medir el tamaño conjunto de fuentes, conversación, instrucciones y salida reservada contra el contexto real del modelo. Si no cabe, fallar de forma visible; no truncar, resumir, cambiar de proveedor ni activar búsqueda automáticamente.
6. Probar diagnósticos contra conversaciones con aclaraciones ya respondidas, negativas razonables, acuerdos incompletos y evidencia insuficiente. Cada recomendación debe enlazar el mensaje observado y la sección pertinente; no usar todas las fuentes por obligación en cada mensaje.

El artículo de escucha que figura en el adaptador anterior no pudo verificarse por timeout durante la investigación. La fuente MIT aquí revisada es una propuesta explícita de sustitución futura, no un fallback activado. No se ha modificado el adaptador en esta entrega.

Actualización del 29/10/2026: mecanismo de lectura obligatoria, registro de herramientas y circuito HTTP implementados localmente para una biblioteca administrada, con pruebas. La configuración real de los cinco materiales sigue pendiente; no se introdujeron archivos de ejemplo como fuentes de producción. Véase [implementación de herramientas](herramientas-archivos-agentes.md#implementación-local-del-29102026).

## Incorporación local del 29/10/2026

Se descargaron y prepararon los tres artículos HTML originales de MIT/PON, conservando autoría, URL y fragmentos identificables; se validaron con la función del procesador. Los dos PDFs siguen pendientes: el de conversaciones difíciles responde403 y el enlace de Seven Elements no entregó un PDF válido en la descarga directa. No se cambió de fuente ni transporte para sustituirlos. La biblioteca no tiene manifiesto activo y no está habilitada para evaluar con tres de cinco fuentes. Los originales y textos preparados permanecen en almacenamiento local ignorado porGit, fuera de documentos de clientes.

### Incorporación completada con los PDFs aportados

El 29/10/2026 el equipo aportó los dos PDFs pendientes. Ambos se procesaron con extracción real por página. La biblioteca local ya contiene los cinco materiales con IDs reales de archivo, hashes y126fragmentos localizables. Seven Elements aporta únicamente los apartados7y8 de la página3; se conserva el original aparte y se excluye5f del material evaluable. Los artículos conservan texto del cuerpo y atribución, sin navegación ni comentarios del sitio.

El manifiesto quedó preparado y configurado exclusivamente en el.env del backend. Lectura de los cinco materiales comprobada mediante worker→rutasrealesAPI→funciónrealprocesador, con clientesHTTPenproceso; no se reiniciaron servicios ni se llamó al modelo. No equivale a una prueba de la instanciaHTTP ya levantada. Los materiales siguen locales e ignoradosporGit, sin subirse a documentos de clientes ni publicarse enelrepositorio.

Contenido extraído total26393bytes; representación completa devuelta por el procesador76214bytes al incluir texto y segmentos. Antes de conectar el modelo hay que medir el contexto final junto con instrucciones/conversación/salida y evitar duplicar texto al construir el prompt, conservando los localizadores. No recortar ni resumir automáticamente para hacerlo caber. Evaluador e interfaz conectados siguen pendientes.

Comprobación posterior con los servicios iniciados por el equipo de Reputación: catálogo y ejecución HTTP internos leyeron correctamente las cinco fuentes mediante API→procesador, con autenticación del worker y el mismo ámbito del manifiesto. No se llamó al modelo. La lectura HTTP de la biblioteca ya está verificada; evaluador/UI siguen pendientes.

## Estado actual del evaluador

Las notas de incorporación anteriores describen etapas de preparación. El evaluador final ya está conectado a API, cola y worker y exige la lectura completa de las cinco guías; véase [evaluador-ensayos-conectado.md](evaluador-ensayos-conectado.md). Los originales y la biblioteca extraída no se redistribuyen en Git. Cada instalación debe preparar su biblioteca administrada y configurar TRATO_REHEARSAL_SOURCE_MANIFEST antes de activar la evaluación; sin ella se muestra un error.
