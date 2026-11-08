"""Deliver the durable confirmation for a completed settlement through Gmail."""
import logging

from paypal.email import EmailDeliveryError

from ..errors import ApiError
from ..proposals.workflow import BackendStore
from .mail import RefundConfirmationEmail

logger = logging.getLogger(__name__)


class RefundConfirmation:
    def __init__(self, settings, gmail, *, repository=None):
        self.settings, self.gmail, self.repository = settings, gmail, repository

    def dispatch(self, owner, *, settlement=None, payment=None, retry=False):
        repo = self.repository if self.repository is not None else BackendStore(self.settings).repo
        while True:
            claim = repo.rpc('refund_confirmation_claim', {
                'p_owner': str(owner), 'p_settlement': settlement, 'p_payment': payment, 'p_retry': retry,
            })
            if claim is None:
                return
            parent = claim['settlement_id']
            item = RefundConfirmationEmail(
                claim['recipient'], claim['project_name'], claim['language'], claim['amount_minor'],
            )
            try:
                if self.gmail is None:
                    raise EmailDeliveryError('GMAIL_NOT_CONNECTED')
                result = self.gmail.send_refund_confirmation(owner, item, parent)
            except EmailDeliveryError as error:
                result = {'status': 'delivery_uncertain' if error.uncertain else 'failed', 'error_code': error.code}
            repo.rpc('refund_confirmation_finish', {
                'p_owner': str(owner), 'p_settlement': parent, 'p_claim': claim['claim_id'], 'p_result': result,
            })
            if settlement is not None:
                return {key: result.get(key) for key in ('status', 'error_code')}

    def after_confirmation(self, owner, *, settlement=None, payment=None):
        try:
            return self.dispatch(owner, settlement=settlement, payment=payment)
        except ApiError as error:
            logger.warning('Refund confirmation dispatch could not be recorded: %s', error.code)
