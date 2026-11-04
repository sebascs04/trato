# Métricas de uso de antecedentes

3 noviembre 2026. Código local; migración aditiva aplicada en trato-dev. No se hizo backfill de registros anteriores ni se llamó a modelos al probarlo.

## Dos señales distintas

- **Uso en planes confirmados:** número de cuentas de freelancers distintas que confirmaron un plan inicial con esas experiencias. Mirar una ficha, generar un borrador o votar no incrementa este contador. Varias confirmaciones/reintentos de una cuenta cuentan una sola vez por ficha comunitaria.
- **Utilidad autodeclarada:** usuarios distintos que pulsaron voluntariamente «Estos antecedentes me fueron útiles». Pueden retirar esa opinión; hacerlo no modifica el uso registrado de planes.

Las señales no acreditan que el cliente pagará ni que el proyecto tendrá éxito. Los recuentos de planes empiezan cuando se activa el registro; un cero no afirma que nunca se usaron antes los antecedentes.

## Escritura y privacidad

Al confirmar un plan, la API conserva las comprobaciones de dueño, cliente, borrador, trabajo IA completado y etapas. Después de persistir el proyecto/plan, llama con su credencial de servidor a `record_reputation_plan_usage`. La función verifica propietario, trabajo, plan guardado y correspondencia literal/versionada de las reseñas publicadas con la ficha del cliente. No registra planes sin antecedentes y no atribuye los de una ficha a otra.

El registro es privado. El navegador no tiene permiso para llamar a esa escritura ni insertar filas; crear un plan directamente mediante el RPC público existente no aumenta la métrica por sí solo. Los reintentos se deduplican por proyecto/ficha y el agregado cuenta propietarios distintos. No se publican IDs de usuarios, proyectos ni trabajos.

La creación del plan y el registro de uso son dos operaciones. Si la segunda falla, el endpoint devuelve el error y no declara éxito completo. Se conserva el ID idempotente: reintentar confirma el mismo plan y completa el registro sin crear duplicados. Una escritura ya registrada mantiene su evidencia histórica; no se vuelve a presentar contenido retirado en el directorio público. No reconstruir automáticamente métricas antiguas a partir de registros que el backend no validó.

La utilidad se guarda por usuario autenticado y ficha, con booleano e historial de actualización. Una misma cuenta no puede multiplicar votos al repetir el envío. Las reseñas son afirmaciones de sus autores, no hechos verificados sobre la conducta del cliente.

## API y carga de la vista

- GET `/api/v1/reputation/clients/{id}/usage`: agregado y estado del voto propio; requiere sesión y ficha pública vigente.
- POST `/api/v1/reputation/clients/{id}/usefulness`: acepta únicamente `{"helpful": true}` o `false`; no acepta contadores/propietarios enviados por el cliente.

La ficha carga detalle y métricas en paralelo, solo cuando se abre. La paginación de reseñas no vuelve a pedir el contador. Un error en métricas se muestra con reintento y no se sustituye por cero ni impide consultar las reseñas cargadas. Al cambiar de usuario/ficha se descartan respuestas tardías.

## Migración y validación

`20261103170835_reputation_plan_usage.sql` está aplicada con ese mismo número remoto. No añade variables ni roles cloud. Tablas privadas con RLS y sin permisos directos para authenticated/anon; funciones internas SECURITY DEFINER con `search_path` vacío, wrappers públicos SECURITY INVOKER y grants específicos. La escritura de uso real solo admite service_role. La lectura/voto comprueba identidad y visibilidad antes de ejecutar.

Pruebas API y SQL con fixtures y rollback: cuenta única por dueño, idempotencia, voto separado, denegación de escritura desde navegador, dueño ajeno, IDs privados y retirada de ficha. El advisor informa RLS sin políticas en estas tablas privadas: es intencional para cerrar el acceso directo, no debe corregirse abriendo SELECT a los usuarios. No modificar avisos de otros módulos para esta entrega.
