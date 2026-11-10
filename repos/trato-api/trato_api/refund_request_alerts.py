"""Emails the freelancer once when the client asks for a refund from their space, like the problem and dispute alerts.

Same mailbox and layout as problem_alerts; the database resolves the recipient and keeps it to one email per request.
The request is already saved when this runs: a failed email never undoes it or reaches the client."""
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate
from html import escape
import logging
from uuid import UUID

from paypal.email import EmailDeliveryError, valid_email
from paypal.email_layout import email_layout

logger = logging.getLogger('uvicorn.error').getChild('trato.refund_request_alerts')


@dataclass(frozen=True)
class RefundRequestAlert:
    recipient_email: str
    project_name: str
    client_name: str
    item: str
    amount_minor: int
    reason: str
    link: str


def build_refund_request_alert_email(sender, alert, notification_id):
    if not valid_email(sender) or not valid_email(alert.recipient_email):
        raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    try:
        reference = UUID(notification_id)
    except (ValueError, TypeError):
        raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if any(c in alert.project_name + alert.client_name + alert.item for c in '\r\n'):
        raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    who = alert.client_name or 'Your client'
    amount = f'USD {alert.amount_minor // 100}.{alert.amount_minor % 100:02d}'
    about = f' for «{alert.item}»' if alert.item else ''
    intro = f'{who} asked for a refund of {amount}{about} in {alert.project_name}.'
    reason = ' '.join(alert.reason.split())
    reason = reason if len(reason) <= 300 else reason[:297] + '…'
    facts = [f'Amount requested: {amount}', f'What they said: “{reason}”']
    action = 'Open Refunds in the project to review it. Nothing is refunded until you register it and PayPal confirms it.'
    message = EmailMessage()
    message['From'], message['To'] = sender, alert.recipient_email
    message['Subject'] = f'Refund requested · {" ".join(alert.project_name.split())[:120]}'
    message['Date'] = formatdate(usegmt=True)
    message['Message-ID'] = f"<trato-refund-request-{reference}@{sender.rsplit('@', 1)[1]}>"
    message.set_content('\n'.join([intro, '', *facts, '', action, alert.link]))
    body = (f'<p>{escape(intro)}</p><p>{"<br>".join(escape(f) for f in facts)}</p><p>{escape(action)}</p>'
            f'<p><a href="{escape(alert.link, quote=True)}">Open Trato</a></p>')
    message.add_alternative(email_layout('A client asked for a refund', alert.project_name, body), subtype='html')
    return message


class RefundRequestAlerts:
    def __init__(self, settings, repo, gmail):
        self.settings, self.repo, self.gmail = settings, repo, gmail

    def notify(self, request_id):
        """Best effort, after the request is saved."""
        if self.gmail is None:
            return None
        claim = self.repo.rpc('refund_request_alert_claim', {'p_request': request_id})
        if not isinstance(claim, dict) or not claim.get('acquired'):
            return None
        alert = RefundRequestAlert(claim['recipient'], claim['project_name'], claim['client_name'], claim['item'],
                                   claim['amount_minor'], claim['reason'], self.settings.web_origin.rstrip('/') + '/#inicio')
        status, message_id = 'failed', None
        try:
            result = self.gmail._send_built(claim['owner_id'], alert, claim['notification_id'], build_refund_request_alert_email, None)
            status, message_id = 'sent', result.get('message_id')
        except EmailDeliveryError as error:
            status = 'uncertain' if error.uncertain else 'failed'
            logger.warning('refund_request_alert_failed %s', error.code)
        self.repo.rpc('refund_request_alert_finish', {'p_request': claim['request_id'], 'p_status': status, 'p_message_id': message_id})
        return status
