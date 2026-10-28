# Reputación de clientes

28/10/2026. Implementación autorizada por Sebastian como sección propia, debajo de Ensayos. No se crean PR ni se hace merge sin una orden expresa.

## Recorrido

- Acceso desde `#reputacion` con sesión de Trato; búsqueda por nombre/ubicación y directorio paginado.
- Ficha compartida: nombre y ubicación/sitio web elegidos explícitamente, puntuación media, comunicación y respeto del alcance, experiencias de distintos autores.
- Compartir requiere seleccionar un proyecto propio, escoger una ficha existente o crear una nueva, alias, valoraciones, experiencia de pago, comentario y consentimiento explícito.
- Las fichas aparecen al publicar una experiencia. Nunca se publica ni se recorre automáticamente el directorio privado de otros freelancers.
- El autor puede actualizar o retirar su experiencia. Una por autor/proyecto; se guardan versiones internas antes de editar/retirar. La ficha agrega solo reseñas publicadas.
- Otros miembros pueden reportar una reseña por identidad incorrecta, privacidad, abuso u otro motivo. Se registra el reporte para revisión; no borra ni sanciona automáticamente por acumular reportes.

## Datos y acceso

Tablas privadas normalizadas: reputation_members (alias), reputation_clients (ficha compartida), reputation_client_links (asociación privada de un cliente del estudio con una ficha), reputation_reviews, reputation_review_versions y reputation_reports.

RLS activado y sin acceso directo para anon/authenticated. RPC public.community_reputation es security invoker y delega a una función privada con auth.uid verificado, usuario existente y rechazo de usuarios anónimos. La función privilegiada privada controla cada acción y devuelve campos permitidos. El backend utiliza el JWT del usuario; no usa ni expone service_role.

La ficha y las reseñas compartidas no contienen emails privados, IDs de autores, documentos, conversaciones, importes ni identidades de proyectos ajenos. Solo el autor puede recibir su propio project_id al editar. La vinculación a un proyecto no certifica su ejecución o entrega: la UI dice «Proyecto vinculado», no «impago verificado» ni «fraude». El estado de pago de una reseña es una declaración de su autor, no una consulta o decisión de PayPal.

El acceso es para cuentas permanentes de la aplicación; un enlace de pago para clientes no concede acceso. Trato no tiene hoy un mecanismo que certifique la profesión de una persona: un cliente que se registrara por separado como usuario de la aplicación no puede distinguirse automáticamente de un freelancer. No prometer exclusión por identidad humana ni verificación profesional inexistente.

No se fusionan fichas por nombres parecidos ni se consulta/enriquece información de terceros. El usuario debe comprobar que la ficha corresponde a su cliente y consentir la información que comparte. Los enlaces privados permanecen fuera de las respuestas compartidas. Moderación: cola de reportes interna persistida; todavía no hay consola de administración ni decisiones automáticas.

## Implementación

- reputation-workspace.mjs/css: directorio, búsqueda, ficha, publicación, edición, retirada, reporte, estados vacíos/carga/error. Sin fixtures ni almacenamiento alternativo ante un fallo.
- Entrada en index/app/connected-workspace/boot y allowlist del servidor. Se conservan Clientes, Ensayos y la navegación de proyectos.
- API reputation_routes.py: list/detail/options/save/withdraw/report. Entradas estrictas, UUIDs, límites, consentimiento, HTTPS y autorización en base de datos.
- Migraciones reales: 20261028154703_community_reputation.sql y 20261028155355_reputation_access_guards.sql. La segunda rechaza usuarios eliminados y permite volver a publicar una reseña retirada preservando versión.
- ES/EN con claves reputation.*, fechas y cantidades localizadas. Alias, nombres y comentarios permanecen originales.

## Verificación

SQL real con dos usuarios y ROLLBACK: comunidad compartida, datos privados no expuestos, proyecto ajeno rechazado, consentimiento obligatorio, una reseña por proyecto, edición con versión, retirada y agregación, reporte idempotente, denegación de lectura de tablas privadas y de acceso anónimo. Sin reseñas de prueba persistidas.

Siete pruebas API; 19 navegador con dobles explícitos de API (Reputación, Ensayos y vista general) aprobadas; se añadieron regresiones para reporte y conservación de borrador ante error de publicación. 35 pruebas Node y npm run check aprobados. Capturas de la vista vacía y ficha inspeccionadas con datos de prueba solo en el transporte del navegador. No se automatizó una publicación mediante una sesión real de usuario en navegador.

Advisors de seguridad: INFO intencionales por tablas privadas con RLS y sin políticas de acceso directo; aviso preexistente de protección de contraseñas filtradas sin modificar. Los recursos del módulo responden200 y el API real rechaza peticiones sin sesión401.

## Coordinación

Rama remota preparada feature/client-reputation desde main 5ea5028, sin subir estos cambios, sin crear PR y sin merge. El workspace compartido no tiene checkout Git operativo en su raíz; no modificar la rama local de API de P1 (feature/local-rehearsal-qwen). Coordinar un snapshot de alcance o checkout separado antes de cualquier publicación autorizada.


Cierre: seis pruebas propias de Reputación aprobadas, incluidas reportar sin editar una reseña ajena y conservar el borrador ante error. SQL ampliado confirma rechazo de usuarios eliminados y republicación de reseña retirada. Migración adicional20261028160219_reputation_foreign_key_indexes.sql cubre las dos FK nuevas señaladas por Advisors; no se modifica el índice pendiente preexistente de worker_threads.
