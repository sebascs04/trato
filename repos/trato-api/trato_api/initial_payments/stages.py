"""Sequential deliverable payments reuse verified initial-plan checkout operations."""
from ..errors import ApiError
from ..vector_routes import VectorGateway,source
from .workflow import InitialPayments,InitialStore

class StageStore:
    def __init__(self,store,position):self.store,self.position=store,position
    def command(self,owner,action,data):
        if action in ('get','prepare'):data={**data,'stage_position':self.position}
        return self.store.command(owner,action,data)

class StagePayments(InitialPayments):
    def __init__(self,settings,gmail,position,*,store=None,paypal=None,gateway=None):
        super().__init__(settings,gmail,store=StageStore(store or InitialStore(settings),position),paypal=paypal)
        self.position,self.gateway=position,gateway or VectorGateway(settings)
    def approved_by_client(self,repo,project,file_id):
        rows=repo.rows('project_stage_reviews',{'select':'decision','project_id':'eq.'+project,'stage_position':'eq.'+str(self.position),
            'document_id':'eq.'+file_id,'decision':'eq.approved','limit':1})
        return bool(rows)
    def prepare_stage(self,repo,owner,project,data,key):
        p=repo.project(project)
        if p['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
        rows=repo.rows('project_start_stages',{'select':'position,title,amount,payment_condition','project_id':'eq.'+project,'owner_id':'eq.'+owner,'position':'eq.'+str(self.position)})
        if len(rows)!=1:raise ApiError('PLAN_STAGE_INVALID',404)
        stage=rows[0];file_id=data['evidence_document_id']
        links=repo.rows('document_upload_contexts',{'select':'stage_position,purpose','document_id':'eq.'+file_id,'project_id':'eq.'+project,'owner_id':'eq.'+owner})
        if len(links)!=1 or links[0]['stage_position']!=self.position or links[0]['purpose']!='delivery_evidence':raise ApiError('PLAN_EVIDENCE_INVALID',409)
        value=source(repo,owner,p,file_id);receipt=self.gateway.receipt(owner,file_id)
        summary=self.gateway.summary(repo,{'id':file_id,'generation':value['generation']})
        if not receipt or receipt.get('status')!='ready' or receipt.get('generation')!=value['generation'] or not summary or receipt.get('summary_fingerprint')!=summary['summary_fingerprint']:
            # Trato's own reading of the PDF may still be pending or ask for clarification. When the client already
            # approved this very delivery, their approval decides: the deliverable can be charged.
            if not self.approved_by_client(repo,project,file_id):raise ApiError('PLAN_EVIDENCE_NOT_READY',409)
        from decimal import Decimal
        return super().prepare(repo,owner,project,{'amount_minor':int(Decimal(str(stage['amount']))*100),'conditions':stage['payment_condition'],
            'output_language':data['output_language'],'evidence_document_id':file_id,'evidence_generation':value['generation']},key)
