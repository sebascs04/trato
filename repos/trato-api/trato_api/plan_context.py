"""Canonical read-only evidence from the freelancer-confirmed initial plan."""
import json
from .errors import ApiError
from .vector_contract import digest

PLAN_TOOL={'name':'read_project_plan','description':'Retrieves the saved plan and its deliverables, budget, target date, payment conditions and plan completion date.','when_to_use':'Use when a question concerns the confirmed organization of work or its planned payment conditions.','parameters':{'type':'object','additionalProperties':False,'required':[],'properties':{}}}

def plan_source(repo,owner,project):
    rows=repo.rows('project_start_plans',{'select':'brief,budget,currency,target_date,completed_at,stages:project_start_stages!project_start_stages_plan_fk(position,title,deliverables,percent,payment_condition,amount)', 'owner_id':'eq.'+owner,'project_id':'eq.'+project['id']})
    if not rows:return None
    if len(rows)!=1:raise ApiError('AI_CONTEXT_INVALID',409)
    value=rows[0];value['stages'].sort(key=lambda s:s['position'])
    record={'file_id':project['id'],'title':'Initial project plan','source_kind':'plan','generation':digest(value),'text':json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))}
    record['source_id']=digest(record)
    return record
