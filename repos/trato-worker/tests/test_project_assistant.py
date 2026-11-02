from copy import deepcopy
import json,unittest
from hashlib import sha256
from uuid import uuid4
from trato_worker.project_assistant import run_project_assistant,ALLOWED_TOOLS
from trato_worker.source_tools import ToolError
OWNER,CLIENT,PROJECT,FILE,JOB,EXEC=[str(uuid4()) for _ in range(6)]
def digest(value):return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def data():
 context={'owner_id':OWNER,'client_id':CLIENT,'project_id':PROJECT}
 return {'workflow':'project_assistant',**context,'question':'What does the agreement say?','output_language':'en','history':[],
  'thread':{'type':'thread','workflow':'project_assistant','thread_id':JOB,'context':context}}
class Backend:
 def __init__(self):self.calls=[];self.foreign=False;self.error=None;self.missing_when=False;self.source=None
 def request(self,method,path,**kw):
  body=kw['json'];self.calls.append(deepcopy(body))
  if body['tool']=='catalog':
   tools=[{'name':name,'description':'Retrieves authorized source information.','when_to_use':'Use when source information is needed.',
    'parameters':{'type':'object','additionalProperties':False,'required':['document_id' if name=='read_document_summary' else 'query'],
     'properties':{'document_id':{'type':'string'}} if name=='read_document_summary' else {'query':{'type':'string'}}}} for name in ALLOWED_TOOLS]
   if self.missing_when:del tools[0]['when_to_use']
   return {'workflow':'project_assistant','project_id':PROJECT,'documents':[{'id':FILE,'title':'Agreement'}],'tools':tools}
  if self.error:raise ToolError(self.error)
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
  return {'type':'final','result':{'status':'answered','answer':'The available source gives a delivery day.',
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
