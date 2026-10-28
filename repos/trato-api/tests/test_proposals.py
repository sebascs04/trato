from copy import deepcopy
import unittest

import httpx
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from trato_api.errors import ApiError
from trato_api.app import Settings
from trato_api.proposals.routes import build_proposal_router
from trato_api.proposals.repository import ProposalRepository

PROJECT='aaaaaaaa-0001-4000-8000-000000000001'
PROPOSAL='aaaaaaaa-0002-4000-8000-000000000002'
REVISION='aaaaaaaa-0003-4000-8000-000000000003'
DOC='aaaaaaaa-0004-4000-8000-000000000004'
SOURCE='aaaaaaaa-0005-4000-8000-000000000005'


class ProposalRoutesTest(unittest.TestCase):
    def setUp(self):
        self.calls=[];calls=self.calls
        class Repository:
            def __init__(self,settings,authorization):self.authorization=authorization
            def command(self,action,data,key):
                calls.append((action,data,key,self.authorization))
                return {'proposal_id':PROPOSAL,'revision_id':REVISION,'acceptance_id':None}
            def list_proposals(self,project):calls.append(('list',project));return []
            def get_proposal(self,id):raise ApiError('PROPOSAL_NOT_FOUND',404)
            def get_revision(self,*args,**kwargs):raise ApiError('REVISION_NOT_FOUND',404)
        def user(request:Request):
            if request.headers.get('authorization')!='Bearer synthetic-user':raise HTTPException(401)
            return 'synthetic-owner'
        app=FastAPI();app.include_router(build_proposal_router(Settings(),user,Repository))
        @app.exception_handler(ApiError)
        async def error(request,value):return JSONResponse({'error':{'code':value.code}},status_code=value.status)
        self.client=TestClient(app);self.auth={'Authorization':'Bearer synthetic-user','Idempotency-Key':'proposal-command'}
        self.terms={'scope_summary':'Additional vertical videos','conditions':'One review round','currency':'USD','deadline':'2026-11-12','line_items':[{'description':'Video','quantity':2,'unit_amount_minor':9000}]}
        self.create={'request_document_id':DOC,'terms':self.terms,'source_document_ids':[DOC,SOURCE]}
    def test_authentication_precedes_creation_and_no_owner_can_be_injected(self):
        url=f'/api/v1/projects/{PROJECT}/proposals'
        self.assertEqual(self.client.post(url,json=self.create).status_code,401)
        self.assertEqual(self.client.post(url,headers=self.auth,json={**self.create,'owner_id':'foreign'}).status_code,422)
        self.assertEqual(self.calls,[])
    def test_only_exact_minor_units_and_explicit_currency_are_accepted(self):
        url=f'/api/v1/projects/{PROJECT}/proposals'
        for value in [0.1,'100',True,-1]:
            data=deepcopy(self.create);data['terms']['line_items'][0]['unit_amount_minor']=value
            self.assertEqual(self.client.post(url,headers=self.auth,json=data).status_code,422)
        data=deepcopy(self.create);data['terms']['currency']='EUR'
        self.assertEqual(self.client.post(url,headers=self.auth,json=data).status_code,422)
        self.assertEqual(self.calls,[])
    def test_zero_price_is_preserved_and_project_comes_from_the_path(self):
        data=deepcopy(self.create);data['terms']['line_items'][0]['unit_amount_minor']=0
        response=self.client.post(f'/api/v1/projects/{PROJECT}/proposals',headers=self.auth,json=data)
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.calls[0][0],'create');self.assertEqual(self.calls[0][1]['project_id'],PROJECT)
        self.assertEqual(self.calls[0][1]['terms']['line_items'][0]['unit_amount_minor'],0)
        self.assertEqual(self.calls[0][3],'Bearer synthetic-user')
        self.assertEqual(response.headers['cache-control'],'no-store')
    def test_missing_key_and_unknown_fields_do_not_invoke_repository(self):
        url=f'/api/v1/projects/{PROJECT}/proposals'
        self.assertEqual(self.client.post(url,headers={'Authorization':'Bearer synthetic-user'},json=self.create).status_code,422)
        data=deepcopy(self.create);data['terms']['additional_minor']=1
        self.assertEqual(self.client.post(url,headers=self.auth,json=data).status_code,422)
        self.assertEqual(self.calls,[])
    def test_acceptance_requires_exact_revision_document_and_human_confirmation(self):
        url=f'/api/v1/proposals/{PROPOSAL}/acceptance'
        valid={'expected_revision_id':REVISION,'document_id':DOC,'confirmed':True,'review_notes':'Reviewed the returned document against this revision.'}
        for patch in [{'confirmed':False},{'confirmed':1},{'review_notes':''},{'document_id':'not-an-id'},{'status':'paid'}]:
            self.assertEqual(self.client.post(url,headers=self.auth,json={**valid,**patch}).status_code,422)
        self.assertEqual(self.calls,[])
        self.assertEqual(self.client.post(url,headers=self.auth,json=valid).status_code,200)
        self.assertEqual(self.calls[0][0],'accept');self.assertEqual(self.calls[0][1]['expected_revision_id'],REVISION)
        self.assertNotIn('cryptographic_signature_verified',self.calls[0][1])
    def test_edit_draft_has_distinct_command_and_requires_current_snapshot(self):
        body={'expected_revision_id':REVISION,'terms':self.terms,'source_document_ids':[DOC,SOURCE]}
        result=self.client.post(f'/api/v1/proposals/{PROPOSAL}/draft',headers=self.auth,json=body)
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.calls[0][0],'edit_draft')
        self.assertEqual(self.calls[0][1]['expected_revision_id'],REVISION)
    def test_new_client_version_requires_feedback_document_and_notes(self):
        body={'expected_revision_id':REVISION,'terms':self.terms,'source_document_ids':[DOC,SOURCE]}
        result=self.client.post(f'/api/v1/proposals/{PROPOSAL}/revisions',headers=self.auth,json=body)
        self.assertEqual(result.status_code,422);self.assertEqual(self.calls,[])

    def test_read_errors_remain_errors_and_never_become_fixtures(self):
        response=self.client.get(f'/api/v1/proposals/{PROPOSAL}',headers=self.auth)
        self.assertEqual(response.status_code,404);self.assertEqual(response.json()['error']['code'],'PROPOSAL_NOT_FOUND')


class ProposalRepositoryTest(unittest.TestCase):
    def test_rpc_forwards_only_user_jwt_and_explicit_command(self):
        seen=[]
        def handle(request):
            seen.append(request)
            return httpx.Response(200,json={'proposal_id':PROPOSAL,'revision_id':REVISION})
        repo=ProposalRepository(Settings(supabase_url='https://example.supabase.invalid',supabase_key='sb_publishable_synthetic'),'Bearer synthetic-user',transport=httpx.MockTransport(handle))
        result=repo.command('review',{'proposal_id':PROPOSAL,'expected_revision_id':REVISION,'document_id':DOC,'confirmed':True},'stable-key')
        self.assertEqual(result['revision_id'],REVISION)
        self.assertEqual(str(seen[0].url),'https://example.supabase.invalid/rest/v1/rpc/proposal_command')
        self.assertEqual(seen[0].headers['authorization'],'Bearer synthetic-user')
        self.assertEqual(seen[0].headers['apikey'],'sb_publishable_synthetic')
    def test_read_is_project_authorized_before_listing_proposals(self):
        seen=[]
        def handle(request):seen.append(str(request.url));return httpx.Response(200,json=[])
        repo=ProposalRepository(Settings(supabase_url='https://example.supabase.invalid',supabase_key='sb_publishable_synthetic'),'Bearer synthetic-user',transport=httpx.MockTransport(handle))
        with self.assertRaises(ApiError):repo.list_proposals(PROJECT)
        self.assertEqual(len(seen),1)
        self.assertIn('/projects?',seen[0]);self.assertNotIn('/change_proposals?',seen[0])
