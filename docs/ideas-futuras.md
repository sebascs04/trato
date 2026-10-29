# Trato — ideas futuras para explorar

Fecha: 21 de octubre de 2026. Son hipótesis de producto, no funciones implementadas, novedades verificadas ni beneficios medidos. No amplían el alcance actual automáticamente.

Investigación posterior sobre modelos predictivos, datasets y competidores en `investigacion-prediccion.md` (23 de octubre). No se decidió un cambio de público ni se implementó un predictor.

## Qué premia el hackathon

Las bases describen cinco criterios de igual peso: implementación tecnológica, diseño, impacto potencial, innovación/idea y presentación. Además hay menciones de Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI y Best Use of Agentic Commerce.

Fuentes oficiales consultadas:
- https://paypalaihackathon.devpost.com/rules
- https://paypalaihackathon.devpost.com/

La creatividad puede ser una interacción que resuelva mejor el problema; no exige añadir un juego. Mostrar una función futura en un roadmap no equivale a demostrarla funcionando.

## 1. Negociación con alternativas de alcance — prioridad de exploración alta

**Problema:** el cliente pide más trabajo pero su presupuesto o plazo no cambia. Cobrar el extra no siempre es una alternativa viable.

**Propuesta:** el agente prepara tres acuerdos posibles sobre el mismo proyecto: ampliar el presupuesto, intercambiar un entregable aún no iniciado o dividir la entrega en fases. Calcula diferencias con tarifas y estimaciones aportadas por el profesional. Si faltan, pregunta. El profesional aprueba las opciones antes de mostrarlas al cliente.

**Experiencia:** solicitud → comparación con versión aceptada → opciones con precio, plazo y alcance → elección del cliente → aceptación versionada → solicitud de pago PayPal cuando corresponda.

**Uso de IA:** interpretar el cambio y preparar alternativas coherentes con las restricciones. Reglas y cálculos monetarios deterministas fuera del LLM.

**Uso de PayPal:** cobrar la alternativa aceptada. Si no hay diferencia de precio, registrar el acuerdo sin inventar un cobro.

**Prueba de demo:** mostrar cómo el mismo mensaje se transforma en opciones y terminar con un pago sandbox verificable.

**Validación:** comprobar si freelancers y clientes entienden las opciones y si estas facilitan acuerdos. No prometer que mejorará la aceptación o los ingresos sin medirlo.

**Datos futuros:** proposal_options, proposal_option_items y acceptances relacionados con requests y documentVersions. No duplicar el contrato completo por cada tarjeta; mantener referencias y diferencias estructuradas.

## 2. Simulador de conversaciones difíciles — juego opcional

**Problema hipotético:** un freelancer reconoce que debe cobrar o poner límites, pero no sabe cómo expresarlo sin dañar la relación.

**Propuesta:** práctica breve donde la IA representa a un cliente que pide una revisión extra, cuestiona el precio o retrasa un pago. El freelancer ensaya su respuesta y recibe comentarios basados en el acuerdo del caso, sin presentar una respuesta como única solución correcta.

**Mecánica:** sesiones de dos minutos, escenarios voluntarios y objetivos como aclarar el alcance, proponer alternativas y acordar el siguiente paso. Evaluar claridad y fidelidad al acuerdo, no agresividad ni presión al cliente. Sin rankings públicos, recompensas monetarias ni apuestas.

**Uso de PayPal:** en un escenario de entrenamiento, el cierre puede recorrer un pago sandbox, claramente etiquetado. Un juego aislado tendría una integración PayPal más débil que el producto principal; se propone como función secundaria.

**Datos futuros:** training_sessions y training_turns separados de conversations/messages de proyectos reales. Nunca confundir un turno del juego con una aceptación, mensaje enviado, invoice o pago real.

**Validación:** comprobar si los usuarios eligen practicar y si les resulta útil; no asumir que quieren jugar. No usar mensajes privados de otros clientes para generar situaciones sin permiso.

## 3. Mapa visual de cómo cambió el acuerdo

**Problema:** presupuesto, mensajes, entregables y cambios quedan repartidos; el cliente y el freelancer recuerdan acuerdos distintos.

**Propuesta:** una línea de tiempo muestra qué se acordó, qué cambió, quién lo aceptó y el efecto en alcance, precio y fecha. El cliente puede revisar el mismo registro con acceso limitado a su proyecto.

**Uso de IA:** proponer la extracción de cambios desde mensajes y enlazarlos a cláusulas. La aceptación debe registrarse explícitamente, no inferirse del silencio.

**Uso de PayPal:** asociar cada cambio aceptado a su invoice y mostrar el estado verificado; no marcarlo pagado por un texto del cliente.

**Distinción del historial existente:** el historial cuenta eventos. Esta vista compara versiones de alcance y permite entender sus diferencias.

**Datos futuros:** scope_changes y acceptances vinculados a versiones. Fechas, precios y entregables como campos, además de texto explicativo.

## 4. Copiloto de entrega y cierre del proyecto

**Problema hipotético:** el freelancer no sabe si una petición es una revisión incluida, un extra o una corrección de algo incumplido.

**Propuesta:** revisar una lista de entregables con el cliente antes de cerrar. Cada punto puede aceptarse, pedir aclaración o dar lugar a una revisión/extra. La IA propone la clasificación y explica su evidencia; ambas partes revisan.

**Uso de PayPal:** cobrar un saldo o extra aprobado, y registrar la conciliación de un reembolso acordado cuando corresponda.

**Límites:** no es escrow ni garantía de calidad o de cobro. No retener archivos o derechos sin condiciones explícitas y validadas. Empezar con metadatos/checklist; no prometer evaluación automática de calidad de video o diseño.

**Datos futuros:** deliverables, review_requests y acceptance_records. Separar aceptación de entrega, autorización de cobro y pago confirmado.

## 5. Asistentes de ambas partes negocian un borrador — exploración posterior

El cliente y el freelancer podrían definir restricciones para sus propios asistentes, que preparan alternativas de acuerdo. Cada parte aprueba explícitamente el resultado antes de un pago. Es potencialmente vistoso para una demo de comercio con agentes, pero exige permisos y revisión de ambos lados y puede añadir más complejidad que valor.

No dar a un agente del freelancer acceso al historial privado del cliente ni al de otros freelancers. Separar propuestas compartidas de instrucciones privadas. No habilitar compras o reembolsos autónomos por defecto. Validar primero la negociación con alternativas de la idea 1.

## Recomendación provisional

### Actualización de el equipo · 24 de octubre de 2026

**Modo ensayo:** nombre elegido para el simulador de conversaciones difíciles de la idea 2. La IA representa a un cliente para practicar objeciones sobre alcance, precio y plazos, usando el acuerdo y la solicitud como contexto. El entrenamiento no predice la conducta del cliente ni registra una aceptación real. el equipo manifestó especial interés en esta función; queda para una etapa posterior al recorrido funcional principal.

**Investigación retomada ·25deoctubre:** el equipo pidió recuperar esta dirección y contrastarla con referentes profesionales. La ampliación, con observación de las cuatro páginas y referencias de Linear/Atlassian para el área de trabajo, está en [investigacion-ux-trato-2026-10-25.md](investigacion-ux-trato-2026-10-25.md). Se documenta investigación; no implica implementación ni despliegue.

**Portada cinematográfica con scroll — pendiente, sin prioridad actual.** el equipo pidió anotar esta dirección visual para retomarla después; no implementarla ahora ni sustituir el espacio de trabajo existente.

Referencias compartidas, con Polpharma como favorita:

- https://www.polpharmabiologics.com/
- https://71three.com/
- https://stillhere.hdfund.org/
- https://potadot.com.my/

Efecto buscado: una escena continua con un objeto protagonista que cambia de encuadre, posición y escala mientras aparecen textos al avanzar. Referencia conceptual adicional: una estatua romana con movimientos de cámara entre explicaciones. No limitarlo a una esfera flotante o pequeñas animaciones decorativas.

Propuesta para Trato: acuerdo en el centro → acercamiento a una cláusula → correo con nuevo pedido → conexiones con entregables afectados → alternativas → adenda → pago PayPal. El movimiento debe explicar el recorrido. Reservar esta experiencia para la portada de presentación; mantener clientes y documentos rápidos y legibles.

Inspección técnica realizada: Polpharma carga Unicorn Studio, GSAP/ScrollTrigger, Lenis y videos; 71Three usa animaciones vinculadas al scroll, secciones fijadas y tarjetas con perspectiva/rotación, además de canvas y video. Esto permite explorar una combinación de documentos animados, perspectiva CSS y una escena protagonista. No se observó la animación en un navegador interactivo ni se confirmó el funcionamiento de cada escena de Polpharma; parte de su JavaScript personalizado devolvió 403. No asumir que todo requiere 3D en tiempo real ni copiar sus recursos.

**Orden acordado:** completar primero autenticación, persistencia, IA, aceptación, cobro PayPal y correo; después retomar el diseño de esta portada y el Modo ensayo. Esta anotación no implica despliegue ni cambios de interfaz.

Explorar primero una sola mejora distintiva: **negociación con alternativas**. La línea de tiempo de acuerdos puede apoyarla con evidencia visual. El simulador se mantiene como experimento opcional después de validar interés. No construir cinco módulos por acumular funcionalidades.

Antes de llamar disruptiva o novedosa a una idea, contrastar alternativas actuales y observar usuarios reales. El éxito del hackathon dependerá también de que la integración funcione y la demo comunique un problema específico.

### Investigación del Modo ensayo · 27/10/2026

Se retomó la idea 2 a petición de el equipo. Hay testimonios freelance sobre miedo a cobrar extras y evidencia limitada de utilidad de la preparación con IA; también hay estudios que favorecen una guía estructurada frente a chats extensos. La categoría tiene competidores, incluido Negosim con tarifas freelance. La recomendación es validar un ensayo breve y opcional dentro de un pedido, con fuentes y salida a un borrador, sin efectos sobre acuerdos ni pagos.

Evidencia, limitaciones, recorrido propuesto y prueba con usuarios en [investigacion-modo-ensayo.md](investigacion-modo-ensayo.md). No se ha demostrado demanda de Trato ni se activaron modelos o pantallas nuevas por esta anotación.


### Reputación y organización de cobros ·28/10/2026

el equipo autorizó una sección Reputación debajo de Ensayos: fichas compartidas de clientes con experiencias de distintos freelancers, dentro de la aplicación autenticada. Implementación y límites en [reputacion.md](reputacion.md). Compartir es explícito; no se vuelca el directorio privado ni se declara fraude o impago verificado por una puntuación.

**Decisión posterior del mismo día:** Reputación conserva el directorio de experiencias; no se añade un análisis de IA independiente solo para sumar IA a la sección. Las experiencias publicadas podrían servir de contexto con fuentes a los agentes de organización del proyecto, conversación y negociación. Esta decisión reemplaza la propuesta anterior de un resumen IA separado en la ficha. Mantener permisos, identidad del cliente, antigüedad, contradicciones y citas; las reseñas siguen siendo testimonios, no hechos contractuales ni decisiones de pago. No activa todavía esa integración ni el plan inicial de cobros.

el equipo prefiere explorar cómo organizar pagos al comenzar un proyecto antes que dar prioridad a recordatorios por impagos: un mensaje de IA no obliga a pagar a quien ignora al profesional. Se propone separar el futuro plan de entregables/pagos por etapas de Reputación y de Ensayos. Esta conversación no autoriza todavía implementar cobros iniciales, una pasarela nueva, reportes externos o envíos automáticos. No presentar pagos fraccionados como protección garantizada ni confundir una opinión compartida con una resolución de PayPal.

#### Plan del proyecto y de cobros desde el inicio

**Objetivo propuesto:** ayudar al freelancer a preparar el trabajo antes de comenzarlo, definiendo entregables, hitos, criterios de aprobación, anticipo y momento de cada cobro. Separa la planificación preventiva de la gestión posterior de cambios o impagos.

**Recorrido por explorar:** el profesional aporta alcance, presupuesto y condiciones; la IA identifica datos ausentes y propone una organización revisable; el profesional ajusta y comparte el plan; se registra qué versión aceptaron las partes. Solo después se habilitarían los cobros que correspondan, con autorización y estado de pago verificado por backend.

**Límites:** no elegir un porcentaje de anticipo como regla universal, prometer que los hitos evitan impagos ni presentar un pago como escrow. Las tarifas, estimaciones y condiciones proceden del profesional; la IA no inventa acuerdos ni cobra por decidir un plan. Faltaría validar esta propuesta con usuarios y concretar el producto/API PayPal que se usaría.

**Estado:** idea futura documentada, sin implementación iniciada ni modificaciones al flujo contractual. El compañero humano está desarrollando el recorrido acuerdo inicial → pedido → adenda → aceptación → pago y devoluciones; no intervenir en ese bloque para adelantar esta idea. Cuando lo libere, acordar alcance y contrato de la planificación antes de escribir código.
