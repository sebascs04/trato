# Navegación al recargar

27 de octubre de 2026. La recarga conserva cliente, proyecto y pestaña; Historial conserva Historial/Mapa. Comparar restaura el pedido y relee sus fuentes; los detalles de adenda restauran el pedido y la instantánea de revisión exacta mediante GET.

La ubicación se guarda en sessionStorage de esa pestaña, con namespace del servidor de Auth y usuario verificado por /api/v1/session. Se conservan únicamente IDs y selección de vista; nunca documentos, importes, autorizaciones, formularios, contraseñas ni contenido de conversaciones. Salir de la cuenta elimina su ubicación.

Antes de restaurar se vuelven a consultar clientes y proyectos autorizados, incluidos filtros por cliente. Una ubicación guardada no concede acceso. Si ya no existe el proyecto, se muestra la lista autorizada del cliente; si desapareció el pedido, se explica y se vuelve a sus pedidos. Fallos de red se muestran con reintento, conservando la ubicación guardada; no se presenta un proyecto vacío como sustituto.

No se guardan ni reproducen comandos de envío, aceptación o pago. El mapa mantiene su sincronización bajo demanda al abrirlo. No se recuperan formularios o modales sin guardar. La ubicación queda en esa sesión de navegador, no se sincroniza entre dispositivos.

ConnectedWorkspace guarda al notificar cambios de vista y restaura después de autenticar y cargar los datos. ProposalWorkspace expone un único método de restauración que reutiliza el lector de detalles con su gestión de errores/reintento; no duplica lógica de negocio ni fuerza la revisión vigente si se estaba consultando otra instantánea.

Pruebas de navegador con API/Auth explícitamente simulados cubren proyecto/pestaña, Mapa, comparación, adenda pagada en versión exacta sin POST, acceso revocado, aislamiento entre usuarios, cierre de sesión y fallo de recarga con reintento. También se adaptaron las pruebas anteriores que asumían volver siempre al directorio.
