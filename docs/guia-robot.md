# Robot guía por sección

2 de noviembre de 2026. Implementación local pedida por el responsable del proyecto. Es ayuda de uso con textos preparados, separada del asistente de IA que consultará documentos del proyecto.

## Uso

Con sesión validada, el botón Guía aparece abajo a la derecha. Un clic abre un robot con pasos breves, un borde que señala el elemento explicado y botones Anterior, Siguiente y Terminar. Cerrar y Escape también terminan la guía. No se abre automáticamente ni ejecuta controles, pagos, envíos o consultas al backend. Al cambiar de proyecto, pedido, pestaña o cerrar sesión, la guía se cierra. No conserva datos privados ni conversaciones.

## Cobertura

Inicio, Clientes, proyectos del cliente, Proyecto, Plan, Cambios, comparación de fuentes, seguimiento de una adenda, Devoluciones, Documentos, Historial y Mapa. Ensayos distingue configuración, conversación y análisis. Reputación incluye el sentido de las experiencias y sus límites. Los pasos apuntan solo a controles visibles; no explican un formulario o botón que no está en pantalla.

Los textos de interfaz son ES/EN, sencillos y sin rayas largas. La mascota proporcionada por el responsable del proyecto se sirve desde assets/mascot/trato-guide.png y usa CSS propio, con animación breve al abrir y respeto a la preferencia de movimiento reducido. No se añade una biblioteca de tours ni un proveedor externo.

## Archivos

section-guide.mjs/css, integración mínima en boot.js, index.html y allowlist de server.mjs. Catálogos guide.* en locales. npm run check incluye el nuevo módulo. Pruebas de contrato en tests/section-guide.test.cjs cubren sesión, contexto de pestaña/proyecto/pedido, apertura voluntaria, pasos, cierre, limpieza, idiomas y ausencia de rayas largas.

Validación visual pendiente del usuario conforme a la etapa acordada. No se realizó despliegue, publicación Git ni llamada a modelos. Local iniciado con dev-polyrepo.py --with-ai después de comprobar puertos propios libres. otros proyectos locales permanece separado.

La mascota original se conserva sin editar. Los botones funcionales de cerrar y navegar mantienen iconos Lucide. El PNG tiene transparencia y no utiliza servicios externos.
