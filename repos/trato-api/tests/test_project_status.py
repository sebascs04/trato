import json,unittest
from unittest.mock import Mock
from trato_api.errors import ApiError
from trato_api.project_status import status_source
from trato_api.refund_assistant import financial_facts

PROJECT={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','name':'Website'}
class Repo:
    def __init__(self,tables):self.tables=tables;self.calls=[]
    def rows(self,table,params):
        # Every read is scoped to owner and project: it runs with the server repository (no signed-in user).
        self.calls.append((table,params));assert params['owner_id']=='eq.owner' and params['project_id']=='eq.'+PROJECT['id']
        return self.tables.get(table,[])
    def rpc(self,name,data):raise AssertionError('status must not depend on RPCs that need a signed-in user: '+name)

class ProjectStatusTests(unittest.TestCase):
    def test_changes_and_plan_payments_are_owner_scoped_verified_records(self):
        repo=Repo({'documents':[{'id':'req','title':'Pequeña tienda','created_at':'2026-11-05T10:00:00Z'}],
            'change_proposals':[{'id':'prop','request_document_id':'req','status':'accepted','locked_at':'2026-11-06T10:00:00Z'}],
            'proposal_revisions':[{'id':'r1','proposal_id':'prop','revision_no':1,'scope_summary':'Tienda 10 productos','conditions':'Sin inventario','currency':'USD','additional_minor':24000,'deadline':'2026-11-25'},
                                  {'id':'r2','proposal_id':'prop','revision_no':2,'scope_summary':'Tienda 5 productos','conditions':'Sin inventario','currency':'USD','additional_minor':18000,'deadline':'2026-11-23'}],
            'proposal_deliveries':[{'revision_id':'r1','kind':'adenda','updated_at':'2026-11-05T11:00:00Z'},{'revision_id':'r2','kind':'adenda','updated_at':'2026-11-05T12:00:00Z'}],
            'proposal_acceptances':[{'revision_id':'r2','created_at':'2026-11-05T13:00:00Z'}],
            'proposal_payments':[{'revision_id':'r2','amount_minor':18000,'currency':'USD','updated_at':'2026-11-06T10:00:00Z'}],
            'project_start_plans':[{'currency':'USD'}],'project_start_stages':[{'position':1,'title':'Design','amount':'180.00'},{'position':2,'title':'Build','amount':'300.00'}],
            'project_initial_checkouts':[{'stage_position':1,'status':'completed','paid_at':'2026-11-06T07:29:00Z'},{'stage_position':2,'status':'pending_approval','paid_at':None}]})
        record=status_source(repo,'owner',PROJECT);value=json.loads(record['text'])
        change=value['change_requests'][0]
        self.assertEqual([v['additional_amount'] for v in change['versions']],['USD 240.00','USD 180.00'])
        self.assertIsNone(change['versions'][0]['accepted_by_client_recorded_at']);self.assertEqual(change['versions'][1]['verified_payment']['amount'],'USD 180.00')
        self.assertTrue(change['read_only_after_payment'])
        self.assertEqual([s['payment'] for s in value['initial_plan_deliverable_payments']],['verified','not_paid'])
        self.assertEqual((record['source_kind'],record['file_id']),('status',PROJECT['id']))
        # A pending checkout is never reported as paid, and the source is bound to its exact content.
        self.assertIsNone(value['initial_plan_deliverable_payments'][1]['paid_at'])
        self.assertNotEqual(status_source(Repo({}),'owner',PROJECT)['source_id'],record['source_id'])

    def test_request_without_proposal_is_reported_without_inventing_versions(self):
        record=status_source(Repo({'documents':[{'id':'req','title':'Logo nuevo','created_at':'2026-11-05T10:00:00Z'}]}),'owner',PROJECT)
        change=json.loads(record['text'])['change_requests'][0]
        self.assertEqual((change['proposal_status'],change['versions']),('no_proposal_yet',[]))

    def test_refund_facts_only_use_confirmed_receipts_applied_to_the_selected_case(self):
        parent={'id':'refund','status':'refund_pending','current_snapshot_id':'snapshot','confirmed_refund_minor':0}
        scope={**parent,'project_id':PROJECT['id'],'owner_id':'owner'}
        receipts=[
            {'id':'matched','payment_id':'pay','status':'completed','amount_minor':1250,'confirmed_at':'2026-11-08T00:00:00Z',
             'environment':'sandbox','capture_id':'private-capture'},
            {'id':'unapplied','payment_id':'pay','status':'completed','amount_minor':800,'confirmed_at':None,'environment':'sandbox'},
        ]
        lookup=Mock(return_value={
            'settlement':scope,'receipts':receipts,
            'applications':[{'settlement_id':'refund','receipt_id':'matched','operation_id':'op'},
                            {'settlement_id':'another','receipt_id':'unapplied','operation_id':'op'}],
            'operations':[{'id':'op','payment_id':'pay','status':'pending','amount_minor':2500}],
            'incidents':[{'payment_id':'pay','code':'PAYPAL_CAPTURE_REVERSED','created_at':'today','reference':'private-capture'}],
        })
        facts=financial_facts(lookup,'owner',PROJECT,parent,[{'id':'pay'}])
        lookup.assert_called_once_with('refund_finance_backend',{'p_owner':'owner','p_action':'context','p_data':{'settlement_id':'refund'}})
        self.assertEqual(facts['confirmed_minor'],1250)
        self.assertEqual(facts['operations'][0]['confirmed_environments'],['sandbox'])
        self.assertNotIn('private-capture',json.dumps(facts))
        self.assertFalse(facts['provider_disputes_available'])
        lookup.return_value['settlement']={**scope,'project_id':'another'}
        with self.assertRaises(ApiError):financial_facts(lookup,'owner',PROJECT,parent,[{'id':'pay'}])
