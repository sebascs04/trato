# Trato

Un espacio para freelancers que conecta acuerdos, solicitudes de cambio, evidencias y pagos con PayPal.

Esta publicación reúne el frontend y los servicios necesarios para compartir y ejecutar el proyecto. Cada servicio conserva su carpeta y responsabilidad; no se publican credenciales, documentos del usuario, bases locales ni entornos virtuales.

## Estado actual

- Clientes y proyectos privados con Supabase Auth, Postgres, Storage y políticas por propietario.
- Ingesta PDF asíncrona mediante outbox, Redis y worker; extracción con referencias por página.
- Propuestas/adendas versionadas, PDF por instantánea, revisión humana y envío explícito mediante Gmail OAuth.
- Aceptación registrada mediante documento recibido y revisión humana. No se certifican firmas criptográficas.
- Cobros PayPal Sandbox y confirmación de pago en backend. Un cambio pagado queda sólo para consulta.
- Historial único por proyecto y carga bajo demanda. Tipografía Manrope e iconos Lucide locales.
- Recorrido de devolución simulado con revisiones, cálculos y fuentes oficiales PayPal. No ejecuta reembolsos reales ni sandbox.
- Mapa visual de ejemplo. Neo4j y Weaviate están previstos, todavía sin conexión.
- Adaptadores y contratos Gemini preparados; el análisis de cambios/devoluciones que usa fixtures es explícitamente simulado. No se activa un proveedor ni se cambia a otro si falla.

## Empezar

Requiere Node.js 18+, Python 3.12 y, para la ingesta conectada, Redis propio. Poppler es necesario para la lectura PDF del prototipo anterior. Los puertos están en `local-ports.json`.

```bash
git clone https://github.com/sebascs04/trato.git
cd trato
npm ci
```

Sigue [la guía para colaboradores](docs/colaboradores.md) para instalar los entornos Python y configurar los servicios. Las plantillas `.env.example` no contienen las credenciales de desarrollo. Un clon no tiene acceso automático a Gmail, PayPal o Supabase de otra persona.

Con los servicios configurados:

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

Interfaz oficial: http://localhost:5173/#clientes. Sin configuración, muestra el error o acceso pendiente; no sustituye datos reales por ejemplos. La interfaz técnica opcional de `repos/trato-web` no es el diseño oficial.

## Organización

| Carpeta | Responsabilidad |
| --- | --- |
| Raíz: `index.html`, `connected-workspace.mjs`, `proposal-workspace.mjs` | Producto web, navegación y operaciones de usuario |
| `repos/trato-api` | Autenticación, reglas de negocio, persistencia, Gmail y PayPal |
| `repos/trato-file-processor` | Validación y extracción de documentos |
| `repos/trato-worker` | Grafos, contratos de modelos y ejecución de trabajos |
| `repos/trato-web` | Herramienta técnica opcional |
| `scripts` | Arranque local, configuración privada e iconos |
| `docs` | Arquitectura, contratos, producto e instrucciones |
| `data` | Datos y PDFs ficticios del prototipo |
| `backend` | Motor/adaptadores anteriores, conservados para referencia y compatibilidad |

Los `.git` de los repositorios locales no se incluyen en esta publicación. Las carpetas de servicios son archivos normales del repositorio compartido, no submódulos que requieran acceso a repos privados.

## Comprobaciones

```bash
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Las pruebas de navegador requieren el servidor local y bibliotecas de Chromium. Los tests de devoluciones arrancan el worker simulado local; no llaman a proveedores financieros ni modelos reales. Consulta los README de cada servicio para sus pruebas Python. Las pruebas Redis tienen requisitos propios y no deben apuntar a recursos de otros proyectos.

## Documentación

- [Colaboradores y configuración](docs/colaboradores.md)
- [Ingesta conectada](docs/ingesta-conectada.md)
- [Arquitectura de IA](docs/arquitectura-ia-trato.md)
- [Flujo de cambios simulado](docs/worker-flujo-cambios.md)
- [Flujo de devoluciones simulado](docs/worker-flujo-devoluciones.md)
- [Estándar de prompts](docs/estandar-prompts.md)
- [Propuesta del producto](docs/propuesta-ganadora.md)

No está desplegado públicamente ni preparado como un servicio de producción. El objetivo inmediato es completar y validar un recorrido funcional para la hackathon.
