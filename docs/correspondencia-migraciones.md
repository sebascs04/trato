# Correspondencia de migraciones de trato-dev

Auditoría de solo lectura del 29 de octubre de 2026. Base compartida de desarrollo.

Se consultaron version, name, cardinality(statements) y MD5 de array_to_string(statements, salto de línea) en supabase_migrations.schema_migrations. Cada una de las 18 filas contiene una sentencia; su MD5 coincide con los bytes completos del SQL local correspondiente. No se normalizaron espacios ni comentarios. Esto verifica el SQL registrado, no demuestra por sí solo que nunca hubo cambios posteriores desde SQL Editor.

Se verificaron también los Git blob SHA-1 de los 17 archivos publicados actualmente en main contra los archivos locales. Coinciden. La ruta pública es [repos/trato-api/supabase/migrations](https://github.com/sebascs04/trato/tree/main/repos/trato-api/supabase/migrations).

## Correspondencia verificada

| Versión aplicada | Archivo local | MD5 del SQL aplicado y local | Publicado en main |
| --- | --- | --- | --- |
| 20261024232244 | 20261024232244_persistent_ingestion.sql | 186bca2e37879e3307f21d657fe196bc | Sí |
| 20261025230240 | 20261025165753_proposal_lifecycle.sql | 2f8226a98eb36d404e0a82506f6c120f | Sí |
| 20261025230939 | 20261025230921_proposal_lifecycle_hardening.sql | 737dac36e945e73b524660371ffe04ee | Sí |
| 20261025232620 | 20261025231302_proposal_pdf_artifacts.sql | 3cc958dcb3dcf7519f1f8e981f22c613 | Sí |
| 20261025233301 | 20261025232834_proposal_delivery_payments.sql | 273c99ffed73e29eea7ba256a5c03b91 | Sí |
| 20261026163009 | 20261025235755_client_soft_delete.sql | 8b24971e89a729189b452f9768863487 | Sí |
| 20261026172452 | 20261026171957_editable_proposal_drafts.sql | 762173e7f1ef75cd97690a3f3d19148a | Sí |
| 20261026175801 | 20261026175041_one_open_request_per_project.sql | 6e976065ecdb484e5b031a4c15d34bd5 | Sí |
| 20261026210106 | 20261026204903_async_document_threads.sql | 6cb6cc447102f576f629d1ad1640df92 | Sí |
| 20261027170436 | 20261027165842_project_graph_threads.sql | d6b42ded5bca5dd1b003236780134a3f | Sí |
| 20261028154703 | 20261028154703_community_reputation.sql | d2d8a21a3f72c591033b878cc3665e2b | Sí |
| 20261028155355 | 20261028155355_reputation_access_guards.sql | 2f872ba1903a3e45b557d0f21ccb5a10 | Sí |
| 20261028160219 | 20261028160219_reputation_foreign_key_indexes.sql | ff3d3054247bd6a9456ca0e2dd7db1aa | Sí |
| 20261029010557 | 20261029010557_reputation_public_email.sql | 3dd2e0eac4797574c594d6200fb7bea3 | Sí |
| 20261029010728 | 20261029010728_reputation_review_identity_guard.sql | 7e322a263d2ef5983e80b8090614a67f | Sí |
| 20261029012658 | 20261029012658_reputation_evidence_files.sql | 47fc65aee98637442a0f954abefcbe33 | Sí |
| 20261029013125 | 20261029013125_reputation_evidence_storage_privacy.sql | 628850079235c77563df02f1d079f9a4 | Sí |
| 20261029160828 | 20261029160828_project_soft_delete.sql | 2628a7ced8167cb7500fdd072351cc47 | No |

## Qué debe comparar cada colaborador

- Los nueve números distintos explican por qué buscar solo por versión no encuentra los archivos históricos. El nombre y el contenido permiten identificar la correspondencia de la tabla.
- Las siete migraciones de reputación del 28 y 29 de octubre ya están publicadas en main con el mismo prefijo que Supabase. Si faltan localmente, revisar la rama y el checkout usado por cada colaborador, conservando sus cambios.
- project_soft_delete, versión 20261029160828, también está aplicada y existe localmente. A la hora de esta revisión aún no aparece en main; debe incluirse en el próximo lote autorizado.
- La publicación reciente de los archivos de reputación incluyó el PR #3: https://github.com/sebascs04/trato/pull/3. No atribuir el origen de aplicación de cada SQL a una rama sin revisar los registros históricos correspondientes.

## Precaución operativa

Esta auditoría no renombra archivos, no repara el historial, no modifica la base y no autoriza db push. No volver a aplicar los nueve SQL bajo sus números locales: ya están registrados con otros números. Antes de usar CLI para futuras migraciones, el equipo debe acordar la reconciliación de los nombres/historial, preservando el SQL verificado y los cambios locales de cada colaborador.

## Entrega de los archivos pendientes

Esta rama de trabajo añade la tabla y el SQL project_soft_delete ya aplicado. La columna «Publicado en main» describe la rama principal en la auditoría; esta entrega no lo fusiona allí. No ejecutar este SQL de nuevo sobre la base compartida.

## Reconciliación local del 31 de octubre de 2026

Los nueve archivos históricos con prefijos distintos se renombran al número de versión aplicado indicado en la tabla. Conservan los bytes del SQL original, incluidos sus saltos de línea. La tabla anterior mantiene los nombres de la auditoría del 29/10 como referencia histórica. Este cambio no reejecuta SQL ni modifica el historial remoto.

Las migraciones de Gmail `20261030035029`, `20261031024840`, `20261031025431` y `20261031103500` quedaron aplicadas en trato-dev durante las pruebas locales autorizadas. Corrigen la persistencia de respuestas, alias SQL ambiguos, la validación de IDs de mensaje y la recuperación de metadatos de adjuntos. Se aplicaron desde un directorio privado con el historial remoto completo, comprobando antes que cada dry run incluyera solo la migración correspondiente.

La reconciliación de estos nueve nombres no acredita que este checkout contenga todas las migraciones de otros lotes. Antes de otro `db push`, consultar `migration list --linked` y resolver cualquier versión remota sin archivo local; no aplicar cambios de reputación u otros módulos por incluirlos accidentalmente en un push de Gmail.

## Plan inicial con IA

La migracion `20261101154326_ai_initial_project_plans.sql` coincide con la version aplicada `20261101154326` (`ai_initial_project_plans`). Crea los planes y etapas privados, RPC transaccional y permiso de columna id para creacion idempotente. Se verifico con la prueba `supabase/tests/ai_initial_project_plans.sql` bajo rollback.


## Procesamiento de archivos y proyeccion comunitaria

`20261101212324_file_processing_and_public_vector_sources.sql` coincide con la version remota `20261101212324`. El nombre local se ajusto a la version real registrada al aplicar el SQL; no aplicar tambien la version inicial de preparacion. Incluye opciones/artefactos con RLS y RPC server-only de outbox, fuentes y recibos de reputacion. La prueba `supabase/tests/file_processing_and_public_vectors.sql` se ejecuto bajo rollback: aislamiento, permisos, retirada y rechazo de escrituras obsoletas.
