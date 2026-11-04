from contextlib import contextmanager
from copy import deepcopy
from hashlib import sha256
import os
from types import SimpleNamespace as NS
from unittest import TestCase
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from file_processor.reference_vectors import (ReferenceFile, ReferenceVectors, build_reference_router,
    records_for, contextual_hit)
from file_processor.vector_contract import PROFILE_ID
from file_processor.vector_store import WeaviateStore, VectorError

FILE='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
SCOPE='a'*64
TEXT='Información útil para negociar. '*70

def source():
    return {'file_id':FILE,'text_sha256':sha256(TEXT.encode()).hexdigest(),
        'segments':[{'segment_id':'page-1','locator':{'kind':'page','page':1},'text':TEXT}]}

def rows():return records_for(ReferenceFile.model_validate(source()),SCOPE)

class Store:
    def __init__(self):self.calls=[];self.error=None
    def write_references(self,scope,file_id,records):
        self.calls.append(('write',scope,file_id,records))
        if self.error:raise VectorError(self.error,503)
        return {'objects':len(records),'embedding_identity':PROFILE_ID}
    def reference_counts(self,*args):self.calls.append(('counts',*args))
    def search_references(self,*args):
        self.calls.append(('search',*args));r=rows()
        return [{'hit':dict(r[1],score=.8),'neighbors':r}]

@patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'true'})
class ReferenceTests(TestCase):
    def setUp(self):
        self.store=Store();app=FastAPI()
        app.include_router(build_reference_router('private-token',ReferenceVectors(self.store)))
        self.client=TestClient(app);self.headers={'Authorization':'Bearer private-token'}
        self.index={'scope_id':SCOPE,'files':[source()]}
        self.search={'scope_id':SCOPE,'file_ids':[FILE],'expected_chunks':{FILE:len(rows())},'query':'negociar'}
    def post(self,route,body):return self.client.post('/v1/references/'+route,json=body,headers=self.headers)
    def test_index_receipt_and_exact_context_offsets(self):
        response=self.post('index',self.index)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['data']['file_chunks'],{FILE:len(rows())})
        result=self.post('search',self.search).json()['data']['hits'][0]
        self.assertEqual(result['text'],TEXT[result['start_char']:result['end_char']])
        self.assertEqual(result['text_sha256'],sha256(result['text'].encode()).hexdigest())
        self.assertFalse({'owner_id','project_id','tenant'} & result.keys())
    def test_auth_and_feature_flag_fail_before_store(self):
        for headers in ({},{'Authorization':'Bearer user-jwt'}):
            self.assertEqual(self.client.post('/v1/references/search',json=self.search,headers=headers).status_code,401)
        with patch.dict(os.environ,{'TRATO_VECTOR_SEARCH_ENABLED':'false'}):
            self.assertEqual(self.post('search',self.search).status_code,503)
        self.assertEqual(self.store.calls,[])
    def test_scope_fields_cannot_be_injected_and_counts_are_strict(self):
        for extra in ({'tenant':'projects_private'},{'owner_id':OTHER},
                      {'expected_chunks':{OTHER:3}},{'expected_chunks':{FILE:True}}):
            self.assertEqual(self.post('search',{**self.search,**extra}).status_code,422)
        self.assertEqual(self.store.calls,[])
    def test_source_hash_duplicate_and_provider_failure(self):
        bad=deepcopy(self.index);bad['files'][0]['text_sha256']='b'*64
        self.assertEqual(self.post('index',bad).status_code,422)
        self.assertEqual(self.post('index',{**self.index,'files':[source(),source()]}).status_code,422)
        self.store.error='VECTOR_BATCH_FAILED'
        result=self.post('index',self.index)
        self.assertEqual(result.status_code,503)
        self.assertEqual(result.json()['error']['code'],'VECTOR_BATCH_FAILED')
        self.assertFalse(any(call[0]=='counts' for call in self.store.calls))
    def test_all_files_prepared_before_writing(self):
        bad=source();bad['file_id']=OTHER
        bad['segments']=[{'segment_id':str(i),'text':'a','locator':{'kind':'page','page':i+1}} for i in range(513)]
        bad['text_sha256']=sha256('\n\n'.join('a' for _ in range(513)).encode()).hexdigest()
        response=self.post('index',{**self.index,'files':[source(),bad]})
        self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(response.json()['error']['code'],'REFERENCE_INPUT_LIMIT')
        self.assertEqual(self.store.calls,[])
    def test_foreign_file_generation_segment_and_tamper_rejected(self):
        r=rows();hit=dict(r[1],score=.9)
        for field,value in [('file_id',OTHER),('generation','b'*64),('segment_id','page-2'),('chunk_text','tampered')]:
            foreign=deepcopy(r);foreign[0]['properties'][field]=value
            with self.assertRaises(VectorError):contextual_hit(hit,foreign,SCOPE,[FILE],1)
    def test_no_neighbor_and_invalid_metadata(self):
        r=rows();hit=dict(r[1],score=.9)
        result=contextual_hit(hit,[hit],SCOPE,[FILE],0)
        self.assertEqual(result['text'],hit['properties']['chunk_text'])
        for bad in [dict(hit,score=float('nan')),dict(hit,properties={**hit['properties'],'owner_id':OTHER})]:
            with self.assertRaises(VectorError):contextual_hit(bad,[bad],SCOPE,[FILE],0)

class AdapterTests(TestCase):
    def test_real_adapter_fixed_tenant_filters_and_pre_post_counts(self):
        captured=[];counts=[];selected=[];r=rows()
        objects=[NS(uuid=x['id'],properties=x['properties'],metadata=NS(score=.8)) for x in r]
        def hybrid(**kwargs):captured.append(kwargs);return NS(objects=[objects[1]])
        def aggregate(**kwargs):counts.append(kwargs);return NS(total_count=len(r))
        col=NS(query=NS(hybrid=hybrid,fetch_objects=lambda **kw:NS(objects=objects)),
               aggregate=NS(over_all=aggregate))
        def tenant(name):selected.append(name);return col
        base=NS(tenants=NS(get=lambda:{'references_shared':{}}),with_tenant=tenant)
        client=NS(collections=NS(use=lambda name:base))
        class LocalStore(WeaviateStore):
            @contextmanager
            def connection(self):yield client
            def validate(self,client):pass
        result=LocalStore().search_references(SCOPE,[FILE],{FILE:len(r)},'negotiation',6,1)
        self.assertEqual(selected,['references_shared']);self.assertEqual(len(counts),2)
        self.assertEqual(captured[0]['alpha'],.7)
        self.assertEqual(captured[0]['query_properties'],['chunk_text'])
        def values(item):
            if hasattr(item,'__dict__'):return values(vars(item))
            if isinstance(item,dict):return {k:values(v) for k,v in item.items()}
            if isinstance(item,list):return [values(v) for v in item]
            return str(item)
        filters=str(values(captured[0]['filters']))
        self.assertIn(FILE,filters);self.assertIn(SCOPE,filters)
        self.assertEqual(len(result[0]['neighbors']),len(r))

    def test_incomplete_index_prevents_hybrid_search(self):
        aggregate=NS(over_all=lambda **kw:NS(total_count=0))
        col=NS(aggregate=aggregate)
        base=NS(tenants=NS(get=lambda:{'references_shared':{}}),with_tenant=lambda name:col)
        client=NS(collections=NS(use=lambda name:base))
        class LocalStore(WeaviateStore):
            @contextmanager
            def connection(self):yield client
            def validate(self,client):pass
        with self.assertRaises(VectorError) as caught:
            LocalStore().search_references(SCOPE,[FILE],{FILE:3},'negotiation',6,1)
        self.assertEqual(caught.exception.code,'REFERENCE_INDEX_INCOMPLETE')

    def test_missing_tenant_is_not_created_during_search(self):
        client=NS(collections=NS(use=lambda name:NS(tenants=NS(get=lambda:{}))))
        class LocalStore(WeaviateStore):
            @contextmanager
            def connection(self):yield client
            def validate(self,client):pass
        with self.assertRaises(VectorError) as caught:
            LocalStore().search_references(SCOPE,[FILE],{FILE:3},'negotiation',6,1)
        self.assertEqual(caught.exception.code,'VECTOR_TENANT_NOT_CONFIGURED')
