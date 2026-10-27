# Trato API

Frontera pública de autenticación y negocio. Implementa Supabase Auth, creación/consulta de clientes y proyectos, ingesta de documentos privados, persistencia normalizada de extracciones/fragmentos e historial. La migración `persistent_ingestion` ya está aplicada en trato-dev. La ingesta PDF ahora usa threads/outbox y un worker separado; ver `../../docs/ingesta-conectada.md`.

## Ejecutar

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
```

Exporta las variables de `.env.example` en el proceso. No se lee `.env` automáticamente. `SUPABASE_PUBLISHABLE_KEY` es la clave pública del proyecto; no uses service role. El token privado del procesador debe coincidir con el de ese servicio.

```bash
.venv/bin/uvicorn trato_api.app:app --host 127.0.0.1 --port 8100 --limit-concurrency 8
```

- `GET /health`: salud del proceso y presencia de configuración; no afirma haber probado salud de la BD.
- `GET /api/v1/config`: URL Supabase y publishable key para la web; nunca claves administrativas.
- `GET /api/v1/session`: identidad de usuario verificada.
- `GET/POST /api/v1/clients` y `/projects`: datos del usuario autenticado.
- `GET/POST /api/v1/projects/{id}/documents`: consultar o incorporar original y encolar lectura (202); POST requiere `Idempotency-Key`, query filename/title/kind y bytes del archivo.
- `GET /api/v1/documents/{id}/extraction` y `/file`: fragmentos y descarga privada con JWT; `POST /retry` reintenta desde el original.
- `GET /api/v1/projects/{id}/events`: historial persistente.
- `POST /api/v1/documents/extract?filename=archivo.docx`: archivo binario, MIME y JWT de usuario Supabase. Identidad verificada antes de procesar. Devuelve contenido con `persisted: false`.
- `/api/v1/payments`, captura, conciliación y correo: router de P1 montado, sin servicio de pagos configurado. Devuelve errores de configuración; no simula cobros conectados ni usa una base en memoria.

`require_user(request)` es la dependencia de identidad compartida. `app.state.services` contiene servicios inyectables para pruebas. La clave del procesador y los tokens Supabase no se devuelven en respuestas ni se registran.

## PayPal

`paypal/` es una copia explícita del módulo de P1 al separar repositorios. La fuente original se conserva en `backend/paypal/` durante la transición. No sincronizar ni editar ambas copias en paralelo: antes del siguiente cambio, acordar con P1 el traslado de propiedad. El router fue copiado con sus pruebas.

```bash
.venv/bin/python -m unittest discover -s tests -v
```

El Dockerfile es una preparación de despliegue aún no construida. Falta repositorio transaccional y aceptación real antes de poder habilitar órdenes PayPal.

El repositorio PostgREST/Storage propaga el JWT verificado del usuario y la clave publicable: no requiere service role. RLS y FKs compuestas impiden cruces de propietario/proyecto. Todos los originales y textos se consideran no verificados; los RPCs no certifican firma ni aceptación. Cada fragmento expone source_context con propietario, cliente derivado, proyecto, documento, extracción y revisión/hash del original para una futura proyección de búsqueda autorizada.

En desarrollo, la interfaz oficial en 5173 usa un proxy del mismo origen, por lo que no necesita abrir el CORS del backend para ese origen. La pantalla técnica de 5174 sigue soportada por WEB_ORIGIN. Las pruebas SQL de `supabase/tests/ingestion_rls.sql` usan fixtures de dos usuarios dentro de rollback. El recorrido real con sesión válida y archivos en Storage aún necesita comprobarse; no confundirlo con pruebas de doble o metadatos sintéticos.

## Ingesta en segundo plano

Iniciar desde la raíz con `python3 scripts/dev-polyrepo.py --with-worker`. El publicador y consumidor de resultados usan `python -m trato_api.thread_runner --mode connected`; requieren Redis propio y configuración backend de `.env.example`. `GET /api/v1/threads/{id}` devuelve estado autorizado. Los endpoints `/internal/threads` requieren token exclusivo del worker y autorización del trabajo; nunca exponen acceso de servidor al navegador.
