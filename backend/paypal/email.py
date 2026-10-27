"""Optional transactional SMTP transport; no Gmail mailbox access or automatic sends."""
from dataclasses import dataclass, field
from datetime import date
import hashlib
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape
import smtplib
import ssl
from urllib.parse import urlparse
from .client import exact_amount, PayPalError


@dataclass(frozen=True)
class PdfAttachment:
    filename:str
    content:bytes=field(repr=False)
    sha256:str


def validate_pdf_attachment(attachment):
    if not isinstance(attachment,PdfAttachment):raise EmailDeliveryError('INVALID_PDF_ATTACHMENT')
    name=attachment.filename
    if not isinstance(name,str) or not name.lower().endswith('.pdf') or len(name)>180 or any(ord(c)<32 or ord(c)==127 or c in '/\\' for c in name):raise EmailDeliveryError('INVALID_ATTACHMENT_FILENAME')
    content=attachment.content
    if not isinstance(content,bytes) or not content.startswith(b'%PDF-') or not 5<len(content)<=10*1024*1024:raise EmailDeliveryError('INVALID_PDF_ATTACHMENT')
    if hashlib.sha256(content).hexdigest()!=attachment.sha256:raise EmailDeliveryError('ATTACHMENT_HASH_MISMATCH')


@dataclass(frozen=True)
class PaymentEmail:
    # All fields are resolved/authorized server-side, not a browser's arbitrary recipient.
    payment_id:str
    recipient_email:str
    recipient_name:str
    project_name:str
    amount:str
    currency:str
    approval_url:str
    agreement:PdfAttachment|None=None


@dataclass(frozen=True)
class ProposalEmail:
    # Reviewed, immutable proposal and recipient resolved by the backend.
    proposal_id:str
    recipient_email:str
    recipient_name:str
    project_name:str
    proposed_scope:str
    additional_amount:str
    currency:str
    revised_due_date:str
    agreement:PdfAttachment


def validate_proposal_email(item):
    if not isinstance(item,ProposalEmail):raise EmailDeliveryError('INVALID_PROPOSAL_EMAIL')
    if not valid_email(item.recipient_email):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    if not isinstance(item.project_name,str) or not item.project_name.strip() or any(c in item.project_name for c in '\r\n'):raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    if not isinstance(item.proposed_scope,str) or not item.proposed_scope.strip() or len(item.proposed_scope)>12000:raise EmailDeliveryError('INVALID_PROPOSED_SCOPE')
    if item.additional_amount!='0.00':
        try:exact_amount(item.additional_amount)
        except PayPalError:raise EmailDeliveryError('INVALID_AMOUNT')
    if item.currency!='USD':raise EmailDeliveryError('UNSUPPORTED_CURRENCY')
    try:
        if date.fromisoformat(item.revised_due_date).isoformat()!=item.revised_due_date:raise ValueError()
    except (TypeError,ValueError):raise EmailDeliveryError('INVALID_PROPOSED_DATE')
    validate_pdf_attachment(item.agreement)


def build_proposal_email(sender,item:ProposalEmail,notification_id):
    validate_proposal_email(item)
    message=_email_envelope(sender,item.recipient_email,notification_id)
    message['Subject']=f'Adenda para revisión · {item.project_name[:120]}'
    greeting=f'Hola, {item.recipient_name}.' if item.recipient_name else 'Hola.'
    cost='Sin adicional de precio.' if item.additional_amount=='0.00' else f'Adicional propuesto: USD {item.additional_amount}.'
    instruction='Revisa la adenda adjunta. Si estás de acuerdo, responde a este correo con el documento firmado. Si necesitas ajustes, indícalos en tu respuesta.'
    text=f'{greeting}\n\nTe compartimos la propuesta de cambio para {item.project_name}.\n\n{item.proposed_scope}\n\n{cost}\nFecha de entrega propuesta: {item.revised_due_date}.\n\n{instruction}\n\nEsta propuesta queda pendiente de aceptación. No incluye una solicitud de pago.\nReferencia: {item.proposal_id}\n'
    message.set_content(text)
    scope=escape(item.proposed_scope).replace('\n','<br>')
    message.add_alternative(f'<p>{escape(greeting)}</p><p>Te compartimos la propuesta de cambio para <strong>{escape(item.project_name)}</strong>.</p><p>{scope}</p><p>{escape(cost)}<br>Fecha de entrega propuesta: {escape(item.revised_due_date)}.</p><p>{escape(instruction)}</p><p>Esta propuesta queda pendiente de aceptación. No incluye una solicitud de pago.</p><p>Referencia: {escape(item.proposal_id)}</p>',subtype='html')
    message.add_attachment(item.agreement.content,maintype='application',subtype='pdf',filename=item.agreement.filename)
    return message


@dataclass(frozen=True)
class SmtpConfig:
    host:str
    port:int
    sender_email:str
    username:str=''
    password:str=''
    encryption:str='starttls'  # starttls or ssl; plain only for loopback mail catcher


class EmailDeliveryError(Exception):
    def __init__(self,code,*,uncertain=False):super().__init__(code);self.code=code;self.uncertain=uncertain


def valid_email(value):
    if not isinstance(value,str) or any(c in value for c in '\r\n') or len(value)>254:return False
    name,address=parseaddr(value)
    return not name and address==value and '@' in address and '.' in address.rsplit('@',1)[-1] and ' ' not in address


def _email_envelope(sender,recipient,notification_id):
    if not valid_email(sender) or not valid_email(recipient):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    if not isinstance(notification_id,str) or not 1<=len(notification_id)<=128 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in notification_id):raise EmailDeliveryError('INVALID_NOTIFICATION_ID')
    message=EmailMessage()
    message['From']=sender;message['To']=recipient
    message['Message-ID']=f'<trato-{notification_id}@{sender.rsplit("@",1)[-1]}>'
    return message


def build_payment_email(sender,item:PaymentEmail,notification_id):
    if item.agreement is not None:validate_pdf_attachment(item.agreement)
    message=_email_envelope(sender,item.recipient_email,notification_id)
    try:exact_amount(item.amount)
    except PayPalError:raise EmailDeliveryError('INVALID_AMOUNT')
    if item.currency!='USD':raise EmailDeliveryError('UNSUPPORTED_CURRENCY')
    url=urlparse(item.approval_url)
    if url.scheme!='https' or url.hostname not in ('www.sandbox.paypal.com','sandbox.paypal.com') or url.username or url.password:raise EmailDeliveryError('INVALID_SANDBOX_PAYMENT_URL')
    if any(c in item.project_name for c in '\r\n'):raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    message['Subject']=f'Cobro de prueba · {item.project_name[:120]}'
    greeting=f'Hola, {item.recipient_name}.' if item.recipient_name else 'Hola.'
    text=f'{greeting}\n\nTienes una solicitud de pago de prueba por USD {item.amount} para {item.project_name}.\n\nRevisa y aprueba el pago en PayPal sandbox:\n{item.approval_url}\n\nEs una prueba: usa una cuenta sandbox, sin dinero real. Abrir este correo no confirma el pago.\nReferencia: {item.payment_id}\n'
    message.set_content(text)
    message.add_alternative(f'<p>{escape(greeting)}</p><p>Tienes una solicitud de pago de prueba por <strong>USD {escape(item.amount)}</strong> para {escape(item.project_name)}.</p><p><a href="{escape(item.approval_url,quote=True)}">Revisar pago en PayPal sandbox</a></p><p>Prueba sin dinero real. Abrir el correo no confirma un pago.</p><p>Referencia: {escape(item.payment_id)}</p>',subtype='html')
    if item.agreement is not None:
        # The PDF is a server-authorized snapshot, not a browser-supplied path or URL.
        attachment=item.agreement
        plain=message.get_body(preferencelist=('plain',))
        plain.set_content(plain.get_content()+'\nAdjuntamos la adenda correspondiente a este cobro.\n')
        html=message.get_body(preferencelist=('html',))
        html.set_content(html.get_content()+'<p>Adjuntamos la adenda correspondiente a este cobro.</p>',subtype='html')
        message.add_attachment(attachment.content,maintype='application',subtype='pdf',filename=attachment.filename)
    return message


class SmtpPaymentMailer:
    def __init__(self,config:SmtpConfig,*,smtp_factory=None):
        if not config.host or not 1<=config.port<=65535 or not valid_email(config.sender_email):raise EmailDeliveryError('SMTP_NOT_CONFIGURED')
        if config.encryption not in ('starttls','ssl','local'):raise EmailDeliveryError('INVALID_SMTP_ENCRYPTION')
        if config.encryption=='local' and config.host not in ('localhost','127.0.0.1','::1'):raise EmailDeliveryError('UNENCRYPTED_SMTP_NOT_ALLOWED')
        if bool(config.username)!=bool(config.password):raise EmailDeliveryError('SMTP_AUTH_INCOMPLETE')
        self.config=config;self.factory=smtp_factory

    def send(self,item,notification_id):
        return self._send_message(build_payment_email(self.config.sender_email,item,notification_id))

    def send_proposal(self,item,notification_id):
        return self._send_message(build_proposal_email(self.config.sender_email,item,notification_id))

    def _send_message(self,message):
        c=self.config
        factory=self.factory or (smtplib.SMTP_SSL if c.encryption=='ssl' else smtplib.SMTP)
        kwargs={'timeout':15}
        if c.encryption=='ssl':kwargs['context']=ssl.create_default_context()
        delivery_started=False;accepted=False
        try:
            with factory(c.host,c.port,**kwargs) as smtp:
                smtp.ehlo()
                if c.encryption=='starttls':smtp.starttls(context=ssl.create_default_context());smtp.ehlo()
                if c.username:smtp.login(c.username,c.password)
                delivery_started=True
                refused=smtp.send_message(message)
                if refused:raise EmailDeliveryError('RECIPIENT_REFUSED')
                accepted=True
        except EmailDeliveryError:raise
        except (smtplib.SMTPRecipientsRefused,smtplib.SMTPDataError):raise EmailDeliveryError('SMTP_DELIVERY_REJECTED')
        except (smtplib.SMTPException,OSError):
            if not accepted:raise EmailDeliveryError('SMTP_DELIVERY_FAILED',uncertain=delivery_started)
        return {'status':'accepted_by_smtp','message_id':str(message['Message-ID'])}
