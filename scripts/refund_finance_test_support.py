"""Explicit integration: real disposable PostgreSQL + real finance workflow + fake PayPal.

No HTTP, credentials, financial provider, shared DB or application service is used.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import re
import subprocess
import sys
from threading import Barrier,Lock
from uuid import uuid4

ROOT=Path(__file__).resolve().parent.parent
sys.path[:0]=[str(ROOT/'repos/trato-api'),str(ROOT/'backend')]
from paypal.client import PayPalError
from trato_api.errors import ApiError
from trato_api.refunds.financial import RefundFinance

parser=argparse.ArgumentParser()
parser.add_argument('--psql',required=True);parser.add_argument('--socket',required=True)
parser.add_argument('--state-file');parser.add_argument('--verify-state',action='store_true')
args=parser.parse_args()
if not Path(args.socket).resolve().is_relative_to('/tmp/trato-refunds-pg'):raise SystemExit('Only the disposable Trato socket is allowed')

def literal(value):return "'"+str(value).replace("'","''")+"'"
def sql(body,owner=None):
    if owner:body="begin;set local role authenticated;select set_config('request.jwt.claim.sub',"+literal(owner)+",true);"+body+';commit;'
    result=subprocess.run([args.psql,'-X','-qAt','-h',args.socket,'-d','trato_refunds_test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=body,text=True,capture_output=True,timeout=25)
    if result.returncode:
        match=re.search(r'ERROR:\s+(?:PT(\d{3}):\s+)?([A-Z_]+)',result.stderr)
        if match:raise ApiError(match[2],int(match[1] or 500))
        raise AssertionError(result.stderr)
    lines=result.stdout.strip().splitlines()
    return lines[-1] if lines else ''
if sql("select current_setting('trato.refund_test',true)")!='isolated':raise SystemExit('Isolated database marker required')

def persisted_state():
    return {table:json.loads(sql("select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from public."+table+' x')) for table in ['refund_financial_authorizations','refund_financial_operations','refund_financial_attempts','refund_financial_runs','refund_provider_receipts','refund_receipt_applications','refund_recovery_checks','refund_recovery_consents','refund_financial_incidents']}
state_path=Path(args.state_file) if args.state_file else None
if state_path and not state_path.resolve().is_relative_to('/tmp/trato-refunds-pg'):raise SystemExit('State file must remain inside the disposable directory')
if args.verify_state:
    if not state_path or persisted_state()!=json.loads(state_path.read_text()):raise SystemExit('Persisted financial evidence changed')
    print('PASS: financial authorizations, attempts, receipts, applications, consents, incidents and reservations survived restart');raise SystemExit(0)

def fixture(multi=True,zero=False):
    path=ROOT/'repos/trato-api/supabase/tests/fixtures/refund_financial_fixture.sql'
    return json.loads(sql('\\ir '+literal(path)+'\nselect pg_temp.refund_financial_fixture('+('true' if multi else 'false')+','+('true' if zero else 'false')+');'))
class Store:
    def __init__(self):self.fail_after_result=False
    def command(self,owner,action,data):
        result=json.loads(sql('set role service_role;select public.refund_finance_backend('+literal(owner)+','+literal(action)+','+literal(json.dumps(data))+'::jsonb);'))
        if action=='result' and self.fail_after_result:
            self.fail_after_result=False;raise ApiError('PERSISTENCE_UNAVAILABLE',503)
        return result
    def receipt(self,owner,payment,evidence,attempt=None):
        return json.loads(sql('set role service_role;select public.refund_receipt_backend('+literal(owner)+','+literal(payment)+','+literal(json.dumps(evidence))+'::jsonb,'+(literal(attempt)+'::uuid' if attempt else 'null')+');'))
    def webhook(self,action,data):
        return json.loads(sql('set role service_role;select public.refund_webhook_backend('+literal(action)+','+literal(json.dumps(data))+'::jsonb);'))
class Repo:
    def __init__(self,f):self.f=f
    def settlement(self,parent):
        value=sql('select coalesce((select to_jsonb(r) from public.refund_settlements r where id='+literal(parent)+'::uuid),\'{}\'::jsonb)',self.f['owner'])
        result=json.loads(value)
        if not result:raise ApiError('REFUND_NOT_FOUND',404)
        return result
    def authorize(self,body,key):return json.loads(sql('select public.refund_financial_authorize('+literal(json.dumps(body))+'::jsonb,'+literal(key)+')',self.f['owner']))
    def view(self):return json.loads(sql('select public.refund_financial('+literal(self.f['parent'])+'::uuid)',self.f['owner']))
class Provider:
    def __init__(self,context,mode='complete'):
        self.payments=context['received_payments'];self.merchant_id=self.payments[0]['merchant_id'];self.records={};self.posts=[];self.mode=mode;self.lock=Lock()
    @staticmethod
    def money(value):return {'currency_code':'USD','value':f'{value//100}.{value%100:02d}'}
    def order_id(self,p):return p['order_id'] or 'TESTORDER'+str(self.payments.index(p)).zfill(8)
    def get_capture(self,id):
        p=next(p for p in self.payments if p['capture_id']==id);amount=p['amount_minor']
        return {'id':id,'status':'COMPLETED','create_time':(datetime.now(timezone.utc)-timedelta(days=1)).isoformat(),'amount':self.money(amount),
         'supplementary_data':{'related_ids':{'order_id':self.order_id(p)}},
         'seller_receivable_breakdown':{'gross_amount':self.money(amount),'paypal_fee':self.money(100),'net_amount':self.money(amount-100)}}
    def get_order(self,id):
        p=next(p for p in self.payments if self.order_id(p)==id)
        return {'id':id,'intent':'CAPTURE','status':'COMPLETED','purchase_units':[{'reference_id':p['expected_reference'],'custom_id':p['expected_reference'],
         'payee':{'merchant_id':self.merchant_id},'amount':self.money(p['amount_minor']),'payments':{'captures':[{'id':p['capture_id']}]}}]}
    def refund_capture(self,capture,payload,request_id):
        with self.lock:
            self.posts.append((capture,deepcopy(payload),request_id));n=len(self.posts)
            if self.mode=='timeout':raise PayPalError('PAYPAL_UNAVAILABLE',uncertain=True)
            if self.mode=='crash':raise RuntimeError('Simulated process crash after dispatch')
            if self.mode=='rejected' and n==2:raise PayPalError('PAYPAL_REFUND_AUTH_REJECTED',definitive=True,http_status=403)
            rid='SYNTHETIC-'+uuid4().hex;state='PENDING' if self.mode=='pending' and n==2 else 'FAILED' if self.mode=='canonical_failed' else 'CANCELLED' if self.mode=='canonical_cancelled' else 'COMPLETED'
            record={'id':rid,'status':state,'amount':deepcopy(payload['amount']),'custom_id':payload['custom_id'],
             'links':[{'rel':'up','href':'https://api-m.sandbox.paypal.com/v2/payments/captures/'+capture}]}
            if self.mode=='wrong_capture':record['links'][0]['href']+='FOREIGN'
            self.records[rid]=record
            return [] if self.mode=='malformed' else {'id':rid,'status':state}
    def get_refund(self,id):return deepcopy(self.records[id])

def prepared(mode='complete',multi=True,zero=False):
    f=fixture(multi,zero);repo=Repo(f);store=Store();context=store.command(f['owner'],'context',{'settlement_id':f['parent']});provider=Provider(context,mode)
    flow=RefundFinance(None,store=store,paypal=provider)
    check=flow.check(repo,f['owner'],f['parent'],f['snapshot'])['check']
    body={'settlement_id':f['parent'],'expected_snapshot_id':f['snapshot'],'check_id':check['id'],'digest':check['digest'],'confirmed':True,'notes':'Financial test authorization'}
    return f,repo,store,provider,flow,body

def authorized(mode='complete',multi=True,zero=False):
    f,repo,store,provider,flow,body=prepared(mode,multi,zero)
    view=repo.authorize(body,'authorize');auth=view['authorizations'][0]['id']
    return f,repo,store,provider,flow,auth
