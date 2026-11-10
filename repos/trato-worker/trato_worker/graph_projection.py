"""Deterministic project projection. Business records remain authoritative in Supabase."""
import os
from uuid import UUID
from urllib.parse import urlparse
from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError, DriverError
from .connected import JobError

GRAPH_PROJECTION_VERSIONS=(2,3)

KINDS={'Project','Document','Extraction','Proposal','Revision','Review','Acceptance','Delivery','Payment','Plan','PlanStage',
       'Refund','RefundVersion','RefundReceipt','ClientChangeRequest','Dispute'}
REFUND_DOCUMENT_LINKS={'source':'REFUND_EVIDENCE','pdf':'REFUND_PDF','acceptance':'REFUND_ACCEPTANCE_EVIDENCE','feedback':'REFUND_FEEDBACK_EVIDENCE'}
RELATIONS={'HAS_DOCUMENT','HAS_EXTRACTION','HAS_PROPOSAL','RESPONDS_TO','HAS_REVISION','CURRENT_REVISION',
 'SUPPORTED_BY','HAS_PDF','HAS_REVIEW','REVIEWED_PDF','ACCEPTS_REVISION','EVIDENCED_BY','FOR_REVISION',
 'FOLLOWS_ACCEPTANCE','REPLACES_DRAFT','REQUESTED_CHANGES_FROM','BASED_ON_ACCEPTANCE','CURRENT_ACCEPTANCE','HAS_PLAN','HAS_STAGE','DELIVERY_EVIDENCE','STAGE_PAYMENT','PAYMENT_EVIDENCE',
 'HAS_CHANGE_REQUEST','HAS_NEW_WORK','ASKS_TO_CHANGE','ACCEPTED_PDF','HAS_DISPUTE','DISPUTE_CONFIRMED_REFUND',

 'HAS_REFUND','HAS_REFUND_VERSION','REFUND_ORIGINAL_PAYMENT','REFUND_CONFIRMED_RECEIPT','REFUND_APPLIES_TO_PAYMENT',*REFUND_DOCUMENT_LINKS.values()}


def build_projection(snapshot,context):
    version=snapshot.get('projection_version')
    if type(version) is not int or version not in GRAPH_PROJECTION_VERSIONS:
        raise JobError('GRAPH_PROJECTION_VERSION_UNSUPPORTED')
    if any(not isinstance(snapshot.get(field),list) for field in ('project_start_plans','project_start_stages','plan_stage_evidence','plan_stage_payments')):
        raise JobError('INVALID_GRAPH_SOURCE')
    if snapshot['owner_id']!=context['owner_id'] or snapshot['project_id']!=context['project_id'] or snapshot['project']['client_id']!=context['client_id']:
        raise JobError('GRAPH_CONTEXT_CONFLICT')
    project=snapshot['project'];nodes={};edges=[]
    owner,project_id=context['owner_id'],context['project_id']
    def key(table,id):
        if str(UUID(id))!=id:raise JobError('INVALID_GRAPH_SOURCE')
        return table+':'+id
    def node(table,id,kind,props,position=None):
        k=key(table,id)
        if position is not None:
            if type(position) is not int or not 1<=position<=8:raise JobError('INVALID_GRAPH_SOURCE')
            k+=':'+str(position)
        nodes[k]={**{('business_kind' if k=='kind' else k):v for k,v in props.items() if v is not None},
                  'entity_key':k,'kind':kind,'owner_id':owner,'project_id':project_id,'source_id':id}
        return k
    def edge(source,kind,target,**props):
        if source not in nodes or target not in nodes:raise JobError('GRAPH_SOURCE_MISSING')
        e={'edge_key':source+'|'+kind+'|'+target,'source':source,'target':target,'kind':kind,**props}
        if not any(x['edge_key']==e['edge_key'] for x in edges):edges.append(e)
    pk=node('projects',project_id,'Project',{'title':project['name'],'status':project['status'],'client_name':project['client_name'],'projection_version':version})
    for row in snapshot['documents']:
        dk=node('documents',row['id'],'Document',row);edge(pk,'HAS_DOCUMENT',dk)
    for row in snapshot['document_extractions']:
        ek=node('document_extractions',row['id'],'Extraction',row);edge(key('documents',row['document_id']),'HAS_EXTRACTION',ek)
    for row in snapshot['change_proposals']:
        k=node('change_proposals',row['id'],'Proposal',row);edge(pk,'HAS_PROPOSAL',k)
        edge(k,'RESPONDS_TO',key('documents',row['request_document_id']))
    for row in snapshot['proposal_revisions']:node('proposal_revisions',row['id'],'Revision',row)
    for row in snapshot['proposal_reviews']:node('proposal_reviews',row['revision_id'],'Review',row)
    for table,kind in [('proposal_acceptances','Acceptance'),('proposal_deliveries','Delivery'),('proposal_payments','Payment')]:
        for row in snapshot[table]:node(table,row['id'],kind,row)
    for row in snapshot['change_proposals']:
        if row['current_revision_id']:edge(key('change_proposals',row['id']),'CURRENT_REVISION',key('proposal_revisions',row['current_revision_id']))
    # Client portal change requests: the version the client asked to change, and the version that answered it.
    portal_requests=snapshot.get('client_portal_change_requests',[])
    for row in portal_requests:node('client_portal_change_requests',row['id'],'ClientChangeRequest',row)
    for row in snapshot['proposal_revisions']:
        rk=key('proposal_revisions',row['id']);edge(key('change_proposals',row['proposal_id']),'HAS_REVISION',rk)
        for field,rel,table in [('replaces_draft_id','REPLACES_DRAFT','proposal_revisions'),('feedback_document_id','REQUESTED_CHANGES_FROM','documents'),('feedback_portal_request_id','REQUESTED_CHANGES_FROM','client_portal_change_requests'),('base_acceptance_id','BASED_ON_ACCEPTANCE','proposal_acceptances')]:
            if row.get(field):edge(rk,rel,key(table,row[field]))
    for row in portal_requests:edge(key('client_portal_change_requests',row['id']),'ASKS_TO_CHANGE',key('proposal_revisions',row['revision_id']))
    for row in snapshot['proposal_revision_sources']:
        edge(key('proposal_revisions',row['revision_id']),'SUPPORTED_BY',key('document_extractions',row['extraction_id']),document_sha256=row['document_sha256'],extraction_result_hash=row['extraction_result_hash'])
    for row in snapshot['proposal_artifacts']:edge(key('proposal_revisions',row['revision_id']),'HAS_PDF',key('documents',row['document_id']),sha256=row['sha256'])
    for row in snapshot['proposal_reviews']:
        k=key('proposal_reviews',row['revision_id']);edge(key('proposal_revisions',row['revision_id']),'HAS_REVIEW',k)
        edge(k,'REVIEWED_PDF',key('documents',row['addendum_document_id']),sha256=row['addendum_sha256'])
    for row in snapshot['proposal_acceptances']:
        k=key('proposal_acceptances',row['id']);edge(k,'ACCEPTS_REVISION',key('proposal_revisions',row['revision_id']))
        if row.get('method')=='client_portal':
            # Accepted with one click in the client portal: the evidence is the reviewed PDF the client saw.
            review=next((r for r in snapshot['proposal_reviews'] if r['revision_id']==row['revision_id']),None)
            if review is None or row['returned_document_id']:raise JobError('INVALID_GRAPH_SOURCE')
            edge(k,'ACCEPTED_PDF',key('documents',review['addendum_document_id']),sha256=review['addendum_sha256'],method='client_portal')
        else:edge(k,'EVIDENCED_BY',key('documents',row['returned_document_id']),sha256=row['returned_sha256'])
    for table in ('proposal_deliveries','proposal_payments'):
        for row in snapshot[table]:
            k=key(table,row['id']);edge(k,'FOR_REVISION',key('proposal_revisions',row['revision_id']))
            if table=='proposal_payments':edge(k,'FOLLOWS_ACCEPTANCE',key('proposal_acceptances',row['acceptance_id']))
    for row in snapshot['project_agreement_heads']:
        if row['acceptance_id']:edge(pk,'CURRENT_ACCEPTANCE',key('proposal_acceptances',row['acceptance_id']))
    plans=snapshot.get('project_start_plans',[])
    stages=snapshot.get('project_start_stages',[])
    evidence=snapshot.get('plan_stage_evidence',[])
    payments=snapshot.get('plan_stage_payments',[])
    if len(plans)>1 or (not plans and (stages or evidence or payments)):raise JobError('GRAPH_SOURCE_MISSING')
    if plans:
        plan=plans[0]
        if plan['project_id']!=project_id:raise JobError('GRAPH_CONTEXT_CONFLICT')
        pl=node('project_start_plans',project_id,'Plan',{**plan,'status':'finished' if plan.get('completed_at') else 'planned'})
        edge(pk,'HAS_PLAN',pl)
        stage_keys={}
        for row in stages:
            position=row['position']
            if position in stage_keys:raise JobError('INVALID_GRAPH_SOURCE')
            stage_keys[position]=node('project_start_stages',project_id,'PlanStage',row,position=position)
            edge(pl,'HAS_STAGE',stage_keys[position])
        evidence_keys=set()
        for row in evidence:
            stage=stage_keys.get(row['stage_position'])
            if not stage:raise JobError('GRAPH_SOURCE_MISSING')
            dk=key('documents',row['document_id']);edge(stage,'DELIVERY_EVIDENCE',dk)
            evidence_keys.add((row['stage_position'],row['document_id']))
        paid_positions=set()
        for row in payments:
            position=row['stage_position']
            if row.get('status')!='completed' or position not in stage_keys or (position,row['evidence_document_id']) not in evidence_keys or not row.get('paid_at') or not row.get('received_payment_id'):
                raise JobError('GRAPH_SOURCE_MISSING')
            if position in paid_positions:raise JobError('INVALID_GRAPH_SOURCE')
            paid_positions.add(position)
            payment=node('project_initial_checkouts',row['id'],'Payment',{**row,'status':'completed','business_kind':'plan_stage','created_at':row['paid_at']})
            edge(stage_keys[position],'STAGE_PAYMENT',payment)
            edge(payment,'PAYMENT_EVIDENCE',key('documents',row['evidence_document_id']))
        if plan.get('completed_at') and set(stage_keys)!=paid_positions:raise JobError('GRAPH_SOURCE_MISSING')
    # Change requests placed in the plan: under a stage, or as new work after it. Optional key, so snapshots
    # from before the placements migration still project; when present it must be exact.
    placements=snapshot.get('change_request_plan_placements',[])
    if not isinstance(placements,list):raise JobError('INVALID_GRAPH_SOURCE')
    if placements and not plans:raise JobError('GRAPH_SOURCE_MISSING')
    seen=set()
    for row in placements:
        request=key('documents',row['request_document_id'])
        if request in seen or nodes.get(request,{}).get('business_kind')!='email_request':raise JobError('GRAPH_SOURCE_MISSING')
        seen.add(request)
        if row['placement']=='stage' and row.get('stage_position') in stage_keys:edge(stage_keys[row['stage_position']],'HAS_CHANGE_REQUEST',request)
        elif row['placement']=='new' and row.get('stage_position') is None:edge(pl,'HAS_NEW_WORK',request)
        else:raise JobError('INVALID_GRAPH_SOURCE')
    if version==3:
        fields=('refund_cases','refund_versions','refund_documents','refund_payments','refund_receipts')
        if any(not isinstance(snapshot.get(field),list) for field in fields):raise JobError('INVALID_GRAPH_SOURCE')
        for row in snapshot['refund_cases']:
            refund=node('refund_settlements',row['id'],'Refund',{
                'summary':row['reason'],'status':row['status'],'created_at':row['created_at'],
                'amount_minor':row['confirmed_refund_minor'],'currency':'USD',
            })
            edge(pk,'HAS_REFUND',refund)
        versions={}
        for row in snapshot['refund_versions']:
            refund=key('refund_settlements',row['settlement_id'])
            version_key=node('refund_snapshots',row['id'],'RefundVersion',{
                'revision_no':row['version_no'],'draft_sequence':row['draft_sequence'],'amount_minor':row['amount_minor'],
                'currency':'USD','created_at':row['created_at'],'is_current_revision':row['is_current_revision'],
                'status':'accepted' if row.get('accepted_at') else None,
            })
            versions[(row['settlement_id'],row['id'])]=version_key
            edge(refund,'HAS_REFUND_VERSION',version_key)
        for row in snapshot['refund_documents']:
            refund=key('refund_settlements',row['settlement_id'])
            origin=versions[(row['settlement_id'],row['snapshot_id'])] if row['snapshot_id'] else refund
            edge(origin,REFUND_DOCUMENT_LINKS[row['role']],key('documents',row['document_id']))
        payment_keys={}
        staged={r['received_payment_id']:key('project_initial_checkouts',r['id']) for r in payments}
        for row in snapshot['refund_payments']:
            payment=staged.get(row['id'])
            if row['proposal_payment_id']:
                recorded=key('proposal_payments',row['proposal_payment_id'])
                if recorded in nodes:payment=recorded
            if payment is None:
                payment=node('project_received_payments',row['id'],'Payment',{
                    'amount_minor':row['amount_minor'],'currency':row['currency'],'status':'completed',
                    'business_kind':row['origin'],'created_at':row['verified_at'],
                })
            payment_keys[(row['settlement_id'],row['id'])]=payment
            edge(key('refund_settlements',row['settlement_id']),'REFUND_ORIGINAL_PAYMENT',payment)
        for row in snapshot['refund_receipts']:
            receipt=node('refund_provider_receipts',row['id'],'RefundReceipt',{
                'amount_minor':row['amount_minor'],'currency':row['currency'],
                'status':'completed','created_at':row['confirmed_at'],
            })
            edge(key('refund_settlements',row['settlement_id']),'REFUND_CONFIRMED_RECEIPT',receipt)
            edge(receipt,'REFUND_APPLIES_TO_PAYMENT',payment_keys[(row['settlement_id'],row['payment_id'])])
    # One node per PayPal dispute, under the payment it contests. A dispute must never stop the map: it hangs from the project
    # when that payment is not in the graph. Its messages and documents live in the project history and Documents.
    for row in snapshot.get('project_disputes',[]):
        dispute=node('project_dispute_events',row['id'],'Dispute',row)
        payments=[key(table,row[field]) for field,table in (('proposal_payment_id','proposal_payments'),('received_payment_id','project_initial_checkouts')) if row.get(field)]
        edge(next((k for k in payments if k in nodes),pk),'HAS_DISPUTE',dispute)
    for row in snapshot.get('dispute_refund_receipts',[]):
        receipt=node('refund_provider_receipts',row['id'],'RefundReceipt',{
            'amount_minor':row['amount_minor'],'currency':row['currency'],
            'status':'completed','created_at':row['confirmed_at'],
        })
        edge(key('project_dispute_events',row['dispute_event_id']),'DISPUTE_CONFIRMED_REFUND',receipt)
    return {'nodes':list(nodes.values()),'edges':edges}


_DRIVERS={}

class GraphWriter:
    def __init__(self,driver,database,*,shared_key=None):self.driver,self.database,self.shared_key=driver,database,shared_key

    @classmethod
    def from_env(cls):
        uri=os.environ.get('NEO4J_URI','');u=urlparse(uri)
        if u.scheme!='neo4j+s' or not u.hostname or not u.hostname.endswith('.databases.neo4j.io') or u.username or u.password:
            raise JobError('GRAPH_NOT_CONFIGURED')
        if not os.environ.get('NEO4J_PASSWORD'):raise JobError('GRAPH_NOT_CONFIGURED')
        # One driver per worker process: opening a new connection to Aura costs ~2 s per sync.
        user,database=os.environ.get('NEO4J_USERNAME','neo4j'),os.environ.get('NEO4J_DATABASE','neo4j')
        shared=(uri,user,database)
        if shared not in _DRIVERS:
            _DRIVERS[shared]={'driver':GraphDatabase.driver(uri,auth=(user,os.environ['NEO4J_PASSWORD']),
                connection_timeout=10,connection_acquisition_timeout=20,max_transaction_retry_time=0),'constraint':False}
        return cls(_DRIVERS[shared]['driver'],database,shared_key=shared)

    def _forget(self):
        entry=_DRIVERS.pop(self.shared_key,None) if self.shared_key else None
        try:(entry['driver'] if entry else self.driver).close()
        except Exception:pass

    def sync(self,projection,context,generation,content_hash):
        owner,project=context['owner_id'],context['project_id']
        # Labels and relationship types are applied dynamically below, so they must come from the fixed sets.
        if any(n['kind'] not in KINDS for n in projection['nodes']) or any(e['kind'] not in RELATIONS for e in projection['edges']):
            raise JobError('INVALID_GRAPH_SOURCE')
        entry=_DRIVERS.get(self.shared_key) if self.shared_key else None
        try:
            with self.driver.session(database=self.database) as session:
                # Constraint is idempotent and applies only to Trato-owned entities; checked once per driver.
                if not entry or not entry['constraint']:
                    session.run('CREATE CONSTRAINT trato_entity_key IF NOT EXISTS FOR (n:TratoEntity) REQUIRE n.entity_key IS UNIQUE').consume()
                    if entry:entry['constraint']=True
                with session.begin_transaction(timeout=45) as tx:
                    root=tx.run('MERGE (p:TratoEntity:Project {entity_key:$key}) ON CREATE SET p.owner_id=$owner,p.project_id=$project '
                                'SET p._graph_lock=coalesce(p._graph_lock,0)+1 RETURN p.generation AS generation,p.owner_id AS owner,p.project_id AS project',
                                key='projects:'+project,owner=owner,project=project).single()
                    if root['owner']!=owner or root['project']!=project:raise JobError('GRAPH_CONTEXT_CONFLICT')
                    if root['generation'] is not None and root['generation']>generation:raise JobError('STALE_GRAPH_GENERATION')
                    # Bounded project replacement is atomic, including removal of obsolete edges/nodes.
                    tx.run('MATCH (n:TratoEntity {owner_id:$owner,project_id:$project})-[r]->(m:TratoEntity {owner_id:$owner,project_id:$project}) DELETE r',owner=owner,project=project).consume()
                    # All nodes in one statement and all edges in another (validated kinds), instead of one per kind.
                    if projection['nodes']:
                        tx.run('UNWIND $rows AS row CALL apoc.merge.node(["TratoEntity",row.kind],{entity_key:row.entity_key},{},{}) YIELD node '
                               'SET node=row,node.generation=$generation',rows=projection['nodes'],generation=generation).consume()
                    if projection['edges']:
                        tx.run('UNWIND $rows AS row MATCH (a:TratoEntity {entity_key:row.source,owner_id:$owner,project_id:$project}),'
                               '(b:TratoEntity {entity_key:row.target,owner_id:$owner,project_id:$project}) '
                               'CALL apoc.merge.relationship(a,row.kind,{edge_key:row.edge_key},{},b,{}) YIELD rel '
                               'SET rel=row,rel.owner_id=$owner,rel.project_id=$project',rows=projection['edges'],owner=owner,project=project).consume()
                    tx.run('MATCH (n:TratoEntity {owner_id:$owner,project_id:$project}) WHERE n.generation<>$generation DETACH DELETE n',owner=owner,project=project,generation=generation).consume()
                    tx.run('MATCH (p:TratoEntity {entity_key:$key,owner_id:$owner,project_id:$project}) SET p.content_hash=$hash,p.synced_at=datetime()',
                           key='projects:'+project,owner=owner,project=project,hash=content_hash).consume()
                    tx.commit()
        except (Neo4jError,DriverError):
            # A broken connection is not reused by the next job.
            self._forget();raise JobError('GRAPH_UNAVAILABLE') from None
        finally:
            if not self.shared_key:self.driver.close()
