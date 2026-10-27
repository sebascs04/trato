from ..persistence import Repository,uuid
from ..errors import ApiError


class ProposalRepository(Repository):
    def list_proposals(self,project_id):
        project=self.project(project_id)
        proposals=self.rows('change_proposals',{'select':'id,project_id,request_document_id,current_revision_id,status,locked_at,created_at','project_id':'eq.'+project['id'],'order':'created_at.desc','limit':100})
        if not proposals:return []
        ids='in.('+','.join(p['current_revision_id'] for p in proposals)+')'
        revisions=self.rows('proposal_revisions',{'select':'id,revision_no,additional_minor','id':ids})
        artifacts=self.rows('proposal_artifacts',{'select':'revision_id','revision_id':ids})
        deliveries=self.rows('proposal_deliveries',{'select':'revision_id,kind,status','revision_id':ids})
        closures=self.rows('request_closures',{'select':'request_document_id','project_id':'eq.'+project['id']})
        payments=self.rows('proposal_payments',{'select':'revision_id,status','revision_id':ids})
        for proposal in proposals:
            revision=next((r for r in revisions if r['id']==proposal['current_revision_id']),None)
            if revision is None:raise ApiError('PROPOSAL_REVISION_MISSING',409)
            proposal['revision_no']=revision['revision_no']
            proposal['business_status']=('Cerrado' if any(c['request_document_id']==proposal['request_document_id'] for c in closures) else 'Finalizado' if proposal['locked_at'] else 'Pendiente de pago' if proposal['status']=='accepted' else 'Esperando respuesta' if any(d['revision_id']==revision['id'] and d['kind']=='adenda' and d['status']=='accepted_by_gmail' for d in deliveries) else 'Adenda en borrador' if any(a['revision_id']==revision['id'] for a in artifacts) else 'Propuesta en preparación')
        return proposals


    def get_proposal(self,proposal_id):
        proposals=self.rows('change_proposals',{'select':'*','id':'eq.'+uuid(proposal_id)})
        if not proposals:raise ApiError('PROPOSAL_NOT_FOUND',404)
        proposal=proposals[0]
        # Revision records/sources/terms are immutable. The client sends this exact
        # revision ID back for every command; SQL compares it under a project lock.
        revisions=self.rows('proposal_revisions',{'select':'*','proposal_id':'eq.'+proposal['id'],'order':'revision_no.desc,draft_sequence.desc','limit':100})
        latest=[];seen=set()
        for revision in revisions:
            if revision['revision_no'] not in seen:latest.append(revision);seen.add(revision['revision_no'])
        return {'proposal':proposal,'revisions':latest,'snapshots':revisions}

    def get_revision(self,proposal_id,revision_id):
        proposal=self.get_proposal(proposal_id)['proposal']
        rows=self.rows('proposal_revisions',{'select':'*','id':'eq.'+uuid(revision_id),'proposal_id':'eq.'+proposal['id']})
        if not rows:raise ApiError('REVISION_NOT_FOUND',404)
        revision=rows[0]
        params={'revision_id':'eq.'+revision['id'],'proposal_id':'eq.'+proposal['id']}
        return {'proposal':proposal,'revision':revision,
            'line_items':self.rows('proposal_revision_items',{'select':'ordinal,description,quantity,unit_amount_minor',**params,'order':'ordinal.asc'}),
            'sources':self.rows('proposal_revision_sources',{'select':'document_id,extraction_id,document_sha256,extraction_result_hash',**params}),
            'reviews':self.rows('proposal_reviews',{'select':'addendum_document_id,addendum_sha256,reviewer_id,reviewed_at',**params}),
            'acceptances':self.rows('proposal_acceptances',{'select':'id,returned_document_id,returned_sha256,reviewer_id,review_notes,method,cryptographic_signature_verified,created_at',**params}),
            'events':self.rows('proposal_events',{'select':'id,event_type,actor_id,created_at',**params,'order':'created_at.asc'}),
            'deliveries':self.rows('proposal_deliveries',{'select':'id,kind,recipient,status,created_at,updated_at',**params,'order':'created_at.asc'}),
            'payments':self.rows('proposal_payments',{'select':'id,status,order_id,capture_id,approval_url,amount_minor,currency,created_at,updated_at',**params,'order':'created_at.desc'}),
            'artifacts':self.rows('proposal_artifacts',{'select':'document_id,sha256,created_at',**params}),
            'payment_required':revision['additional_minor']>0}

    def command(self,action,data,key):
        return self.rpc('proposal_command',{'p_action':action,'p_data':data,'p_key':key})
