# Borrado lógico de clientes

Implementado el 26 de octubre de 2026.

En Clientes, «Eliminar» abre una confirmación. POST `/api/v1/clients/{id}/delete` registra `clients.deleted_at` mediante una función autorizada con el JWT del dueño. Repetir la operación conserva la fecha inicial. No hay borrado físico ni modificaciones de términos, versiones, PDFs, aceptaciones o pagos.

La eliminación se hereda del cliente: políticas RLS restrictivas ocultan sus proyectos y todas las tablas con contexto de proyecto. Storage también deja de autorizar originales porque su política consulta los documentos visibles. No se duplican banderas de borrado en cada tabla. Las funciones de ingesta y propuestas comprueban `private.ensure_active_project` y rechazan operaciones nuevas sobre un proyecto cuyo cliente está eliminado.

Los resultados de proveedores ya iniciados pueden terminar de registrarse para conservar evidencia financiera y de correo. El borrado no revoca un enlace PayPal ya enviado ni cancela una orden. No se inician nuevos envíos ni cobros para clientes eliminados. La recuperación puede hacerse restaurando el padre en administración; no se añadió todavía una papelera o interfaz de restauración.

## Verificación

- Migración validada primero en PostgreSQL local WASM (`@electric-sql/pglite@0.5.12`) con el esquema completo y las pruebas de adendas/pagos.
- Aplicada en Supabase: `client_soft_delete`.
- Prueba SQL remota con fixtures y rollback: aislamiento entre propietarios, borrado repetido, ocultación de datos relacionados, conservación física, prohibición de nuevas escrituras y rechazo de usuario anónimo. No se eliminaron clientes reales durante estas pruebas.
- 108 pruebas de API y 17 pruebas de navegador del espacio conectado, incluida confirmación/cancelación/borrado/recarga.
- Advisor de seguridad sin nuevos avisos de RLS. Persiste el aviso previo de protección de contraseñas filtradas desactivada: [documentación de Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Servicios locales

Interfaz `http://localhost:5173`, API Trato `http://127.0.0.1:8100`, procesador `http://127.0.0.1:8101`. El supervisor configura explícitamente el proxy y la URL del procesador. No hay búsqueda automática de puertos ni alternancia ante fallos. Inicio: `python3 scripts/dev-polyrepo.py`.
