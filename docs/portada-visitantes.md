# Portada para visitantes

28/10/2026. Sebastian pidió sustituir la pantalla repetida de acceso sin sesión por una presentación elegante inspirada en Polpharma,71Three,StillHere yPotadot, con una escena continua al hacer scroll. Después pidió que la historia explicara el problema con porcentajes sustentados y destacara IA yPayPal, junto a la solución y el impacto buscado. Esta autorización corresponde a la portada local; no autoriza PR, merge, despliegue, envíos ni nuevas operaciones financieras.

## Experiencia

- Sin sesión: portada completa, sin sidebar ni panel privado repetido. Header con recorrido, estudio, idioma, inicio de sesión y registro.
- Sesión guardada: se conserva la restauración del espacio privado, sin sustituir un fallo autenticado por una demo. Un error de configuración sin sesión permanece visible en la portada con opción de reintentar.
- Escena propia con perspectiva CSS3D: documento extruido, pedido nuevo, preparación revisable y cobroPayPal. Documento y tarjetas cambian de encuadre al avanzar por acuerdo→pedido→adenda→pago. No se copiaron recursos de las referencias ni se añadió una dependencia3D o CDN.
- Narrativa principal IA→revisión/aceptación humana→PayPal→verificación del pago. Reputación,Ensayos y mapa aparecen como apoyo.
- El texto sobre impacto expresa objetivos (menos ambigüedad, trazabilidad y contexto), no resultados medidos o porcentajes de mejora inventados. La portada es presentación; no sustituye la demo funcional que exigen las bases.
- Acceso al formulario real de Trato, sin envío automático de credenciales. El CTA de registro pone Crear cuenta como acción principal y usa autocomplete=new-password. La confirmación por correo ya no indica entrar desde un perfil oculto al visitante.
- Movimiento pausables y prefers-reduced-motion; la activación manual puede habilitarlo explícitamente. Recursos locales, sin bucleRAF cuando no hay scroll/resize ni lecturas de datos privados para mostrar la presentación.

## Cifras y fuente

Fuente primaria comprobada el28/10/2026: https://www.leapers.co/research/2025/report/ , informe publicado7/1/2026, datos2025.

-67,5% reportó retrasos de pago.
-26,4% reportó impagos.

Encuesta online a1.013trabajadores independientes del Reino Unido,1octubre–15noviembre2025, muestra voluntaria no ponderada, respuestas válidas variables por pregunta. La portada muestra ese contexto y enlaza el informe. No presentar cifras como estimación mundial, peruana, de usuarios de Trato o prueba de que el producto recupera dinero. Se citan datos fácticos con texto propio; no se reproduce una gráfica, testimonio ni material creativo del informe.

La escena es ilustrativa, sin nombres de clientes ni transacciones reales. La demostración de pago está identificada como PayPalSandbox. El panel de IA describe el enfoque de asistencia/revisión, sin afirmar que la integración de modelos pendiente ya esté activada por mostrar la portada.

## Archivos y verificación

visitor-landing.mjs/css, carga desdeboot, contenedorindex, allowlistserver, iconosLucideplay/pause y catálogoslanding.*ES/EN. El módulo envuelve syncChrome desdefuera sin sustituir lógica privada; connected-workspace solo cambia el mensaje de confirmación del registro. Rama remota preparada feature/visitor-landing, sin push de código ni operacionesPR.

Pruebas: suite58browser (57aprobadas; fallo de localizador ambiguo al haber dos botones Iniciar sesión corregido para limitar el envío al diálogo), revalidación del acceso y portada después. Cubren portada ES/EN, origen de cifras, no consultas privadas al visitar, fases de escena, registro, sesión guardada, logout, movimiento reducido y error visible. npm test35PASS y npm run check (1180clavesES/EN)PASS. Capturas inspeccionadas en.local/browser-tests/visitor-hero.png yvisitor-story.png con transporte API explícito de prueba.


## Refinamiento de movimiento y acceso ·28/10/2026

Sebastian pidió ampliar la dirección más allá de su favorita. Se retomaron las notas de Polpharma (encuadres), 71Three (jerarquía y entradas), Still Here (continuidad espacial) y Potadot (motivo continuo), sin copiar recursos. La escena CSS conserva el documento como protagonista: cámara interpolada entre centros de capítulos, desplazamiento suave con ratón, separación de hojas, cláusula resaltada, partículas orbitales, marcador de etapa y entrada gradual de secciones. PayPal toma el primer plano en la última etapa. No se añade motor3D ni dependencia. Pausa y preferencia de movimiento reducido detienen los efectos; el contenido continúa accesible.

Entrar y crear cuenta ahora abren modos independientes con un único envío principal, contraseña con autocomplete correspondiente y enlace para alternar conservando solamente el correo. Se elimina la mutación cosmética del formulario desde la portada. Perfil y rutas de sesión conservan su comportamiento.

Verificación: 7 pruebas de portada aprobadas (ES/EN, cambio de modo, cámara y pausa incluidos), comprobación visual de la separación de hojas y paridad1184claves. Sin publicación, PR ni merge.

## Escena pública de Ensayos ·28/10/2026

Se añade antes de las herramientas una conversación ilustrada con tres temperamentos seleccionables: tranquilo, con dudas y molesto. Ilustración SVG original de personaje con expresiones, parpadeo y gestos; cambian su objeción y una posible respuesta del freelancer. Los textos son ejemplos editoriales ES/EN identificados como ensayo, sin inferencia, aceptación ni comunicación real.

La alternancia cada7,5segundos solo se programa mientras la sección es visible, la portada está abierta y el movimiento está habilitado. La pausa de la escena y la del documento comparten estado y etiquetas accesibles; movimiento reducido comienza pausado. La selección manual permanece disponible incluso en pausa. Al ocultar la portada se elimina el temporizador.

Verificación:10pruebas Chromium aprobadas, incluidas selección de temperamento ES/EN, alternancia y pausa con reloj controlado. Composición revisada en.local/browser-tests/visitor-practice.png. npm run check:1202claves ES/EN. Solo visitor-landing.mjs/css, catálogos y pruebas; sin cambios al Ensayo privado ni al proveedor.
