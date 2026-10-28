# Revisión de arquitectura, relaciones y permisos de Supabase

24 de octubre de 2026. Informe de revisión; no implementa cambios ni aplica migraciones.

## Dictamen

La migración inicial es una base razonable para aislar datos de freelancers individuales. Sus claves foráneas compuestas, permisos de columnas y políticas de lectura merecen conservarse. Todavía no representa el recorrido completo de la propuesta: faltan actores autorizados, alternativas versionadas, aceptaciones, fuentes de análisis, historial y entidades de pago.

Recomendación: completar primero el contrato de datos y autorización del primer recorrido; después probar la migración en Supabase local antes de conectarla a la aplicación. Cambiar SQLite por Postgres sin resolver estos puntos conservaría estados del agente, pero no daría persistencia suficiente al negocio.

## Alcance y evidencia

Se contrastaron `docs/propuesta-ganadora.md`, `docs/tareas-integracion.md` y `docs/modelo-de-datos.md` con:

- `supabase/migrations/202610240001_initial.sql`, líneas 1–83.
- `backend/workflow_worker.py`, especialmente líneas 26–71.
- `backend/workflow.py`, especialmente líneas 8–22 y 59–75.
- `workflow-bridge.mjs`, especialmente líneas 5–18.
- La fixture, configuración de ejemplo y pruebas existentes.

La documentación oficial se consultó para verificar permisos, RLS, Storage y restricciones relacionales. Los hallazgos son de inspección estática. No se ejecutó SQL, no se accedió a una instancia Supabase y no se verificaron sus roles, políticas preexistentes ni configuración de esquemas expuestos. No se encontraron pruebas SQL de Supabase entre los archivos revisados; las pruebas actuales de SQLite no validan RLS. `psql` y `supabase` no aparecieron en el PATH consultado.

Hay trabajo concurrente sobre la interfaz: este informe se centra en los archivos de backend y migración citados y no presupone que el estado de persistencia del navegador permanezca igual.

## Lo que está bien planteado

- `projects → clients` incluye `owner_id` en la relación. Un proyecto no puede apuntar a un cliente de otro propietario.
- Documentos, versiones y solicitudes usan relaciones compuestas por documento/proyecto/propietario. Esto cubre también cruces entre dos proyectos del mismo dueño en las relaciones que lo requieren.
- El índice parcial `one_active_agreement` impide dos versiones con estado `accepted` para un proyecto.
- Las seis tablas habilitan RLS, revocan permisos de `anon` y `authenticated`, y conceden lectura por propietario. Las únicas altas directas concedidas al usuario son campos específicos de clientes y proyectos.
- El usuario no recibe permiso directo para escribir firmas, estados de acuerdos o documentos verificados. No es necesario abrir esas escrituras para completar el MVP.
- El bucket se declara privado, limitado a PDFs de 10 MB, y su lectura se vincula con un documento del usuario.
- La separación propuesta entre Postgres autoritativo, checkpoints de LangGraph e índice Weaviate es adecuada.

RLS y privilegios SQL son controles complementarios: una política no concede por sí sola acceso a la tabla. Esta combinación coincide con la [guía oficial de seguridad de la Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Hallazgos prioritarios

### 1. Falta el actor que puede aprobar un cambio — alta, antes de aceptación real

**Evidencia:** `clients` solo contiene nombre y correo de contacto; no hay personas, representantes ni facultades de aprobación. La propuesta exige resolver instrucciones contradictorias y consultar a una persona autorizada.

**Impacto:** no es posible registrar de forma estructurada quién pidió algo, quién podía decidir y quién aceptó esa versión. El dueño del espacio y el representante del cliente son actores distintos.

**Recomendación:** incorporar contactos y autorizaciones por proyecto, con capacidades separadas para solicitar, aprobar alcance y firmar; guardar vigencia y evidencia de su designación. Vincular cada aceptación con actor, versión exacta y verificación de identidad. Un correo extraído de un PDF es un dato declarado, no una autorización.

Mantener un propietario individual para el primer MVP es suficiente si cada freelancer tiene su propio espacio. Si Sebastian y Mariam necesitan compartir datos como usuarios del producto, hace falta membresía de un espacio de trabajo; compartir el desarrollo no implica necesitar ese modelo. No usar cuentas o claves administrativas compartidas para simular colaboración.

### 2. La condición de firma no garantiza integridad ni inmutabilidad — alta, antes de acuerdos reales

**Evidencia:** SQL líneas 27–37. Para `accepted` o `superseded` solo se exige fecha y `signature_evidence IS NOT NULL`. Un objeto vacío o un valor JSON `null` pueden cumplir la segunda condición. No hay protección que impida a una escritura privilegiada cambiar el contenido ya aceptado.

**Impacto:** un error del futuro backend podría aceptar evidencia incompleta o alterar aquello que se firmó. La restricción actual no verifica firmantes, documento, hash ni resultado del proveedor. Esto no demuestra una vía de escritura del usuario: sus permisos actuales están restringidos.

**Recomendación:** registrar evidencias estructuradas por firmante y versión/hash; validar el proveedor o mecanismo elegido en servidor; proteger contenido y referencias de versiones aceptadas/sustituidas frente a modificaciones ordinarias mediante permisos y una regla de inmutabilidad en BD. Conservar eventos de aceptación separados de la mutabilidad del borrador.

La activación debe bloquear el proyecto o comprobar una revisión esperada y ejecutar en una transacción: verificar la versión base, validar evidencias, sustituir la vigente, activar la nueva y registrar el evento. El índice parcial evita duplicados, pero no implementa esa transición. Si otra adenda cambió el acuerdo mientras se negociaba, exigir revisión antes de activar.

Definir además si cada versión contiene el acuerdo consolidado o un anexo. El esquema actual admite una sola versión `accepted`; si una adenda complementa el contrato inicial, debe conservar explícitamente su relación y aplicabilidad junto con ese contrato.

### 3. Faltan alternativas, aceptaciones e historial como entidades de negocio — alta, antes del recorrido persistente

**Evidencia:** solo existen `clients`, `projects`, `documents`, `agreement_versions`, `change_requests` y `workflow_runs`. `proposal` y `adenda` viven dentro del estado LangGraph; véase `backend/workflow.py`, líneas 59–75.

**Impacto:** la migración no permite reconstruir qué alternativa se compartió, cuál eligió el cliente, qué cambió después ni de qué solicitud nació una adenda. Tampoco hay una tabla de eventos persistentes.

**Recomendación:** agregar propuestas versionadas y sus alternativas, decisión/aceptación sobre una revisión exacta, vínculo de solicitud a versión contractual resultante e historial con actor, fecha, origen e ID de operación. Cambiar precio, alcance o fecha exige una nueva revisión y deja sin aplicación una aceptación anterior para esa propuesta modificada. Guardar la revisión anterior para auditoría.

El checkpoint puede contener copias para continuar una ejecución; la consulta del contrato, aceptación e historial debe proceder de las entidades de negocio.

### 4. La identidad local no se puede trasladar directamente a Supabase — alta, antes de publicar

**Evidencia:** `workflow-bridge.mjs`, líneas 14–16, deriva `owner` de una cookie aleatoria. `workflow_worker.py` consulta proyectos y acuerdos desde la fixture y delimita ejecuciones con ese identificador de sesión.

**Impacto:** el hash de cookie no es el UUID de Supabase Auth. Comprobar que el proyecto existe en la demo no acredita acceso a un proyecto real.

**Recomendación:** verificar el JWT de Supabase en el backend y derivar allí el usuario. Autorizar crear, listar, consultar y reanudar sobre solicitud/proyecto/propietario persistidos. Al iniciar, obtener el acuerdo aplicable desde Postgres y fijar su versión; al reanudar, comprobar también su vigencia y las aprobaciones. El navegador no debe escoger libremente propietario, permisos o `checkpoint_thread_id`.

Los JWT sustentan la identidad usada por RLS; el backend debe verificar su validez mediante el mecanismo oficial correspondiente, además de autorizar cada recurso. [Documentación de JWT de Supabase](https://supabase.com/docs/guides/auth/jwts).

### 5. RLS no protege las escrituras administrativas del futuro backend — alta, al integrar

**Evidencia:** el SQL restringe escrituras del cliente, pero deja esas operaciones al backend; `.env.example` prevé credenciales administrativas. La migración no define un rol de aplicación con facultades acotadas ni operaciones de negocio transaccionales.

**Impacto:** si una operación usa un rol con `BYPASSRLS`, las políticas por propietario no impedirán por sí mismas una lectura o escritura cruzada. Guardar la clave en servidor es necesario, pero no sustituye la autorización.

**Recomendación:** usar contexto del usuario para operaciones ordinarias compatibles con sus permisos y reservar operaciones privilegiadas para servicios acotados. Cada escritura privilegiada debe validar dueño, proyecto, estado previo y referencias. Definir grants efectivos del rol backend de forma reproducible; no suponer que todo proyecto tiene los mismos privilegios por defecto.

Si se usan funciones `SECURITY DEFINER`, limitar `EXECUTE`, fijar un `search_path` seguro y validar identidad y alcance dentro de ellas. Mantener tablas de checkpoints en un esquema privado fuera de la Data API, con una cuenta limitada a ese cometido.

Supabase documenta que el rol administrativo puede omitir RLS; esto exige comprobar qué identidad y rol lleva cada petición. [Guía de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### 6. Los documentos aún no tienen un ciclo de ingesta completo — media, antes de persistir PDFs

**Evidencia:** SQL líneas 18–25 y 74–82. Faltan tamaño, tipo observado, texto por página, trabajos de ingesta y procedencia/correcciones de metadatos. La estructura de la ruta se describe en un comentario, sin restricción de formato.

**Impacto:** no se pueden citar páginas ni reconstruir una corrección; una caída entre subir el PDF y registrar su fila puede dejar objetos huérfanos. Storage y la transacción de las tablas de negocio no forman una única operación atómica.

**Recomendación:** reservar ID/ruta desde servidor, comprobar el proyecto, subir con nombre inmutable y finalizar la ingesta con hash calculado por backend, tamaño y tipo verificados. Registrar estados y reintentos idempotentes; limpiar cargas fallidas. Conservar original y texto extraído por separado y relacionar la copia devuelta para firma con la adenda concreta.

La ausencia de política de carga del usuario es coherente con cargas mediadas por backend. Para vista previa, autorizar el documento antes de emitir una URL breve; tratarla como acceso transferible mientras sea válida. Revisar políticas preexistentes y la configuración real del bucket: `ON CONFLICT DO NOTHING` no corrige un bucket ya público o con límites distintos. Las reglas documentadas de carga y acceso están en [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control) y [descargas de buckets privados](https://supabase.com/docs/guides/storage/serving/downloads).

### 7. Las claves foráneas protegen pertenencia, pero no toda la semántica — media

**Evidencia:** SQL líneas 34–46. Una solicitud puede referenciar cualquier clase de documento del proyecto; una versión puede referenciar un documento cuyo `kind` no sea contractual. La solicitud tampoco exige por sí sola que su versión base haya sido aceptada.

**Recomendación:** validar estos predicados en operaciones de dominio o triggers, además de las FKs existentes. Al confirmar la solicitud, fijar la versión que era aplicable entonces; no exigir que siga vigente para siempre, porque el historial debe sobrevivir a futuras adendas. Si se permite registrar pedidos antes de existir un acuerdo aceptado, representar ese estado y bloquear el análisis contractual hasta resolverlo.

El `CHECK` de estados enumera valores, pero no impide saltar de uno a otro. Definir una máquina de transiciones para datos de negocio y su correspondencia con los estados internos del grafo. Los estados simulados no deben traducirse a aceptaciones o pagos reales.

### 8. Faltan fuentes y entidades necesarias para la propuesta — por etapas

**Antes del primer análisis real:** mensajes/conversaciones, participantes, entregables identificables, resultados de análisis con citas a documento/versión/página y procedencia de datos corregidos. Sin vínculos a entregables y personas se pierde la diferenciación de instrucciones contradictorias.

**Antes del cobro sandbox completo:** solicitudes de pago, operaciones del proveedor, importes exactos con moneda, aceptación que autoriza el cobro, referencias externas únicas, recepción de webhooks e idempotencia. Separar solicitado, aceptado, pagado y disponible. Una opción sin adicional no crea un cobro.

**Después:** reembolsos y cierre con entregas/aceptaciones. Mantener Weaviate y cualquier grafo como proyecciones regenerables de IDs/versiones autoritativas; registrar trabajos pendientes para actualizar o retirar documentos del índice tras cambios de permisos o versiones.

### 9. Índices y borrados requieren completar el diseño — media/baja

Los índices actuales cubren varios filtros de dueño/proyecto. Faltan índices específicos para consultas y referencias que se incorporen, por ejemplo ejecuciones por solicitud y eventos por proyecto/fecha. Medir planes antes de agregar índices redundantes; PostgreSQL no crea automáticamente índices sobre todas las columnas que referencian una FK. [Restricciones de PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html).

Las FKs actuales no especifican borrado en cascada; por defecto pueden impedir borrar padres con dependencias. Definir archivo/borrado lógico, retención y limpieza de objetos/proyecciones antes de ofrecer eliminación de cuentas o proyectos. Evitar cascadas indiscriminadas sobre evidencias de aceptación y pagos.

## Relaciones mínimas propuestas

Los siguientes nombres son orientativos, no una migración aprobada. Todas las referencias entre recursos de proyecto deben conservar pertenencia al mismo propietario/proyecto.

| Área | Relaciones que deben quedar explícitas |
|---|---|
| Identidad | Usuario propietario → clientes → proyectos; contacto → autorización vigente por proyecto |
| Fuentes | Proyecto → documentos → extracción/páginas; conversación → mensajes → autor y documento fuente |
| Acuerdo | Proyecto → versiones contractuales; versión → documento/hash, versión base y evidencias de firma |
| Cambio | Solicitud → mensajes/documentos de origen, entregables y versión base; análisis → citas verificables |
| Negociación | Solicitud → revisiones de propuesta → alternativas; aceptación → revisión/alternativa y actor autorizado |
| Resultado | Solicitud/alternativa aceptada → nueva versión contractual; evento → actor, recurso y operación |
| Pago | Aceptación → solicitud de pago → operaciones verificadas; webhook → proveedor/ID externo único |
| Ejecución | Solicitud → ejecuciones LangGraph; ejecución → checkpoint privado y revisión de entrada |

Para el contrato inicial, acordar si se consolida el texto completo en cada versión o si se resuelven contrato y anexos mediante relaciones explícitas. La recuperación debe traer todas las fuentes aplicables desde Postgres, además de cualquier búsqueda vectorial.

## Matriz de permisos recomendada

| Actor | Consultar | Crear/editar | Operaciones restringidas |
|---|---|---|---|
| Visitante sin sesión | Ningún dato privado | Ninguna | Sin acceso a PDFs ni ejecuciones |
| Freelancer autenticado | Sus clientes, proyectos y documentos | Datos ordinarios y borradores autorizados | No marcar pagos, firmas o verificaciones mediante campos libres |
| Representante del cliente | Solo la propuesta/documentos expresamente compartidos | Su respuesta sobre una revisión concreta | Sin acceso al chat privado, otros proyectos o checkpoints |
| Backend de negocio | Recursos autorizados para la operación | Transiciones validadas y eventos | Verificar identidad, alcance, revisión e idempotencia |
| Worker de ingesta/IA | Entradas autorizadas del trabajo | Extracciones, índices y análisis propuestos | Sin facultad de aceptar contratos ni mover dinero |
| Receptor de eventos de proveedor | Referencia necesaria para resolver el evento | Evidencia verificada y transición permitida | Validar autenticidad, duplicados, importe, moneda y destinatario |

La participación del cliente puede hacerse con autenticación o un acceso limitado diseñado para ese fin; no concederle lectura completa por convertirse en un usuario `authenticated`. Una URL compartida tampoco sustituye la comprobación del firmante. El worker debe recibir trabajos delimitados sin heredar innecesariamente credenciales administrativas.

## Secuencia de implementación recomendada

1. Definir propiedad individual, actores del cliente, acuerdo consolidado/anexos y contrato de estados. Mantener estos acuerdos en documentación antes de extender el SQL.
2. Completar migraciones de persistencia mínima: fuentes, ingesta, historial y relaciones de negocio; fijar permisos y funciones transaccionales.
3. Aplicar en Supabase local limpio y comprobar grants efectivos y RLS con dos usuarios. Probar también contra configuración preexistente, especialmente Storage.
4. Conectar Auth/backend y CRUD del recorrido inicial: cliente → proyecto → contrato → PDF → solicitud → recuperación tras recargar.
5. Migrar checkpoints a esquema privado; autorizar cada operación y probar concurrencia/reanudación. Mantener datos de negocio consultables sin reconstruir el grafo.
6. Integrar análisis con fuentes, alternativas, aceptación/firma e idempotencia; después cobro sandbox y confirmación verificada.

## Validaciones pendientes antes de considerar lista la arquitectura

- Usuario A no lee ni escribe datos/archivos/ejecuciones de B por REST, Storage o backend, aunque conozca sus IDs.
- A no puede vincular documentos entre dos de sus proyectos ni falsificar `owner_id`, estados o evidencias mediante altas directas.
- Campos permitidos de creación funcionan; campos restringidos se rechazan. Confirmar grants del rol backend y ausencia de exposición de checkpoints.
- No se activa una versión con evidencia vacía ni de un firmante no autorizado; el contenido aceptado no se modifica por una operación ordinaria.
- Dos aceptaciones concurrentes conservan una versión vigente coherente; cambiar la revisión invalida la aceptación anterior para el nuevo contenido.
- Lectura privada autorizada funciona, lectura cruzada falla y las URLs temporales caducan. Cargas/reintentos no duplican archivos ni solicitudes.
- Reiniciar o reanudar no duplica eventos ni efectos externos. Mensajes, documentos y citas sobreviven al reinicio con sus relaciones.
- Eventos de proveedor duplicados o desordenados no producen doble cobro ni regresiones indebidas de estado.

Estas son pruebas propuestas para la implementación siguiente, no resultados obtenidos en esta revisión. No se modificaron código, migración existente, dependencias ni servicios externos; el único archivo añadido es este informe.
