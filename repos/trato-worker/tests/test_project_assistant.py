from copy import deepcopy
import json,unittest
from hashlib import sha256
from uuid import uuid4
from trato_worker.project_assistant import run_project_assistant,MEMORY_TOOLS as ALLOWED_TOOLS
from trato_worker.source_tools import ToolError
OWNER,CLIENT,PROJECT,FILE,JOB,EXEC=[str(uuid4()) for _ in range(6)]
def digest(value):return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def data():
 context={'owner_id':OWNER,'client_id':CLIENT,'project_id':PROJECT}
 return {'workflow':'project_assistant',**context,'question':'What does the agreement say?','output_language':'en','history':[],'memory':{'revision':0,'summary':'','summarized_through':0,'messages':[]},
  'thread':{'type':'thread','workflow':'project_assistant','thread_id':JOB,'context':context}}
class Backend:
 def __init__(self):self.calls=[];self.foreign=False;self.error=None;self.missing_when=False;self.source=None;self.checkpoints={};self.commits=[];self.memory_enabled=True
 def request(self,method,path,**kw):
  body=kw['json']
  if path.endswith('/memory'):
   action=body['action'];p=body['data']
   if action=='checkpoint_get':
    key=p.get('checkpoint_id') or max(self.checkpoints,default=None)
    return deepcopy(self.checkpoints.get(key))
   if action=='checkpoint_put':self.checkpoints.setdefault(p['checkpoint_id'],{'payload':p['payload'],'writes':{}})
   elif action=='checkpoint_writes':self.checkpoints[p['checkpoint_id']]['writes'].update(p['writes'])
   elif action=='commit':self.commits.append(deepcopy(p));return {'stored':True,'revision':1}
   return {'stored':True}
  self.calls.append(deepcopy(body))
  if body['tool']=='catalog':
   tools=[{'name':name,'description':'Retrieves authorized source information.','when_to_use':'Use when source information is needed.',
    'parameters':{'type':'object','additionalProperties':False,'required':['document_id' if name=='read_document_summary' else 'query'],
     'properties':{'document_id':{'type':'string'}} if name=='read_document_summary' else {'query':{'type':'string'}}}} for name in (ALLOWED_TOOLS if self.memory_enabled else ALLOWED_TOOLS[:3])]
   if self.missing_when:del tools[0]['when_to_use']
   return {'workflow':'project_assistant','project_id':PROJECT,'documents':[{'id':FILE,'title':'Agreement'}],'tools':tools}
  if self.error:raise ToolError(self.error)
  if body['tool']=='search_conversation_history':return {'sources':[],'project_id':PROJECT,'messages':[]}
  source={'file_id':str(uuid4()) if self.foreign else FILE,'title':'Agreement','generation':'a'*64,
   'source_kind':'summary' if body['tool']!='search_document_text' else 'original','text':'Delivery is due on Friday.','locator':None}
  source['source_id']=digest(source);self.source=source
  return {'sources':[source],'exhaustive_evidence':False}
class Model:
 name='test-double'
 def __init__(self,backend,tool='read_document_summary'):self.backend=backend;self.tool=tool;self.calls=[];self.forge=False
 def generate(self,messages,schema):
  self.calls.append((deepcopy(messages),deepcopy(schema)))
  if len(self.calls)==1:
   params={'document_id':FILE} if self.tool=='read_document_summary' else {'query':'delivery'}
   return {'type':'tool_call','tool':self.tool,'params':params}
  if self.tool=='search_conversation_history':return {'type':'final','result':{'answer_basis':'conversation','status':'answered','answer':'There is no matching earlier statement.','citations':[],'missing_information':[]}}
  return {'type':'final','result':{**({'answer_basis':'documents'} if self.backend.memory_enabled else {}),'status':'answered','answer':'The available source gives a delivery day.',
   'citations':[{'source_id':self.backend.source['source_id'],'quote':'invented evidence' if self.forge else 'Delivery is due on Friday.'}],'missing_information':[]}}
class AssistantTests(unittest.TestCase):
 def test_model_selects_summary_or_original_tool_and_dispatcher_uses_each_parameter_schema(self):
  for tool in ALLOWED_TOOLS:
   backend=Backend();model=Model(backend,tool)
   result=run_project_assistant(data(),model,backend,JOB,EXEC)
   self.assertEqual(result['tools_used'],[tool]);self.assertEqual(result['project_id'],PROJECT)
   self.assertEqual(backend.calls[1]['tool'],tool)
   branches=model.calls[0][1]['oneOf'][1:]
   schemas={b['properties']['tool']['const']:b['properties']['params'] for b in branches}
   self.assertEqual(schemas['read_document_summary']['required'],['document_id'])
   self.assertEqual(schemas['search_document_text']['required'],['query'])
   self.assertIn('when_to_use',model.calls[0][0][-1]['content'])
 def test_completed_graph_resumes_from_durable_checkpoint_without_repeating_model_or_commit(self):
  backend=Backend();model=Model(backend)
  first=run_project_assistant(data(),model,backend,JOB,EXEC)
  calls=len(model.calls);commits=len(backend.commits)
  second=run_project_assistant(data(),model,backend,JOB,str(uuid4()))
  self.assertEqual(first,second);self.assertEqual(len(model.calls),calls);self.assertEqual(len(backend.commits),commits)
 def test_checkpoint_cannot_be_reused_for_another_question(self):
  backend=Backend();model=Model(backend);run_project_assistant(data(),model,backend,JOB,EXEC)
  changed={**data(),'question':'A different question'}
  with self.assertRaisesRegex(ToolError,'AI_MEMORY_CONFLICT'):run_project_assistant(changed,Model(backend),backend,JOB,str(uuid4()))
 def test_commit_failure_resumes_saved_answer_without_calling_model_again(self):
  backend=Backend();model=Model(backend);original=backend.request;fail=[True]
  def request(method,path,**kwargs):
   if path.endswith('/memory') and kwargs['json']['action']=='commit' and fail[0]:fail[0]=False;raise ToolError('MEMORY_WRITE_FAILED')
   return original(method,path,**kwargs)
  backend.request=request
  with self.assertRaisesRegex(ToolError,'MEMORY_WRITE_FAILED'):run_project_assistant(data(),model,backend,JOB,EXEC)
  calls=len(model.calls)
  result=run_project_assistant(data(),model,backend,JOB,str(uuid4()))
  self.assertEqual(result['status'],'answered');self.assertEqual(len(model.calls),calls);self.assertEqual(len(backend.commits),1)
 def test_fabricated_quotes_are_rejected(self):
  backend=Backend();model=Model(backend);model.forge=True
  with self.assertRaisesRegex(ToolError,'AI_INVALID_CITATION'):run_project_assistant(data(),model,backend,JOB,EXEC)
 def test_failure_does_not_switch_tool_provider_or_invent_a_response(self):
  backend=Backend();backend.error='VECTOR_SUMMARY_INDEX_INCOMPLETE';model=Model(backend)
  with self.assertRaisesRegex(ToolError,'VECTOR_SUMMARY_INDEX_INCOMPLETE'):run_project_assistant(data(),model,backend,JOB,EXEC)
  self.assertEqual(len(model.calls),1)
 def test_foreign_source_or_incomplete_catalog_is_rejected(self):
  for field in ['foreign','missing_when']:
   backend=Backend();setattr(backend,field,True);model=Model(backend)
   with self.assertRaises(ToolError):run_project_assistant(data(),model,backend,JOB,EXEC)
 def test_thread_scope_and_output_language_must_match(self):
  for change in [{'output_language':'fr'},{'thread':{'type':'thread','context':{}}}]:
   backend=Backend();model=Model(backend)
   with self.assertRaisesRegex(ToolError,'AI_INVALID_INPUT'):run_project_assistant({**data(),**change},model,backend,JOB,EXEC)
   self.assertEqual(backend.calls,[])

class CaseAssistantTests(unittest.TestCase):
 def case(self, backend):
  value=data();value.pop('memory');backend.memory_enabled=False;value['case_context']={'session_id':str(uuid4()),'case_kind':'change','case_id':str(uuid4()),'revision_id':str(uuid4()),'project_id':PROJECT}
  value['mandatory_context']={'record':{'scope':'Backend-selected request'},'revision':{'version':1}}
  original=backend.request
  def request(method,path,**kw):
   result=original(method,path,**kw)
   if kw['json'].get('tool')=='catalog':result['case_context']=deepcopy(value['case_context'])
   return result
  backend.request=request
  return value
 def test_case_context_and_mandatory_records_are_supplied_to_model(self):
  backend=Backend();value=self.case(backend);model=Model(backend,'search_document_text')
  result=run_project_assistant(value,model,backend,JOB,EXEC)
  self.assertEqual(result['status'],'answered')
  payload=json.loads(model.calls[0][0][1]['content'])
  self.assertEqual(payload['case_context'],value['case_context'])
  self.assertEqual(payload['mandatory_context'],value['mandatory_context'])
 def test_case_answer_cannot_be_supported_only_by_summary(self):
  backend=Backend();value=self.case(backend);model=Model(backend)
  with self.assertRaisesRegex(ToolError,'AI_INVALID_CITATION'):run_project_assistant(value,model,backend,JOB,EXEC)
 def test_project_catalog_cannot_be_reused_for_a_case(self):
  backend=Backend();value=data();value['case_context']={'case_id':str(uuid4())};model=Model(backend)
  with self.assertRaisesRegex(ToolError,'AI_CONTEXT_INVALID'):run_project_assistant(value,model,backend,JOB,EXEC)
  self.assertEqual(model.calls,[])

class SelectedSourceTests(unittest.TestCase):
 def backend(self,selected):
  backend=Backend();original=backend.request
  def request(method,path,**kw):
   result=original(method,path,**kw)
   if kw['json'].get('tool')=='catalog':result['source_scope']={'document_ids':selected,'complete_project':False}
   return result
  backend.request=request
  return backend
 def test_explicit_selection_is_fixed_and_passed_to_the_model(self):
  backend=self.backend([FILE]);model=Model(backend,'search_document_text')
  value={**data(),'source_document_ids':[FILE]}
  result=run_project_assistant(value,model,backend,JOB,EXEC)
  self.assertEqual(result['status'],'answered')
  payload=json.loads(model.calls[0][0][1]['content'])
  self.assertEqual(payload['source_scope'],{'document_ids':[FILE],'complete_project':False})
  self.assertEqual([row['id'] for row in payload['documents']],[FILE])
 def test_mismatched_selection_or_scope_is_rejected_before_model_call(self):
  for selection,catalog_ids in [([FILE],[str(uuid4())]),([FILE,FILE],[FILE]),([FILE],[]),([str(uuid4())],[FILE])]:
   with self.subTest(selection=selection,catalog_ids=catalog_ids):
    backend=self.backend(catalog_ids);model=Model(backend)
    with self.assertRaisesRegex(ToolError,'AI_CONTEXT_INVALID'):
     run_project_assistant({**data(),'source_document_ids':selection},model,backend,JOB,EXEC)
    self.assertEqual(model.calls,[])
 def test_scope_is_never_activated_implicitly_for_an_unscoped_question(self):
  backend=self.backend([FILE]);model=Model(backend)
  with self.assertRaisesRegex(ToolError,'AI_CONTEXT_INVALID'):
   run_project_assistant(data(),model,backend,JOB,EXEC)
  self.assertEqual(model.calls,[])
 def test_selected_search_still_rejects_a_foreign_source_from_tools(self):
  backend=self.backend([FILE]);backend.foreign=True;model=Model(backend)
  with self.assertRaisesRegex(ToolError,'INVALID_TOOL_RESPONSE'):
   run_project_assistant({**data(),'source_document_ids':[FILE]},model,backend,JOB,EXEC)
