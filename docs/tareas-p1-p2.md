# Trato: tareas de P1 y P2

Actualizado el 28/10/2026 por pedido de Sebastian. **P1 es este chat**, responsable de continuar Ensayos, modelo local y revisión de Reputación. **P2 es el otro chat de Codex**. El compañero humano que continúa cambios/devoluciones es una persona distinta de P2.

Este archivo fija responsabilidades y pendientes. No autoriza gastos, despliegues, publicaciones, PR ni merges. El [backlog general](backlog.md) conserva los IDs TRATO; esta distribución actualiza su propuesta inicial de reparto.

## P1: mi lista de trabajo

| ID | Tarea | Estado y siguiente entrega |
| --- | --- | --- |
| P1-01 | Qwen local mediante Ollama propio de Trato | Instalado y probado en GPU. Continuidad ES/EN comprobada en muestras; respuestas de 21–39 segundos. Revisar calidad y latencia antes de habilitarlo en la interfaz. Sin sustitución automática de modelo. |
| P1-02 | Fuentes y criterios del evaluador de Ensayos | Cinco referencias concretas revisadas y vinculadas a criterios en [fuentes-evaluador-ensayos.md](fuentes-evaluador-ensayos.md). Cinco materiales incorporados localmente con IDs y localizadores; lectura integrada verificada. Lectura obligatoria y contexto del modelo conectados y probados; todas las guías se conservan, sin truncación ni sustitución. Las citas se validan contra los segmentos reales. |
| P1-03 | Cliente ficticio con temperamento e historial | Backend preparado; falta conectar la interfaz. Respetar paciencia, flexibilidad y sensibilidad al precio; conservar conversación y contexto. Sin cierre por número fijo de mensajes. |
| P1-04 | Evaluador neutral de la conversación | Implementado y conectado al worker: cinco fuentes obligatorias, evidencia por mensaje, alternativa opcional y citas verificadas. Pruebas reales ES/EN, trabajo de cola y ensayo completo de tres respuestas con cinco fuentes y citas completados. Validación literal no certifica pertinencia semántica; mantener evaluación de calidad con casos. |
| P1-05 | Integrar y probar el recorrido real de Ensayos | Análisis final real conectado: trabajo privado por usuario, cola/worker dedicados, persistencia24h y citas en navegación horizontal. Navegador ES/EN, errores y recuperación sin duplicar aprobados. El personaje conserva guion explícito hasta completar P1-03; no anunciar conversación generativa completa. |
| P1-12 | Herramientas de lectura y ejecución del agente en el worker | Diseño acordado en [herramientas-archivos-agentes.md](herramientas-archivos-agentes.md): worker → backend → procesador → backend → worker, con herramientas internas/HTTP sin MCP en esta etapa. Contrato de `search_text_file_id` sin gestión nueva de versiones para guías. Implementación local del 29/10: registro/dispatch worker, nodo obligatorio, API privada y función del procesador, con pruebas integradas. Biblioteca de cinco fuentes incorporada localmente y lectura integrada verificada con clientes en proceso; conexión al evaluador final implementada localmente; no se cambió ingesta del compañero. Rama compartida feature/rehearsal-source-tools, sin publicación de código autorizada. |
| P1-06 | Reputación compartida de clientes | P2 ya implementó interfaz/API/persistencia según [reputacion.md](reputacion.md). P1 continúa revisión y validación, sin duplicar el módulo. Varias personas deben poder aportar experiencias a la misma ficha de cliente. |
| P1-07 | Comprobar el flujo comunitario con dos freelancers | **Delegado a P2-08 el 28/10 por pedido de Sebastian.** Prueba integrada con cuentas autorizadas si están disponibles; distinguir SQL real, navegador con dobles y navegador conectado. |
| P1-08 | Identidad y calidad de las reseñas | **Revisión delegada a P2-09 el 28/10.** P1 conserva el análisis de IA P1-11. No fusionar homónimos ni presentar testimonios como verificaciones. |
| P1-09 | Gemini y posibilidad de compartir el modelo | Gemini sigue siendo la opción deseada, pendiente de acceso/configuración. Qwen permite pruebas locales mientras tanto. Explicar ZeroGPU después, sin desplegarlo ni cambiar proveedor sin autorización. No presuponer cobertura de los USD300. |
| P1-10 | Evaluación final contra el concurso | Al cerrar la construcción, aplicar [bases y evaluación](bases-y-evaluacion-hackathon.md) a la versión entregable y guardar evidencia por requisito. |
| P1-11 | Contexto comunitario para agentes de planificación y negociación | **Reorientado por Sebastian el 28/10:** no construir un resumen/análisis IA independiente en Reputación. Sus experiencias publicadas podrán alimentar, con permiso y citas, los agentes que ayuden a organizar el proyecto, conversar y negociar cambios. Integración futura pendiente de alcance y coordinación; no iniciar el plan de cobros ni invadir el recorrido del compañero. |

### Objetivo de Reputación

Ayudar al freelancer a decidir con qué cliente trabajar consultando experiencias de otros freelancers. Una ficha puede reunir reseñas de distintos autores, no es una nota privada que solo ve quien la creó.

No publicar automáticamente los clientes privados. Compartir es una decisión explícita; no copiar correos, contratos, conversaciones, importes o proyectos ajenos al directorio comunitario. Una experiencia declarada no acredita fraude, impago verificado ni comportamiento futuro. Trato todavía no certifica que una cuenta pertenezca profesionalmente a un freelancer.

### Experiencias como contexto para agentes

La decisión más reciente sustituye la propuesta de un análisis separado en la ficha: Reputación conserva su directorio de experiencias. Cuando se acuerde la integración, los agentes de planificación o negociación podrán usar únicamente las reseñas publicadas y autorizadas de la ficha seleccionada, no los documentos privados de otros autores. Cada afirmación debe remitir a las reseñas exactas que la sustentan. Distinguir testimonios de hechos verificados, indicar escasez/antigüedad/contradicción y evitar probabilidades de impago inventadas. Si una reseña se edita o retira, volver a comprobar las fuentes antes de presentar conclusiones como vigentes.

Las recomendaciones son precauciones de negociación, como discutir un anticipo, hitos o condiciones claras; no certifican culpabilidad ni rechazan clientes automáticamente. El texto de una reseña es material para analizar y nunca una instrucción del agente. Mantener ES/EN según output_language, citas originales, controles de identidad de ficha y fallos visibles sin simulación alternativa. Este bloque está planificado, no implementado.

## P2: grafos, portada y entrega de Reputación

Actualizado por P2 el 28/10/2026. Los estados siguientes describen trabajo local y verificaciones registradas; no implican publicación ni integración en main.

| ID | Área | Estado y evidencia | Pendiente propio / coordinación |
| --- | --- | --- | --- |
| P2-01 | Grafo conectado y presentación de negocio | Conexión con Aura y proyección de registros reales documentadas en [grafo conectado](grafo-conectado.md). El mapa prioriza documentos, propuestas, adendas, aceptación y pagos; oculta pasos técnicos de lectura. | Las relaciones actuales proceden del modelo de datos. Extraer relaciones semánticas del contenido mediante IA es una ampliación pendiente; no está conectada ni se autoriza con este reparto. |
| P2-02 | Legibilidad y navegación del mapa | Distribución automática con acuerdo inicial como referencia, flechas ortogonales, puertos exclusivos, verbos sin cruces y filtros contextuales. Regresiones de navegación y colisiones ES/EN documentadas; las relaciones originales se conservan. | **Siguiente bloque propuesto:** validar el mapa con los pedidos, adendas, pagos y devoluciones reales que entregue el compañero. Revisar selección contextual, apertura del documento y ausencia de relaciones duplicadas. Requiere acordar alcance y disponibilidad del recorrido antes de implementarlo. |
| P2-03 | Portada pública narrativa | Implementada con cámara interpolada al scroll, capas de documentos, cláusula resaltada, partículas y protagonismo final de PayPal. Fuente de cifras y contexto de la encuesta visibles. | Mantener coherencia del relato con las capacidades que efectivamente se habiliten. Cualquier nueva promesa o cifra requiere comprobar su respaldo. Sin cambios pendientes autorizados ahora. |
| P2-04 | Acceso y presentación pública de Ensayos | Login y registro separados; escena SVG con tres temperamentos, objeciones y respuestas ilustrativas, selección manual y alternancia solo cuando es visible. Pausa y movimiento reducido disponibles. | La escena pública no llama al modelo ni guarda conversaciones; P1 conecta el Ensayo privado. No duplicar su integración. |
| P2-05 | Reputación: implementación entregada a P1 | Directorio, fichas compartidas, experiencias, edición, retirada y reportes conectados a API/RPC. Pruebas SQL con dos usuarios y rollback, API y navegador documentadas en [Reputación](reputacion.md). | P1 continúa la validación multi-freelancer, identidad de fichas y P1-11. P2 no edita módulo, tablas, RPC ni análisis de Reputación en paralelo. |
| P2-06 | Verificación y cierre del último bloque | Última suite de portada: **10 pruebas Chromium aprobadas**. Sintaxis y paridad: **1.202 claves ES/EN** al cerrar el bloque; captura de la escena revisada. Ver [portada](portada-visitantes.md). | No se volvió a ejecutar toda la aplicación como parte de esta actualización documental. Antes de una entrega conjunta, comprobar los recorridos afectados contra el código integrado. |
| P2-07 | Publicación de cambios | Últimos ajustes de mapa, portada y escena permanecen locales; no se han publicado mediante este reparto. | Push, creación de PR y merge son acciones distintas. Crear y fusionar PR requieren las autorizaciones explícitas de Sebastian que correspondan; este documento no las concede. |
| P2-08 | Validación comunitaria de Reputación | SQL real con rollback, API11 y navegador11 con dobles aprobados. Correo opt-in y vista previa implementados localmente. E2E con dos sesiones reales pendiente. | Comprobar dos autores sobre una misma ficha, agregación, autoría de edición/retirada, reportes, consentimiento y aislamiento. Corregir errores reproducibles dentro de Reputación y conservar pruebas/evidencia. No crear reseñas reales de terceros para probar. |
| P2-09 | Revisión de identidad de fichas y límites de reseñas | Homónimos separados por correo, índice único, confirmación explícita y edición por autor/proyecto/ficha comprobados; límites de identidad y reporte documentados. | Probar homónimos/duplicados y detectar mensajes engañosos sobre verificación; documentar hallazgos y corregir errores claros. No construir otra plataforma de moderación, fusionar fichas automáticamente ni activar análisis de IA. |

### Archivos y límites de P2

- Contexto técnico conservado: `graph-live.mjs/css`, `graph-preview.mjs/css`, pruebas de mapa/navegación; `visitor-landing.mjs/css` y pruebas de portada. Consultar los documentos enlazados antes de retomar.
- No hay archivos reservados activamente por P2 al cerrar esta actualización. Los últimos ajustes de acceso en `connected-workspace.mjs/css` están terminados.
- Antes de editar archivos compartidos (`connected-workspace.mjs`, `app.js`, `index.html`, `boot.js`, `server.mjs`, catálogos o rutas API), comunicar a P1 las secciones exactas. La ausencia de una reserva no autoriza cambios dentro del bloque del compañero humano.
- El bloque propuesto P2-02 es una propuesta para acordar con Sebastian, no una tarea iniciada. La ingesta semántica del grafo también permanece pendiente de alcance/proveedor/contrato; no activar otro modelo ni una simulación como respaldo.

P2 no recibe tareas nuevas automáticamente por este documento. Cualquier ampliación de alcance o reasignación se acuerda antes de editar.

### Reasignación acordada el 28/10: Reputación en paralelo

Sebastian pidió a P2 tomar parte de las tareas de P1. P2 toma P2-08/P2-09 y reserva `reputation-workspace.mjs/css`, `repos/trato-api/trato_api/reputation_routes.py`, pruebas propias de Reputación y `docs/reputacion.md`. Puede añadir únicamente claves `reputation.*` en ES/EN, sin reordenar catálogos completos. P1 no editará esos módulos mientras dure el bloque.

P1 conserva `practice-workspace.*`, `rehearsal.py`, `rehearsal_routes.py`, sus pruebas y fuentes/criterios/prompts de Ensayos. P1-11 es ahora una futura integración de contexto comunitario, sin analizador independiente de Reputación; compartir contratos por documentación antes de implementarla.

Cambios en `app.py`, navegación, autenticación o migraciones requieren coordinación previa del alcance. Preferir datos ficticios y transacciones con rollback para las pruebas; no publicar testimonios atribuidos a clientes reales. Si no hay dos sesiones autorizadas para navegador conectado, completar las comprobaciones posibles y declarar expresamente ese límite. No presentar una prueba con dobles como E2E real.

El compañero humano conserva **todo el recorrido acuerdo inicial → pedido → adenda → aceptación → pago y devoluciones**, incluida su validación e integración mientras lo desarrolla. P2 no toma ese recorrido como siguiente tarea ahora. El lote anterior ya fue integrado por PR #2; esta reasignación no autoriza otra publicación, PR o merge.

## Compañero humano: alcance reservado

Sebastian indicó que su compañero continúa el flujo de solicitudes de cambio y devoluciones. P1/P2 coordinan los contratos compartidos antes de intervenir en esas partes. La evaluación final comprueba el resultado integrado, sin asumir que el trabajo pendiente ya está terminado.

### Pendiente: conectar grafos con devoluciones

Instrucción de Sebastian, 28/10/2026: integrar también las devoluciones en el grafo, **después de que el compañero termine y libere ese bloque**. Por ahora no editar su implementación, contratos ni migraciones para adelantar esta integración.

- [ ] Acordar con el compañero los registros y relaciones reales disponibles al cerrar su flujo.
- [ ] Representar solicitud, propuesta de devolución, aceptación y reembolso vinculados al proyecto y pago original, según los datos efectivamente guardados.
- [ ] Conservar el pago original y distinguir solicitud/propuesta de reembolso confirmado; no inferir estados por abrir una vista o subir un documento.
- [ ] Probar aislamiento entre proyectos, historial, fuentes y relaciones del grafo con el recorrido integrado.

Estado: pendiente de entrega y coordinación; no iniciado. El trabajo de Ensayos y Reputación puede continuar sin tocar ese bloque.

## Regla de trabajo: misma rama y publicación conjunta

Instrucción de Sebastian del 28/10/2026: P1 y P2 comparten una única rama de trabajo por lote, desde el `main` actualizado; se sustituye el reparto anterior de ramas independientes por chat. Las reservas por tarea y archivo siguen vigentes.

Antes de publicar, ambos entregan sus cambios terminados y verificaciones a una sola persona responsable. Esa persona prepara y revisa el lote conjunto, excluye secretos y archivos privados, y realiza el único push autorizado. No publicar por separado ni simultáneamente. Crear el PR y fusionarlo siguen requiriendo autorización explícita de Sebastian para ese lote.

Las ramas separadas recién preparadas no justifican mover o descartar trabajo pendiente. La raíz actual carece de checkout Git operativo: la coordinación de la rama remota no modifica los checkouts anidados. Rama compartida confirmada por ambos chats: `feature/trato-next-iteration`, creada desde `main` en `a3a931a71cafd8b8d6ae95813c3e15f99be788ec`. Las ramas individuales preparadas antes quedan sin uso para el siguiente lote; no se eliminan ni se mezclan automáticamente.

El plan de organización inicial de entregables, anticipos e hitos está documentado como idea futura; todavía no tiene implementación asignada. P1 conserva Ensayos y P2 Reputación. Su desarrollo debe coordinarse con el compañero que lleva el recorrido de negocio.

## Orden inmediato

1. P1 revisa y documenta las fuentes del evaluador.
2. P1 prueba el cliente ficticio y el evaluador por separado.
3. P1 conecta el recorrido de Ensayos y valida ambos idiomas.
4. P1 revisa Reputación con experiencias de distintos freelancers y el aislamiento de datos.
5. Documentar el contrato de experiencias publicadas que podrían consumir los agentes, sin implementar aún planificación/cobros ni un analizador independiente de Reputación.
6. Equipo integra los recorridos y evalúa la entrega contra las bases.

Al iniciar una tarea anotar fecha, archivos y resultado esperado; al terminar, evidencia y límites. Coordinar especialmente `app.py`, `connected-workspace.mjs`, `app.js`, `index.html`, catálogos y migraciones. No marcar Hecho por tener solo frontend o pruebas con dobles.

## Referencias

- [Estado y pruebas de Qwen](qwen-local.md)
- [Ensayos](modo-ensayo.md)
- [Investigación de Ensayos](investigacion-modo-ensayo.md)
- [Reputación](reputacion.md)
- [Estándar de prompts](estandar-prompts.md)
- [Bases y evaluación final](bases-y-evaluacion-hackathon.md)

## Evaluador conectado, 29/10/2026

P1 implementó lectura de cinco fuentes→Qwen en worker dedicado→citas verificadas→resultado privado en Redis→interfaz horizontal. Conversación del personaje aún de guion explícito. Estado y límites en [evaluador-ensayos-conectado.md](evaluador-ensayos-conectado.md). Sin publicación autorizada de este lote.

## Lote local IA y fuentes, 1 noviembre 2026

- P1: integracion Ensayos, Reputacion y propuesta inicial por cola/worker JSON; plan/etapas persistidos al confirmar. Consulta docs/integracion-ia-flujos.md.
- P1 con UI Reputacion coordinada P2: base vectorial privada conectada; el FP ejecuta Weaviate, backend autoriza y valida, worker mantiene orquestacion. GuíasEnsayos lectura5completa obligatoria y catalogo de fuentes en feedback. Consulta docs/busqueda-vectorial-conectada.md para limites: indexacion automatica posterior a extraccion conectada por cola, endpoint explicito para fuentes existentes; no pipeline universal ni proyeccion publica conectados.
- Configuracion nueva FP.env (URL/keyWeaviate propia y flagvectorial), API.env (solo flag); claves anteriores sinrotar. Florespull no copiara estos secretos ni la biblioteca privada. Instrucciones en docs/configuracion-vectorial-colaboradores.md. P2 informado.
- Pendiente de prueba conjunta: recorridosUI reales/Gemini y su calidad, integracion automatica del procesamiento por proposito y proyeccion de reputacion publicada. Los borradores file_pipeline siguen conservados sinactivarlos como si estuvieranterminados. No modificar flujosFlores ni publicar este lote sinautorizacion nueva.


## Cierre local P1, 1 noviembre 2026

Procesamiento por proposito y proyeccion de textos de reputacion publicados conectados; esquema Weaviate compartido actualizado y validado, sin nueva coleccion ni inferencias. Migracion exacta 20261101212324 aplicada y documentada. API239, worker128 con11omisiones, FP26: comprobaciones correctas con dobles. Falta prueba conjunta UI/Gemini, activar deliberadamente pipeline en el entorno, productor de casos de devolucion de Flores y adjuntos privados de reputacion. No publicar esos limites como funcionalidades terminadas. Lote local sin push/PR/merge; instrucciones del colaborador en docs/configuracion-vectorial-colaboradores.md.
