# Vista general personal

## Referencias y criterio

Revisión del 4/11/2026:

- [Carbon Design System: dashboards](https://www.carbondesignsystem.com/building-blocks/data-visualization/dashboards). Priorizar la información relevante, establecer una jerarquía clara y agrupar con espacio suficiente.
- [Nielsen Norman Group: 8 Design Guidelines for Complex Applications](https://www.nngroup.com/articles/complex-application-design/). Facilitar retomar el trabajo y mantener la información secundaria disponible sin saturar la pantalla.

Aplicación a Trato: Inicio permite continuar el proyecto seleccionado, acceder a sus acciones y preparar el siguiente encargo. No reproduce documentos, historial o el recorrido completo de una solicitud.

## Implementación actual

- Introducción: TeTrato y un botón para abrir la demostración de cambios o devoluciones. Sustituye el bloque del último proyecto por decisión del usuario.
- Clientes: hasta dos accesos con nombre y correo, cantidad real del directorio cargado y acción para añadir un cliente. El directorio completo se enlaza cuando existe proyecto seleccionado o hay más de dos clientes.
- Reputación y Ensayos: dos tarjetas próximas, con propósito y destino explícitos.
- Clientes y demostración ocupan el ancho disponible. Sin clientes: una sola acción para crear el primero.
- Tipografía de contenido de 15 px, títulos diferenciados, botones con texto, foco visible e iconos Lucide. Catálogos ES/EN.

Inicio reutiliza el estado autorizado ya cargado. No consulta documentos, propuestas, pagos o historial adicionales. La caché de proyectos se carga por cliente y no representa un agregado global: no se usa para inventar totales financieros o estados de otros proyectos. Los accesos del proyecto mantienen los IDs seleccionados y bloquean navegación durante operaciones en curso.

## Backlog revisado

Main `aa8625dae90e7961020a8782725886972b3e9b13` incorpora los pendientes del responsable de cambios y devoluciones en `docs/backlog.md`:

- TRATO18: cierre persistente y restricciones de proyecto finalizado.
- TRATO19: cobro inicial del proyecto mediante PayPal Sandbox, separado de las adendas.

La vista no añade controles que den por implementados esos pendientes. Cambios locales, sin publicación ni despliegue implícitos.

## Actualización segura del workspace

