import unittest
from trato_api.errors import ApiError
from trato_api.proposal_ai import analysis_record,revision_scope

PROJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';REQUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
PROPOSAL={'id':'cccccccc-cccc-4ccc-8ccc-cccccccccccc','request_document_id':REQUEST,'project_id':PROJECT}
SOURCE={'source_id':'s'*64,'file_id':REQUEST,'title':'Pequeña tienda','source_kind':'original','generation':'g'}
class Jobs:
    def __init__(self,data,status='completed'):self.data=data;self.status=status
    def input(self,owner,job_id):return self.data
    def get(self,owner,job_id,kind):return {'status':self.status,'result':{'raw':True}}
class Assistant:
    def __init__(self,data,status='completed',answer_status='answered'):self.jobs=Jobs(data,status);self.answer_status=answer_status
    def validate_result(self,repo,owner,job_id,result,*,draft_saved=False):
        assert draft_saved,'saved drafts must skip only the request-context check'
        return {'status':self.answer_status,'answer':'La tienda no estaba en el acuerdo.','citations':[{'source_id':'s'*64,'quote':'diez productos'}],'sources':[SOURCE],
                'proposal':{'scope_summary':'Tienda de 10 productos','conditions':'Sin inventario','description':'Módulo de tienda','estimated_hours':'8'}}
class Service:
    def __init__(self,**kwargs):self.assistant=Assistant(**kwargs)
DATA={'action':'draft_change','project_id':PROJECT,'change_proposal_context':{'request_document_id':REQUEST}}

class ProposalAITests(unittest.TestCase):
    def test_saved_analysis_keeps_tetrato_proposal_reasoning_and_cited_sources(self):
        record=analysis_record(Service(data=DATA),None,'owner','job',PROPOSAL)
        self.assertEqual((record['scope_summary'],record['estimated_hours'],record['reasoning']),('Tienda de 10 productos','8','La tienda no estaba en el acuerdo.'))
        self.assertEqual(record['citations'],[{'quote':'diez productos','title':'Pequeña tienda','file_id':REQUEST,'source_kind':'original'}])
    def test_analysis_from_another_request_project_or_unfinished_job_is_rejected(self):
        for data in [{**DATA,'project_id':'other'},{**DATA,'change_proposal_context':{'request_document_id':'other'}},{**DATA,'action':'question'}]:
            with self.assertRaisesRegex(ApiError,'AI_CONTEXT_INVALID'):analysis_record(Service(data=data),None,'owner','job',PROPOSAL)
        with self.assertRaisesRegex(ApiError,'AI_PLAN_NOT_READY'):analysis_record(Service(data=DATA,status='running'),None,'owner','job',PROPOSAL)
        with self.assertRaisesRegex(ApiError,'AI_CONTEXT_INVALID'):analysis_record(Service(data=DATA,answer_status='insufficient_evidence'),None,'owner','job',PROPOSAL)
    def test_saved_terms_fingerprint_changes_when_the_draft_is_edited(self):
        from trato_api.proposal_ai import saved_terms
        class Repo:
            def __init__(self,scope):self.scope=scope
            def rows(self,table,params):
                if table=='proposal_revisions':return [{'scope_summary':self.scope,'conditions':'Sin inventario','currency':'USD','additional_minor':24000,'deadline':'2026-11-25'}]
                return [{'description':'Módulo de tienda','ordinal':1}]
        terms,first=saved_terms(Repo('Tienda'),'owner',{'id':'rev'})
        self.assertEqual(terms['additional_amount'],'USD 240.00')
        self.assertNotEqual(first,saved_terms(Repo('Tienda con cupones'),'owner',{'id':'rev'})[1])
    def test_revision_must_belong_to_owner(self):
        class Repo:
            def rows(self,table,params):return []
        with self.assertRaisesRegex(ApiError,'PROPOSAL_NOT_FOUND'):revision_scope(Repo(),'owner',PROPOSAL['id'],PROPOSAL['id'])

class RevisionAnalysisBindingTests(unittest.TestCase):
    def test_revision_analysis_requires_same_feedback_previous_version_and_context_notes(self):
        from copy import deepcopy
        data=deepcopy(DATA);data['change_proposal_context'].update(proposal_id=PROPOSAL['id'],revision_id=REQUEST,feedback_document_id=PROJECT,feedback_notes='Mentioned in person')
        class Repo:
            number=2
            feedback=PROJECT
            notes='Mentioned in person'
            def rows(self,table,params):
                if params['id']=='eq.'+REQUEST:return [{'revision_no':1}]
                return [{'revision_no':self.number,'feedback_document_id':self.feedback,'feedback_notes':self.notes}]
        repo=Repo();revision={'id':'new'}
        self.assertEqual(analysis_record(Service(data=data),repo,'owner','job',PROPOSAL,revision)['scope_summary'],'Tienda de 10 productos')
        for field,value in [('number',3),('feedback','other'),('notes','Different context')]:
            repo=Repo();setattr(repo,field,value)
            with self.assertRaisesRegex(ApiError,'AI_CONTEXT_INVALID'):analysis_record(Service(data=data),repo,'owner','job',PROPOSAL,revision)
        data['change_proposal_context']['feedback_notes']=''
        repo=Repo();repo.notes='La tienda no estaba en el acuerdo.'
        self.assertIsNotNone(analysis_record(Service(data=data),repo,'owner','job',PROPOSAL,revision))
