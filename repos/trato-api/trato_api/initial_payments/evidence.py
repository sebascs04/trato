"""Retire unpaid stage evidence before purging its scoped vector objects."""
from ..errors import ApiError
from redis.exceptions import RedisError
from ..proposals.workflow import BackendStore
from ..vector_routes import VectorGateway

class StageEvidence:
    def __init__(self,settings,*,store=None,gateway=None):
        self.store=store if store is not None else BackendStore(settings)
        self.gateway=gateway if gateway is not None else VectorGateway(settings)
    def command(self,owner,project,position,file_id,action):
        return self.store.repo.rpc('plan_evidence_backend',{'p_owner':owner,'p_project':project,'p_position':position,'p_document':file_id,'p_action':action})
    @staticmethod
    def authorize(repo,owner,project):
        value=repo.project(project)
        if value['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
    def pending(self,repo,owner,project,position):
        self.authorize(repo,owner,project)
        return self.command(owner,project,position,None,'pending')
    def inventory(self,repo,owner,project,position):
        self.authorize(repo,owner,project)
        common={'owner_id':'eq.'+owner,'project_id':'eq.'+project}
        contexts=repo.rows('document_upload_contexts',{'select':'document_id,stage_position,purpose',
            **common,'stage_position':'eq.'+str(position),'purpose':'eq.delivery_evidence','limit':1001})
        if len(contexts)>1000:raise ApiError('VECTOR_INVENTORY_LIMIT',413)
        documents=[]
        if contexts:
            documents=repo.rows('documents',{'select':'id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,origin_status,created_at,document_extractions(id,status,error_code,worker_thread_id,worker_threads(status,phase))',
                **common,'deleted_at':'is.null','id':'in.('+','.join(c['document_id'] for c in contexts)+')',
                'order':'created_at.desc,id.asc','limit':1001})
        ids=[d['id'] for d in documents]
        latest={}
        if ids:
            for offset in range(0,10001,100):
                outcomes=repo.rows('file_processing_artifacts',{'select':'document_id,status:artifact->>status,error_code:artifact->>error_code',
                    **common,'document_id':'in.('+','.join(ids)+')','stage':'eq.outcome',
                    'order':'created_at.desc,document_id.asc,cache_key.desc','limit':100,'offset':offset})
                for outcome in outcomes:latest.setdefault(outcome['document_id'],outcome)
                if len(outcomes)<100:break
            else:raise ApiError('VECTOR_INVENTORY_LIMIT',413)
        for d in documents:
            d['upload_context']={'stage_position':position,'purpose':'delivery_evidence'}
            extraction=d.get('document_extractions')
            d['extraction']=next(iter(extraction),None) if isinstance(extraction,list) else extraction
            d['processing_outcome']=latest.get(d['id'])
        inventory=self.gateway.inventory(repo,owner,project,limit=1000,file_ids=ids) if ids else {'files':[]}
        return {'documents':documents,'files':inventory['files'],
            'withdrawals':self.command(owner,project,position,None,'pending')}
    def remove(self,repo,owner,project,position,file_id):
        self.authorize(repo,owner,project)
        record=self.command(owner,project,position,file_id,'withdraw')
        if record['cleanup_status']=='complete':return record
        lock=None;acquired=False
        try:
            connection=self.gateway.connection();lock=connection.lock('trato:vector:index-lock',timeout=2400,blocking_timeout=0)
            acquired=lock.acquire(blocking=False)
            if not acquired:raise ApiError('VECTOR_INDEX_BUSY',409)
            self.gateway.store.remove_file(owner,record['client_id'],project,file_id)
            self.gateway.registry.remove(owner,file_id)
            connection.delete(self.gateway.receipt_key(owner,file_id))
            return self.command(owner,project,position,file_id,'cleaned')
        except ApiError as error:
            return {**record,'cleanup_error':error.code}
        except RedisError:
            return {**record,'cleanup_error':'VECTOR_REGISTRY_UNAVAILABLE'}
        finally:
            if acquired and lock.owned():lock.release()
