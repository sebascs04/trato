# Trato File Processor

The file processor is a private service that validates documents and extracts their text. It reads PDF files with Poppler and DOCX files through a bounded reading of their XML, then returns the text split into located segments: physical pages for PDF and paragraph numbers for DOCX. It also hosts the vector search that lets TeTrato cite passages from a project's documents.

## Run it

It needs Python 3.12 and Poppler (`pdftotext`); on Debian or Ubuntu, install `poppler-utils`.

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
export FILE_PROCESSOR_TOKEN="a-long-random-local-token"
.venv/bin/uvicorn file_processor.app:app --host 127.0.0.1 --port 8101
```

`GET /health` reports the service and its supported formats. `POST /v1/extractions?filename=request.pdf` takes the original file as the request body and requires `Authorization: Bearer <FILE_PROCESSOR_TOKEN>`. Only the API holds that token.

You can also try the parser on its own:

```bash
.venv/bin/python -m file_processor tests/fixtures/request.pdf
```

## Output and limits

Each result includes the SHA-256 of the original file, its size, format and parser, the full text and its located segments. Files can be up to 10 MB, with 250 KB of text; a PDF is read within 12 seconds, and temporary files are closed as soon as the work ends.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```
