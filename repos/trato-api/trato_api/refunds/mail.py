"""Server-owned settlement mail template. No raw HTML supplied by the browser."""
from dataclasses import dataclass
from email.message import EmailMessage
from html import escape
from uuid import UUID
from paypal.email import PdfAttachment,valid_email,EmailDeliveryError,add_branded_html,validate_pdf_attachment


@dataclass(frozen=True)
class SettlementEmail:
    recipient_email: str
    project_name: str
    version: int
    language: str
    refund_minor: int
    agreement: PdfAttachment
    note: str = ''


def build_settlement_email(sender,item,notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    try:UUID(notification_id)
    except (ValueError,TypeError):raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if item.language not in ('es','en'):raise EmailDeliveryError('INVALID_OUTPUT_LANGUAGE')
    if not isinstance(item.project_name,str) or any(ord(c)<32 for c in item.project_name) or type(item.refund_minor) is not int or item.refund_minor<0:raise EmailDeliveryError('INVALID_EMAIL_FIELDS')
    validate_pdf_attachment(item.agreement)
    amount=f'USD {item.refund_minor//100}.{item.refund_minor%100:02d}'
    message=EmailMessage();message['From']=sender;message['To']=item.recipient_email
    message['Message-ID']=f"<trato-refund-{notification_id}@{sender.rsplit('@',1)[1]}>"
    if item.language=='es':
        message['Subject']=f'Propuesta de cierre v{item.version} · {item.project_name}'
        body=f'Adjuntamos la propuesta de cierre v{item.version} del proyecto {item.project_name}.\nDevolución propuesta: {amount}.\nRevisa las condiciones y responde a este correo indicando tu aceptación o los ajustes que solicitas.\nEste envío no ejecuta una devolución.'
    else:
        message['Subject']=f'Settlement proposal v{item.version} · {item.project_name}'
        body=f'Please find settlement proposal v{item.version} for project {item.project_name}.\nProposed refund: {amount}.\nReview the conditions and reply to this email with your acceptance or requested adjustments.\nThis email does not execute a refund.'
    if item.note:
        if len(item.note)>600 or any(ord(c)<32 and c!='\n' for c in item.note):raise EmailDeliveryError('INVALID_EMAIL_FIELDS')
        body=f'{item.note}\n\n{body}'
    message.set_content(body)
    if item.language=='es':
        title='Tu propuesta de devolución'
        greeting='Hola.'
        summary='Importe propuesto'
        version=f'Propuesta v{item.version} · Pendiente de tu respuesta'
        review='Revisa la propuesta adjunta'
        action='Si estás de acuerdo, responde a este correo para confirmarlo. Si necesitas ajustes, cuéntanos en tu respuesta.'
    else:
        title='Your refund proposal'
        greeting='Hello.'
        summary='Proposed refund'
        version=f'Proposal v{item.version} · Awaiting your reply'
        review='Review the attached proposal'
        action='If you agree, reply to this email to confirm. If you need changes, let us know in your reply.'
    note_text=escape(item.note).replace('\n','<br>')
    note_html=f'<p>{note_text}</p>' if note_text else ''
    content=(
        f'<p>{escape(greeting)}</p>'
        f'{note_html}'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="background:#f6f3fa;border-radius:12px;margin:0 0 24px">'
        '<tr><td style="padding:16px 18px;line-height:1.6">'
        f'<div style="font-size:14px;color:#62576d">{escape(summary)}</div>'
        f'<strong style="font-size:26px;color:#302837">{escape(amount)}</strong>'
        f'<div style="font-size:13px;color:#62576d;margin-top:4px">{escape(version)}</div>'
        '</td></tr></table>'
        f'<h2 style="font-size:17px;margin:0 0 8px">{escape(review)}</h2>'
        f'<p>{escape(action)}</p>'
        f'<p><strong>PDF</strong> · {escape(item.agreement.filename)}</p>'
    )
    add_branded_html(message,title,item.project_name,content)
    message.add_attachment(item.agreement.content,maintype='application',subtype='pdf',filename=item.agreement.filename)
    return message


@dataclass(frozen=True)
class RefundConfirmationEmail:
    recipient_email: str
    project_name: str
    language: str
    amount_minor: int


def build_refund_confirmation_email(sender, item, notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):
        raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    try:
        reference = UUID(notification_id)
    except (ValueError, TypeError):
        raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if item.language not in ('es', 'en'):
        raise EmailDeliveryError('INVALID_OUTPUT_LANGUAGE')
    if type(item.amount_minor) is not int or item.amount_minor <= 0:
        raise EmailDeliveryError('INVALID_EMAIL_FIELDS')

    amount = f'USD {item.amount_minor // 100}.{item.amount_minor % 100:02d}'
    if item.language == 'es':
        title, amount_label = 'Tu reembolso está confirmado', 'Importe reembolsado'
        intro = 'PayPal Sandbox confirmó el reembolso de tu pago en el entorno de pruebas.'
        help_text = 'Puedes consultar el movimiento en la actividad de PayPal Sandbox.'
    else:
        title, amount_label = 'Your refund is confirmed', 'Amount refunded'
        intro = 'PayPal Sandbox confirmed your payment refund in the test environment.'
        help_text = 'You can view the transaction in your PayPal Sandbox activity.'

    message = EmailMessage()
    message['From'], message['To'] = sender, item.recipient_email
    message['Message-ID'] = f"<trato-refund-confirmed-{reference}@{sender.rsplit('@', 1)[1]}>"
    message['Subject'] = f'[Sandbox] {title}'
    message.set_content(f'{title}\n\n{item.project_name}\n{intro}\n{amount_label}: {amount}\n\n{help_text}')
    content = (
        f'<p>{escape(intro)}</p>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="background:#f6f3fa;border-radius:12px;margin:0 0 24px">'
        '<tr><td style="padding:16px 18px;line-height:1.6">'
        f'<div style="font-size:14px;color:#62576d">{escape(amount_label)}</div>'
        f'<strong style="font-size:26px;color:#302837">{escape(amount)}</strong>'
        '</td></tr></table>'
        f'<p>{escape(help_text)}</p>'
    )
    add_branded_html(message, title, item.project_name, content)
    return message
