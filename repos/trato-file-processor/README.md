# Trato File Processor

Servicio privado que valida documentos y extrae texto sin IA. PDF mediante Poppler, DOCX mediante lectura acotada de ZIP/XML. Word antiguo `.doc`, OCR, imágenes, hojas de cálculo y presentaciones no están implementados.

## Ejecutar

Python 3.12 y Poppler (`pdftotext`) deben estar disponibles. En Debian/Ubuntu, el paquete de sistema es `poppler-utils`.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
export FILE_PROCESSOR_TOKEN="una-clave-local-larga-y-aleatoria"
.venv/bin/uvicorn file_processor.app:app --host 127.0.0.1 --port 8101 --limit-concurrency 8
```

`GET /health` informa salud y formatos soportados. `POST /v1/extractions?filename=correo.pdf` requiere `Authorization: Bearer <FILE_PROCESSOR_TOKEN>`, el MIME de PDF/DOCX y el archivo original como cuerpo binario. El token pertenece a la API, nunca al navegador. Dockerfile disponible; la imagen aún no se ha construido en esta entrega.

También puedes probar el parser sin API ni sesión:

```bash
.venv/bin/python -m file_processor tests/fixtures/request.pdf
```

## Resultado v1

Devuelve hash SHA-256 del original, tamaño, formato, parser, texto y segmentos con localizador. PDF usa páginas físicas; DOCX usa ordinales de párrafo, incluyendo texto de tablas. No inventa paginación de Word. No lee encabezados, notas, imágenes ni comentarios de DOCX. Subir documentos no verifica identidad ni firmas.

Límites: archivo 10 MB, texto 250 KB, XML 4 MB, ZIP descomprimido 32 MB, 2048 entradas y proporción de compresión 200. PDF tiene un tiempo máximo de 12 segundos. No se descomprime a rutas del disco ni se siguen enlaces del documento. Los archivos temporales se cierran al terminar. No persiste documentos ni resultados.

```bash
.venv/bin/python -m unittest discover -s tests -v
```

La fixture `tests/fixtures/request.pdf` procede de la demo ficticia de Trato.
