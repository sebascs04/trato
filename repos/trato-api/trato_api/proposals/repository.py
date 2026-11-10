from concurrent.futures import ThreadPoolExecutor

from ..persistence import Repository,uuid
from ..errors import ApiError


class ProposalRepository(Repository):
    def _read_parallel(self, queries):
        # Call only after authorizing the parent. Reads use the same caller JWT.
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures={name:pool.submit(self.rows,table,params) for name,(table,params) in queries.items()}
            return {name:future.result() for name,future in futures.items()}

    def _proposal(self, proposal_id):
        rows=self.rows('change_proposals',{'select':'*','id':'eq.'+uuid(proposal_id)})
        if not rows:raise ApiError('PROPOSAL_NOT_FOUND',404)
        return rows[0]

    def list_proposals(self,project_id):
        project=self.project(project_id)
        proposals=self.rows('change_proposals',{'select':'id,project_id,request_document_id,current_revision_id,status,locked_at,created_at','project_id':'eq.'+project['id'],'order':'created_at.desc','limit':100})
        if not proposals:return []
        ids='in.('+','.join(p['current_revision_id'] for p in proposals)+')'
        data=self._read_parallel({
            'revisions':('proposal_revisions',{'select':'id,revision_no,additional_minor','id':ids}),
            'placements':('change_request_plan_placements',{'select':'request_document_id,placement,stage_position','project_id':'eq.'+project['id']}),
            'artifacts':('proposal_artifacts',{'select':'revision_id','revision_id':ids}),
            'deliveries':('proposal_deliveries',{'select':'revision_id,kind,status','revision_id':ids}),
            'closures':('request_closures',{'select':'request_document_id','project_id':'eq.'+project['id']}),
            # Changes the client asked for in the portal that no new version has answered yet: it is the freelancer's turn.
            'portal_requests':('client_portal_change_requests',{'select':'revision_id','revision_id':ids,'used_at':'is.null'})})
        revisions,artifacts,deliveries,closures,placements,portal_requests=(data[key] for key in ('revisions','artifacts','deliveries','closures','placements','portal_requests'))
        placed={p['request_document_id']:p for p in placements}
        for proposal in proposals:
            revision=next((r for r in revisions if r['id']==proposal['current_revision_id']),None)
            if revision is None:raise ApiError('PROPOSAL_REVISION_MISSING',409)
            proposal['revision_no']=revision['revision_no']
            proposal['additional_minor']=revision['additional_minor']
            # Where the request sits in the work plan; null for requests registered before placements existed.
            where=placed.get(proposal['request_document_id'])
            proposal['plan_placement']=where['placement'] if where else None
            proposal['plan_stage_position']=where['stage_position'] if where else None
            proposal['business_status']=('Cerrado' if any(c['request_document_id']==proposal['request_document_id'] for c in closures) else 'Finalizado' if proposal['locked_at'] else 'Pendiente de pago' if proposal['status']=='accepted' else 'Cambios pedidos por el cliente' if any(q['revision_id']==revision['id'] for q in portal_requests) else 'Esperando respuesta' if any(d['revision_id']==revision['id'] and d['kind']=='adenda' and d['status']=='accepted_by_gmail' for d in deliveries) else 'Adenda en borrador' if any(a['revision_id']==revision['id'] for a in artifacts) else 'Propuesta en preparación')
        finished=[p for p in proposals if p['business_status']=='Finalizado']
        if finished:self._list_refunds(project,finished)
        return proposals

    def _list_refunds(self,project,finished):
        # Paid and then refunded: the list reads «Refunded» like the client's (business_status stays «Finalizado»). Optional.
        try:
            payments=self.rows('proposal_payments',{'select':'id,proposal_id,status,amount_minor','proposal_id':'in.('+','.join(p['id'] for p in finished)+')','status':'eq.completed'})
            if not payments:return
            self._with_refunds(project,payments)
            for proposal in finished:
                paid=[p for p in payments if p['proposal_id']==proposal['id']]
                if any(p.get('refunded_minor') for p in paid):
                    proposal['paid_minor']=sum(p['amount_minor'] for p in paid);proposal['refunded_minor']=sum(p.get('refunded_minor') or 0 for p in paid)
        except Exception:  # noqa: BLE001
            pass


    def get_proposal(self,proposal_id,*,summary=False):
        proposal=self._proposal(proposal_id)
        # Revision records/sources/terms are immutable. The client sends this exact
        # revision ID back for every command; SQL compares it under a project lock.
        revisions=self.rows('proposal_revisions',{'select':'id,revision_no,draft_sequence,additional_minor,deadline' if summary else '*','proposal_id':'eq.'+proposal['id'],'order':'revision_no.desc,draft_sequence.desc','limit':100})
        latest=[];seen=set()
        for revision in revisions:
            if revision['revision_no'] not in seen:latest.append(revision);seen.add(revision['revision_no'])
        result={'proposal':proposal,'revisions':latest}
        if not summary:result['snapshots']=revisions
        return result

    def get_revision(self,proposal_id,revision_id,*,collections=None):
        proposal=self._proposal(proposal_id)
        rows=self.rows('proposal_revisions',{'select':'*','id':'eq.'+uuid(revision_id),'proposal_id':'eq.'+proposal['id']})
        if not rows:raise ApiError('REVISION_NOT_FOUND',404)
        revision=rows[0]
        params={'revision_id':'eq.'+revision['id'],'proposal_id':'eq.'+proposal['id']}
        queries={
            'line_items':('proposal_revision_items',{'select':'ordinal,description,quantity,unit_amount_minor',**params,'order':'ordinal.asc'}),
            'sources':('proposal_revision_sources',{'select':'document_id,extraction_id,document_sha256,extraction_result_hash',**params}),
            'reviews':('proposal_reviews',{'select':'addendum_document_id,addendum_sha256,reviewer_id,reviewed_at',**params}),
            'acceptances':('proposal_acceptances',{'select':'id,returned_document_id,returned_sha256,reviewer_id,review_notes,method,cryptographic_signature_verified,created_at',**params}),
            'events':('proposal_events',{'select':'id,event_type,actor_id,created_at',**params,'order':'created_at.asc'}),
            'deliveries':('proposal_deliveries',{'select':'id,kind,recipient,status,provider_thread_id,created_at,updated_at',**params,'order':'created_at.asc'}),
            'payments':('proposal_payments',{'select':'id,status,order_id,capture_id,approval_url,amount_minor,currency,merchant_id,capture_attempted,method,invoice_id,invoice_url,created_at,updated_at',**params,'order':'created_at.desc'}),
            'artifacts':('proposal_artifacts',{'select':'document_id,sha256,created_at',**params}),
        }
        selected=tuple(queries) if collections is None else tuple(collections)
        if any(name not in queries for name in selected):raise ValueError('Unknown revision collection')
        data=self._read_parallel({name:queries[name] for name in selected})
        if collections is None and revision['revision_no']>1:
            previous=self.rows('proposal_revisions',{
                'select':'id,revision_no,scope_summary,additional_minor,deadline,proposal_deliveries!inner(id)',
                'proposal_id':'eq.'+proposal['id'],'revision_no':'eq.'+str(revision['revision_no']-1),
                'proposal_deliveries.kind':'eq.adenda','proposal_deliveries.status':'eq.accepted_by_gmail',
                'order':'draft_sequence.desc','limit':1})
            if previous:
                data['previous_sent']={key:value for key,value in previous[0].items() if key!='proposal_deliveries'}
        if any(p.get('status')=='completed' for p in data.get('payments') or []):self._with_refunds(proposal,data['payments'])
        return {'proposal':proposal,'revision':revision,**data,'payment_required':revision['additional_minor']>0}

    def _with_refunds(self,proposal,payments):
        # What was refunded of a paid addendum, so the freelancer reads «Refunded» like the client does. Best effort: the
        # revision still opens if this read fails, as plain «Paid».
        try:
            ids=','.join(p['id'] for p in payments if p.get('status')=='completed')
            received=self.rows('project_received_payments',{'select':'id,proposal_payment_id','proposal_payment_id':f'in.({ids})'})
            refunded={r['id']:r.get('local_previous_refunds_minor') or 0 for r in self.rpc('refund_payments',{'p_project_id':proposal.get('project_id') or proposal['id']})}
            by_payment={r['proposal_payment_id']:refunded.get(r['id'],0) for r in received}
            for p in payments:
                if p['id'] in by_payment:p['refunded_minor']=min(p['amount_minor'],by_payment[p['id']])
        except Exception:  # noqa: BLE001 - optional detail, never blocks the change view
            pass

    def command(self,action,data,key):
        return self.rpc('proposal_command',{'p_action':action,'p_data':data,'p_key':key})
