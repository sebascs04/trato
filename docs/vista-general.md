# Vista general del estudio

## Referencias y criterio

Revisión del 27/10/2026:

- Nielsen Norman Group, Progressive Disclosure: https://www.nngroup.com/articles/progressive-disclosure/ — priorizar opciones frecuentes, detalles a demanda y enlaces con destino claro.
- Carbon Design System, Empty states: https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states — explicar el siguiente paso cuando no hay datos, sin rellenar espacio con contenido irrelevante.

Aplicación propia a Trato: Inicio sirve para retomar trabajo y acceder a las funciones existentes. No debe duplicar documentos, historial o el recorrido de una solicitud.

## Implementación actual

- Proyecto abierto: nombre y cliente reales, con enlace para continuar en su espacio. Si no hay proyecto seleccionado, orienta a elegir o crear un cliente.
- Clientes: lista breve con nombres/contactos autorizados ya cargados, cantidad de registros y enlace al directorio completo.
- Ensayos: acceso al recorrido de práctica disponible.
- Sin datos: texto y acción para crear el primer cliente. La vista conserva los estados de acceso, error y carga existentes.

La navegación a Inicio no consulta documentos, propuestas, pagos o historial adicionales. Se reutiliza el estado autorizado cargado; no se presentan registros de otros proyectos como cifras globales. Los indicadores financieros y de tareas globales requieren un contrato de agregación del backend antes de mostrarse. No se calculan con una lista parcial de proyectos ni se usan fixtures como datos conectados.

La interfaz tiene ES/EN y usa Lucide. Cambios locales, sin publicación ni PR implícitos.
