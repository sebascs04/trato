"""Authorized graph reads. Never exposes Neo4j credentials or accepts Cypher."""
import os
from urllib.parse import urlparse
from fastapi import APIRouter,Depends,Request
from fastapi.responses import JSONResponse
from neo4j import GraphDatabase,READ_ACCESS
from neo4j.exceptions import Neo4jError,DriverError
from .persistence import Repository,uuid
from .errors import ApiError


class GraphReader:
    def read(self,owner,project,state):
        uri=os.environ.get('NEO4J_URI','');parsed=urlparse(uri)
        if parsed.scheme!='neo4j+s' or not parsed.hostname or not parsed.hostname.endswith('.databases.neo4j.io') or not os.environ.get('NEO4J_PASSWORD'):
            raise ApiError('GRAPH_NOT_CONFIGURED',503)
        try:
            with GraphDatabase.driver(uri,auth=(os.environ.get('NEO4J_USERNAME','neo4j'),os.environ['NEO4J_PASSWORD']),
                    connection_timeout=10,connection_acquisition_timeout=20,max_transaction_retry_time=0) as driver:
                with driver.session(database=os.environ.get('NEO4J_DATABASE','neo4j'),default_access_mode=READ_ACCESS) as session:
                    row=session.run('''MATCH (p:TratoEntity:Project {entity_key:$key,owner_id:$owner,project_id:$project,generation:$generation,content_hash:$hash})
                    CALL (p) { MATCH (n:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation}) RETURN collect(properties(n)) AS nodes }
                    CALL (p) { MATCH (a:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})-[r]->(b:TratoEntity {owner_id:p.owner_id,project_id:p.project_id,generation:p.generation})
                    WHERE r.owner_id=p.owner_id AND r.project_id=p.project_id RETURN collect(properties(r)) AS edges }
                    RETURN nodes,edges,toString(p.synced_at) AS synced_at''',key='projects:'+project,owner=owner,project=project,
                    generation=state['generation'],hash=state['content_hash'],timeout=15).single()
                    if row is None:raise ApiError('GRAPH_STALE',409)
                    if len(row['nodes'])>2000 or len(row['edges'])>5000:raise ApiError('GRAPH_VIEW_TOO_LARGE',422)
                    nodes=[{k:v for k,v in node.items() if k not in ('synced_at','_graph_lock')} for node in row['nodes']]
                    return {'nodes':nodes,'edges':row['edges'],'synced_at':row['synced_at'],'generation':state['generation']}
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
    def graph(project_id:str,user=Depends(require_user),repo=Depends(repository)):
        project=uuid(project_id)
        before=repo.rpc('project_graph',{'p_project_id':project,'p_action':'state'})
        if before['status']!='ready' or not before.get('current'):raise ApiError('GRAPH_STALE',409)
        value=(reader or GraphReader()).read(user,project,before)
        after=repo.rpc('project_graph',{'p_project_id':project,'p_action':'state'})
        if before!=after:raise ApiError('GRAPH_STALE',409)
        return JSONResponse({'data':value},headers={'Cache-Control':'no-store'})
    return router
