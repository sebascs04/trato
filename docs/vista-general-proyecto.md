# Vista general del proyecto

27 de octubre de 2026. Pedido de Sebastian: Proyecto sirve como entrada y resumen de todos los apartados, además del acuerdo inicial.

- Acuerdo inicial: conserva Añadir información y muestra las dos fuentes más recientes. El resto se consulta en Documentos.
- Cambios: vista previa de los dos pedidos más recientes, con el estado de negocio ya recibido. Ver cambios abre la pestaña completa; no duplica alta, revisión ni edición de propuestas.
- Devoluciones: acceso a su apartado, sin inventar cantidades ni resultados del simulador como registros reales.
- Documentos: tres archivos recientes, título y nombre del archivo, con acceso a la biblioteca por pedido.
- Historial: acceso al seguimiento y mapa. No solicita eventos ni sincroniza Neo4j hasta abrir su vista.

El resumen utiliza documentos/propuestas/estado ya cargados del proyecto. No añade consultas ni calcula precio, alcance o fechas a partir de texto no analizado. Las cargas, permisos, flujos de cambios y grafo permanecen intactos.

Implementación acotada: renderAgreement en connected-workspace.mjs, estilos cloud-overview en connected-workspace.css. Pruebas nuevas tests/browser/project-overview.spec.cjs cubren previews sin duplicar controles, navegación, carga diferida del historial y proyecto vacío. Datos/Auth de navegador son dobles explícitos; no crean registros.
