"""Server-owned settlement mail template. No raw HTML supplied by the browser."""
from dataclasses import dataclass
from email.message import EmailMessage
from paypal.email import PdfAttachment,valid_email,EmailDeliveryError


@dataclass(frozen=True)
class SettlementEmail:
    recipient_email: str
    project_name: str
    version: int
    language: str
    refund_minor: int
    agreement: PdfAttachment


def build_settlement_email(sender,item,notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    from uuid import UUID
    try:UUID(notification_id)
    except (ValueError,TypeError):raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if item.language not in ('es','en'):raise EmailDeliveryError('INVALID_OUTPUT_LANGUAGE')
    if not isinstance(item.project_name,str) or any(ord(c)<32 for c in item.project_name) or type(item.refund_minor) is not int or item.refund_minor<0:raise EmailDeliveryError('INVALID_EMAIL_FIELDS')
    amount=f'USD {item.refund_minor//100}.{item.refund_minor%100:02d}'
    message=EmailMessage();message['From']=sender;message['To']=item.recipient_email
    message['Message-ID']=f"<trato-refund-{notification_id}@{sender.rsplit('@',1)[1]}>"
    if item.language=='es':
        message['Subject']=f'Propuesta de cierre v{item.version} · {item.project_name}'
        body=f'Adjuntamos la propuesta de cierre v{item.version} del proyecto {item.project_name}.\nDevolución propuesta: {amount}.\nRevisa las condiciones y responde a este correo indicando tu aceptación o los ajustes que solicitas.\nEste envío no ejecuta una devolución.'
    else:
        message['Subject']=f'Settlement proposal v{item.version} · {item.project_name}'
        body=f'Please find settlement proposal v{item.version} for project {item.project_name}.\nProposed refund: {amount}.\nReview the conditions and reply to this email with your acceptance or requested adjustments.\nThis email does not execute a refund.'
    message.set_content(body)
    message.add_attachment(item.agreement.content,maintype='application',subtype='pdf',filename=item.agreement.filename)
    return message
