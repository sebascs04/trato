# Integracion IA: Ensayos, Reputacion y proyecto inicial

## Responsabilidades

Frontend envia intencion y datos del formulario; API autentica y aporta el cliente y las resenas publicadas; Redis mantiene trabajos privados e idempotentes; worker llama al modelo elegido y valida JSON. No se ejecutan Gmail, PayPal, reembolsos ni aceptaciones en estos agentes.

- Ensayos: POST /api/v1/rehearsals/replies y /evaluations. Historial completo en cada turno, cierre por cliente ficticio o freelancer, coach separado. El evaluador conserva la herramienta de cinco fuentes y falla si faltan; conectar o revisar el corpus documental es una etapa posterior. No hay analisis inventado como sustituto.
- Reputacion: POST /api/v1/ai/reputation. Solo profile_id e idioma son del usuario. El backend obtiene todas las resenas publicadas, con version y texto, y el worker valida las citas literales. Resultado privado por usuario, no una etiqueta publica de riesgo ni un veredicto sobre el cliente.
- Plan: POST /api/v1/ai/project-plans. Cliente verificado por JWT/RLS; el correo se toma de su ficha y no se pide de nuevo. Objetivos, presupuesto y fecha se combinan con las resenas. La propuesta devuelve etapas y condiciones, con referencias a experiencias cuando corresponda. Sin resenas, no se inventa historial.
- Seguimiento: GET /api/v1/ai/jobs/{id}. Solo el propietario puede ver estado/resultado. La misma clave no duplica el trabajo; una carga diferente produce conflicto. Un fallo visible requiere una nueva accion del usuario, sin modelos o respuestas alternativas.

## Confirmacion del proyecto

Los PDFs seleccionados siguen locales hasta confirmar. El plan generado es editable y el total permanece vinculado al presupuesto usado en el trabajo. POST /api/v1/ai/projects verifica el trabajo, el cliente, el borrador y las etapas; una RPC guarda proyecto, plan y etapas en una transaccion. GET /api/v1/ai/projects/{id}/plan lo recupera desde la base, no del cache del navegador. Los importes por etapa se calculan en centavos, asignando el residuo a la ultima para conservar el total. Crear un plan no cobra ni acredita pagos; los cobros siguen en el backend PayPal Sandbox.

Migracion: 20261101154326_ai_initial_project_plans.sql. Tablas normalizadas project_start_plans y project_start_stages con RLS por propietario y proyecto activo. Incluye el permiso de columna id para la creacion idempotente. No cambia tablas ni permisos de los flujos de cambios/devoluciones. La prueba SQL usa rollback y no deja proyectos o usuarios de prueba.

## Ejecucion local

En API y worker: TRATO_AI_WORKFLOWS_ENABLED=true. Mantener la configuracion Gemini y la lista explicita de modelos de modelos-gemini.md. Para Ensayos: TRATO_REHEARSAL_EVALUATOR_ENABLED=true en ambos servicios. Las credenciales JSON solo estan en el worker y no se publican.

```bash
python3 scripts/dev-polyrepo.py --with-ai
```

Inicia web/API/procesador basico, Redis propio y los workers de IA. No inicia la ingesta de documentos. --with-worker conserva el arranque completo existente. Ambos comprueban los puertos fijos y abortan ante conflicto; nunca reutilizan recursos de otro proyecto.

## Comprobaciones y siguientes pasos

Se verifican contratos JSON, claves idempotentes, aislamiento por propietario, citas a resenas y sumas/centavos de etapas con dobles de modelo y Redis temporal aislado. No equivalen a una prueba real de calidad del modelo. Por instruccion del usuario, no se recorren estos flujos desde la interfaz en esta etapa. Tampoco se ejecutan inferencias reales para certificarlos. Quedan para la etapa posterior la validacion conjunta desde UI, los documentos/vectorial y el corpus documental del coach. No se publica este lote sin nueva autorizacion.
