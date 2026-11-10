"""Check PayPal before creating a refund or attempting to move money."""
import re

from ..disputes import DisputeReader, dispute_refund_ids, summarize
from ..errors import ApiError


def ensure_no_open_dispute(capture_id, reader=None):
    """Return expected refund IDs for buyer resolutions, or None if there are none."""
    client = (reader or DisputeReader()).provider()
    listing = client.list_disputes(capture_id)
    items = listing.get('items', [])
    links = listing.get('links', [])
    if (
        not isinstance(items, list) or not isinstance(links, list)
        or any(not isinstance(link, dict) or link.get('rel') == 'next' for link in links)
        or 'name' in listing or 'error' in listing
    ):
        raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
    expected_refunds = None
    missing_refund_reference = False
    for item in items:
        dispute_id = item.get('dispute_id') if isinstance(item, dict) else None
        if not isinstance(dispute_id, str) or not re.fullmatch(r'PP-[A-Z0-9-]{4,40}', dispute_id):
            raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
        details = client.get_dispute(dispute_id)
        dispute = summarize(details, {'capture_id': capture_id})
        if dispute is None or dispute['dispute_id'] != dispute_id or not dispute['status']:
            raise ApiError('INVALID_PROVIDER_RESPONSE', 502)
        if dispute['status'] != 'RESOLVED':
            raise ApiError('REFUND_PAYMENT_IN_DISPUTE', 409)
        if not dispute['outcome'] or dispute['outcome'] == 'NONE':
            missing_refund_reference = True
        if dispute['outcome'] in ('RESOLVED_BUYER_FAVOUR', 'ACCEPTED'):
            if expected_refunds is None:
                expected_refunds = set()
            ids = dispute_refund_ids(details)
            if not ids:
                missing_refund_reference = True
            expected_refunds.update(ids)
    return set() if missing_refund_reference else expected_refunds
