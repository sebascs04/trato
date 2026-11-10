"""Emails the freelancer once when a client reports a problem from the portal, like the PayPal dispute alert.

Same mailbox and layout as dispute_alerts; the database resolves the recipient and keeps it to one email per report."""
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate
from html import escape
import logging
from uuid import UUID

from paypal.email import EmailDeliveryError, valid_email
from paypal.email_layout import email_layout

logger = logging.getLogger('uvicorn.error').getChild('trato.problem_alerts')
REASONS = {'not_received': 'Work not received', 'not_as_agreed': 'Not as agreed', 'quality': 'Quality issue', 'other': 'Other'}


@dataclass(frozen=True)
class ProblemAlert:
    recipient_email: str
    project_name: str
    client_name: str
    title: str
    reason: str
    notes: str
    link: str


def build_problem_alert_email(sender, item, notification_id):
    if not valid_email(sender) or not valid_email(item.recipient_email):
        raise EmailDeliveryError('INVALID_EMAIL_ADDRESS')
    try:
        reference = UUID(notification_id)
    except (ValueError, TypeError):
        raise EmailDeliveryError('INVALID_NOTIFICATION_ID') from None
    if any(c in item.project_name + item.client_name for c in '\r\n'):
        raise EmailDeliveryError('INVALID_EMAIL_SUBJECT')
    # Client names are free text («Café Aurora.»): a trailing dot would break the sentence.
    who = item.client_name.strip().rstrip('.').strip() or 'Your client'
    about = f' with «{item.title}»' if item.title else ''
    intro = f'{who} reported a problem{about} in {item.project_name}.'
    note = ' '.join(item.notes.split())
    note = note if len(note) <= 300 else note[:297] + '…'
    facts = [f'Reason: {REASONS.get(item.reason, "Other")}', f'What they said: “{note}”']
    action = 'Reply in Trato before it turns into a PayPal dispute: TeTrato helps you answer with the project evidence.'
    message = EmailMessage()
    message['From'], message['To'] = sender, item.recipient_email
    message['Subject'] = f'Problem reported · {" ".join(item.project_name.split())[:120]}'
    message['Date'] = formatdate(usegmt=True)
    message['Message-ID'] = f"<trato-problem-alert-{reference}@{sender.rsplit('@', 1)[1]}>"
    message.set_content('\n'.join([intro, '', *facts, '', action, item.link]))
    body = (f'<p>{escape(intro)}</p><p>{"<br>".join(escape(f) for f in facts)}</p><p>{escape(action)}</p>'
            f'<p><a href="{escape(item.link, quote=True)}">Open the problem in Trato</a></p>')
    message.add_alternative(email_layout('A client reported a problem', item.project_name, body), subtype='html')
    return message


class ProblemAlerts:
    def __init__(self, settings, repo, gmail):
        self.settings, self.repo, self.gmail = settings, repo, gmail

    def notify(self, digest):
        """Best effort: the report is already saved; a failed email never undoes it or reaches the client."""
        if self.gmail is None:
            return None
        return self._send(self.repo.rpc('problem_alert_claim', {'p_token_hash': digest}))

    def notify_report(self, report_id):
        """The same email for a report on a paid Work plan deliverable, which has no portal link: claimed by report id."""
        if self.gmail is None:
            return None
        return self._send(self.repo.rpc('problem_alert_claim_report', {'p_report': report_id}))

    def _send(self, claim):
        if not isinstance(claim, dict) or not claim.get('acquired'):
            return None
        item = ProblemAlert(claim['recipient'], claim['project_name'], claim['client_name'], claim['title'], claim['reason'],
                            claim['notes'], self.settings.web_origin.rstrip('/') + '/#inicio')
        status, message_id = 'failed', None
        try:
            result = self.gmail._send_built(claim['owner_id'], item, claim['notification_id'], build_problem_alert_email, None)
            status, message_id = 'sent', result.get('message_id')
        except EmailDeliveryError as error:
            status = 'uncertain' if error.uncertain else 'failed'
            logger.warning('problem_alert_failed %s', error.code)
        self.repo.rpc('problem_alert_finish', {'p_report': claim['report_id'], 'p_status': status, 'p_message_id': message_id})
        return status
