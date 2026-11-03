# Tanda 2: revisión y diseño para aprobación

Estado: diseño aprobado por el usuario e implementado. Evidencia y límites en `tanda-2-devoluciones-validacion.md`; migración compartida todavía no aplicada.

## Hallazgos del código

- `trato_api/proposals/repository.py` y `persistence.py`: las lecturas usan el JWT del usuario y RLS; las mutaciones pasan por RPC con claves de idempotencia.
- `20261025233301_proposal_delivery_payments.sql`: `proposal_payments` conserva propietario, proyecto, revisión, aceptación, importe, moneda, merchant, orden y captura. No conserva comisión original ni conciliación de reembolsos. No interpretar ausencias como importes cero.
- `20261026175801_one_open_request_per_project.sql`: el bloqueo actual detecta documentos `email_request`; la devolución debe incorporarse a esa misma exclusión bajo bloqueo del proyecto. Reservar un documento y crear un expediente deben competir por el mismo bloqueo.
- `20261026172452_editable_proposal_drafts.sql`: patrón aprovechable de instantáneas internas, versión pública y control de revisión vigente. No reutilizar ni editar la propuesta pagada para representar una devolución.
- `trato_api/refunds/domain.py`: valida desglose y evidencias de la tanda 1. `CaptureContext` requiere datos financieros ya verificados; no se puede fabricarlos para guardar un borrador antes de conectar PayPal.

## Alcance propuesto

1. Crear una migración nueva, conservando las históricas. Tablas de expedientes, instantáneas/revisiones, referencias a fuentes y eventos; registro privado de comandos idempotentes. Relaciones compuestas que impidan cruzar propietario, proyecto, pago y expediente.
2. Crear expediente ligado a un pago local `completed` con captura, moneda USD y propietario/proyecto activos. Pago de otro proyecto/usuario o diagnóstico técnico Sandbox no son elegibles. Fuente de solicitud privada y terminada. El expediente reserva el cupo de pedido abierto aunque aún no tenga propuesta.
3. Guardar propuestas e instantáneas inmutables, con versión pública y secuencia de borrador. Validar conceptos, evidencias exactas y sumas tanto en API como en la frontera SQL. Una llamada RPC directa no puede saltarse las reglas. El usuario solo propone importes; no declara saldos, identidad ni verificación del proveedor.
4. Separar contexto de preparación de contexto financiero verificado. Permitir comisión y remanente externos desconocidos, sin ponerles cero. El borrador puede revisarse contra el bruto registrado y antecedentes locales, identificando expresamente que la elegibilidad/remanente actuales están pendientes de conciliación. El cálculo financiero estricto de tanda 1 sigue reservado para contexto verificado. No emitir aprobación financiera ni afirmar reembolsabilidad con este cálculo preliminar.
5. Montar repositorio y rutas JWT para listar, crear y consultar expedientes; consultar una instantánea y editar el borrador con `expected_snapshot_id`. Cabecera `Idempotency-Key` obligatoria para mutaciones. Conservar el resultado original en reintentos iguales, incluso si el primer alta ya ocupó el cupo; otra carga con la misma clave produce conflicto.
6. Incorporar cierre explícito por retiro/rechazo con motivo, solamente sin aceptación ni operación financiera activa. No borrar el expediente ni desbloquear unilateralmente un acuerdo aceptado. Integrar este estado en `project_request_status` sin eliminar los campos que utiliza la interfaz actual.
7. Revalidar bajo bloqueo del proyecto y después del pago/expediente en orden consistente. No abrir transacciones DB durante llamadas externas. La autorización y reserva de dinero pertenecen a tanda 5; aquí se protege concurrencia del expediente y sus revisiones, sin inventar operaciones financieras.

Las nuevas versiones tras envío solo podrán habilitarse con evidencia vinculada al envío exacto cuando exista ese flujo en tanda 4. En tanda 2 no se expondrá una ruta que permita declarar `sent` o `accepted` desde HTTP. Una instantánea histórica no se sobrescribe aunque aún no tenga PDF.

## Archivos previstos

- `repos/trato-api/trato_api/refunds/domain.py`: distinción entre preparación y evidencia financiera verificada, manteniendo validaciones estrictas.
- Nuevos `refunds/repository.py`, `refunds/routes.py` y módulo de preparación si hace falta; montaje en `trato_api/app.py`.
- Nueva migración en `repos/trato-api/supabase/migrations/`; tests SQL en `supabase/tests/`.
- Tests de API/repositorio y ampliación de tests de dominio.
- Contrato v1 y plan: actualizar alcance, evidencia y límites de integración.

No tocar `.env`, secretos, colección Weaviate, configuración Gemini, simulación, envío Gmail ni ejecución PayPal. No implementar interfaz de tanda 3. No modificar los archivos locales ajenos sin seguimiento.

## Seguridad y pruebas de aceptación

- RLS: lecturas por propietario y proyecto activo. Sin INSERT/UPDATE/DELETE directos para clientes; escritura únicamente por comandos validados. Funciones con permisos mínimos y `search_path` explícito. Operaciones financieras futuras exclusivas del servidor.
- API: JWT requerido, IDs válidos, campos extra rechazados, errores seguros, claves idempotentes, límites de tamaño y filtros de proyecto/pago.
- SQL real: creación y edición, replay tras ocupar el cupo, conflicto de clave, fuentes de otro propietario/proyecto, extracción incompleta, instantánea obsoleta, historial inmutable, acceso RPC directo y pago no elegible.
- Concurrencia con conexiones separadas: dos altas de devolución y alta de devolución frente a `email_request`; solo una gana. Dos ediciones de la misma instantánea no producen dos cabezas vigentes.
- Persistencia: recargar/recrear repositorio conserva expediente e historial, sin almacenamiento en memoria como sustituto.
- Regresión: tests de tanda 1, suite API y comprobaciones existentes de pedido abierto; sin llamadas financieras ni IA.

La prueba SQL debe ejecutarse en un entorno Trato identificado y coordinado. Primero comprobar herramientas y destino sin mostrar secretos. Las pruebas usan fixtures aisladas y rollback; ninguna limpieza global ni reset de Supabase. Si falta base de pruebas, reportar lo no ejecutado; los dobles HTTP no acreditan RLS ni concurrencia reales. No aplicar la migración al Supabase compartido sin revisar y coordinar ese despliegue concreto.

## Resultado esperado

Expediente persistente y API verificables por tests, sin interfaz nueva ni reembolsos. Aporta la persistencia de TRATO-13; envío/aceptación real y confirmación financiera siguen pendientes de sus tandas. Se presenta evidencia al usuario y se detiene antes de tanda 3.
