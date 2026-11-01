from unittest import TestCase
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from file_processor.prepared_text import read_prepared_file,build_prepared_router

class PreparedTextTests(TestCase):
    def source(self):return {'schema_version':1,'file_id':str(uuid4()),'source_sha256':'a'*64,'parser':'pdf','parser_version':'test',
        'segments':[{'segment_id':'page-2','locator':{'kind':'page','page':2},'text':'The source page.'}]}
    def test_original_page_and_text_are_preserved_without_reparsing(self):
        source=self.source();value=read_prepared_file(source)
        self.assertEqual(value['text'],'The source page.')
        self.assertEqual(value['segments'],source['segments'])
    def test_unknown_path_and_empty_or_oversized_sources_are_rejected(self):
        for payload in [{**self.source(),'path':'/secret'}, {**self.source(),'segments':[]}]:
            with self.assertRaises(ValueError):read_prepared_file(payload)
    def test_read_requires_processor_token(self):
        app=FastAPI();app.include_router(build_prepared_router('internal'));client=TestClient(app)
        self.assertEqual(client.post('/v1/files/prepared-text',json=self.source()).status_code,401)
        self.assertEqual(client.post('/v1/files/prepared-text',json=self.source(),headers={'Authorization':'Bearer internal'}).status_code,200)
