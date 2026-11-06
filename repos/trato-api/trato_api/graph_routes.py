"""Authorized graph reads. Never exposes Neo4j credentials or accepts Cypher."""
import os
from urllib.parse import urlparse
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from neo4j import GraphDatabase,READ_ACCESS,Query
from neo4j.exceptions import Neo4jError,DriverError
from .persistence import Repository,uuid
from .errors import ApiError


ROOT_QUERY = """MATCH (p:TratoEntity:Project {entity_key:$key,owner_id:$owner,project_id:$project,generation:$generation,content_hash:$hash,projection_version:$projection_version})
CALL (p) {
 MATCH (anchor:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})
 WHERE anchor.kind='Plan' OR (anchor.kind='Document' AND anchor.business_kind='email_request')
 WITH anchor ORDER BY anchor.created_at,anchor.entity_key
 RETURN collect({key:anchor.entity_key,id:anchor.source_id,scope:CASE WHEN anchor.kind='Plan' THEN 'plan' ELSE 'change' END,title:coalesce(anchor.title,'')}) AS scopes
}
"""
# These selectors are code-owned Cypher. Browser input is only a validated enum/UUID.
SELECTORS = {
 'all': """CALL (p) { MATCH (n:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation}) RETURN collect(n) AS chosen,true AS scope_found }""",
 'plan': """CALL (p) {
 OPTIONAL MATCH (anchor:TratoEntity:Plan {entity_key:$anchor,owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})
 OPTIONAL MATCH path=(anchor)-[:HAS_STAGE|DELIVERY_EVIDENCE|STAGE_PAYMENT|PAYMENT_EVIDENCE*0..3]->(n)
 WHERE all(item IN nodes(path) WHERE item.owner_id=p.owner_id AND item.project_id=p.project_id AND item.generation=p.generation)
 AND all(rel IN relationships(path) WHERE rel.owner_id=p.owner_id AND rel.project_id=p.project_id)
 WITH p,anchor,collect(DISTINCT n) AS reached
 RETURN CASE WHEN anchor IS NULL THEN [] ELSE [p]+reached END AS chosen,anchor IS NOT NULL AS scope_found
 }""",
 'change': """CALL (p) {
 OPTIONAL MATCH (anchor:TratoEntity:Document {entity_key:$anchor,owner_id:p.owner_id,project_id:p.project_id,generation:p.generation,business_kind:'email_request'})
 OPTIONAL MATCH path=(anchor)-[:RESPONDS_TO|HAS_REVISION|CURRENT_REVISION|FOR_REVISION|ACCEPTS_REVISION|HAS_REVIEW*0..4]-(n)
 WHERE all(item IN nodes(path) WHERE item.owner_id=p.owner_id AND item.project_id=p.project_id AND item.generation=p.generation)
 AND all(rel IN relationships(path) WHERE rel.owner_id=p.owner_id AND rel.project_id=p.project_id)
 WITH p,anchor,collect(DISTINCT n) AS core
 CALL (p,core) {
  UNWIND core AS origin
  OPTIONAL MATCH proof=(origin)-[:HAS_PDF|EVIDENCED_BY|REVIEWED_PDF|REQUESTED_CHANGES_FROM|BASED_ON_ACCEPTANCE|SUPPORTED_BY*1..2]->(evidence)
  WHERE all(item IN nodes(proof) WHERE item.owner_id=p.owner_id AND item.project_id=p.project_id AND item.generation=p.generation)
  AND all(rel IN relationships(proof) WHERE rel.owner_id=p.owner_id AND rel.project_id=p.project_id)
  RETURN collect(DISTINCT evidence) AS supporting
 }
 CALL (p,supporting) {
  UNWIND supporting AS extracted
  OPTIONAL MATCH (document:TratoEntity:Document {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})-[r:HAS_EXTRACTION]->(extracted)
  WHERE r.owner_id=p.owner_id AND r.project_id=p.project_id
  RETURN collect(DISTINCT document) AS originals
 }
 WITH anchor,CASE WHEN anchor IS NULL THEN [] ELSE [p]+core+supporting+originals END AS candidates
 CALL (candidates) { UNWIND candidates AS candidate RETURN collect(DISTINCT candidate) AS chosen }
 RETURN chosen,anchor IS NOT NULL AS scope_found
 }"""
}
RESULT_QUERY = """
CALL (p,chosen) {
 MATCH (a:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})-[r]->(b:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})
 WHERE a IN chosen AND b IN chosen AND r.owner_id=p.owner_id AND r.project_id=p.project_id
 RETURN collect(properties(r)) AS edges
}
RETURN [n IN chosen | properties(n)] AS nodes,edges,scopes,scope_found,toString(p.synced_at) AS synced_at
"""

def graph_scope(scope,request_id):
    if scope not in SELECTORS or (scope=='change')!=(request_id is not None):raise ApiError('INVALID_GRAPH_SCOPE',422)
    return uuid(request_id) if request_id is not None else None

class GraphReader:
    def read(self,owner,project,state,scope='all',request_id=None):
        request_id=graph_scope(scope,request_id)
        uri=os.environ.get('NEO4J_URI','');parsed=urlparse(uri)
        if parsed.scheme!='neo4j+s' or not parsed.hostname or not parsed.hostname.endswith('.databases.neo4j.io') or not os.environ.get('NEO4J_PASSWORD'):
            raise ApiError('GRAPH_NOT_CONFIGURED',503)
        try:
            with GraphDatabase.driver(uri,auth=(os.environ.get('NEO4J_USERNAME','neo4j'),os.environ['NEO4J_PASSWORD']),
                    connection_timeout=10,connection_acquisition_timeout=20,max_transaction_retry_time=0) as driver:
                with driver.session(database=os.environ.get('NEO4J_DATABASE','neo4j'),default_access_mode=READ_ACCESS) as session:
                    row=session.run(Query(ROOT_QUERY+SELECTORS[scope]+RESULT_QUERY,timeout=15),key='projects:'+project,owner=owner,project=project,
                        generation=state['generation'],hash=state['content_hash'],projection_version=2,anchor='documents:'+request_id if request_id else 'project_start_plans:'+project).single()
                    if row is None:raise ApiError('GRAPH_STALE',409)
                    if not row['scope_found']:raise ApiError('GRAPH_SCOPE_NOT_FOUND',404)
                    if len(row['nodes'])>2000 or len(row['edges'])>5000 or len(row['scopes'])>2000:raise ApiError('GRAPH_VIEW_TOO_LARGE',422)
                    nodes=[{k:v for k,v in node.items() if k not in ('synced_at','_graph_lock')} for node in row['nodes']]
                    return {'nodes':nodes,'edges':row['edges'],'scopes':row['scopes'],'scope':{'kind':scope,'request_id':request_id},'synced_at':row['synced_at'],'generation':state['generation']}
        except (Neo4jError,DriverError):raise ApiError('GRAPH_UNAVAILABLE',503) from None


def build_graph_router(settings,require_user,repository_factory=None,reader=None):
    router=APIRouter(prefix='/api/v1/projects')
    def repository(request:Request,user=Depends(require_user)):
        return (repository_factory or Repository)(settings,request.headers.get('authorization',''))
    @router.post('/{project_id}/graph/sync')
    def sync(project_id:str,repo=Depends(repository)):
        value=repo.rpc('project_graph',{'p_project_id':uuid(project_id),'p_action':'sync'})
        return JSONResponse({'data':value},status_code=200 if value['status']=='ready' else 202,headers={'Cache-Control':'no-store'})
    @router.get('/{project_id}/graph')
    def graph(project_id:str,scope:str='all',request_id:str|None=None,user=Depends(require_user),repo=Depends(repository)):
        project=uuid(project_id)
        request_id=graph_scope(scope,request_id)
        before=repo.rpc('project_graph',{'p_project_id':project,'p_action':'state'})
        if before['status']!='ready' or not before.get('current'):raise ApiError('GRAPH_STALE',409)
        value=(reader or GraphReader()).read(user,project,before,scope,request_id)
        after=repo.rpc('project_graph',{'p_project_id':project,'p_action':'state'})
        if before!=after:raise ApiError('GRAPH_STALE',409)
        return JSONResponse({'data':value},headers={'Cache-Control':'no-store'})
    return router
