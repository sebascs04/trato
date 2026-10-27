from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import unittest
import subprocess
from trato_api.errors import ApiError
from trato_api.proposals.pdf import render_pdf, ProposalPdfService

class PdfTest(unittest.TestCase):
    def setUp(self):
        self.snapshot={'proposal':{'id':'p','project_id':'project','current_revision_id':'r','status':'draft','locked_at':None},'revision':{'id':'r','revision_no':1,'scope_summary':'Vídeo vertical <final> & subtítulos','conditions':'Una revisión\nEntrega por correo','additional_minor':10,'deadline':'2026-11-12'},'line_items':[{'description':'Vídeo','quantity':1,'unit_amount_minor':10}],'sources':[{'document_id':'source','document_sha256':'a'*64}],'artifacts':[]}
    def test_deterministic_pdf_has_exact_terms_accents_and_cents(self):
        content=render_pdf(self.snapshot,'Campaña','Sebastián')
        self.assertEqual(content,render_pdf(self.snapshot,'Campaña','Sebastián'))
        text=subprocess.run(['pdftotext','-','-'],input=content,capture_output=True,check=True).stdout.decode()
        for expected in ['versión 1','Vídeo vertical <final> & subtítulos','USD 0.10','2026-11-12','Sebastián','a'*64]:self.assertIn(expected,text)
    def test_new_revision_retains_old_pdf_and_changes_snapshot(self):
        old=render_pdf(self.snapshot,'Campaña','Cliente')
        new=deepcopy(self.snapshot);new['revision'].update(id='r2',revision_no=2,additional_minor=20);new['line_items'][0]['unit_amount_minor']=20
        self.assertNotEqual(old,render_pdf(new,'Campaña','Cliente'))
        self.assertEqual(old,render_pdf(self.snapshot,'Campaña','Cliente'))
    def test_unsupported_glyph_and_inconsistent_total_fail_explicitly(self):
        bad=deepcopy(self.snapshot);bad['revision']['additional_minor']=9
        with self.assertRaises(ApiError) as error:render_pdf(bad,'P','C')
        self.assertEqual(error.exception.code,'PROPOSAL_AMOUNT_MISMATCH')
        with self.assertRaises(ApiError) as error:render_pdf(self.snapshot,'P','\U0001fae0')
        self.assertEqual(error.exception.code,'PDF_UNSUPPORTED_CHARACTER')
    def test_existing_artifact_is_downloaded_not_regenerated(self):
        content=b'%PDF-original';snapshot=deepcopy(self.snapshot);snapshot['artifacts']=[{'document_id':'doc','sha256':sha256(content).hexdigest()}]
        class Repo:
            def get_revision(self,*args):return snapshot
            def document(self,id):return {'id':id}
            def download(self,doc):return content
        self.assertEqual(ProposalPdfService().save(Repo(),'p','r'),snapshot['artifacts'][0])
    def test_superseded_revision_cannot_generate_pdf(self):
        snapshot=deepcopy(self.snapshot);snapshot['proposal']['current_revision_id']='new'
        class Repo:
            def get_revision(self,*args):return snapshot
        with self.assertRaises(ApiError):ProposalPdfService().save(Repo(),'p','r')
