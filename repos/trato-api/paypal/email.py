"""Optional transactional SMTP transport; no Gmail mailbox access or automatic sends."""
from dataclasses import dataclass, field
from datetime import date
import hashlib
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape
from pathlib import Path
import smtplib
import ssl
from urllib.parse import urlparse
from .client import exact_amount, PayPalError
from .email_layout import email_layout

MASCOT_CONTENT_ID = 'mascot@trato'
MASCOT_FILE = Path(__file__).with_name('assets') / 'trato-guide.png'

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
    language:str='es'
    # A PayPal invoice: PayPal may also email it, and either email pays the same invoice.
    invoice:bool=False


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
    freelancer_email:str=''
    language:str='es'
    # Signed client portal link for this revision; the token travels in the fragment, never to a server log.
    portal_url:str=''


def valid_portal_url(value):
    return (isinstance(value,str) and len(value)<=500 and value.startswith(('https://','http://localhost:','http://127.0.0.1:'))
            and '/portal.html#t=' in value and not any(c in value for c in '\r\n "<>'))


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
    if item.freelancer_email and not valid_email(item.freelancer_email):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    if item.portal_url and not valid_portal_url(item.portal_url):raise EmailDeliveryError('INVALID_PORTAL_URL')
    validate_pdf_attachment(item.agreement)


def build_proposal_email(sender,item:ProposalEmail,notification_id):
    validate_proposal_email(item)
    message=_email_envelope(sender,item.recipient_email,notification_id)
    english=item.language=='en'
    title='Addendum for review' if english else 'Adenda para revisión'
    project_label='Project' if english else 'Proyecto'
    contact_label='Freelancer email' if english else 'Correo del freelancer'
    scope_label='Scope of change' if english else 'Alcance del cambio'
    date_label='Proposed due date' if english else 'Fecha de entrega propuesta'
    reference_label='Reference' if english else 'Referencia'
    hello='Hello' if english else 'Hola'
    cost_label='Proposed additional charge' if english else 'Adicional propuesto'
    no_cost='No additional charge.' if english else 'Sin adicional de precio.'
    review='Review the attached addendum' if english else 'Revisa la adenda adjunta'
    instruction=(
        'If you agree, reply with the signed document. If you need any changes, include them in your reply.' if english else
        'Si estás de acuerdo, responde a este correo con el documento firmado. Si necesitas ajustes, indícalos en tu respuesta.'
    )
    portal_action='Review and accept online' if english else 'Revisar y aceptar en línea'
    portal_copy=(
        'Open the secure link to see the addendum and accept it with one click, without creating an account. '
        'You can also reply with the signed document.' if english else
        'Abre el enlace seguro para ver la adenda y aceptarla con un clic, sin crear una cuenta. '
        'También puedes responder con el documento firmado.'
    )
    if item.portal_url:
        instruction=portal_copy
    status=(
        'This proposal is awaiting acceptance. It does not include a payment request.' if english else
        'Esta propuesta queda pendiente de aceptación. No incluye una solicitud de pago.'
    )
    message['Subject']=f'{title} · {item.project_name[:120]}'
    greeting=f'{hello}, {item.recipient_name}.' if item.recipient_name else f'{hello}.'
    cost=no_cost if item.additional_amount=='0.00' else f'{cost_label}: USD {item.additional_amount}.'
    contact=f'{contact_label}: {item.freelancer_email}\n' if item.freelancer_email else ''
    portal_text=f'\n{portal_action}: {item.portal_url}\n' if item.portal_url else ''
    text=f'{greeting}\n\n{project_label}: {item.project_name}\n{contact}\n{item.proposed_scope}\n\n{cost}\n{date_label}: {item.revised_due_date}.\n\n{review}. {instruction}\n{portal_text}\n{status}\n{reference_label}: {item.proposal_id}\n'
    message.set_content(text)
    scope=escape(item.proposed_scope).replace('\n','<br>')
    contact_html = (f'<br><strong>{contact_label}</strong><br>{escape(item.freelancer_email)}'
                    if item.freelancer_email else '')
    html = (
        f'<p>{escape(greeting)}</p>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="background:#f6f3fa;border-radius:12px;margin:0 0 24px">'
        f'<tr><td style="padding:16px 18px;font-size:15px;line-height:1.8;overflow-wrap:anywhere">'
        f'<strong>{project_label}</strong><br>{escape(item.project_name)}{contact_html}</td></tr></table>'
        f'<h2 style="font-size:17px;margin:22px 0 8px">{scope_label}</h2>'
        f'<p><span style="overflow-wrap:anywhere">{scope}</span></p>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="background:#f6f3fa;border-radius:12px;margin:0 0 24px">'
        f'<tr><td style="padding:16px 18px;font-size:15px;line-height:1.8">'
        f'<strong>{escape(cost)}</strong><br>'
        f'{date_label}: <strong>{escape(item.revised_due_date)}</strong>'
        '</td></tr></table>'
        f'<h2 style="font-size:17px;margin:0 0 8px">{review}</h2>'
        f'<p>{instruction}</p>'
        + (f'<p style="margin:18px 0 24px"><a href="{escape(item.portal_url)}" '
           'style="display:inline-block;background:#7051c6;color:#ffffff;text-decoration:none;font-weight:600;'
           f'padding:12px 20px;border-radius:10px">{portal_action}</a></p>' if item.portal_url else '')
        + f'<p>{status}</p>'
        f'<p>{reference_label}: {escape(item.proposal_id)}</p>'
    )
    add_branded_html(message, title, item.project_name, html)
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


def add_branded_html(message, title, project, content):
    try:
        mascot = MASCOT_FILE.read_bytes()
    except OSError:
        raise EmailDeliveryError('EMAIL_MASCOT_UNAVAILABLE') from None
    message.add_alternative(email_layout(title, project, content, mascot_src=f'cid:{MASCOT_CONTENT_ID}'), subtype='html')
    message.get_body(preferencelist=('html',)).add_related(
        mascot, maintype='image', subtype='png', cid=f'<{MASCOT_CONTENT_ID}>', disposition='inline')


INVOICE_NOTE_EN = 'PayPal may also email you this same invoice. You can ignore that email or pay from whichever you prefer: it is one invoice and is paid only once.'
INVOICE_NOTE_ES = 'PayPal también puede enviarte esta misma factura por correo. Puedes ignorar ese correo o pagar desde el que prefieras: es una sola factura y se paga una sola vez.'


def payment_email_content(greeting, amount, approval_url, payment_id, *, has_agreement, english=False, invoice=False):
    intro = 'Review your project’s test payment in PayPal Sandbox.' if english else 'Revisa el cobro de prueba de tu proyecto en PayPal Sandbox.'
    amount_label = 'Test amount' if english else 'Importe de prueba'
    button = (('Pay invoice in PayPal Sandbox' if english else 'Pagar factura en PayPal Sandbox') if invoice
              else ('Review payment in PayPal Sandbox' if english else 'Revisar pago en PayPal Sandbox'))
    mode = 'Test mode.' if english else 'Modo de prueba.'
    sandbox = 'Use a Sandbox account. No real money is transferred.' if english else 'Usa una cuenta Sandbox, sin dinero real.'
    attachment = 'The addendum for this payment is attached.' if english else 'Adjuntamos la adenda correspondiente a este cobro.'
    reference = 'Reference' if english else 'Referencia'
    return (
        f'<p>{escape(greeting)}</p>'
        f'<p>{intro}</p>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="background:#f6f3fa;border:1px solid #e6dcef;border-radius:14px;margin:0 0 24px">'
        '<tr><td align="center" style="padding:20px">'
        f'<div style="font-size:13px;color:#62576d;margin-bottom:8px">{amount_label}</div>'
        f'<strong style="font-size:32px;line-height:1.2;color:#302837">USD {escape(amount)}</strong>'
        '</td></tr></table>'
        f'<p><a href="{escape(approval_url, quote=True)}">{button}</a></p>'
        f'<p><strong>{mode}</strong> {sandbox}</p>'
        + (f'<p>{INVOICE_NOTE_EN if english else INVOICE_NOTE_ES}</p>' if invoice else '')
        + (f'<p>{attachment}</p>' if has_agreement else '')
        + f'<p>{reference}: {escape(payment_id)}</p>'
    )


def build_payment_email(sender,item:PaymentEmail,notification_id):
    if item.agreement is not None:validate_pdf_attachment(item.agreement)
    message=_email_envelope(sender,item.recipient_email,notification_id)
    try:exact_amount(item.amount)
    except PayPalError:raise EmailDeliveryError('INVALID_AMOUNT')
    if item.currency!='USD':raise EmailDeliveryError('UNSUPPORTED_CURRENCY')
    url=urlparse(item.approval_url)
    if url.scheme!='https' or url.hostname not in ('www.sandbox.paypal.com','sandbox.paypal.com') or url.username or url.password:raise EmailDeliveryError('INVALID_SANDBOX_PAYMENT_URL')
    if any(c in item.project_name for c in '\r\n'):raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    english=item.language=='en'
    title=('PayPal invoice' if english else 'Factura PayPal') if item.invoice else ('Test payment request' if english else 'Cobro de prueba')
    hello='Hello' if english else 'Hola'
    message['Subject']=f'{title} · {item.project_name[:120]}'
    greeting=f'{hello}, {item.recipient_name}.' if item.recipient_name else f'{hello}.'
    if english:
        text=f'{greeting}\n\nYou have a test payment request for USD {item.amount} for {item.project_name}.\n\nReview and approve the payment in PayPal Sandbox:\n{item.approval_url}\n\nUse a Sandbox account. No real money is transferred. Opening this email does not confirm payment.\nReference: {item.payment_id}\n'
    else:
        text=f'{greeting}\n\nTienes una solicitud de pago de prueba por USD {item.amount} para {item.project_name}.\n\nRevisa y aprueba el pago en PayPal sandbox:\n{item.approval_url}\n\nEs una prueba: usa una cuenta sandbox, sin dinero real. Abrir este correo no confirma el pago.\nReferencia: {item.payment_id}\n'
    if item.invoice:
        text+='\n'+(INVOICE_NOTE_EN if english else INVOICE_NOTE_ES)+'\n'
    if item.agreement is not None:
        text+='\nThe addendum for this payment is attached.\n' if english else '\nAdjuntamos la adenda correspondiente a este cobro.\n'
    message.set_content(text)
    add_branded_html(message, title, item.project_name,
                      payment_email_content(greeting, item.amount, item.approval_url, item.payment_id,
                                            has_agreement=item.agreement is not None, english=english, invoice=item.invoice))
    if item.agreement is not None:
        # The PDF is a server-authorized snapshot.
        attachment=item.agreement
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
