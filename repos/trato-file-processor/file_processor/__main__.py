"""Local parser check without HTTP, user accounts, AI or persistence."""
import argparse
import json
from pathlib import Path
import sys

from .extraction import DOCX_MIME, ExtractionError, MAX_FILE_BYTES, extract_document

parser = argparse.ArgumentParser(description='Extrae texto local de PDF/DOCX sin IA.')
parser.add_argument('file', type=Path)
args = parser.parse_args()
try:
    with args.file.open('rb') as source:
        data = source.read(MAX_FILE_BYTES + 1)
    mime = DOCX_MIME if args.file.suffix.lower() == '.docx' else 'application/octet-stream'
    print(json.dumps({'data': extract_document(data, args.file.name, mime)}, ensure_ascii=False))
except ExtractionError as error:
    print(json.dumps({'error': {'code': error.code, 'message': str(error)}}, ensure_ascii=False))
    sys.exit(1)
except OSError:
    print(json.dumps({'error': {'code': 'FILE_UNAVAILABLE', 'message': 'No se pudo abrir el archivo local.'}}))
    sys.exit(1)
