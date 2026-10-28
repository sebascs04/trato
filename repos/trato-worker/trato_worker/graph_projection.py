"""Deterministic project projection. Business records remain authoritative in Supabase."""
import os
from uuid import UUID
from urllib.parse import urlparse
from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError, DriverError
from .connected import JobError

KINDS={'Project','Document','Extraction','Proposal','Revision','Review','Acceptance','Delivery','Payment'}
RELATIONS={'HAS_DOCUMENT','HAS_EXTRACTION','HAS_PROPOSAL','RESPONDS_TO','HAS_REVISION','CURRENT_REVISION',
 'SUPPORTED_BY','HAS_PDF','HAS_REVIEW','REVIEWED_PDF','ACCEPTS_REVISION','EVIDENCED_BY','FOR_REVISION',
 'FOLLOWS_ACCEPTANCE','REPLACES_DRAFT','REQUESTED_CHANGES_FROM','BASED_ON_ACCEPTANCE','CURRENT_ACCEPTANCE'}


def build_projection(snapshot,context):
    if snapshot['owner_id']!=context['owner_id'] or snapshot['project_id']!=context['project_id'] or snapshot['project']['client_id']!=context['client_id']:
        raise JobError('GRAPH_CONTEXT_CONFLICT')
    project=snapshot['project'];nodes={};edges=[]
    owner,project_id=context['owner_id'],context['project_id']
    def key(table,id):
        if str(UUID(id))!=id:raise JobError('INVALID_GRAPH_SOURCE')
        return table+':'+id
    def node(table,id,kind,props):
        k=key(table,id)
        nodes[k]={**{('business_kind' if k=='kind' else k):v for k,v in props.items() if v is not None},
                  'entity_key':k,'kind':kind,'owner_id':owner,'project_id':project_id,'source_id':id}
        return k
    def edge(source,kind,target,**props):
        if source not in nodes or target not in nodes:raise JobError('GRAPH_SOURCE_MISSING')
        e={'edge_key':source+'|'+kind+'|'+target,'source':source,'target':target,'kind':kind,**props}
        if not any(x['edge_key']==e['edge_key'] for x in edges):edges.append(e)
    pk=node('projects',project_id,'Project',{'title':project['name'],'status':project['status'],'client_name':project['client_name']})
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
    for row in snapshot['proposal_revisions']:
        rk=key('proposal_revisions',row['id']);edge(key('change_proposals',row['proposal_id']),'HAS_REVISION',rk)
        for field,rel,table in [('replaces_draft_id','REPLACES_DRAFT','proposal_revisions'),('feedback_document_id','REQUESTED_CHANGES_FROM','documents'),('base_acceptance_id','BASED_ON_ACCEPTANCE','proposal_acceptances')]:
            if row[field]:edge(rk,rel,key(table,row[field]))
    for row in snapshot['proposal_revision_sources']:
        edge(key('proposal_revisions',row['revision_id']),'SUPPORTED_BY',key('document_extractions',row['extraction_id']),document_sha256=row['document_sha256'],extraction_result_hash=row['extraction_result_hash'])
    for row in snapshot['proposal_artifacts']:edge(key('proposal_revisions',row['revision_id']),'HAS_PDF',key('documents',row['document_id']),sha256=row['sha256'])
    for row in snapshot['proposal_reviews']:
        k=key('proposal_reviews',row['revision_id']);edge(key('proposal_revisions',row['revision_id']),'HAS_REVIEW',k)
        edge(k,'REVIEWED_PDF',key('documents',row['addendum_document_id']),sha256=row['addendum_sha256'])
    for row in snapshot['proposal_acceptances']:
        k=key('proposal_acceptances',row['id']);edge(k,'ACCEPTS_REVISION',key('proposal_revisions',row['revision_id']))
        edge(k,'EVIDENCED_BY',key('documents',row['returned_document_id']),sha256=row['returned_sha256'])
    for table in ('proposal_deliveries','proposal_payments'):
        for row in snapshot[table]:
            k=key(table,row['id']);edge(k,'FOR_REVISION',key('proposal_revisions',row['revision_id']))
            if table=='proposal_payments':edge(k,'FOLLOWS_ACCEPTANCE',key('proposal_acceptances',row['acceptance_id']))
    for row in snapshot['project_agreement_heads']:
        if row['acceptance_id']:edge(pk,'CURRENT_ACCEPTANCE',key('proposal_acceptances',row['acceptance_id']))
    return {'nodes':list(nodes.values()),'edges':edges}


class GraphWriter:
    def __init__(self,driver,database):self.driver,self.database=driver,database

    @classmethod
    def from_env(cls):
        uri=os.environ.get('NEO4J_URI','');u=urlparse(uri)
        if u.scheme!='neo4j+s' or not u.hostname or not u.hostname.endswith('.databases.neo4j.io') or u.username or u.password:
            raise JobError('GRAPH_NOT_CONFIGURED')
        if not os.environ.get('NEO4J_PASSWORD'):raise JobError('GRAPH_NOT_CONFIGURED')
        return cls(GraphDatabase.driver(uri,auth=(os.environ.get('NEO4J_USERNAME','neo4j'),os.environ['NEO4J_PASSWORD']),
              connection_timeout=10,connection_acquisition_timeout=20,max_transaction_retry_time=0),os.environ.get('NEO4J_DATABASE','neo4j'))

    def sync(self,projection,context,generation,content_hash):
        owner,project=context['owner_id'],context['project_id']
        try:
            with self.driver.session(database=self.database) as session:
                # Constraint is idempotent and applies only to Trato-owned entities.
                session.run('CREATE CONSTRAINT trato_entity_key IF NOT EXISTS FOR (n:TratoEntity) REQUIRE n.entity_key IS UNIQUE').consume()
                with session.begin_transaction(timeout=45) as tx:
                    root=tx.run('MERGE (p:TratoEntity:Project {entity_key:$key}) ON CREATE SET p.owner_id=$owner,p.project_id=$project '
                                'SET p._graph_lock=coalesce(p._graph_lock,0)+1 RETURN p.generation AS generation,p.owner_id AS owner,p.project_id AS project',
                                key='projects:'+project,owner=owner,project=project).single()
                    if root['owner']!=owner or root['project']!=project:raise JobError('GRAPH_CONTEXT_CONFLICT')
                    if root['generation'] is not None and root['generation']>generation:raise JobError('STALE_GRAPH_GENERATION')
                    # Bounded project replacement is atomic, including removal of obsolete edges/nodes.
                    tx.run('MATCH (n:TratoEntity {owner_id:$owner,project_id:$project})-[r]->(m:TratoEntity {owner_id:$owner,project_id:$project}) DELETE r',owner=owner,project=project).consume()
                    for kind in sorted(KINDS):
                        rows=[n for n in projection['nodes'] if n['kind']==kind]
                        if rows:tx.run('UNWIND $rows AS row MERGE (n:TratoEntity:'+kind+' {entity_key:row.entity_key}) SET n=row,n.generation=$generation',rows=rows,generation=generation).consume()
                    for kind in sorted(RELATIONS):
                        rows=[e for e in projection['edges'] if e['kind']==kind]
                        if rows:tx.run('UNWIND $rows AS row MATCH (a:TratoEntity {entity_key:row.source,owner_id:$owner,project_id:$project}),'
                                      '(b:TratoEntity {entity_key:row.target,owner_id:$owner,project_id:$project}) '
                                      'MERGE (a)-[r:'+kind+' {edge_key:row.edge_key}]->(b) SET r=row,r.owner_id=$owner,r.project_id=$project',
                                      rows=rows,owner=owner,project=project).consume()
                    tx.run('MATCH (n:TratoEntity {owner_id:$owner,project_id:$project}) WHERE n.generation<>$generation DETACH DELETE n',owner=owner,project=project,generation=generation).consume()
                    tx.run('MATCH (p:TratoEntity {entity_key:$key,owner_id:$owner,project_id:$project}) SET p.content_hash=$hash,p.synced_at=datetime()',
                           key='projects:'+project,owner=owner,project=project,hash=content_hash).consume()
                    tx.commit()
        except (Neo4jError,DriverError):raise JobError('GRAPH_UNAVAILABLE') from None
        finally:self.driver.close()
