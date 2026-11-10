"""Emails the freelancer once when a client opens a PayPal dispute, so they learn of it without opening Trato.

Sent from Trato's mailbox to the project owner's own account email (the database resolves it). The facts come from the
dispute PayPal returned, already summarized for the verified payment; nothing from the webhook body is trusted."""
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate
from html import escape
import logging
from uuid import UUID

from paypal.email import EmailDeliveryError, valid_email
from paypal.email_layout import email_layout

logger = logging.getLogger('uvicorn.error').getChild('trato.dispute_alerts')
OPEN = {'OPEN', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE', 'UNDER_REVIEW'}
REASONS = {'MERCHANDISE_OR_SERVICE_NOT_RECEIVED': 'Service not received',
           'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED': 'Service not as described',
           'UNAUTHORISED': 'Unauthorized payment', 'CREDIT_NOT_PROCESSED': 'Credit not processed',
           'DUPLICATE_TRANSACTION': 'Duplicate payment', 'INCORRECT_AMOUNT': 'Incorrect amount',
           'PAYMENT_BY_OTHER_MEANS': 'Paid by other means', 'CANCELED_RECURRING_BILLING': 'Canceled recurring billing',
           'PROBLEM_WITH_REMITTANCE': 'Problem with remittance', 'OTHER': 'Other'}


@dataclass(frozen=True)
class DisputeAlert:
    recipient_email: str
    project_name: str
    client_name: str
    dispute_id: str
    amount: str
    currency: str
    reason: str
    response_due: str
    link: str


def build_dispute_alert_email(sender, item, notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):
        raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    try:
        reference = UUID(notification_id)
    except (ValueError, TypeError):
        raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if any(c in item.project_name + item.client_name for c in '\r\n'):
        raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    who = item.client_name or 'Your client'
    amount = f'{item.currency} {item.amount}'.strip()
    due = item.response_due[:10] if item.response_due else ''
    intro = f'{who} opened a PayPal dispute on a payment of {amount} for {item.project_name}.'
    facts = [f'Reason: {REASONS.get(item.reason, item.reason or "Not stated")}', f'Dispute: {item.dispute_id}']
    if due:
        facts.append(f'Respond by: {due}')
    action = 'Open it in Trato: TeTrato prepares a response from the project evidence, and you review it before anything goes to PayPal.'
    message = EmailMessage()
    message['From'], message['To'] = sender, item.recipient_email
    message['Subject'] = f'PayPal dispute · {" ".join(item.project_name.split())[:120]}'
    message['Date'] = formatdate(usegmt=True)
    message['Message-ID'] = f"<trato-dispute-alert-{reference}@{sender.rsplit('@', 1)[1]}>"
    message.set_content('\n'.join([intro, '', *facts, '', action, item.link, '', 'PayPal Sandbox · test funds']))
    body = (f'<p>{escape(intro)}</p><p>{"<br>".join(escape(f) for f in facts)}</p><p>{escape(action)}</p>'
            f'<p><a href="{escape(item.link, quote=True)}">Open dispute in Trato</a></p><p>PayPal Sandbox · test funds</p>')
    message.add_alternative(email_layout('A client opened a PayPal dispute', item.project_name, body), subtype='html')
    return message


class DisputeAlerts:
    def __init__(self, settings, store, gmail):
        self.settings, self.store, self.gmail = settings, store, gmail

    def notify(self, owner, project, summary):
        """Best effort and at most once per dispute: a failed email never makes PayPal resend the event."""
        if self.gmail is None or summary.get('status') not in OPEN:
            return None
        claim = self.store.repo.rpc('dispute_alert_claim', {'p_owner': owner, 'p_project': project, 'p_dispute': summary['dispute_id']})
        if not claim.get('acquired'):
            return None
        amount = summary.get('amount') or {}
        item = DisputeAlert(claim['recipient'], claim['project_name'], claim['client_name'], summary['dispute_id'],
                            amount.get('value') or '', amount.get('currency') or '', summary.get('reason') or '',
                            summary.get('response_due') or '', self.settings.web_origin.rstrip('/') + '/#inicio')
        status, message_id = 'failed', None
        try:
            result = self.gmail._send_built(owner, item, claim['notification_id'], build_dispute_alert_email, None)
            status, message_id = 'sent', result.get('message_id')
        except EmailDeliveryError as error:
            status = 'uncertain' if error.uncertain else 'failed'
            logger.warning('dispute_alert_failed %s', error.code)
        self.store.repo.rpc('dispute_alert_finish', {'p_owner': owner, 'p_project': project, 'p_dispute': summary['dispute_id'],
                                                     'p_status': status, 'p_message_id': message_id})
        return status
