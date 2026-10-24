# Trato

Un espacio para que freelancers gestionen acuerdos, solicitudes de cambio y cobros por proyecto, con documentos y fuentes que permitan entender por qué cambió cada trato.

## Estado actual

Esta primera publicación contiene la interfaz interactiva, datos ficticios, extracción local de texto PDF, un flujo local con LangGraph y el adaptador de PayPal sandbox con sus pruebas. El análisis visible, la formalización y el recorrido de pago de la interfaz son vistas previas; todavía no están conectados a operaciones reales. No se envían correos ni se verifica una firma desde esta interfaz.

La API autenticada, Supabase, el procesador de documentos y el worker se desarrollan en componentes independientes. Sus repositorios locales de trabajo no se incluyen en esta publicación. Esta versión no representa todavía la entrega funcional completa del hackathon.

## Ejecutar la interfaz

Requiere Node.js 18 o posterior. No hay dependencias npm que instalar.

```bash
git clone https://github.com/sebascs04/trato.git
cd trato
npm run dev
```

Abre http://localhost:5173. Para otro puerto, usa `PORT=5174 npm run dev`. El servidor escucha únicamente en la interfaz local; aún no está preparado para un despliegue público en Render.

Puedes recorrer Clientes → Nueva solicitud de cambio y usar el correo de ejemplo. Los proyectos iniciales y sus PDFs son ficticios. Los cambios y archivos incorporados desde la interfaz se guardan localmente en IndexedDB; no se suben a GitHub ni a una base remota.

## Extracción y flujo local

Para leer PDFs con texto seleccionable se necesita `pdftotext`, incluido en Poppler. No hay OCR conectado.

El flujo de Python requiere Python 3.12 y las dependencias fijadas:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
```

El motor guarda checkpoints en `.local/`, que no forma parte del repositorio. Consulta [el flujo ejecutable](docs/flujo-ejecutable.md) para detalles. Algunos apartados de ese documento conservan la evolución de la interfaz.

## PayPal

El adaptador de backend implementa creación, consulta, captura, reconciliación y verificación de eventos de sandbox, además de preparación de correo. Necesita configuración privada y un repositorio autoritativo de aceptaciones y pagos para conectarse a la API. Los estados de vista previa del navegador no autorizan cobros reales.

Consulta [la integración de PayPal](docs/paypal-sandbox.md). Las variables de `.env.example` están vacías y no se cargan automáticamente. Las credenciales deben permanecer en el backend.

## Comprobaciones

```bash
npm run check
npm test
.venv/bin/python -m unittest discover -s backend -p 'test_paypal.py'
.venv/bin/python -m unittest discover -s backend -p 'test_workflow.py'
```

Las pruebas de rutas requieren FastAPI y su cliente de pruebas; no están incluidos en el lockfile del motor local.

## Organización

- `index.html`, `styles.css`, `app.js`: interfaz y recorrido por proyecto.
- `data/`: entidades relacionadas por ID y documentos ficticios.
- `local-store.js`: persistencia local de la interfaz.
- `server.mjs`, `pdf-extraction.mjs`: servidor local y lectura de PDF.
- `backend/workflow*.py`: motor y checkpoints locales.
- `backend/paypal/`: adaptador para PayPal sandbox.
- `tests/`, `backend/test_*.py`: pruebas.

Esta publicación excluye credenciales, documentos aportados por usuarios, bases locales, entornos virtuales y los repositorios de trabajo anidados.
