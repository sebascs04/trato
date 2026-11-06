import unittest
from trato_api.errors import ApiError
from trato_api.refunds.activity import QUERIES,milestones
from trato_api.persistence import Repository
from trato_api.app import Settings
import httpx

T='2026-11-02T12:00:00Z'

def activity_data():
    data={name:[] for name in QUERIES}
    data.update(refunds=[{'id':'refund','reason':'Razón original del cliente','status':'completed','created_at':T,'closed_at':T}],
        refund_snapshots=[{'id':'s1','settlement_id':'refund','version_no':1},{'id':'draft-2','settlement_id':'refund','version_no':1}],
        refund_deliveries=[{'id':'sent','settlement_id':'refund','snapshot_id':'s1','updated_at':T}],
        refund_feedback=[{'settlement_id':'refund','snapshot_id':'s1','created_at':T}],
        refund_acceptances=[{'settlement_id':'refund','snapshot_id':'s1','created_at':T}],
        refund_authorizations=[{'id':'auth','settlement_id':'refund','snapshot_id':'s1','created_at':T}],
        refund_receipts=[{'id':'receipt','payment_id':'payment','amount_minor':20000,'currency':'USD','confirmed_at':T}],
        refund_applications=[{'id':'app','receipt_id':'receipt','settlement_id':'refund'}])
    return data

class RefundActivityTests(unittest.TestCase):
    def test_only_business_milestones_and_one_money_event(self):
        events=milestones(activity_data())
        self.assertEqual(len(events),7)
        money=[e for e in events if 'amount_minor' in e];self.assertEqual(len(money),1)
        self.assertEqual(money[0]['id'],'refund-money-receipt');self.assertEqual(money[0]['amount_minor'],20000)
        self.assertTrue(all(e['group_kind']=='refund' and e['group_id']=='refund' and e['request_document_id'] is None for e in events))
        self.assertTrue(all(e['group_title']=='Razón original del cliente' for e in events))
        self.assertFalse(any('draft' in e['id'] for e in events))

    def test_external_to_local_application_keeps_stable_movement_identity(self):
        data=activity_data();data['refund_applications']=[]
        first=next(e for e in milestones(data) if e['kind']=='refund_completed')
        self.assertEqual(first['group_id'],'payment-payment');self.assertIsNone(first['group_title'])
        data['refund_applications']=[{'id':'app','receipt_id':'receipt','settlement_id':'refund'}]
        second=next(e for e in milestones(data) if e['kind']=='refund_completed')
        self.assertEqual(first['id'],second['id']);self.assertEqual(first['amount_minor'],second['amount_minor'])
        self.assertEqual(second['group_id'],'refund')

    def test_missing_snapshot_or_parent_is_a_visible_context_error(self):
        for name in ['refunds','refund_snapshots']:
            data=activity_data();data[name]=[]
            with self.assertRaises(ApiError):milestones(data)

    def test_activity_queries_paginate_every_table_and_keep_owner_jwt(self):
        project='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';calls=[]
        docs=[{'id':f'd{i:04}','title':'Request '+str(i),'created_at':T} for i in range(1001)]
        def transport(request):
            table=request.url.path.rsplit('/',1)[-1];calls.append(request)
            if table=='projects':return httpx.Response(200,json=[{'id':project,'name':'Project','created_at':T}])
            self.assertEqual(request.headers['authorization'],'Bearer owner-token')
            self.assertEqual(request.url.params['project_id'],'eq.'+project)
            if table=='documents' and request.url.params['kind']=='eq.email_request':
                start=int(request.url.params['offset']);return httpx.Response(200,json=docs[start:start+int(request.url.params['limit'])])
            return httpx.Response(200,json=[])
        repo=Repository(Settings(supabase_url='https://test.invalid',supabase_key='public'),'Bearer owner-token',transport=httpx.MockTransport(transport))
        events=repo.activity(project);changes=[e for e in events if e['group_kind']=='change']
        self.assertEqual(len(changes),1001)
        self.assertEqual([e['kind'] for e in events if e['group_kind']=='project'],['project_created'])
        self.assertEqual([int(r.url.params['offset']) for r in calls if r.url.path.endswith('/documents') and r.url.params['kind']=='eq.email_request'],[0,500,1000])
        self.assertTrue(all(e['group_id']==e['request_document_id'] for e in changes))
        self.assertEqual(len({e['id'] for e in changes}),1001)
