# Tanda 2: persistencia y API de devoluciones

Implementación aprobada por el usuario. Sin IA, interfaz nueva, correo ni operaciones PayPal.

## Entrega

- Migración `20261101160000_refund_settlement_drafts.sql`: expedientes independientes ligados a pagos registrados, instantáneas inmutables, fuentes exactas y eventos; comandos privados con idempotencia.
- RPC `refund_command` con acciones limitadas a `create`, `edit_draft` y `close`. Revalida identidad, proyecto activo, pago, fuentes, cálculo y revisión esperada en SQL. No expone aceptación, envío, autorización financiera ni una forma de marcar pagado/devuelto.
- RLS y permisos de solo lectura para clientes autenticados; rechazo de escrituras directas. Claves foráneas compuestas y triggers protegen historial y contexto.
- Bloqueo del proyecto común con `email_request`; luego bloqueo del pago y expediente. El reintento idempotente devuelve el resultado original antes de rechazar por el cupo ya ocupado. Cierre de borrador por retiro/rechazo con motivo; no permite revocar un expediente aceptado.
- Preparación separada de verificación financiera: `original_fee_minor=null`, `provider_remaining_minor=null`, `provider_verified=false`, `financial_execution_ready=false`. El historial local de devoluciones confirmadas no equivale a conciliación del proveedor. No se habilita dinero con estos datos.
- Consulta del historial completo por páginas de metadatos y descarga individual de cada instantánea y sus fuentes. Listado de expedientes limitado a los 100 más recientes, como los listados existentes; ampliar paginación de ese listado cuando se implemente la UI si hace falta.

## Rutas

Todas requieren JWT; las mutaciones también `Idempotency-Key`. Los IDs de proyecto/expediente de la ruta prevalecen; el body no puede aportar propietarios ni contexto financiero.

| Método y ruta bajo `/api/v1` | Función |
| --- | --- |
| GET `/projects/{project_id}/refunds` | Listar expedientes autorizados |
| POST `/projects/{project_id}/refunds` | Registrar petición y evidencia de fuente ya leída |
| GET `/refunds/{id}` | Cabecera, metadatos de instantáneas e historial |
| GET `/refunds/{id}/snapshots/{snapshot_id}` | Términos, desglose y fuentes exactas de una instantánea |
| POST `/refunds/{id}/draft` | Primera propuesta con `expected_snapshot_id=null`; siguientes con ID vigente |
| POST `/refunds/{id}/close` | Retiro/rechazo explícito del borrador con notas |

La petición inicial puede citar un documento `reference` ya leído. No necesita crear otro `email_request` mientras ocupa el cupo del proyecto. Editar no cambia v1: añade secuencia e instantánea internas. La nueva versión después del envío se conectará en tanda 4.

## Verificación

- API: **240 tests aprobados**, incluidos dominio, autenticación de rutas, DTO estrictos, repositorio y paginación. Comando desde `repos/trato-api`: `../trato-file-processor/.venv/bin/python -m unittest discover -s tests`. Fuera del sandbox por la limitación conocida de TestClient.
- SQL: migraciones históricas más la nueva aplicadas en PostgreSQL 14.24 aislado; **25 migraciones** en total. Pruebas de devoluciones pasan con fixtures y rollback; cubren SQL directo, RLS, pagos no elegibles, evidencia incompleta/ajena, conceptos inválidos, porcentajes, replays, revisión obsoleta y borrador cerrado.
- Regresión SQL: **11 de 12 archivos aprobados**. `ingestion_rls.sql` falla en el caso histórico `Cross owner`: espera una excepción de FK pero la política posterior `active_client_projects` lo bloquea antes con RLS. Se reprodujo el mismo fallo con las 24 migraciones anteriores, sin la nueva. No se modificó ese test ni el comportamiento de ingesta como parte de esta tanda.
- La primera prueba histórica del grafo encontró un permiso faltante del scaffold de pruebas para `service_role`; corregido el scaffold, el test pasa. No se cambiaron permisos de producción para resolverlo.
- Cuatro carreras reales con conexiones independientes: devolución/devolución, devolución/`email_request`, edición/edición y reintentos simultáneos con misma clave. Todas aprobadas.
- Reinicio de la base aislada: las instantáneas y hashes guardados coincidieron después del reinicio. Esto comprueba persistencia SQL, no un recorrido nuevo en la app.

## Reproducción y límites del entorno

Se descargaron binarios de PostgreSQL a `/tmp/trato-refunds-pg`; no se instalaron servicios del sistema ni se usó Docker u otro proyecto. La instancia usa únicamente su socket privado, con `listen_addresses=''`, sin puerto TCP.

Para repetir en un cluster PostgreSQL vacío y desechable, crear la base `trato_refunds_test`, cargar `supabase/tests/fixtures/postgres_supabase_scaffold.sql`, luego las migraciones ordenadas y ejecutar con `psql -X -v ON_ERROR_STOP=1 -f supabase/tests/refund_settlements.sql`. El scaffold crea roles y los objetos mínimos de Auth/Storage para pruebas; no se debe ejecutar sobre Supabase real ni un cluster existente. No verifica JWT criptográficos ni Storage HTTP. Nunca sustituye el entorno conectado de Trato.

`scripts/test-refund-concurrency.py` requiere el socket bajo `/tmp/trato-refunds-pg`, la base fija marcada `trato.refund_test=isolated` y `--psql`, `--socket`, `--state-file`. Crea fixtures sintéticas confirmadas para probar conexiones múltiples; no borra datos del servidor. Tras reiniciar esa misma instancia, `--verify-state` contrasta los hashes y contenido guardados en el archivo de evidencia dentro de `/tmp/trato-refunds-pg`.

## Pendiente antes de usar la API conectada

La migración **no se aplicó a Supabase compartido**. Falta coordinar su despliegue en el proyecto Trato correcto y comprobar allí el comportamiento de PostgREST y el JWT real. No presentar los tests locales como una integración remota completada. Un servidor sin la migración mostrará el fallo de persistencia; no tiene un almacén alternativo.

La tanda 3 añadirá la interfaz. PDF, envío, feedback vinculado al correo y aceptación siguen en tanda 4; conciliación y ejecución financiera, en 5–6. TRATO-13 tiene implementada su base persistente, pero el bloque integral TRATO-13 a 16 no está terminado. La IA queda como requerimiento posterior separado.
