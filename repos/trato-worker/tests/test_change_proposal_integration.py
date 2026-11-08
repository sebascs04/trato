"""Read-only MVP flow: real HTTP tools and validation, explicit storage/model doubles."""
import json,os,unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from trato_api.change_proposal import ChangeProposalService,build_change_proposal_router
from trato_api.project_assistant import ProjectAssistant,build_project_assistant_router
from trato_api.errors import ApiError
from trato_worker.source_tools import BackendToolClient,ToolError
from change_proposal_test_support import Repo,Jobs,Gateway,OWNER,OTHER,PROJECT,AGREEMENT,REQUEST,PROPOSAL,REVISION,FEEDBACK

from memory_test_support import TestMemory

class ProposalModel:
 name='explicit-test-model'
 def __init__(self,request_only=False,feedback=False):self.calls=0;self.request_only=request_only;self.feedback=feedback;self.payload=None
 def generate(self,messages,schema):
  self.calls+=1
  if self.calls==1:self.payload=json.loads(messages[1]['content']);return {'type':'tool_call','tool':'search_document_text','params':{'query':'original scope and requested payment module'}}
  options=json.loads(messages[-1]['content'])['tool_result']['data']['citation_options']
  roles=['request'] if self.request_only else ['agreement','request']
  if self.feedback:roles.append('feedback')
  references=[next(option['reference_id'] for option in options if option['role']==role) for role in roles]
  return {'type':'final','result':{'status':'answered','answer':'The supplied request adds a payment module to the original five pages.',
    'proposal':{'scope_summary':'Add the requested payment module.','conditions':'Review integrations before delivery.',
      'description':'Payment module implementation','estimated_hours':'3.5','suggested_deadline':None},
    'citations':[{'reference_id':reference} for reference in references],'missing_information':[]}}

@patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'worker'})
class ChangeProposalIntegrationTests(unittest.TestCase):
 def setUp(self):
  self.repo=Repo();self.jobs=Jobs();self.model=None
  self.assistant=ProjectAssistant(None,jobs=self.jobs,gateway=Gateway(),server=self.repo,memory=TestMemory())
  self.service=ChangeProposalService(None,assistant=self.assistant)
  app=FastAPI();prefs=SimpleNamespace(for_request=lambda *args:'explicit-test-model')
  app.include_router(build_change_proposal_router(None,lambda:OWNER,repository_factory=lambda *args:self.repo,service=self.service,preferences=prefs))
  app.include_router(build_project_assistant_router(None,lambda:OWNER,repository_factory=lambda *args:self.repo,service=self.assistant,preferences=prefs))
  @app.exception_handler(ApiError)
  async def error(_,e):return JSONResponse({'error':{'code':e.code}},status_code=e.status)
  self.api=TestClient(app);self.api.__enter__();self.addCleanup(self.api.__exit__,None,None,None)
  def handler(request):
   response=self.api.request(request.method,request.url.path,content=request.content,headers=dict(request.headers))
   return httpx.Response(response.status_code,json=response.json())
  self.client=BackendToolClient('http://api.invalid','worker',transport=httpx.MockTransport(handler))
 def enqueue(self,**changes):
  body={'project_id':PROJECT,'request_document_id':REQUEST,'output_language':'en','question':'Prepare this change.',
    'document_ids':sorted([AGREEMENT,REQUEST]),**changes}
  response=self.api.post('/api/v1/ai/change-proposals',json=body,headers={'Idempotency-Key':str(uuid4())})
  self.assertEqual(response.status_code,202,response.text);return response.json()['data']['id']
 def run_job(self,id,model=None):
  from trato_worker.change_proposal import run_change_proposal
  lease=self.jobs.start(id);self.model=model or ProposalModel()
  result=run_change_proposal(self.jobs.input(OWNER,id),self.model,self.client,id,lease)
  self.jobs.finish(id,result)
  return result
 def complete(self,**changes):
  id=self.enqueue(**changes);self.run_job(id);return id
 def test_before_first_adenda_agent_cites_sources_and_calculates_price_without_business_write(self):
  id=self.complete();response=self.api.get('/api/v1/ai/change-proposals/'+id)
  self.assertEqual(response.status_code,200,response.text);value=response.json()['data']['result']
  self.assertEqual(value['status'],'ready');self.assertIsNone(value['proposal_id']);self.assertIsNone(value['revision_id'])
  self.assertEqual({s['file_id'] for s in value['sources']},{AGREEMENT,REQUEST})
  self.assertEqual(value['estimated_hours'],'3.5')
  price=self.api.post('/api/v1/ai/change-proposals/'+id+'/price',json={'rate_minor':101,'confirmed_hours':'0.5'})
  self.assertEqual(price.status_code,200,price.text);self.assertEqual(price.json()['data']['additional_minor'],51)
  self.assertEqual(self.model.calls,2);self.assertEqual(self.repo.mutations,[])
 def test_sent_revision_reuses_same_agent_with_feedback_pdf_and_optional_user_context(self):
  self.repo.revise()
  id=self.enqueue(proposal_id=PROPOSAL,revision_id=REVISION,feedback_document_id=FEEDBACK,feedback_notes='They also mentioned a mobile demo in person.',document_ids=sorted([AGREEMENT,REQUEST,FEEDBACK]))
  model=ProposalModel(feedback=True);self.run_job(id,model)
  response=self.api.get('/api/v1/ai/change-proposals/'+id);self.assertEqual(response.status_code,200,response.text)
  value=response.json()['data']['result'];self.assertEqual(value['status'],'ready')
  self.assertEqual({s['file_id'] for s in value['sources']},{AGREEMENT,REQUEST,FEEDBACK})
  bound=model.payload['change_proposal_context'];self.assertEqual(bound['sent_terms']['scope_summary'],'Payment module')
  self.assertEqual(bound['feedback_notes'],'They also mentioned a mobile demo in person.')
  self.assertEqual(self.repo.proposal['current_revision_id'],REVISION);self.assertEqual(self.repo.mutations,[])
 def test_revision_draft_without_optional_notes_is_allowed_but_feedback_citation_is_mandatory(self):
  self.repo.revise();id=self.enqueue(proposal_id=PROPOSAL,revision_id=REVISION,feedback_document_id=FEEDBACK,document_ids=sorted([AGREEMENT,REQUEST,FEEDBACK]))
  self.assertEqual(self.jobs.input(OWNER,id)['change_proposal_context']['feedback_notes'],'')
  with self.assertRaises(ToolError):self.run_job(id,ProposalModel())
 def test_feedback_from_wrong_revision_or_accepted_change_cannot_be_drafted(self):
  self.repo.revise();self.repo.contexts[0]['revision_id']=str(uuid4())
  body={'project_id':PROJECT,'request_document_id':REQUEST,'proposal_id':PROPOSAL,'revision_id':REVISION,'feedback_document_id':FEEDBACK,'output_language':'en'}
  response=self.api.post('/api/v1/ai/change-proposals',json=body,headers={'Idempotency-Key':str(uuid4())});self.assertEqual(response.status_code,409,response.text)
  self.repo.contexts[0]['revision_id']=REVISION;self.repo.acceptances=[{'id':str(uuid4()),'revision_id':REVISION,'project_id':PROJECT,'owner_id':OWNER}]
  response=self.api.post('/api/v1/ai/change-proposals',json=body,headers={'Idempotency-Key':str(uuid4())});self.assertEqual(response.status_code,409,response.text)
 def test_price_requires_confirmed_hours_and_rejects_boolean_rate(self):
  id=self.complete()
  for body in [{'rate_minor':1000},{'rate_minor':True,'confirmed_hours':'2'},{'rate_minor':1000,'confirmed_hours':'0'},{'rate_minor':1000,'confirmed_hours':'NaN'}]:
   with self.subTest(body=body):
    response=self.api.post('/api/v1/ai/change-proposals/'+id+'/price',json=body)
    self.assertEqual(response.status_code,422,response.text)
  self.assertEqual(self.model.calls,2);self.assertEqual(self.repo.mutations,[])
 def test_paid_change_blocks_poll_price_and_tool_execution(self):
  self.repo.draft();id=self.complete(proposal_id=PROPOSAL,revision_id=REVISION)
  self.repo.proposal.update(status='accepted',locked_at='2026-11-04T12:00:00Z')
  for response in [self.api.get('/api/v1/ai/change-proposals/'+id),self.api.post('/api/v1/ai/change-proposals/'+id+'/price',json={'rate_minor':1000,'confirmed_hours':'2'})]:
   self.assertEqual(response.status_code,409,response.text)
  # A queued inference also loses authorization when its subject is finalized.
  self.repo.proposal.update(status='draft',locked_at=None);pending=self.enqueue(proposal_id=PROPOSAL,revision_id=REVISION)
  self.repo.proposal.update(status='accepted',locked_at='2026-11-04T12:00:00Z')
  with self.assertRaises(ToolError):self.run_job(pending)
  self.assertEqual(self.model.calls,0);self.assertEqual(self.repo.mutations,[])
 def test_source_changed_after_generation_blocks_poll_and_price(self):
  id=self.complete();self.repo.text[REQUEST]+=' A replacement request changed the scope.'
  for response in [self.api.get('/api/v1/ai/change-proposals/'+id),self.api.post('/api/v1/ai/change-proposals/'+id+'/price',json={'rate_minor':1000,'confirmed_hours':'2'})]:
   self.assertEqual(response.status_code,409,response.text)
  self.assertEqual(self.repo.mutations,[])
 def test_foreign_owner_or_foreign_selection_is_rejected_before_enqueue(self):
  for changes,mutate in [({},True),({'document_ids':[str(uuid4())]},False)]:
   with self.subTest(changes=changes,mutate=mutate):
    self.repo.documents[REQUEST]['owner_id']=OTHER if mutate else OWNER
    body={'project_id':PROJECT,'request_document_id':REQUEST,'output_language':'en',**changes}
    response=self.api.post('/api/v1/ai/change-proposals',json=body,headers={'Idempotency-Key':str(uuid4())})
    self.assertEqual(response.status_code,404,response.text)
  self.assertFalse(self.jobs.records);self.assertEqual(self.repo.mutations,[])
 def test_ready_proposal_needs_original_evidence_for_request_and_agreement(self):
  id=self.enqueue()
  try:self.run_job(id,ProposalModel(request_only=True))
  except ToolError as error:self.assertEqual(error.code,'AI_INVALID_CITATION')
  else:
   response=self.api.get('/api/v1/ai/change-proposals/'+id)
   self.assertEqual(response.status_code,502,response.text)
  self.assertEqual(self.repo.mutations,[])
 def test_followup_preserves_previous_turn_in_worker_context_without_reusing_it_as_citation(self):
  first=self.complete()
  second=self.enqueue(question='Exclude administrative settings from the module.',history_ids=[first])
  expected=[{'question':'Prepare this change.','answer':'The supplied request adds a payment module to the original five pages.'}]
  self.assertEqual(self.jobs.input(OWNER,second)['history'],expected)
  class FollowupModel(ProposalModel):
   def generate(inner,messages,schema):
    if inner.calls==0:
     payload=json.loads(messages[1]['content']);self.assertEqual(payload['history'],expected)
     self.assertEqual(payload['question'],'Exclude administrative settings from the module.')
    return super().generate(messages,schema)
  self.run_job(second,FollowupModel())
  response=self.api.get('/api/v1/ai/change-proposals/'+second)
  self.assertEqual(response.status_code,200,response.text)
  self.assertEqual({s['file_id'] for s in response.json()['data']['result']['sources']},{AGREEMENT,REQUEST})
  self.assertEqual(self.repo.mutations,[])
 def test_history_from_another_request_cannot_be_attached_to_this_draft(self):
  first=self.complete();other=str(uuid4())
  self.repo.documents[other]={**self.repo.documents[REQUEST],'id':other,'title':'Different request'}
  self.repo.text[other]='A different request asks for analytics.';self.repo.extracts[other]=str(uuid4());self.repo.segments[other]=str(uuid4())
  response=self.api.post('/api/v1/ai/change-proposals',json={'project_id':PROJECT,'request_document_id':other,'output_language':'en',
    'history_ids':[first],'document_ids':sorted([AGREEMENT,other])},headers={'Idempotency-Key':str(uuid4())})
  self.assertEqual(response.status_code,409,response.text)
  self.assertEqual(response.json()['error']['code'],'AI_CONTEXT_INVALID')
  self.assertEqual(len(self.jobs.records),1);self.assertEqual(self.repo.mutations,[])
 def test_editing_draft_revision_after_research_blocks_reuse_even_with_same_visible_version(self):
  self.repo.draft();id=self.complete(proposal_id=PROPOSAL,revision_id=REVISION)
  self.repo.proposal['current_revision_id']=str(uuid4())
  response=self.api.post('/api/v1/ai/change-proposals/'+id+'/price',json={'rate_minor':1000,'confirmed_hours':'2'})
  self.assertEqual(response.status_code,409,response.text);self.assertEqual(self.repo.mutations,[])
 def test_questions_can_discuss_the_generated_estimate_with_fresh_documentary_evidence(self):
  from trato_worker.project_assistant import run_project_assistant
  draft=self.complete();id=str(uuid4())
  response=self.api.post('/api/v1/ai/project-questions',headers={'Idempotency-Key':id},json={
    'project_id':PROJECT,'question':'Why do you estimate 3.5 hours?','output_language':'en',
    'change_proposal_job_id':draft,'document_ids':sorted([AGREEMENT,REQUEST])})
  self.assertEqual(response.status_code,202,response.text)
  self.assertEqual(self.jobs.input(OWNER,id)['proposal_discussion']['estimated_hours'],'3.5')
  class DiscussionModel:
   name='explicit-test-model'
   calls=0
   def generate(inner,messages,schema):
    inner.calls+=1
    if inner.calls==1:
     payload=json.loads(messages[1]['content'])
     self.assertEqual(payload['proposal_discussion']['estimated_hours'],'3.5')
     self.assertEqual(payload['question'],'Why do you estimate 3.5 hours?')
     return {'type':'tool_call','tool':'search_document_text','params':{'query':'requested payment module'}}
    source=json.loads(messages[-1]['content'])['tool_result']['data']['sources'][0]
    return {'type':'final','result':{'status':'answered','answer_basis':'documents',
     'answer':'The estimate covers the requested payment module and needs your review.',
     'citations':[{'source_id':source['source_id'],'quote':source['text']}],'missing_information':[]}}
  model=DiscussionModel();lease=self.jobs.start(id)
  result=run_project_assistant(self.jobs.input(OWNER,id),model,self.client,id,lease)
  self.assertEqual(result['status'],'answered');self.assertTrue(result['citations'])
  self.assertEqual(model.calls,2);self.assertEqual(self.repo.mutations,[])
 def test_generated_proposal_from_another_owner_cannot_be_used_as_discussion_context(self):
  draft=self.complete();self.jobs.records[draft]['owner']=OTHER
  response=self.api.post('/api/v1/ai/project-questions',headers={'Idempotency-Key':str(uuid4())},json={
    'project_id':PROJECT,'question':'Explain this proposal.','output_language':'en','change_proposal_job_id':draft})
  self.assertEqual(response.status_code,404,response.text)
  self.assertEqual(len(self.jobs.records),1);self.assertEqual(self.repo.mutations,[])
