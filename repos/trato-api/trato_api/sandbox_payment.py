"""Explicit USD0.10 sandbox connectivity test; never a contractual acceptance.

Local single-process diagnostic store. It does not mark any project/change paid.
"""
import os
from pathlib import Path
import sqlite3
import threading
from uuid import UUID,uuid4

from paypal.client import PayPalSandboxClient,PaymentInstruction,PayPalError
from paypal.config import SandboxSettings


class SandboxPaymentTest:
    AMOUNT='0.10'
    def __init__(self,settings,path,*,client=None):
        if settings.environment!='sandbox' or settings.missing():raise PayPalError('PAYPAL_SANDBOX_NOT_CONFIGURED',status=503)
        self.settings=settings
        self.client=client or PayPalSandboxClient(settings.client_id,settings.client_secret,settings.merchant_id)
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if self.path.is_symlink():raise PayPalError('INVALID_TEST_STORE',status=503)
        fd=os.open(self.path,os.O_RDWR|os.O_CREAT,0o600);os.close(fd);os.chmod(self.path,0o600)
        self.lock=threading.RLock()
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS sandbox_payment_tests(
                id TEXT PRIMARY KEY,owner TEXT NOT NULL,command_key TEXT NOT NULL,
                merchant TEXT NOT NULL,amount TEXT NOT NULL CHECK(amount='0.10'),
                status TEXT NOT NULL,order_id TEXT,approval_url TEXT,capture_id TEXT,
                capture_attempted INTEGER NOT NULL DEFAULT 0,error_code TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(owner,command_key))''')
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS sandbox_single_test_per_owner ON sandbox_payment_tests(owner)")
    def db(self):
        db=sqlite3.connect(self.path,timeout=5);db.row_factory=sqlite3.Row;return db
    def get(self,owner,id):
        try:id=str(UUID(id))
        except (ValueError,TypeError,AttributeError):raise PayPalError('INVALID_TEST_ID',status=422)
        with self.db() as db:row=db.execute('SELECT * FROM sandbox_payment_tests WHERE owner=? AND id=?',(owner,id)).fetchone()
        if not row:raise PayPalError('PAYMENT_NOT_FOUND',status=404)
        return dict(row)
    def latest(self,owner):
        with self.db() as db:row=db.execute('SELECT * FROM sandbox_payment_tests WHERE owner=? ORDER BY rowid DESC LIMIT 1',(owner,)).fetchone()
        return dict(row) if row else None
    @staticmethod
    def public(record):
        return {**{key:record[key] for key in ['id','amount','status','order_id','approval_url','capture_id','error_code','updated_at']},'currency':'USD','environment':'sandbox','purpose':'connection_test'}
    def instruction(self,record):
        return PaymentInstruction(record['id'],record['amount'],'USD',record['merchant'])
    def uncertain(self,record,error):
        with self.db() as db:
            db.execute("UPDATE sandbox_payment_tests SET status='reconciliation_required',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner=? AND status<>'completed'",(error.code,record['id'],record['owner']))
    def apply(self,record,order):
        status=self.client.validate_order(order,self.instruction(record))
        if record['order_id'] and order['id']!=record['order_id']:raise PayPalError('PAYMENT_EVIDENCE_MISMATCH',status=409,uncertain=True)
        captures=order['purchase_units'][0].get('payments',{}).get('captures',[])
        with self.db() as db:
            # No stale poll/callback can downgrade a completed test.
            db.execute('''UPDATE sandbox_payment_tests SET status=?,order_id=?,approval_url=?,capture_id=?,error_code=NULL,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND owner=? AND status<>'completed' ''',(status,order['id'],self.client.approval_url(order),captures[0]['id'] if captures else None,record['id'],record['owner']))
        return self.get(record['owner'],record['id'])
    def create(self,owner,key):
        if not isinstance(key,str) or not 1<=len(key)<=128 or any(ord(c)<33 or ord(c)>126 for c in key):raise PayPalError('INVALID_IDEMPOTENCY_KEY',status=422)
        with self.lock:
            id=str(uuid4())
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                existing=db.execute('SELECT * FROM sandbox_payment_tests WHERE owner=?',(owner,)).fetchone()
                if existing:return dict(existing)
                db.execute("INSERT INTO sandbox_payment_tests(id,owner,command_key,merchant,amount,status) VALUES(?,?,?,?,?,'creating')",(id,owner,key,self.settings.merchant_id,self.AMOUNT))
                row=dict(db.execute('SELECT * FROM sandbox_payment_tests WHERE id=?',(id,)).fetchone())
            try:
                order=self.client.create_order(self.instruction(row),'t-'+UUID(row['id']).hex,self.settings.return_url,self.settings.cancel_url)
                return self.apply(row,order)
            except PayPalError as error:
                self.uncertain(row,error);raise
    def reconcile(self,owner,id):
        with self.lock:
            row=self.get(owner,id)
            if not row['order_id']:raise PayPalError('ORDER_REFERENCE_UNCERTAIN',status=409,uncertain=True)
            return self.apply(row,self.client.get_order(row['order_id']))
    def capture(self,owner,id):
        with self.lock:
            row=self.get(owner,id)
            id=row['id']
            if row['status']=='completed':return row
            if not row['order_id']:raise PayPalError('ORDER_NOT_READY',status=409)
            canonical=self.client.get_order(row['order_id'])
            row=self.apply(row,canonical)
            if row['status'] in ('completed','pending','failed','cancelled'):return row
            if row['status']!='approved':raise PayPalError('BUYER_APPROVAL_REQUIRED',status=409)
            if row['capture_attempted']:raise PayPalError('CAPTURE_RECONCILIATION_REQUIRED',status=409,uncertain=True)
            with self.db() as db:
                db.execute("UPDATE sandbox_payment_tests SET capture_attempted=1,status='capturing' WHERE id=? AND owner=?",(id,owner))
            try:
                self.client.capture_order(row['order_id'],'k-'+UUID(id).hex)
                return self.apply(row,self.client.get_order(row['order_id']))
            except PayPalError as error:
                self.uncertain(row,error);raise
