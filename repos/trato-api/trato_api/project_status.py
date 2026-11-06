"""Canonical read-only evidence of the project's verified business records (changes and payments)."""
import json
from .errors import ApiError
from .vector_contract import digest

STATUS_TOOL={'name':'read_project_status','description':'Retrieves the recorded business state of the project: each change request with its addendum versions (scope, conditions, additional amount, deadline), when each version was sent and accepted, closures, backend-verified change payments and verified payments of the initial plan deliverables.',
 'when_to_use':'Use when a question concerns the state of a change request, which addendum version was sent or accepted, agreed amounts or deadlines of changes, or what the client has paid.',
 'parameters':{'type':'object','additionalProperties':False,'required':[],'properties':{}}}
LIMIT=200000

def money(minor,currency='USD'):return f'{currency} {int(minor)//100}.{int(minor)%100:02d}'

def status_source(repo,owner,project):
    common={'owner_id':'eq.'+owner,'project_id':'eq.'+project['id']}
    requests=repo.rows('documents',{'select':'id,title,created_at',**common,'kind':'eq.email_request','deleted_at':'is.null','order':'created_at.asc','limit':200})
    proposals=repo.rows('change_proposals',{'select':'id,request_document_id,status,locked_at',**common,'limit':200})
    revisions=repo.rows('proposal_revisions',{'select':'id,proposal_id,revision_no,scope_summary,conditions,currency,additional_minor,deadline',**common,'order':'revision_no.asc','limit':1000})
    deliveries=repo.rows('proposal_deliveries',{'select':'revision_id,kind,updated_at',**common,'status':'eq.accepted_by_gmail','limit':2000})
    acceptances=repo.rows('proposal_acceptances',{'select':'revision_id,created_at',**common,'limit':1000})
    payments=repo.rows('proposal_payments',{'select':'revision_id,amount_minor,currency,updated_at',**common,'status':'eq.completed','limit':1000})
    closures=repo.rows('request_closures',{'select':'request_document_id,reason,notes,closed_at',**common,'limit':200})
    by_request={p['request_document_id']:p for p in proposals}
    changes=[]
    for request in requests:
        proposal=by_request.get(request['id']);closure=next((c for c in closures if c['request_document_id']==request['id']),None)
        versions=[]
        for r in [r for r in revisions if proposal and r['proposal_id']==proposal['id']]:
            sent=[d['updated_at'] for d in deliveries if d['revision_id']==r['id'] and d['kind']=='adenda']
            payment_sent=[d['updated_at'] for d in deliveries if d['revision_id']==r['id'] and d['kind']=='payment']
            accepted=[a['created_at'] for a in acceptances if a['revision_id']==r['id']]
            paid=[p for p in payments if p['revision_id']==r['id']]
            versions.append({'addendum_version':r['revision_no'],'scope':r['scope_summary'],'conditions':r.get('conditions') or '','additional_amount':money(r['additional_minor'],r.get('currency') or 'USD'),
                'deadline':r['deadline'],'sent_to_client_at':sent[0] if sent else None,'accepted_by_client_recorded_at':accepted[0] if accepted else None,
                'payment_request_sent_at':payment_sent[0] if payment_sent else None,
                'verified_payment':{'amount':money(paid[0]['amount_minor'],paid[0]['currency']),'paid_at':paid[0]['updated_at']} if paid else None})
        changes.append({'request':request['title'],'registered_at':request['created_at'],'proposal_status':proposal['status'] if proposal else 'no_proposal_yet',
            'read_only_after_payment':bool(proposal and proposal.get('locked_at')),'closure':{'reason':closure['reason'],'notes':closure['notes'],'closed_at':closure['closed_at']} if closure else None,'versions':versions})
    stages=[]
    plans=repo.rows('project_start_plans',{'select':'currency',**common})
    if plans:
        titles={s['position']:s for s in repo.rows('project_start_stages',{'select':'position,title,amount',**common,'order':'position.asc'})}
        progress=repo.rpc('project_plan_progress',{'p_project':project['id']}) or {}
        for row in progress.get('stages') or []:
            stage=titles.get(row.get('position'))
            if not stage:continue
            paid=row.get('status')=='completed' and row.get('paid_at')
            stages.append({'deliverable':row['position'],'title':stage['title'],'amount':money(round(float(stage['amount'])*100),plans[0]['currency']),
                'payment':'verified' if paid else 'not_paid','paid_at':row['paid_at'] if paid else None})
    value={'change_requests':changes,'initial_plan_deliverable_payments':stages}
    record={'file_id':project['id'],'title':'Project status','source_kind':'status','generation':digest(value),'text':json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))}
    if len(record['text'].encode())>LIMIT:raise ApiError('AI_CONTEXT_LIMIT',413)
    record['source_id']=digest(record)
    return record
