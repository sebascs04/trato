"""Shared backend-only index receipts. Redis is not the source of readiness."""
from copy import deepcopy
from .errors import ApiError
from .persistence import uuid
from .thread_store import ThreadStore


class VectorReceipts:
    def __init__(self, settings, *, repo=None):
        self.settings, self.repo = settings, repo

    def repository(self):
        if self.repo is None:
            self.repo = ThreadStore(self.settings).repo
        return self.repo

    def get(self, owner, file_id):
        rows = self.repository().rows('document_vector_receipts', {
            'select': 'receipt', 'owner_id': 'eq.'+uuid(owner), 'document_id': 'eq.'+uuid(file_id)})
        return deepcopy(rows[0]['receipt']) if rows else None

    def get_many(self, owner, file_ids):
        """{file_id: receipt} for several documents in one query; documents without a receipt are absent."""
        ids = sorted({uuid(i) for i in file_ids})
        found = {}
        for start in range(0, len(ids), 50):
            rows = self.repository().rows('document_vector_receipts', {'select': 'document_id,receipt',
                'owner_id': 'eq.'+uuid(owner), 'document_id': 'in.(' + ','.join(ids[start:start+50]) + ')'})
            found.update({row['document_id']: deepcopy(row['receipt']) for row in rows})
        return found

    def put(self, owner, file_id, receipt):
        self.repository().call('POST', '/rest/v1/document_vector_receipts',
            params={'on_conflict': 'document_id'}, headers={'Prefer': 'resolution=merge-duplicates'},
            json={'document_id': uuid(file_id), 'owner_id': uuid(owner),
                  'project_id': uuid(receipt['project_id']), 'receipt': receipt})

    def remove(self, owner, file_id):
        self.repository().call('DELETE', '/rest/v1/document_vector_receipts',
            params={'owner_id': 'eq.'+uuid(owner), 'document_id': 'eq.'+uuid(file_id)})
