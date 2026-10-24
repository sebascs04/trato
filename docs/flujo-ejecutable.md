# Flujo ejecutable de cambios — estado del 24 de octubre de 2026

## Actualización: un único formulario

La interfaz separada de prueba ya no se carga. El recorrido actual es:

1. **PDF:** subir el correo en Nueva solicitud de cambio.
2. **Lectura:** revisar el texto extraído y los metadatos; confirmar y ver el
   pedido junto al acuerdo vigente.
3. **Análisis:** LangGraph avanza internamente; se muestran fuentes, lectura y
   estimaciones ilustrativas de esfuerzo, días y adicional.
4. **Alternativas:** elegir y editar una propuesta; los supuestos de la demo no
   son resultados generados por IA ni una evaluación real de pertinencia.
5. **Adenda:** revisar el borrador producido con esos datos, sin firma ni cobro.

No se pide al usuario elegir «corresponde / aclaración / ajeno» para simular el
agente. El motor conserva esas ramas para la futura integración de un modelo,
pero en este recorrido de demo se asume correspondencia explícitamente como
simulación después de la confirmación del usuario. No presentarlo como un filtro
semántico real. Las cifras son supuestos editables, no recomendaciones inferidas
del PDF. El backend guarda los checkpoints de la prueba en SQLite; el PDF y la
solicitud de la interfaz siguen siendo de sesión. Supabase continúa pendiente.

Las instrucciones históricas siguientes describen la primera interfaz de prueba;
los botones para abrir un panel separado y la lista de flujos guardados fueron
retirados del producto. El backend mantiene consulta y reanudación por API.

## Qué ya se puede probar

LangGraph ejecuta un recorrido real con estado persistente local. No se llama a
un LLM, Weaviate, Neo4j, Supabase, correo, firma o PayPal. El contenido de análisis
y la aceptación de firma se identifican como simulaciones.

1. En Cambios y extras, abre un ejemplo y pulsa **Probar recorrido con LangGraph**.
   Alternativamente, crea una solicitud por PDF desde Clientes y pulsa **Probar
   flujo con LangGraph** al revisar la solicitud registrada.
2. Confirma el pedido y el acuerdo de referencia.
3. Elige manualmente la pertinencia para probar las ramas: corresponde,
   necesita aclaración o ajeno. No se presenta esa selección como juicio de IA.
4. Si es ajeno, termina bloqueado. Si falta aclaración, vuelve a confirmar el
   pedido corregido. Si corresponde, muestra el análisis simulado.
5. Define una alternativa, alcance, importe y días. Los importes son aportados
   por el usuario y se validan en servidor con decimales.
6. Revisa la adenda sin firma y simula la firma de ambas partes o el rechazo.
   La simulación no activa una nueva versión contractual ni un cobro.
7. Puedes cerrar y reabrir desde **Flujos de prueba guardados** en el cliente.
   Los ejemplos reutilizan el mismo flujo por proyecto y sesión del navegador.

Los checkpoints y registros de ejecución se guardan en `.local/workflow.sqlite`,
no en Supabase. El historial de la interfaz original y los PDFs aportados siguen
en memoria del navegador: al recargar se pierden esos archivos, aunque el texto y
los pasos del flujo guardado permanecen. La cookie local HttpOnly delimita los
flujos de cada sesión; no sustituye Supabase Auth y no sirve para publicar esta
API como una aplicación multiusuario. Borrar la cookie pierde el acceso a los
flujos de esa sesión desde la interfaz.

## Ejecución reproducible

Requiere Node 18+, Python 3.12 y Poppler (`pdftotext`) para la carga de PDF.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock.txt
npm run dev
```

No hace falta una clave de modelos para esta simulación. La configuración del
servidor actual usa variables exportadas en el shell; no carga `.env` por sí sola.
No activar trazas externas: la pasarela deshabilita LangSmith en el proceso local.

```bash
npm run check
npm test
npm run test:workflow
```

Las pruebas de LangGraph ejecutan procesos nuevos para cada operación: comprueban
persistencia/reanudación, creación idempotente, aislamiento de sesión, bloqueo,
aclaración, validación monetaria y firma exclusivamente simulada. Los efectos
externos siguen sin implementarse.

## Supabase: preparado, todavía no conectado

La migración `supabase/migrations/202610240001_initial.sql` define clientes,
proyectos, documentos privados, versiones, solicitudes y registros de ejecución.
Incluye RLS de lectura por propietario y relaciones compuestas para impedir
referencias a documentos/acuerdos de otro proyecto o propietario. Los usuarios no
pueden marcar contratos firmados ni documentos verificados mediante escrituras
directas. Las operaciones de documentos y estados deberán pasar por el backend
con comprobación de usuario/proyecto; el service role nunca va al navegador.

La migración no está aplicada ni ha sido probada contra un servidor Postgres.
No se creó un proyecto ni se enviaron datos a Supabase. `.env.example` contiene
nombres de variables para la integración futura, no credenciales ni un adaptador
ya conectado. Antes de aplicar al proyecto: comprobar esquema existente, probar
localmente las migraciones/RLS y configurar autenticación.

Pendientes inmediatos:

- Elegir/crear el proyecto Supabase y configurar Auth para Sebastian y Mariam.
- Probar/aplicar la migración en desarrollo.
- Implementar CRUD autorizado y carga privada del PDF original.
- Cambiar la fixture por proyectos reales de Supabase y registrar solicitudes
  persistentemente antes de iniciar un flujo.
- Configurar checkpoints de LangGraph en un esquema privado de Postgres con una
  cuenta backend, sin exponer tablas internas de checkpoints por la API pública.
- Reemplazar la elección manual de pertinencia y el análisis simulado por un
  modelo con LangChain, salida estructurada y fuentes; después Weaviate/embeddings.
- Agregar firma y PayPal reales al final con idempotencia y aprobación explícita.

## Infraestructura del hackathon

La página oficial de Render anuncia **USD50 en créditos**, sujetos a activación
y condiciones de facturación. No se reclamaron ni se contrató infraestructura.
No encontramos una oferta de AWS en la página de recursos consultada: no asumir
acceso AWS gratuito por participar.

- https://paypalaihackathon.devpost.com/details/render
- https://paypalaihackathon.devpost.com/resources

La elección sigue siendo Supabase para Auth/Postgres/Storage, con Weaviate como
índice vectorial y Neo4j como prueba posterior. LangGraph ejecuta los pasos;
no es la base de grafos de conocimiento.

## Estados y cierre por firma — última revisión

Registrada (sin análisis) → análisis simulado disponible → propuesta en revisión
→ adenda preparada → pendiente de firma (envío simulado) → documento recibido,
firma por verificar. El estado final de negocio será cambio formalizado cuando
ambas firmas y la correspondencia con la adenda se verifiquen; esa integración
sigue pendiente y la UI no permite marcar un PDF subido como contrato aceptado.

El formulario incorpora una sexta etapa para envío/recepción. La prueba no envía
correos. El PDF devuelto se conserva una sola vez en Documentos durante la sesión,
con un evento de recepción en el historial. Las condiciones de la adenda guardada
se recuperan al reabrir la solicitud en la misma sesión.

Se retiraron las tarjetas persistentes de solicitudes en el encabezado de Clientes.
Un aviso de 3,5 segundos confirma el registro; el historial conserva el estado y
un botón para reabrir la solicitud. La bandeja de Cambios conserva sus filas.
Los registros de interfaz aún no están respaldados por Supabase.

## Retomar solicitudes pendientes — guardado local

Clientes ahora incluye la pestaña **Solicitudes**. Cada fila muestra su estado y
un acceso para continuar, abrir la adenda o revisar el documento devuelto. El
historial también permite reabrir desde los eventos de registro, adenda y envío.

El módulo `local-store.js` guarda solicitudes, PDFs aportados como Blob, eventos,
estados y condiciones de la adenda en IndexedDB. Al recargar, `boot.js` restaura
los registros y recrea los enlaces de vista previa de los PDFs. Se conserva el
estado entre cierres de formulario y recargas en el mismo navegador/origen.
La opción Restablecer demo también guarda el estado vacío. El borrado de datos
del navegador o cambiar de origen/puerto pierde acceso a ese almacenamiento.

No es Supabase ni sincronización entre dispositivos. Si el almacenamiento no
está disponible o falla por cuota, se avisa y el usuario debe mantener abierta
la sesión. Los checkpoints del motor siguen en SQLite. Las secciones anteriores
que afirman que todos los PDFs se pierden al recargar describen el estado previo.
Las pruebas verifican la restauración de entidades y la reanudación del formulario;
no sustituyen una prueba visual del IndexedDB del navegador del usuario.

## Final completo del frontend: revisión y formalización simuladas

Después de subir la adenda devuelta, la misma pantalla permite:

1. Abrir el PDF y simular una revisión conforme de versión, condiciones y firmas.
2. Simular la formalización del cambio; si existe un checkpoint del motor en
   firma, se completa su rama de firma simulada.
3. Ver el resultado final con una versión ilustrativa, alcance, adicional, plazo,
   documento de respaldo y pago separado sin gestionar.
4. Reabrir el resultado desde Solicitudes o Historial. Se conserva localmente.

La UI no inspecciona firmas reales ni cambia la versión autoritativa del acuerdo.
El nuevo estado `formalized_simulated` y la versión ilustrativa pertenecen al
borrador de demo. El guardado local incluye esas marcas. No debe confundirse este
final visual con una aceptación legal o un pago confirmado.
