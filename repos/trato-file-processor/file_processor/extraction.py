"""Bounded, local extraction. Uploaded documents never select tools or URLs."""
from hashlib import sha256
from io import BytesIO
from pathlib import PurePosixPath
import selectors
import subprocess
import tempfile
import time
import zipfile
import zlib

from defusedxml.ElementTree import fromstring
from defusedxml.common import DefusedXmlException
from xml.etree.ElementTree import ParseError

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 250_000
MAX_XML_BYTES = 4 * 1024 * 1024
MAX_ZIP_BYTES = 32 * 1024 * 1024
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
WORD = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CONTENT_TYPES = '{http://schemas.openxmlformats.org/package/2006/content-types}'


class ExtractionError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.status = code, status


def pdf_segments(data):
    """Keep physical page numbers, including when intervening pages have no text."""
    with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as errors:
        source.write(data)
        source.seek(0)
        try:
            child = subprocess.Popen(['pdftotext', '-layout', '-', '-'], stdin=source,
                                     stdout=subprocess.PIPE, stderr=errors)
        except FileNotFoundError:
            raise ExtractionError('PARSER_UNAVAILABLE', 'Poppler no está instalado.', 503)
        chunks, size = [], 0
        deadline = time.monotonic() + 12
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ExtractionError('EXTRACTION_TIMEOUT', 'El archivo tardó demasiado en procesarse.')
                    if not selector.select(min(remaining, 0.2)):
                        continue
                    chunk = child.stdout.read1(16384)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_TEXT_BYTES:
                        raise ExtractionError('TEXT_TOO_LARGE', 'El texto extraído supera el límite permitido.')
                    chunks.append(chunk)
            try:
                code = child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise ExtractionError('EXTRACTION_TIMEOUT', 'El archivo tardó demasiado en procesarse.')
            if code:
                errors.seek(0)
                detail = errors.read(4096).lower()
                if b'password' in detail or b'encrypted' in detail:
                    raise ExtractionError('PASSWORD_PROTECTED', 'El PDF está protegido y no puede leerse.')
                raise ExtractionError('UNREADABLE_FILE', 'No se pudo leer el PDF.')
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()
            child.stdout.close()
    pages = b''.join(chunks).decode('utf-8', errors='replace').split('\f')
    if pages and not pages[-1].strip():
        pages.pop()
    return [{'index': i, 'locator': {'kind': 'page', 'page': i}, 'text': text.strip()}
            for i, text in enumerate(pages, 1) if text.strip()]


def docx_segments(data):
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > 2048 or len(set(names)) != len(names):
                raise ExtractionError('UNSAFE_ARCHIVE', 'El DOCX tiene una estructura ZIP no admitida.')
            if sum(entry.file_size for entry in entries) > MAX_ZIP_BYTES:
                raise ExtractionError('ARCHIVE_TOO_LARGE', 'El contenido descomprimido supera el límite.')
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or entry.flag_bits & 1:
                    raise ExtractionError('UNSAFE_ARCHIVE', 'El DOCX contiene entradas no admitidas.')
                if entry.file_size > max(1, entry.compress_size) * 200:
                    raise ExtractionError('UNSAFE_ARCHIVE', 'La compresión del DOCX supera el límite.')
                if entry.filename.lower().endswith('vbaproject.bin'):
                    raise ExtractionError('UNSUPPORTED_FORMAT', 'No se admiten documentos con macros.', 415)
            for name in ('[Content_Types].xml', 'word/document.xml'):
                if name not in names:
                    raise ExtractionError('INVALID_DOCX', 'El archivo no es un documento DOCX válido.')
                if archive.getinfo(name).file_size > MAX_XML_BYTES:
                    raise ExtractionError('ARCHIVE_TOO_LARGE', 'El XML del DOCX supera el límite.')
            types = fromstring(archive.read('[Content_Types].xml'), forbid_dtd=True)
            expected = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
            if not any(e.get('PartName') == '/word/document.xml' and e.get('ContentType') == expected
                       for e in types.findall(CONTENT_TYPES + 'Override')):
                raise ExtractionError('INVALID_DOCX', 'El documento no declara un cuerpo DOCX válido.')
            root = fromstring(archive.read('word/document.xml'), forbid_dtd=True)
            if root.tag != WORD + 'document':
                raise ExtractionError('UNSUPPORTED_FORMAT', 'Esta variante de documento Word aún no está admitida.', 415)
            result, size = [], 0
            for index, paragraph in enumerate(root.iter(WORD + 'p'), 1):
                parts = []
                for element in paragraph.iter():
                    if element.tag == WORD + 't':
                        parts.append(element.text or '')
                    elif element.tag == WORD + 'tab':
                        parts.append('\t')
                    elif element.tag in (WORD + 'br', WORD + 'cr'):
                        parts.append('\n')
                text = ''.join(parts).strip()
                size += len(text.encode('utf-8'))
                if size > MAX_TEXT_BYTES:
                    raise ExtractionError('TEXT_TOO_LARGE', 'El texto extraído supera el límite permitido.')
                if text:
                    result.append({'index': index, 'locator': {'kind': 'paragraph', 'paragraph': index}, 'text': text})
            return result
    except (zipfile.BadZipFile, KeyError, RuntimeError, NotImplementedError, OSError, zlib.error):
        raise ExtractionError('INVALID_DOCX', 'El DOCX está dañado o no es compatible.')
    except (DefusedXmlException, ParseError):
        raise ExtractionError('UNSAFE_XML', 'El XML del DOCX es inválido o contiene declaraciones no admitidas.')


def extract_document(data, filename, content_type):
    if not data:
        raise ExtractionError('EMPTY_FILE', 'El archivo está vacío.')
    if len(data) > MAX_FILE_BYTES:
        raise ExtractionError('FILE_TOO_LARGE', 'El archivo supera 10 MB.', 413)
    suffix = PurePosixPath(filename.lower()).suffix
    mime = content_type.split(';', 1)[0].strip().lower()
    if suffix == '.pdf' and mime in ('application/pdf', 'application/octet-stream'):
        if not data.startswith(b'%PDF-'):
            raise ExtractionError('FORMAT_MISMATCH', 'El contenido no corresponde a un PDF.')
        segments, kind, parser = pdf_segments(data), 'pdf', 'poppler-pdftotext'
        warnings = ['Sin OCR: las páginas sin texto seleccionable no aportan contenido.']
    elif suffix == '.docx' and mime in (DOCX_MIME, 'application/octet-stream'):
        segments, kind, parser = docx_segments(data), 'docx', 'docx-xml'
        warnings = ['Referencias por párrafo, sin estimar páginas de Word. Solo cuerpo y tablas; no imágenes, encabezados, notas ni comentarios.']
    else:
        raise ExtractionError('UNSUPPORTED_FORMAT', 'Formatos admitidos: PDF y DOCX. El formato .doc antiguo aún no está admitido.', 415)
    if not segments:
        raise ExtractionError('NO_EXTRACTABLE_TEXT', 'No hay texto extraíble. El documento puede contener solo imágenes; OCR aún no está implementado.')
    text = '\n\n'.join(segment['text'] for segment in segments)
    if len(text.encode('utf-8')) > MAX_TEXT_BYTES:
        raise ExtractionError('TEXT_TOO_LARGE', 'El texto extraído supera el límite permitido.')
    return {'schema_version': 1, 'status': 'ready', 'sha256': sha256(data).hexdigest(),
            'format': kind, 'size_bytes': len(data), 'parser': parser, 'parser_version': '1',
            'text': text, 'segments': segments, 'warnings': warnings,
            'identity_verified': False, 'signature_verified': False}
