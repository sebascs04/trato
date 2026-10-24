"""Optional transactional SMTP transport; no Gmail mailbox access or automatic sends."""
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape
import smtplib
import ssl
from urllib.parse import urlparse
from .client import exact_amount, PayPalError


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


def build_payment_email(sender,item:PaymentEmail,notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    if not isinstance(notification_id,str) or not 1<=len(notification_id)<=128 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in notification_id):raise EmailDeliveryError('INVALID_NOTIFICATION_ID')
    try:exact_amount(item.amount)
    except PayPalError:raise EmailDeliveryError('INVALID_AMOUNT')
    if item.currency!='USD':raise EmailDeliveryError('UNSUPPORTED_CURRENCY')
    url=urlparse(item.approval_url)
    if url.scheme!='https' or url.hostname not in ('www.sandbox.paypal.com','sandbox.paypal.com') or url.username or url.password:raise EmailDeliveryError('INVALID_SANDBOX_PAYMENT_URL')
    if any(c in item.project_name for c in '\r\n'):raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    message=EmailMessage()
    message['From']=sender;message['To']=item.recipient_email
    message['Subject']=f'Cobro de prueba · {item.project_name[:120]}'
    message['Message-ID']=f'<trato-{notification_id}@{sender.rsplit("@",1)[-1]}>'
    greeting=f'Hola, {item.recipient_name}.' if item.recipient_name else 'Hola.'
    text=f'{greeting}\n\nTienes una solicitud de pago de prueba por USD {item.amount} para {item.project_name}.\n\nRevisa y aprueba el pago en PayPal sandbox:\n{item.approval_url}\n\nEs una prueba: usa una cuenta sandbox, sin dinero real. Abrir este correo no confirma el pago.\nReferencia: {item.payment_id}\n'
    message.set_content(text)
    message.add_alternative(f'<p>{escape(greeting)}</p><p>Tienes una solicitud de pago de prueba por <strong>USD {escape(item.amount)}</strong> para {escape(item.project_name)}.</p><p><a href="{escape(item.approval_url,quote=True)}">Revisar pago en PayPal sandbox</a></p><p>Prueba sin dinero real. Abrir el correo no confirma un pago.</p><p>Referencia: {escape(item.payment_id)}</p>',subtype='html')
    return message


class SmtpPaymentMailer:
    def __init__(self,config:SmtpConfig,*,smtp_factory=None):
        if not config.host or not 1<=config.port<=65535 or not valid_email(config.sender_email):raise EmailDeliveryError('SMTP_NOT_CONFIGURED')
        if config.encryption not in ('starttls','ssl','local'):raise EmailDeliveryError('INVALID_SMTP_ENCRYPTION')
        if config.encryption=='local' and config.host not in ('localhost','127.0.0.1','::1'):raise EmailDeliveryError('UNENCRYPTED_SMTP_NOT_ALLOWED')
        if bool(config.username)!=bool(config.password):raise EmailDeliveryError('SMTP_AUTH_INCOMPLETE')
        self.config=config;self.factory=smtp_factory

    def send(self,item,notification_id):
        c=self.config
        message=build_payment_email(c.sender_email,item,notification_id)
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
