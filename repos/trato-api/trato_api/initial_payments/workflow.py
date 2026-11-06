"""Human-authorized initial orders. Only provider evidence records received money."""
from email.message import EmailMessage
from email.utils import formatdate
from hashlib import sha256
from html import escape
import json,os,secrets
from urllib.parse import urlencode
from paypal.client import PaymentInstruction,PayPalError,exact_amount
from paypal.config import SandboxSettings
from paypal.email import valid_email,EmailDeliveryError
from paypal.email_layout import email_layout
from ..errors import ApiError
from ..proposals.workflow import BackendStore,ProposalWorkflow

class InitialStore(BackendStore):
    def command(self,owner,action,data):
        return self.repo.rpc('initial_checkout_backend',{'p_owner':owner,'p_action':action,'p_data':data})

class InitialPayments:
    def __init__(self,settings,gmail=None,*,store=None,paypal=None):
        self.settings,self.gmail,self.store,self.paypal=settings,gmail,store,paypal
    def backend(self):return self.store if self.store is not None else InitialStore(self.settings)
    def provider(self):return self.paypal if self.paypal is not None else ProposalWorkflow(self.settings,None).provider()
    @staticmethod
    def instruction(pay):
        return PaymentInstruction('initial-'+pay['project_id'],f'{pay["amount_minor"]//100}.{pay["amount_minor"]%100:02d}','USD',pay['merchant_id'])
    def link(self,pay):
        return self.settings.web_origin.rstrip('/')+'/initial-payment.html?'+urlencode({'checkout':pay['checkout_token'],'lang':pay['output_language']})
    def public(self,pay):
        return {k:pay.get(k) for k in ('id','status','amount_minor','currency','order_id','capture_id','paid_at','project_name','conditions','stage_position')}
    def owned(self,pay):
        if pay is None:return None
        # sandbox lets the owner open the client's checkout to test it; Live never exposes that shortcut.
        return {**self.public(pay),**{k:pay.get(k) for k in ('conditions','output_language','created_at','updated_at','mail_status','events','last_error')},'checkout_url':self.link(pay),
                'sandbox':os.getenv('PAYPAL_ENVIRONMENT')=='sandbox'}
    def get(self,repo,owner,project):
        p=repo.project(project)
        if p['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
        return self.owned(self.backend().command(owner,'get',{'project_id':project}))
    def prepare(self,repo,owner,project,data,key):
        p=repo.project(project)
        if p['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
        clients=repo.rows('clients',{'select':'contact_email','id':'eq.'+p['client_id'],'owner_id':'eq.'+owner,'deleted_at':'is.null'})
        if len(clients)!=1 or not valid_email(clients[0].get('contact_email','')):raise ApiError('CLIENT_EMAIL_REQUIRED',409)
        payer=clients[0]['contact_email']
        bindings=os.getenv('TRATO_SANDBOX_INITIAL_PAYER_BINDINGS','')
        if bindings:
            try:
                values=json.loads(bindings)
                if os.getenv('PAYPAL_ENVIRONMENT')!='sandbox' or not isinstance(values,dict) or any(not valid_email(x) for x in values.values()):raise ValueError()
                payer=values.get(owner,payer)
            except (ValueError,TypeError):raise ApiError('REFUND_SANDBOX_BINDING_INVALID',503) from None
        client=self.provider()
        pay=self.backend().command(owner,'prepare',{**data,'project_id':project,'request_key':key,'merchant_id':client.merchant_id,'payer_email':payer,'token':secrets.token_urlsafe(32)})
        self.create(pay)
        return self.get(repo,owner,project)
    def create(self,pay):
        pay=self.backend().command(pay['owner_id'],'claim_create',{'id':pay['id']})
        if not pay['acquired']:return pay
        try:
            url=self.link(pay)
            order=self.provider().create_order(self.instruction(pay),'ip-'+pay['id'].replace('-',''),url+'&result=return',url+'&result=cancel')
            return self.apply(pay,order)
        except PayPalError as error:
            self.backend().command(pay['owner_id'],'uncertain',{'id':pay['id'],'code':error.code})
            raise ApiError(error.code,error.status) from None
    def apply(self,pay,order):
        client=self.provider();state=client.validate_order(order,self.instruction(pay))
        if pay.get('order_id') and order['id']!=pay['order_id']:raise ApiError('PAYMENT_EVIDENCE_MISMATCH',409)
        # Who pays is not a payment control: a client's accountant or company account may pay. Order, amount,
        # merchant, currency and the verified capture are what protect the freelancer (project owner decision, 6 Nov 2026).
        captures=order['purchase_units'][0].get('payments',{}).get('captures',[])
        if state=='completed':
            if order.get('status')!='COMPLETED' or len(captures)!=1:raise ApiError('PAYMENT_EVIDENCE_MISMATCH',409)
            capture=client.get_capture(captures[0]['id'])
            if (capture.get('id')!=captures[0]['id'] or capture.get('status')!='COMPLETED' or
                capture.get('amount',{}).get('currency_code')!='USD' or
                exact_amount(capture.get('amount',{}).get('value'))!=exact_amount(self.instruction(pay).amount)):
                raise ApiError('PAYMENT_EVIDENCE_MISMATCH',409)
        return self.backend().command(pay['owner_id'],'apply',{'id':pay['id'],'status':state,'order_id':order['id'],
            'capture_id':captures[0]['id'] if captures else None,'approval_url':client.approval_url(order),
            'amount_minor':pay['amount_minor'],'currency':'USD','merchant_id':pay['merchant_id']})
    def reconcile(self,repo,owner,project):
        p=repo.project(project)
        if p['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
        pay=self.backend().command(owner,'get',{'project_id':project})
        if pay is None:raise ApiError('INITIAL_PAYMENT_NOT_FOUND',404)
        if pay['status']=='completed':return self.owned(pay)
        try:pay=self.apply(pay,self.provider().get_order(pay['order_id'])) if pay.get('order_id') else self.create(pay)
        except PayPalError as error:raise ApiError(error.code,error.status) from None
        return self.get(repo,owner,project)
    def checkout(self,token,*,capture=False):
        if not isinstance(token,str) or len(token)!=43 or not all(c.isalnum() or c in '_-' for c in token):raise ApiError('INITIAL_PAYMENT_NOT_FOUND',404)
        pay=self.backend().command(None,'checkout',{'token':token})
        if pay['status']=='completed':return self.public(pay)
        if not pay.get('order_id'):raise ApiError('INITIAL_ORDER_RECONCILIATION_REQUIRED',409)
        try:
            pay=self.apply(pay,self.provider().get_order(pay['order_id']))
            if capture and pay['status'] in ('approved','capturing'):
                pay=self.backend().command(pay['owner_id'],'claim_capture',{'id':pay['id']})
                if pay['acquired']:
                    self.provider().capture_order(pay['order_id'],'ic-'+pay['id'].replace('-',''))
                    pay=self.apply(pay,self.provider().get_order(pay['order_id']))
            result=self.public(pay)
            # Approval URL is provided only by the verified Orders response, never by browser input.
            if pay['status']=='pending_approval':result['approval_url']=pay.get('approval_url')
            return result
        except PayPalError as error:raise ApiError(error.code,error.status) from None
    def preview(self,repo,owner,project):
        p=repo.project(project)
        if p['owner_id']!=owner:raise ApiError('PROJECT_NOT_FOUND',404)
        pay=self.backend().command(owner,'get',{'project_id':project})
        if not pay or not pay.get('order_id') or pay['status']=='completed':raise ApiError('INITIAL_PAYMENT_NOT_READY',409)
        if not self.gmail:raise ApiError('GMAIL_NOT_CONFIGURED',503)
        status=self.gmail.status(owner)
        if not status.get('connected'):raise ApiError('GMAIL_NOT_CONNECTED',409)
        item={k:pay.get(k) for k in ('project_name','client_name','recipient_email','amount_minor','conditions','output_language','mail_id','stage_position')}
        item['url']=self.link(pay);item['sender']=status['email']
        digest=sha256(json.dumps(item,sort_keys=True).encode()).hexdigest()
        message=build_email(item['sender'],item,pay['mail_id'])
        return pay,item,{'sender':item['sender'],'recipient':pay['recipient_email'],'subject':str(message['Subject']),'body':message.get_body(preferencelist=('plain',)).get_content(),'digest':digest}
    def send(self,repo,owner,project,digest):
        pay,item,preview=self.preview(repo,owner,project)
        if not secrets.compare_digest(preview['digest'],digest):raise ApiError('EMAIL_PREVIEW_CHANGED',409)
        claim=self.backend().command(owner,'mail_claim',{'id':pay['id'],'sender':preview['sender'],'digest':digest})
        if not claim['acquired']:return self.owned(claim)
        try:result=self.gmail._send_built(owner,item,claim['mail_id'],build_email,preview['sender'])
        except EmailDeliveryError as error:
            self.backend().command(owner,'mail_finish',{'id':pay['id'],'status':'uncertain' if error.uncertain else 'failed'})
            raise ApiError(error.code,503) from None
        self.backend().command(owner,'mail_finish',{'id':pay['id'],'status':'sent','message_id':result['message_id'],'thread_id':result.get('thread_id')})
        return self.get(repo,owner,project)

def build_email(sender,item,notification):
    english=item['output_language']=='en';amount=f'USD {item["amount_minor"]/100:.2f}'
    staged=item.get('stage_position') is not None
    subject=(('Deliverable payment' if english else 'Pago de entregable') if staged else ('Initial payment' if english else 'Pago inicial'))+' · '+' '.join(item['project_name'].split())
    title=('Your deliverable is ready' if english else 'Tu entregable está listo') if staged else ('Your project starts here' if english else 'Tu proyecto empieza aquí')
    intro=(('Here is the payment request for deliverable ' if english else 'Te enviamos la solicitud de pago del entregable ')+str(item['stage_position'])+' · '+item['project_name']+'.') if staged else (('Here is the initial payment request for ' if english else 'Te enviamos la solicitud de pago inicial de ')+item['project_name']+'.')
    button='Review payment' if english else 'Revisar pago'
    sandbox='PayPal Sandbox · test funds' if english else 'PayPal Sandbox · saldo de prueba'
    msg=EmailMessage();msg['From']=sender;msg['To']=item['recipient_email'];msg['Subject']=subject;msg['Date']=formatdate(usegmt=True)
    msg['Message-ID']=f'<trato-initial-{notification}@{sender.rsplit("@",1)[1]}>'
    msg.set_content(f'{intro}\n\n{amount}\n{item["conditions"]}\n\n{item["url"]}\n\n{sandbox}')
    msg.add_alternative(email_layout(title,item['project_name'],f'<p>{escape(intro)}</p><h2>{amount}</h2><p>{escape(item["conditions"]).replace(chr(10),"<br>")}</p><p><a href="{escape(item["url"],quote=True)}">{button}</a></p><p>{sandbox}</p>'),subtype='html')
    return msg
