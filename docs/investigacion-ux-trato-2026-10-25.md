# Referencias UX para Trato — 25 de octubre de 2026

## Pregunta

Sebastian encuentra confusa la interfaz de cambios y pide investigar cómo resuelven productos profesionales la gestión de proyectos, documentos y aprobaciones. Esto es una propuesta de diseño, no una nueva especificación implementada.

## Referencias primarias consultadas

- HoneyBook, Navigate a project: https://help.honeybook.com/en/articles/11648189-navigate-a-project
  El proyecto contiene comunicaciones, archivos y detalles de un trabajo concreto; su cabecera identifica el proyecto y al cliente. Separa actividad, archivos y otras funciones del espacio persistente.
- Bonsai, All about Projects: https://help.hellobonsai.com/en/articles/12783206-all-about-projects
  Espacio de proyecto que reúne documentos, enlaces y actividad. Sirve como referencia de continuidad del contexto, sin copiar toda su amplitud funcional.
- Nielsen Norman Group, Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/
  Distingue mostrar funciones secundarias a demanda de dividir una tarea en pasos. Advierte sobre excesivos niveles y recorridos interdependientes que obligan a ir y volver.
- Nielsen Norman Group, Wizards: https://www.nngroup.com/articles/wizards/
  Un asistente corresponde a una secuencia concreta de tareas dependientes, con avance, retroceso y cancelación. No todo un producto necesita comportarse como un asistente.
- GOV.UK, Task list: https://design-system.service.gov.uk/components/task-list/
  Apropiada cuando hay evidencia de tareas que se completan en varias sesiones y cuyo orden puede elegir el usuario; no corresponde a una secuencia estricta.
- GOV.UK, Complete multiple tasks: https://design-system.service.gov.uk/patterns/complete-multiple-tasks/
  En determinados tipos de tareas conviene que el usuario indique expresamente cuándo terminó. Esto respalda no deducir finalización del hecho de subir archivos.
- Atlassian, Empty state: https://atlassian.design/components/empty-state/
  Un espacio vacío debe explicar qué puede hacer el usuario a continuación.

## Diagnóstico de nuestra pantalla (interpretación propia)

1. La cabecera Clientes, el selector de proyecto y otra tarjeta de proyecto repiten contexto y ocupan espacio antes de la tarea.
2. El proyecto es un espacio de trabajo persistente; gestionar un cambio es una tarea opcional dentro de él. Sus navegaciones deben distinguirse.
3. La pantalla Revisar cambio actualmente muestra fuentes completas en dos columnas. Permite comprobarlas, pero deja al usuario el trabajo de encontrar y entender las diferencias.
4. Cambiar etiquetas o añadir botones sucesivos no resuelve la relación entre información, decisión y resultado de cada pantalla.
5. Se necesita coherencia al volver al proyecto o retomar un pedido. Estados de negocio y navegación son cosas distintas: abrir una pantalla no implica revisar, aprobar ni enviar nada.

## Propuesta para validar antes de otra implementación amplia

### Espacio del proyecto

Cabecera compacta: Clientes / cliente1 / Proyecto del cliente 1. El título principal identifica el proyecto, no vuelve a decir Clientes. Solo aquí: resumen de lo acordado, información/fuentes y lista de pedidos de cambio con sus estados.

En proyecto vacío, una acción principal Añadir información y una explicación breve. Con fuentes guardadas, se puede seguir añadiendo y elegir Revisar lo acordado, sin avance automático. Un proyecto sin pedidos nuevos sigue siendo un estado válido.

### Recorrido de un cambio concreto

Se entra desde el pedido guardado. Mantiene título y estado del pedido durante el recorrido:

1. Entender el pedido: qué pidió, qué cubría el acuerdo y qué necesita confirmación.
2. Preparar propuesta: opciones y efectos en alcance, costo y plazo, revisados por el profesional.
3. Revisar y enviar: vista de la propuesta/adenda y acción explícita de envío.

Después del envío corresponde seguimiento de estados, no fingir que otra pantalla de lectura equivale a aceptación. Aceptación y cobro siguen las reglas de negocio acordadas con P1.

Las fuentes completas se abren bajo demanda desde cada afirmación o en un panel de respaldo. Son comprobación y contexto; la vista de decisión necesita una síntesis revisable y referencias verificables. No mostrar una síntesis inventada mientras se conecta el análisis.

### Una pantalla, una decisión principal

El usuario debe poder responder: dónde estoy, qué estoy revisando, qué debo decidir y qué ocurrirá al pulsar el botón principal. Los estados disponibles deben salir de datos reales; una carga de archivo no concluye automáticamente una tarea ni acepta un acuerdo.

## Validación propuesta

Probar un esquema de tres vistas con las tareas que Sebastian ya describió:

- Crear cliente/proyecto, guardar dos fuentes y salir sin iniciar un cambio.
- Volver al proyecto, consultar lo acordado e incorporar otra fuente.
- Abrir un pedido nuevo, entender su relación con el acuerdo y preparar una propuesta sin enviarla accidentalmente.

Este documento recoge investigación y una hipótesis de diseño. Las fuentes no acreditan que esta propuesta ya haya sido validada con usuarios de Trato.

## Ampliación: dirección visual ya acordada en el otro chat

Se localizó la propuesta en `docs/ideas-futuras.md`, sección «Actualización de Sebastian · 24 de octubre de 2026», a partir de la línea87. La favorita registrada es Polpharma. Se trata de una portada cinematográfica: una escena continua cuyo objeto cambia de encuadre, posición y escala a medida que avanza la historia. Referencia conceptual: una estatua romana y movimientos de cámara, no solo una figura decorativa flotante.

El recorrido visual anotado para Trato era acuerdo → cláusula → correo de pedido → entregables afectados → alternativas → adenda → pago. El documento reserva este tratamiento a la presentación, manteniendo el espacio de trabajo legible. La petición del25octubre retoma la investigación de esta dirección; no se ha implementado una nueva portada ni sustituido la aplicación.

### Referencias visitadas y observación directa

Se abrieron las cuatro páginas en Chromium1365×900, sin autenticación ni interacción con formularios. Se guardaron capturas iniciales y posteriores a un desplazamiento en `.local/design-research/`, junto con `inspection.json`. Fue una observación puntual de escritorio, no una auditoría completa de su animación, rendimiento o versión móvil. Parte de las primeras capturas corresponde a introducciones en carga; no confundirlas con su composición definitiva.

| Referencia | Evidencia observada | Qué explorar para Trato |
| --- | --- | --- |
| [Polpharma](https://www.polpharmabiologics.com/) | Composición inicial a pantalla completa, volúmenes superpuestos, titulares grandes y serif. La captura posterior muestra otro bloque narrativo con navegación persistente | Objeto documental protagonista y cambios de encuadre que expliquen el producto |
| [71Three](https://71three.com/) | Introducción con marca; después aparece una portada clara de gran tipografía, pocos elementos y navegación breve | Titulares precisos, jerarquía fuerte y pocas acciones principales |
| [Still Here](https://stillhere.hdfund.org/) | Escena interior a pantalla completa, título y paso de una puerta cerrada a abierta entre capturas | Continuidad espacial entre momentos de la historia; no trasladar sus imágenes ni temática a Trato |
| [Potadot](https://potadot.com.my/) | Introducción con objeto formado por puntos; después una portada clara con ese objeto, titular y acciones | Continuidad de un motivo visual entre introducción, relato y llamada a la acción |

No atribuir toda diferencia entre estas capturas al scroll: también transcurrió tiempo de carga/animación. Para estudiar la coreografía exacta haría falta una observación más larga de cada tramo. Se detectaron canvas y GSAP en páginas, pero eso no demuestra qué recurso genera cada efecto ni obliga a usar la misma tecnología.

### Referencias adicionales para el espacio de trabajo

- [Linear: A calmer interface for a product in motion,12mar2026](https://linear.app/now/behind-the-latest-design-refresh). Sus diseñadores explican cómo redujeron el protagonismo de la navegación y suavizaron separadores para que la tarea principal recupere atención.
- [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui). Documentan explorar conceptos y comprobar su coherencia en distintos tipos de vista antes de la implementación general. La legibilidad y alineación de cabeceras, paneles y controles son parte de la propuesta.
- [Atlassian: Motion](https://atlassian.design/foundations/motion). El movimiento debe aclarar cambios, mantener contexto y apoyar la rapidez. Los elementos pequeños y frecuentes requieren una expresión más sutil que una presentación de marca.

### Síntesis propuesta para Trato (interpretación propia)

Una identidad común puede expresarse de manera distinta en presentación y trabajo:

- **Portada:** escena de un acuerdo/documento que conecta el problema con el resultado. Pocas frases, tipografía protagonista y transiciones narrativas. Estudiar el ritmo antes de elegir una biblioteca o contratar recursos3D.
- **Aplicación:** cabecera compacta con cliente/proyecto/pedido actual; área central para trabajar; lectura cómoda; documentos originales en un panel contextual; navegación discreta y acciones en lugares estables.
- **Revisión del cambio:** resultado revisable al centro, fuente accesible al lado. Separar qué pidió, qué cubre el acuerdo y qué requiere aclaración. Una comparación de textos enteros sirve de respaldo; por sí sola no entrega esa síntesis.
- **Coherencia:** conservar identidad de Trato, definir escalas tipográficas/espaciado/superficies/estados y comprobarlas en proyecto vacío, proyecto con fuentes y pedido de cambio. No deducir que toda interfaz moderna debe ser oscura o animada.

El siguiente entregable de diseño sería un esquema visual coherente de esas tres vistas operativas, más un guion independiente de la portada. La investigación actual no demuestra que una propuesta nueva ya haya pasado pruebas con usuarios.
