from io import BytesIO
from pathlib import Path
import shutil
import unittest
import zipfile

from fastapi.testclient import TestClient
from file_processor.app import create_app
from file_processor.extraction import DOCX_MIME, ExtractionError, extract_document


def docx(xml=None):
    output = BytesIO()
    xml = xml or '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Asunto: Extra</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Una versión vertical</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('word/document.xml', xml)
    return output.getvalue()


class ExtractionTests(unittest.TestCase):
    def test_docx_preserves_paragraph_and_table_order_without_fake_pages(self):
        result = extract_document(docx(), 'pedido.docx', DOCX_MIME)
        self.assertEqual(result['text'], 'Asunto: Extra\n\nUna versión vertical')
        self.assertEqual(result['segments'][1]['locator'], {'kind': 'paragraph', 'paragraph': 2})
        self.assertFalse(result['signature_verified'])
        self.assertEqual(len(result['sha256']), 64)

    def test_entities_are_rejected(self):
        xml = '<!DOCTYPE x [<!ENTITY a "SECRET">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:document>'
        with self.assertRaises(ExtractionError) as error:
            extract_document(docx(xml), 'pedido.docx', DOCX_MIME)
        self.assertEqual(error.exception.code, 'UNSAFE_XML')

    def test_archive_bomb_is_rejected_before_decompression(self):
        output = BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('word/document.xml', 'a' * 500_000)
        with self.assertRaises(ExtractionError) as error:
            extract_document(output.getvalue(), 'pedido.docx', DOCX_MIME)
        self.assertEqual(error.exception.code, 'UNSAFE_ARCHIVE')

    def test_disguised_files_and_old_word_are_rejected(self):
        for data, filename, mime in [(b'not PDF', 'a.pdf', 'application/pdf'),
                                     (b'not ZIP', 'a.docx', DOCX_MIME),
                                     (b'old Word', 'a.doc', 'application/msword')]:
            with self.subTest(filename=filename), self.assertRaises(ExtractionError):
                extract_document(data, filename, mime)

    @unittest.skipUnless(shutil.which('pdftotext'), 'Poppler required')
    def test_actual_pdf(self):
        data = (Path(__file__).parent / 'fixtures' / 'request.pdf').read_bytes()
        result = extract_document(data, 'correo.pdf', 'application/pdf')
        self.assertIn('Correo de solicitud', result['text'])
        self.assertEqual(result['segments'][0]['locator'], {'kind': 'page', 'page': 1})

    def test_http_requires_service_identity(self):
        with TestClient(create_app('test-token')) as client:
            self.assertEqual(client.post('/v1/extractions?filename=a.docx', content=docx()).status_code, 401)
            response = client.post('/v1/extractions?filename=a.docx', content=docx(),
                                   headers={'Authorization': 'Bearer test-token', 'Content-Type': DOCX_MIME})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['data']['format'], 'docx')

    def test_service_fails_closed_without_configuration(self):
        with TestClient(create_app('')) as client:
            self.assertEqual(client.post('/v1/extractions?filename=a.docx').status_code, 503)

    def test_empty_and_oversized_files(self):
        with self.assertRaises(ExtractionError) as error:
            extract_document(b'', 'a.pdf', 'application/pdf')
        self.assertEqual(error.exception.code, 'EMPTY_FILE')
        with self.assertRaises(ExtractionError) as error:
            extract_document(b'x' * (10 * 1024 * 1024 + 1), 'a.pdf', 'application/pdf')
        self.assertEqual(error.exception.status, 413)


if __name__ == '__main__':
    unittest.main()
