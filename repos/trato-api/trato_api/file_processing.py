"""Job-bound file tools: canonical sources, purpose selection and immutable artifacts."""
from copy import deepcopy
from hashlib import sha256
import json
import os
import secrets
from uuid import NAMESPACE_URL,uuid5

from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .ai_jobs import AIJobs,PREFIX
from .business_routes import read_bytes
from .errors import ApiError
from .persistence import Repository,uuid
from .thread_store import ThreadStore
from .vector_contract import digest,PROFILE_ID,PROFILE
from .vector_routes import source,ProcessorChunks,VectorGateway,POLICY

STAGES={'extraction','treatment','chunks','summary','outcome'}
PURPOSES={'initial_agreement','change_request','addendum_adjustments','acceptance_evidence',
          'generated_addendum','reputation_evidence','refund_request','refund_evidence','training_material',
          'supporting_reference','delivery_evidence'}


def remember_options(settings,repo,document,language,purpose=None,bindings=None):
    if os.getenv('TRATO_FILE_PROCESSING_ENABLED')!='true':return
    if language not in ('es','en'):raise ApiError('INVALID_OUTPUT_LANGUAGE',422)
    repo.project(document['project_id'])
    row={'document_id':document['id'],'project_id':document['project_id'],'owner_id':document['owner_id'],
         'output_language':language,'purpose':purpose,'bindings':bindings or {}}
    server=ThreadStore(settings).repo
    old=server.rows('file_processing_options',{'select':'*','document_id':'eq.'+document['id']})
    if old:
        if old[0]['purpose']!=purpose or old[0]['bindings']!=(bindings or {}):raise ApiError('FILE_PURPOSE_CONFLICT',409)
        return
    server.call('POST','/rest/v1/file_processing_options',json=row)


def purpose_context(repo,owner,project,value):
    doc=value['document'];common={'project_id':'eq.'+project['id'],'owner_id':'eq.'+owner}
    options=repo.rows('file_processing_options',{'select':'output_language,purpose,bindings','document_id':'eq.'+doc['id']})
    option=options[0] if options else {'output_language':'es','purpose':None,'bindings':{}}
    if option['output_language'] not in ('es','en'):raise ApiError('INVALID_OUTPUT_LANGUAGE',422)
    purpose={'initial_agreement':'initial_agreement','email_request':'change_request','reference':'supporting_reference',
             'addendum':'supporting_reference','delivery':'delivery_evidence'}.get(doc['kind'])
    bindings={};proof=[]
    artifacts=repo.rows('proposal_artifacts',{'select':'revision_id','document_id':'eq.'+doc['id'],**common})
    acceptance=repo.rows('proposal_acceptances',{'select':'revision_id','returned_document_id':'eq.'+doc['id'],**common})
    feedback=repo.rows('proposal_revisions',{'select':'id,proposal_id','feedback_document_id':'eq.'+doc['id'],**common})
    if artifacts:purpose='generated_addendum';bindings={'revision_id':artifacts[0]['revision_id']}
    if acceptance:purpose='acceptance_evidence';bindings={'revision_id':acceptance[0]['revision_id']}
    if feedback:purpose='addendum_adjustments';bindings={'revision_id':feedback[0]['id']}
    if option.get('purpose'):
        if option['purpose'] not in PURPOSES or option['purpose']=='training_material':
            raise ApiError('FILE_PURPOSE_CONTEXT_INVALID',422)
        purpose=option['purpose'];bindings=option['bindings']
    if bindings.get('revision_id'):
        revisions=repo.rows('proposal_revisions',{'select':'id,proposal_id,scope_summary,conditions,additional_minor,deadline',
                           'id':'eq.'+uuid(bindings['revision_id']),**common})
        if len(revisions)!=1:raise ApiError('FILE_PURPOSE_CONTEXT_INVALID',409)
        revision=revisions[0];proof.append(revision)
        proposals=repo.rows('change_proposals',{'select':'id,request_document_id','id':'eq.'+revision['proposal_id'],**common})
        if len(proposals)!=1:raise ApiError('FILE_PURPOSE_CONTEXT_INVALID',409)
        bindings={'revision_id':revision['id'],'request_id':proposals[0]['request_document_id']};proof+=proposals
    reference={}
    if purpose in ('refund_request','refund_evidence'):
        payment=bindings.get('payment_id')
        if not payment:raise ApiError('FILE_PAYMENT_BINDING_REQUIRED',422)
        payments=repo.rows('proposal_payments',{'select':'id,status,amount_minor,currency',
            'id':'eq.'+uuid(payment),**common})
        if len(payments)!=1 or payments[0]['status']!='completed':raise ApiError('FILE_PAYMENT_NOT_CONFIRMED',409)
        if bindings.get('refund_case_id'):raise ApiError('FILE_REFUND_CASE_CONTEXT_NOT_CONFIGURED',503)
        reference['case_description']=json.dumps(payments[0],ensure_ascii=False);proof+=payments
    if purpose=='change_request':
        head=repo.rows('project_agreement_heads',{'select':'generation,acceptance_id',**common});proof+=head
        baseline=[]
        initial=repo.rows('documents',{'select':'id','kind':'eq.initial_agreement',**common,'order':'created_at.asc,id.asc','limit':101})
        if len(initial)>100:raise ApiError('FILE_BASELINE_CONTEXT_LIMIT',413)
        for d in initial:
            baseline_source=source(repo,owner,project,d['id'])
            baseline.extend(s['text'] for s in baseline_source['segments']);proof.append(baseline_source['generation'])
        accepted=repo.rows('proposal_acceptances',{'select':'id,revision_id',**common,'order':'created_at.asc,id.asc','limit':101})
        if len(accepted)>100:raise ApiError('FILE_BASELINE_CONTEXT_LIMIT',413)
        for acc in accepted:
            revisions=repo.rows('proposal_revisions',{'select':'scope_summary,conditions,currency,additional_minor,deadline',
                              'id':'eq.'+acc['revision_id'],**common})
            if len(revisions)!=1:raise ApiError('FILE_BASELINE_INVALID',409)
            baseline.append(json.dumps(revisions[0],ensure_ascii=False));proof.extend([acc,revisions[0]])
        text='\n\n'.join(baseline)
        if len(text.encode())>64000:raise ApiError('FILE_BASELINE_CONTEXT_LIMIT',413)
        if text:reference['baseline_summary']=text
    if purpose not in PURPOSES:raise ApiError('FILE_PURPOSE_NOT_SUPPORTED',422)
    return {'purpose':purpose,'bindings':bindings,'reference_context':reference,
            'output_language':option['output_language'],'selection_fingerprint':digest([purpose,bindings,reference,proof])}


def enqueue_processing(repo,jobs,owner,project_id,file_id,model_id,job_id=None,language=None):
    if os.getenv('TRATO_FILE_PROCESSING_ENABLED')!='true':raise ApiError('FILE_PROCESSING_NOT_CONFIGURED',503)
    project=repo.project(uuid(project_id));value=source(repo,uuid(owner),project,uuid(file_id))
    context=purpose_context(repo,owner,project,value)
    if language is not None:
        if language not in ('es','en'):raise ApiError('INVALID_OUTPUT_LANGUAGE',422)
        context['output_language']=language
    data={'workflow':'process_file','owner_id':owner,'project_id':project['id'],'client_id':project['client_id'],
          'file_id':file_id,'generation':value['generation'],'model_id':model_id,**context}
    id=uuid(job_id) if job_id else str(uuid5(NAMESPACE_URL,'trato:process-file:'+digest(data)))
    data['thread']={'type':'thread','schema_version':1,'mode':'connected','workflow':'process_file','action':'start',
        'thread_id':id,'event_id':str(uuid5(NAMESPACE_URL,'trato:file-command:'+id)),
        'context':{k:data[k] for k in ('owner_id','client_id','project_id')},
        'payload':{'file_id':file_id,'source_sha256':value['document']['sha256'],'purpose':context['purpose']}}
    return jobs.enqueue(owner,id,data)


class FileProcessing:
    def __init__(self,settings,*,jobs=None,repo=None,gateway=None,chunks=None):
        self.settings=settings;self.jobs=jobs if jobs is not None else AIJobs();self.repo_override=repo
        self.gateway=gateway if gateway is not None else VectorGateway(settings)
        self.chunker=chunks if chunks is not None else ProcessorChunks(settings)
    def active(self,id,lease):
        if os.getenv('TRATO_FILE_PROCESSING_ENABLED')!='true':raise ApiError('FILE_PROCESSING_NOT_CONFIGURED',503)
        id,lease=uuid(id),uuid(lease);row=self.jobs.connection().hgetall(PREFIX+id)
        if not row or row.get('status')!='running' or row.get('execution_id')!=lease:raise ApiError('FILE_JOB_NOT_ACTIVE',409)
        try:
            data=json.loads(row['input'])
            if data['workflow']!='process_file' or row['owner']!=data['owner_id'] or data['thread']['thread_id']!=id:raise ValueError()
        except (ValueError,TypeError,KeyError):raise ApiError('FILE_JOB_INVALID',422) from None
        repo=self.repo_override if self.repo_override is not None else ThreadStore(self.settings).repo
        project=repo.project(data['project_id'])
        clients=repo.rows('clients',{'select':'id','id':'eq.'+project['client_id'],'owner_id':'eq.'+data['owner_id'],'deleted_at':'is.null'})
        if not clients:raise ApiError('PROJECT_NOT_FOUND',404)
        value=source(repo,data['owner_id'],project,data['file_id']);fresh=purpose_context(repo,data['owner_id'],project,value)
        if (value['generation']!=data['generation'] or project['client_id']!=data['client_id'] or
            fresh['selection_fingerprint']!=data['selection_fingerprint']):raise ApiError('FILE_SOURCE_CHANGED',409)
        doc=value['document'];manifest={k:deepcopy(data['thread'][k]) for k in ('thread_id','event_id','context')}
        manifest.update(lease_id=lease,file_id=doc['id'],source_sha256=doc['sha256'],source_version=value['extraction']['id'],
            selection_fingerprint=data['selection_fingerprint'],purpose=data['purpose'],
            access={'visibility':'reputation_private' if data['purpose']=='reputation_evidence' else 'project_private',**data['thread']['context']},filename=doc['original_filename'],
            output_language=data['output_language'],bindings=data['bindings'],reference_context=data['reference_context'])
        return repo,data,value,manifest
    @staticmethod
    def extraction(value):
        text='\n\n'.join(s['text'] for s in value['segments'])
        return {'schema_version':1,'source_sha256':value['document']['sha256'],'parser':value['extraction']['parser'],
            'parser_version':value['extraction']['parser_version'],'segments':value['segments'],
            'text':text,'text_sha256':sha256(text.encode()).hexdigest()}
    @staticmethod
    def extraction_key(manifest,extraction):
        keys={'file_id':manifest['file_id'],'source_sha256':manifest['source_sha256'],'source_version':manifest['source_version'],
              'selection':manifest['selection_fingerprint'],'reference_context':manifest['reference_context']}
        return digest([digest(keys),extraction['parser'],extraction['parser_version'],extraction['segments']])
    def read_artifact(self,repo,data,stage,key):
        rows=repo.rows('file_processing_artifacts',{'select':'artifact,artifact_fingerprint,source_generation',
             'document_id':'eq.'+data['file_id'],'stage':'eq.'+stage,'cache_key':'eq.'+key})
        if not rows:return None
        row=rows[0]
        if row['source_generation']!=data['generation'] or digest(row['artifact'])!=row['artifact_fingerprint']:
            raise ApiError('FILE_ARTIFACT_INVALID',502)
        return row['artifact']
    def store(self,repo,data,stage,key,artifact):
        if stage not in STAGES or len(key)!=64 or not isinstance(artifact,dict) or len(json.dumps(artifact).encode())>1500000:
            raise ApiError('FILE_ARTIFACT_INVALID',422)
        old=self.read_artifact(repo,data,stage,key)
        if old is not None:
            if old!=artifact:raise ApiError('FILE_ARTIFACT_CONFLICT',409)
        else:
            row={'document_id':data['file_id'],'project_id':data['project_id'],'owner_id':data['owner_id'],
                 'source_generation':data['generation'],'stage':stage,'cache_key':key,
                 'artifact_fingerprint':digest(artifact),'artifact':artifact}
            try:repo.call('POST','/rest/v1/file_processing_artifacts',json=row)
            except ApiError as error:
                if error.status!=409 or self.read_artifact(repo,data,stage,key)!=artifact:raise
        return {'stage':stage,'cache_key':key,'artifact_fingerprint':digest(artifact)}
    def execute(self,id,lease,tool,params):
        repo,data,value,manifest=self.active(id,lease);extraction=self.extraction(value)
        source_key=self.extraction_key(manifest,extraction)
        if tool=='revalidate_file' and params=={}:return manifest
        if tool=='read_extracted_file' and params=={}:return self.chunker.read_text(value)
        if tool=='chunk_extracted_file':
            if params!={'policy':POLICY,'source_fingerprint':source_key}:raise ApiError('FILE_TOOL_INVALID',422)
            chunks=self.chunker.read({**value,'generation':source_key})
            return {'schema_version':1,'file_id':data['file_id'],'source_fingerprint':source_key,
                    'policy_fingerprint':digest(POLICY),'offset_unit':'unicode_code_points','chunks':chunks}
        if tool in ('read_file_artifact','store_file_artifact'):
            stage=params.get('stage');key=params.get('cache_key')
            if stage not in STAGES or not isinstance(key,str) or len(key)!=64:raise ApiError('FILE_TOOL_INVALID',422)
            if tool=='read_file_artifact':return self.read_artifact(repo,data,stage,key)
            if stage=='outcome':raise ApiError('FILE_TOOL_NOT_ALLOWED',403)
            artifact=params.get('artifact');self.validate_artifact(stage,artifact,manifest,extraction,source_key,repo,data)
            return self.store(repo,data,stage,key,artifact)
        if tool=='index_file_chunks':
            projection=params.get('projection')
            if (not isinstance(projection,dict) or projection.get('file_id')!=data['file_id'] or
                projection.get('source_fingerprint')!=source_key or projection.get('embedding_profile')!=PROFILE or
                projection.get('projection_fingerprint')!=digest({k:v for k,v in projection.items() if k!='projection_fingerprint'})):
                raise ApiError('FILE_PROJECTION_INVALID',422)
            chunks=self.read_artifact(repo,data,'chunks',digest([source_key,POLICY]))
            summaries=repo.rows('file_processing_artifacts',{'select':'artifact','document_id':'eq.'+data['file_id'],
                'source_generation':'eq.'+data['generation'],'stage':'eq.summary','order':'created_at.desc','limit':100})
            summary=next((r['artifact'] for r in summaries if r['artifact'].get('summary_fingerprint')==projection['document']['properties'].get('summary_fingerprint')),None)
            if not chunks or not summary or projection!=expected_projection(manifest,chunks,summary):
                raise ApiError('FILE_PROJECTION_INVALID',422)
            self.gateway.index(repo,data['owner_id'],data['project_id'],data['file_id'])
            return {'file_id':data['file_id'],'projection_fingerprint':projection['projection_fingerprint'],
                    'document_count':1,'chunk_count':len(projection['chunks'])}
        raise ApiError('FILE_TOOL_NOT_ALLOWED',403)
    def validate_artifact(self,stage,artifact,manifest,extraction,source_key,repo,data):
        if not isinstance(artifact,dict):raise ApiError('FILE_ARTIFACT_INVALID',422)
        segments={s['segment_id']:s['text'] for s in extraction['segments']}
        if stage=='extraction' and artifact!=extraction:raise ApiError('FILE_ARTIFACT_INVALID',422)
        if stage=='treatment':
            assessment=artifact.get('assessment',{});refs=[*assessment.get('evidence',[]),*(r for o in assessment.get('observations',[]) for r in o.get('evidence',[]))]
            decision={'supported':'continue','unclear':'needs_clarification','unrelated':'rejected'}.get(assessment.get('relevance'))
            if (artifact.get('human_review_required') is not True or not refs or
                artifact.get('decision')!=decision or not decision or artifact.get('model_identity')!=data['model_id'] or
                artifact.get('coverage')!={'status':'all_segments_processed','segment_ids':list(segments)} or
                any(r.get('segment_id') not in segments or not r.get('quote') or r['quote'] not in segments[r['segment_id']] for r in refs)):
                raise ApiError('FILE_ARTIFACT_INVALID',422)
        if stage=='chunks':
            expected={'schema_version':1,'file_id':data['file_id'],'source_fingerprint':source_key,
                'policy_fingerprint':digest(POLICY),'offset_unit':'unicode_code_points',
                'chunks':self.chunker.read({**source(repo,data['owner_id'],repo.project(data['project_id']),data['file_id']),'generation':source_key})}
            if artifact!=expected:raise ApiError('FILE_ARTIFACT_INVALID',422)
        if stage=='summary':
            if (artifact.get('source_fingerprint')!=source_key or artifact.get('output_language')!=manifest['output_language'] or
                artifact.get('summary_fingerprint')!=digest({k:v for k,v in artifact.items() if k!='summary_fingerprint'})):
                raise ApiError('FILE_ARTIFACT_INVALID',422)
            chunks=self.read_artifact(repo,data,'chunks',digest([source_key,POLICY]))
            originals={c['chunk_id']:c for c in chunks['chunks']} if chunks else {}
            refs=artifact.get('citations',[])
            if (artifact.get('model_identity')!=data['model_id'] or not 1<=len(refs)<=5 or
                artifact.get('coverage',{}).get('processed_chunk_ids')!=list(originals) or
                any(r.get('chunk_id') not in originals or not r.get('quote') or r['quote'] not in originals[r['chunk_id']]['text'] for r in refs)):
                raise ApiError('FILE_ARTIFACT_INVALID',422)
    def finalize(self,id,lease,event):
        repo,data,value,manifest=self.active(id,lease)
        if (event.get('workflow')!='process_file' or event.get('thread_id')!=id or event.get('lease_id')!=lease or
            event.get('context')!=data['thread']['context'] or event.get('causation_id')!=data['thread']['event_id']):
            raise ApiError('FILE_OUTCOME_INVALID',422)
        result=event.get('result',{})
        if result.get('file_id')!=data['file_id'] or result.get('status') not in ('processed','error','rejected','needs_clarification'):
            raise ApiError('FILE_OUTCOME_INVALID',422)
        outcome={'source_generation':data['generation'],'purpose':data['purpose'],'output_language':data['output_language'],
                 'model_id':data['model_id'],'selection_fingerprint':data['selection_fingerprint'],**result}
        if result['status']!='processed':
            self.gateway.connection().set(self.gateway.receipt_key(data['owner_id'],data['file_id']),json.dumps({
                'status':'failed','generation':data['generation'],'error_code':result.get('error_code','FILE_REVIEW_REQUIRED')}))
        self.store(repo,data,'outcome',digest([id,lease]),outcome)
        return {'stored':True,'status':result['status']}


def expected_projection(manifest,chunks,summary):
    access=manifest['access'];metadata={'file_id':manifest['file_id'],'source_version':manifest['source_version'],
        'source_sha256':manifest['source_sha256'],'source_fingerprint':chunks['source_fingerprint'],'purpose':manifest['purpose'],
        **{k:v for k,v in access.items() if v is not None},'summary_fingerprint':summary['summary_fingerprint'],'embedding_identity':PROFILE_ID}
    records=[]
    for c in chunks['chunks']:
        records.append({'id':str(uuid5(NAMESPACE_URL,'trato:index-chunk:'+digest([metadata,chunks['policy_fingerprint'],c['chunk_id']]))),
            'properties':{**metadata,'record_type':'text_chunk','chunk_id':c['chunk_id'],'chunk_text':c['text'],
             'document_summary':summary['summary'],**{k:c[k] for k in ('segment_id','locator','start_char','end_char','text_sha256')}}})
    document={'id':str(uuid5(NAMESPACE_URL,'trato:index-document:'+digest(metadata))),
        'properties':{**metadata,'record_type':'document_summary','filename':manifest['filename'],
        'document_summary':summary['summary'],'topics':summary['topics'],'citations':summary['citations'],'expected_chunks':len(records)}}
    result={'schema_version':1,'scope_fingerprint':digest({k:v for k,v in access.items() if v is not None}),
        'file_id':manifest['file_id'],'source_fingerprint':chunks['source_fingerprint'],'embedding_identity':PROFILE_ID,
        'embedding_profile':PROFILE,'chunk_vector_properties':['chunk_text'],'chunk_lexical_properties':['chunk_text'],
        'document':document,'chunks':records}
    result['projection_fingerprint']=digest(result);return result


def build_file_processing_router(settings,require_user,repository_factory=None,service=None):
    service=service if service is not None else FileProcessing(settings);router=APIRouter()
    def authorize(request):
        token=os.getenv('TRATO_WORKER_TOKEN','')
        if not token or not secrets.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+token).encode()):
            raise ApiError('UNAUTHORIZED',401)
    async def body(request):
        try:
            value=json.loads(await read_bytes(request,2000000))
            if not isinstance(value,dict):raise ValueError()
            return value
        except ValueError:raise ApiError('FILE_TOOL_INVALID',422) from None
    @router.post('/internal/file-processing/authorize')
    async def auth(request:Request):
        authorize(request);thread=await body(request)
        row=service.jobs.connection().hgetall(PREFIX+uuid(thread.get('thread_id')))
        if not row:raise ApiError('FILE_JOB_NOT_ACTIVE',409)
        repo,data,value,manifest=await run_in_threadpool(service.active,thread['thread_id'],row.get('execution_id'))
        if thread!=data['thread']:raise ApiError('FILE_JOB_INVALID',422)
        return JSONResponse({'data':manifest},headers={'Cache-Control':'no-store'})
    @router.post('/internal/file-processing/execute')
    async def execute(request:Request):
        authorize(request);value=await body(request)
        if set(value)!={'workflow','thread_id','lease_id','tool','params'} or value['workflow']!='process_file' or not isinstance(value['params'],dict):
            raise ApiError('FILE_TOOL_INVALID',422)
        result=await run_in_threadpool(service.execute,value['thread_id'],value['lease_id'],value['tool'],value['params'])
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    @router.post('/internal/file-processing/{job_id}/outcome')
    async def outcome(job_id:str,request:Request):
        authorize(request);value=await body(request)
        if set(value)!={'execution_id','event'}:raise ApiError('FILE_TOOL_INVALID',422)
        result=await run_in_threadpool(service.finalize,uuid(job_id),uuid(value['execution_id']),value['event'])
        return JSONResponse({'data':result},headers={'Cache-Control':'no-store'})
    @router.get('/api/v1/projects/{project_id}/documents/{file_id}/processing')
    def status(project_id:str,file_id:str,request:Request,user=Depends(require_user)):
        repo=(repository_factory or Repository)(settings,request.headers.get('authorization',''))
        value=source(repo,user,repo.project(uuid(project_id)),uuid(file_id))
        context=purpose_context(repo,user,repo.project(uuid(project_id)),value)
        rows=repo.rows('file_processing_artifacts',{'select':'artifact,created_at','document_id':'eq.'+file_id,
            'source_generation':'eq.'+value['generation'],'stage':'eq.outcome','order':'created_at.desc','limit':1})
        if rows and rows[0]['artifact'].get('selection_fingerprint')!=context['selection_fingerprint']:rows=[]
        return JSONResponse({'data':rows[0] if rows else None},headers={'Cache-Control':'no-store'})
    @router.post('/api/v1/projects/{project_id}/documents/{file_id}/process')
    async def process(project_id:str,file_id:str,request:Request,user=Depends(require_user)):
        from .model_preferences import ModelPreferences
        repo=(repository_factory or Repository)(settings,request.headers.get('authorization',''))
        language=request.headers.get('accept-language','es')
        result=await run_in_threadpool(enqueue_processing,repo,service.jobs,user,uuid(project_id),uuid(file_id),
            ModelPreferences().configuration()[1],uuid(request.headers.get('idempotency-key','')),language)
        return JSONResponse({'data':result},status_code=202,headers={'Cache-Control':'no-store'})
    return router
