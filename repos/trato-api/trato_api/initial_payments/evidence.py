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
