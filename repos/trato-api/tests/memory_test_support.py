"""Explicit in-memory persistence double for HTTP assistant integration tests only."""
from copy import deepcopy
from trato_api.errors import ApiError
class TestMemory:
 def __init__(self):self.scopes={};self.checkpoints={}
 def call(self,owner,project,action,data=None):
  data=data or {};scope=self.scopes.setdefault((owner,project),{'revision':0,'summary':'','summarized_through':0,'turns':[]})
  if action=='context':return {**{key:scope[key] for key in ('revision','summary','summarized_through')},'messages':[{'position':t['position'],'question':t['result']['question'],'answer':t['result']['answer']} for t in scope['turns'] if t['position']>scope['summarized_through']]}
  if action=='turn':return next((deepcopy(t) for t in scope['turns'] if t['id']==data['job_id']),None)
  if action=='history':return {'entries':deepcopy(scope['turns']),'next_before':None}
  if action=='commit':
   existing=next((t for t in scope['turns'] if t['id']==data['job_id']),None)
   if existing:return {'stored':True,'revision':existing['position']}
   if data['revision']!=scope['revision']:raise ApiError('AI_MEMORY_CONFLICT',409)
   scope['revision']+=1;scope['summary']=data['summary'];scope['summarized_through']=data['summarized_through'];scope['turns'].append({'id':data['job_id'],'position':scope['revision'],'result':deepcopy(data['answer'])});return {'stored':True,'revision':scope['revision']}
  job=(owner,project,data['job_id']);checkpoints=self.checkpoints.setdefault(job,{})
  if action=='checkpoint_get':
   ready={key:value for key,value in checkpoints.items() if value['payload']}
   return deepcopy(ready.get(data.get('checkpoint_id') or max(ready,default=None)))
  if action=='checkpoint_put':checkpoints.setdefault(data['checkpoint_id'],{'payload':{},'writes':{}})['payload']=deepcopy(data['payload'])
  elif action=='checkpoint_writes':checkpoints.setdefault(data['checkpoint_id'],{'payload':{},'writes':{}})['writes'].update(deepcopy(data['writes']))
  else:raise AssertionError(action)
  return {'stored':True}
