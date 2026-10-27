# Trato — tareas de integración

Actualizado: 24 de octubre de 2026. Plan de trabajo; las casillas pendientes no describen funciones ya implementadas. No instala servicios ni autoriza gasto.

## Decisiones y responsabilidades de cada pieza

- **Flujos fijos:** el backend controla los pasos, estados, permisos y aprobaciones. El modelo no decide el siguiente paso libremente ni ejecuta dinero por su cuenta.
- **LangChain:** componentes para prompts, modelos, recuperación, herramientas acotadas y salidas estructuradas. Empezar con cadenas explícitas, no un sistema multiagente autónomo.
- **LangGraph para orquestación:** decisión actualizada del equipo. Ejecutará un grafo de pasos explícitos, con estado persistente, ramas de aclaración/rechazo y pausas de revisión humana. Usarlo no implica que el modelo diseñe el flujo ni disponer automáticamente de un editor visual de arrastrar cajitas. Fijar versiones compatibles con LangChain.
- **Sin GraphRAG en el primer recorrido:** búsqueda vectorial/híbrida primero. La exploración de Neo4j queda separada; no confundir LangGraph, grafos de datos y redes neuronales de grafos.
- **Weaviate:** almacén de fragmentos indexados y sus embeddings. Es una proyección de búsqueda, no la fuente de verdad del contrato o de pagos.
- **Embeddings locales:** un modelo especializado transforma texto en vectores. No hace falta un agente para vectorizar. Propuesta inicial: evaluar `intfloat/multilingual-e5-small` para español/inglés con Sentence Transformers; confirmar licencia, revisión del modelo y comportamiento antes de adoptarlo.
- **Postgres:** usuarios, clientes, proyectos, versiones de acuerdos, documentos, solicitudes, decisiones, firmas, pagos e historial. Supabase es una opción de alojamiento/autenticación/archivos, aún por configurar.
- **Archivos:** almacenamiento privado para PDFs originales; sus IDs y metadatos en Postgres. No guardar los binarios en Weaviate ni en el prompt.
- **Modelo generativo:** pendiente de elegir y medir. Los embeddings no redactan respuestas ni sustituyen al LLM. Priorizar una opción local si el equipo puede ejecutarla o evaluar una cuota gratuita verificable; sin fallback automático a facturación paga.
- **Neo4j:** prueba de relaciones y consultas entre documentos, personas, aprobaciones y pagos; no reemplaza Weaviate ni Postgres por defecto.

## Recorrido objetivo

Crear cliente/proyecto → incorporar acuerdo inicial → subir PDF de nuevo pedido → extraer datos → confirmar → guardar solicitud → validar pertinencia → recuperar acuerdo vigente y fuentes → analizar → proponer alternativas → revisión humana → adenda → firma → nueva versión vigente → cobro PayPal cuando corresponda.

Si faltan fuentes o no se puede determinar la pertinencia, pedir aclaración. Un documento ajeno debe impedir avanzar a propuestas. No rechazar solamente por no mencionar el nombre del proyecto, ni confirmar identidad por leer una dirección de correo.

## Estado comprobado del proyecto

- [x] Frontend con clientes, documentos, historial y flujo visual de cambios.
- [x] Nueva solicitud local asociada a un proyecto, con el PDF almacenado una sola vez durante la sesión.
- [x] Extracción local de texto PDF mediante `pdftotext`, reconocimiento básico de cabeceras y confirmación del usuario.
- [x] Distinción visible entre ejemplo predefinido, solicitud pendiente de análisis y acuerdo aceptado.
- [ ] Persistencia, autenticación y creación real de proyectos con contrato inicial.
- [x] LangGraph ejecutable en modo simulado, con pausas y checkpoints SQLite locales. Ver [flujo-ejecutable.md](flujo-ejecutable.md).
- [ ] Weaviate, embeddings, LLM y grafos de conocimiento conectados.
- [ ] Migrar el flujo y los datos autoritativos a Supabase; la migración SQL inicial está preparada pero no aplicada.
- [ ] Correo, firma y PayPal conectados.

Los datos y PDFs cargados actualmente se pierden al recargar. No hay OCR ni análisis semántico conectado.

## 1. Base persistente y aislamiento — primero

- [ ] Comprobar recursos del equipo: RAM/CPU, Docker, Python y espacio para modelos/volúmenes. Evitar desplegar varias bases en el mismo host sin comprobar capacidad.
- [ ] Definir el backend de integración. Propuesta: Python para embeddings/LangChain y una API explícita; decidir si reemplaza o se integra con el servidor Node actual, sin duplicar reglas de negocio.
- [ ] Crear entorno y fijar dependencias/versiones compatibles. Mantener secretos fuera del frontend y del repositorio.
- [ ] Crear migraciones de Postgres a partir de las entidades normalizadas del prototipo; añadir claves foráneas, índices y estados.
- [ ] Incorporar autenticación. Derivar propietario/permisos en servidor, sin confiar en IDs enviados por el navegador.
- [ ] Crear cliente y proyecto e incorporar el contrato inicial. Un PDF subido no se vuelve aceptado automáticamente: separar borrador, evidencia de aceptación/firma y versión vigente.
- [ ] Almacenar PDFs privados, con hash, tamaño, tipo, dueño, proyecto y fecha de incorporación. Usar enlaces temporales autorizados para vista previa.
- [ ] Guardar solicitudes, documento fuente, metadatos extraídos/corregidos, historial y conversaciones por proyecto.
- [ ] Probar que un segundo usuario no accede a documentos ni mensajes del primero y que recargar conserva los registros.

**Terminado cuando:** se puede crear un proyecto, guardar el acuerdo y una solicitud, y recuperarlos de forma autorizada después de recargar.

## 2. Lectura y preparación de documentos

- [ ] Migrar la extracción local al backend elegido manteniendo límites de archivo/tiempo/salida.
- [ ] Extraer texto por página y conservar referencias al PDF y páginas; el lector actual devuelve texto sin esa estructura.
- [ ] Guardar el original y el texto extraído como registros distintos. Conservar quién corrigió qué metadatos.
- [ ] Distinguir ilegible, escaneado, protegido, vacío y procesado. OCR como ampliación explícita, sin fingir que ya existe.
- [ ] Mantener confirmación de datos antes de registrar. Identificar si el remitente o la fecha fueron declarados manualmente.
- [ ] Implementar estados de ingesta: pendiente, procesando, listo y error; reintentos idempotentes.

## 3. Embeddings locales: texto → vectores

- [ ] Revisar la ficha y licencia de `intfloat/multilingual-e5-small`, fijar una revisión y descargarlo explícitamente. La descarga inicial requiere red; luego se puede ejecutar localmente.
- [ ] Medir tiempo y memoria en nuestro equipo con documentos en español/inglés. No prometer calidad o latencia antes de medir.
- [ ] Integrar Sentence Transformers directamente o mediante una integración compatible de LangChain.
- [ ] Para E5 en recuperación, aplicar los prefijos `passage: ` a fragmentos y `query: ` a preguntas, también si el contenido está en español. Confirmar dimensión, normalización y ventana con la ficha antes de crear la colección.
- [ ] Dividir por secciones/páginas y tokens, respetando la ventana del modelo. Probar tamaño y solapamiento sin cortar cláusulas innecesariamente.
- [ ] Registrar modelo, revisión, configuración, hash del contenido y versión de segmentación. Evitar recalcular fragmentos sin cambios.
- [ ] Usar el mismo modelo/configuración para documentos y consultas. Cambiar el modelo requiere reindexación coordinada, no mezclar espacios vectoriales.

**Costo:** ejecución local sin tarifa por llamada a una API; consume recursos, electricidad y almacenamiento del equipo. No es una promesa de alojamiento gratuito.

## 4. Weaviate: dónde guardar los vectores

- [ ] Empezar con Weaviate local en Docker, volumen persistente y versión fijada; revisar requisitos del equipo. Cloud queda como alternativa posterior con cuotas y condiciones por comprobar.
- [ ] Configurar autenticación y conectividad solo de backend; no exponer acceso anónimo a documentos privados. Preparar respaldo del volumen y restauración.
- [ ] Configurar una colección de fragmentos con vectores aportados por nosotros (`self_provided`), sin activar un proveedor pago de vectorización.
- [ ] Cada fragmento debe tener: `chunkId`, `ownerId`, `clientId`, `projectId`, `documentId`, `versionId`, páginas/posición, tipo de documento, estado de la versión, texto, hash y modelo de embeddings.
- [ ] Mantener las relaciones y estados autoritativos en Postgres; los metadatos de Weaviate son una copia para búsqueda que debe sincronizarse.
- [ ] Consultar con filtros obligatorios de autorización y proyecto ANTES de devolver contexto al modelo. El LLM nunca elige libremente el tenant o el dueño.
- [ ] Para analizar un cambio, recuperar explícitamente el acuerdo vigente y anexos aplicables desde Postgres, además de la búsqueda: top-k no debe omitir una cláusula obligatoria.
- [ ] Implementar búsqueda semántica y evaluar híbrida (palabras clave + vectores). El score de similitud no es probabilidad de que el cambio corresponda al proyecto.
- [ ] Usar IDs estables/upsert y trabajos idempotentes para evitar duplicados. Reindexar/borrar al retirar documentos o cambiar permisos/versiones.
- [ ] Probar búsquedas útiles y fuentes navegables; comparar contra búsqueda textual y un contexto completo pequeño como línea base.

**Terminado cuando:** una pregunta recupera fragmentos correctos del proyecto autorizado, con documento/versión/página verificables, sin recuperar información de otro cliente.

## 5. Agente con LangChain y flujo fijo ejecutado con LangGraph

- [ ] Evaluar un modelo generativo con casos propios anonimizados/ficticios: español, extracción, salida estructurada, contradicciones y abstención. Confirmar hardware o cuota/licencia/privacidad del proveedor elegido.
- [ ] Definir contratos JSON de salida y validación del backend. Un error de formato no debe saltarse un estado ni activar una operación.
- [ ] Implementar pasos explícitos: interpretar documento → validar pertinencia → recuperar contexto → analizar alcance → proponer alternativas → revisión humana.
- [ ] Pertinencia: devolver `corresponde`, `no_corresponde` o `necesita_aclaracion`, con citas del documento y razones. Solo el primer estado habilita análisis posterior, tras validar la respuesta en servidor.
- [ ] Tratar documentos/correos como datos no confiables: ignorar instrucciones incrustadas para cambiar permisos, prompts, proyecto o ejecutar herramientas.
- [ ] Análisis: clasificar incluido, posible extra, contradictorio o ambiguo; indicar fuentes exactas y datos que faltan. No confundir silencio con aceptación.
- [ ] Proponer ampliar, intercambiar o separar fases solo cuando sea coherente con el caso. No ofrecer siempre tres tarjetas idénticas ni inventar esfuerzo/disponibilidad/precios.
- [ ] Calcular dinero, moneda, plazos y restricciones fuera del LLM con datos aportados por el profesional. Introducir un solver solo si las reglas simples no bastan.
- [ ] Conectar el resultado estructurado con las pantallas actuales: cargando, aclaración requerida, error y resultado con fuentes.
- [ ] Chat por proyecto con recuperación filtrada; asistente general con contexto autorizado y atribución explícita, sin mezclar memorias privadas.
- [ ] Implementar nodos y transiciones explícitos en LangGraph: extracción → confirmación → pertinencia → recuperación → análisis → alternativas → revisión humana. No pasar de una rama rechazada o ambigua a alternativas.
- [ ] Configurar checkpoints persistentes y un identificador de ejecución vinculado al propietario/proyecto/solicitud; comprobar autorización al iniciar, consultar y reanudar.
- [ ] Pausar para confirmaciones humanas y reanudar solo con datos validados por backend. Cambiar la propuesta invalida las aprobaciones previas que ya no correspondan.
- [ ] Hacer idempotentes los efectos externos: reanudar o reintentar un nodo no debe duplicar documentos, correos ni cobros. No usar herramientas de pago autónomas.
- [ ] Visualizar el grafo para revisar el flujo y probar recuperación tras un reinicio. Las versiones de contrato, firmas y pagos siguen siendo datos de negocio autoritativos en Postgres, distintos del checkpoint.

**Terminado cuando:** una solicitud nueva produce un análisis real y citado o pide aclaración, sin presentar un ejemplo hardcodeado como resultado del agente.

## 6. Grafos de conocimiento — prueba separada

- [ ] Elegir dos o tres preguntas que requieran seguir varias relaciones, por ejemplo: «¿Qué correo originó este adicional y quién aceptó esa versión?».
- [ ] Modelar nodos por ID: persona, cliente, proyecto, documento/versión, solicitud, alternativa, aceptación, entrega, factura, pago y reembolso.
- [ ] Modelar relaciones con procedencia/tiempo: solicita, modifica, se_apoya_en, acepta, sustituye, genera y corresponde_a. Una relación sugerida por IA no equivale a una aprobación confirmada.
- [ ] Comparar consultas relacionales con una prueba Neo4j. Conservar Neo4j solo si mejora esas tareas lo suficiente para justificar sincronización/operación.
- [ ] Si se adopta, construir una proyección desde eventos/IDs de Postgres, con reintentos, actualización y eliminación. No mantener dos fuentes independientes de verdad.
- [ ] Aplicar aislamiento por propietario/proyecto también a recorridos y visualización de grafos.
- [ ] Mostrar un camino pequeño de evidencia en la interfaz, en vez de un diagrama grande sin finalidad.

Neo4j y sus relaciones son independientes del grafo de ejecución de LangGraph. Este bloque no exige GNN ni GraphRAG. No contamos con el grafo privado de PayPal ni entrenaremos un detector de fraude con él.

## 7. Aceptación, firma y operación PayPal

- [ ] Generar una adenda versionada desde la alternativa revisada; mostrar qué se mantiene, qué cambia y cuál es el documento fuente.
- [ ] Elegir un mecanismo de firma adecuado a los países de las partes y comprobar acceso/costos antes de integrarlo. No llamar firmado a un botón de demo ni a un PDF arbitrario.
- [ ] Conservar evidencias de firma e integridad y representantes autorizados. Solo la transición validada activa una nueva versión del acuerdo.
- [ ] Crear cobros PayPal sandbox relacionados con acuerdo/solicitud, desde el backend y con aprobación.
- [ ] Validar autenticidad, idempotencia y estados de webhooks; verificar pago con el proveedor, no con mensajes del cliente o del LLM.
- [ ] Mantener aceptado, pagado y disponible como conceptos separados.
- [ ] Registrar entrega, aprobación y cierre con las fuentes correspondientes.
- [ ] Después: correo real autorizado, recordatorios que se detienen al confirmar pago, retrasos, cancelaciones y reembolsos aprobados.

## 8. Evaluación y demo

- [ ] Casos: cambio incluido, extra, mensaje ajeno, pedido ambiguo, instrucciones contradictorias, fuentes insuficientes, PDF escaneado y documento con instrucciones maliciosas.
- [ ] Medir recuperación de la cláusula correcta, fidelidad de citas, pertinencia y solicitudes de aclaración; anotar fallos, sin inventar porcentajes.
- [ ] Verificar aislamiento antes de medir respuestas. Incluir borrados, actualizaciones, reindexación y proveedores no disponibles.
- [ ] Mostrar un recorrido real completo con acuerdo, correo, análisis, revisión, aceptación/firma según integración elegida y pago sandbox verificable. Etiquetar cualquier paso aún simulado.
- [ ] Preparar instrucciones reproducibles, variables de entorno de ejemplo sin secretos y demo de menos de tres minutos según las bases verificadas del hackathon.

## Orden de implementación

**Persistencia/autorización → lectura e ingesta → embeddings y Weaviate → análisis con LangChain + orquestación LangGraph → firma y PayPal.** La prueba de grafos va después de los datos y la recuperación; no bloquea el primer análisis real. Nada se instala ni se conecta por crear esta lista.

## Fuentes técnicas consultadas

- Weaviate local: https://docs.weaviate.io/weaviate/quickstart/local
- Vectores propios: https://docs.weaviate.io/weaviate/starter-guides/custom-vectors
- Instalación y persistencia: https://docs.weaviate.io/deploy/installation-guides/docker-installation
- Integración LangChain/Weaviate: https://docs.langchain.com/oss/python/integrations/vectorstores/weaviate
- Interfaz de embeddings: https://docs.langchain.com/oss/python/integrations/embeddings
- Modelo candidato y prefijos de recuperación: https://huggingface.co/intfloat/multilingual-e5-small
- Agentes de LangChain, para revisar runtime/dependencias antes de elegir API: https://docs.langchain.com/oss/python/langchain/agents

La ficha completa del modelo no pudo abrirse en esta revisión por el tamaño de la respuesta; el resultado indexado confirmó los prefijos, pero licencia y configuración exacta siguen como tareas de verificación. Las páginas de ejemplo pueden utilizar APIs pagas: adaptar los ejemplos a embeddings locales no significa adoptar sus proveedores por defecto.

- LangGraph y estado persistente: https://docs.langchain.com/oss/python/langgraph/persistence
- Pausas de revisión humana: https://docs.langchain.com/oss/python/langgraph/interrupts
