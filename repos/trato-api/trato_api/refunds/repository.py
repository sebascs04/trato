"""User-scoped persistent refund records. SQL owns all mutations and checks."""
from ..errors import ApiError
from ..persistence import Repository, uuid


class RefundRepository(Repository):
    def financial(self,settlement_id):
        return self.rpc('refund_financial',{'p_settlement_id':uuid(settlement_id)})

    def financial_authorize(self,data,key):
        return self.rpc('refund_financial_authorize',{'p_data':data,'p_key':key})

    def eligible_payments(self, project_id):
        self.project(project_id)
        return self.rpc('refund_payments', {'p_project_id': uuid(project_id)})

    def received_payments(self, project_id, payment_id=None):
        project = self.project(project_id)
        filters = {'select': 'id,capture_id', 'project_id': 'eq.' + project['id'], 'order': 'id.asc'}
        if payment_id is not None:
            filters['id'] = 'eq.' + uuid(payment_id)
        return self._all_rows('project_received_payments', filters)

    def operation(self, project_id, key):
        return self.rpc('refund_command_result', {'p_project_id': uuid(project_id), 'p_key': key})

    def _all_rows(self, table, params, page_size=100):
        result = []
        offset = 0
        while True:
            page = self.rows(table, {**params, 'limit': page_size, 'offset': offset})
            result.extend(page)
            if len(page) < page_size:
                return result
            offset += len(page)

    def settlement(self, settlement_id):
        records = self.rows('refund_settlements', {'select': '*', 'id': 'eq.' + uuid(settlement_id)})
        if not records:
            raise ApiError('REFUND_NOT_FOUND', 404)
        return records[0]

    def list_settlements(self, project_id):
        project = self.project(project_id)
        return self.rows('refund_settlements', {'select': '*', 'project_id': 'eq.' + project['id'],
                                              'order': 'created_at.desc,id.desc', 'limit': 100})

    def detail(self, settlement_id):
        item = self.settlement(settlement_id)
        filters = {'settlement_id': 'eq.' + item['id']}
        return {'settlement': item,
                'snapshots': self._all_rows('refund_snapshots', {
                    'select': 'id,settlement_id,version_no,draft_sequence,previous_snapshot_id,content_sha256,created_at',
                    **filters, 'order': 'version_no.desc,draft_sequence.desc'}),
                'payments': self._all_rows('refund_settlement_payments', {'select': '*', **filters, 'order': 'payment_id.asc'}),
                'events': self._all_rows('refund_events', {'select': '*', **filters,
                                                          'order': 'created_at.asc,id.asc'})}

    def snapshot(self, settlement_id, snapshot_id):
        item = self.settlement(settlement_id)
        records = self.rows('refund_snapshots', {'select': '*', 'settlement_id': 'eq.' + item['id'],
                                               'id': 'eq.' + uuid(snapshot_id)})
        if not records:
            raise ApiError('REFUND_SNAPSHOT_NOT_FOUND', 404)
        result = {'settlement': item, 'snapshot': records[0],
                'artifacts': self._all_rows('refund_artifacts', {'select': '*', **{'settlement_id': 'eq.' + item['id'], 'snapshot_id': 'eq.' + uuid(snapshot_id)}, 'order': 'created_at.asc'}),
                'reviews': self._all_rows('refund_reviews', {'select': '*', 'snapshot_id': 'eq.' + uuid(snapshot_id), 'order': 'created_at.asc'}),
                'deliveries': self._all_rows('refund_deliveries', {'select': '*', 'snapshot_id': 'eq.' + uuid(snapshot_id), 'order': 'created_at.desc,id.desc'}),
                'acceptances': self._all_rows('refund_acceptances', {'select': '*', 'snapshot_id': 'eq.' + uuid(snapshot_id), 'order': 'created_at.asc'}),
                'responses': self._all_rows('refund_client_responses', {'select': 'id,delivery_id,snapshot_id,settlement_id,provider_message_id,from_email,body_text,received_at,attachments,raw_message', 'snapshot_id': 'eq.' + uuid(snapshot_id), 'order': 'received_at.desc,id.desc'}, page_size=10),
                'sources': self._all_rows('refund_sources', {'select': '*', 'settlement_id': 'eq.' + item['id'],
                                                            'snapshot_id': 'eq.' + uuid(snapshot_id), 'order': 'id.asc'})}
        from ..gmail.service import display_reply
        for response in result['responses']:
            response.update(display_reply(response['body_text'],response.pop('raw_message',{})))
        return result

    def command(self, action, data, key):
        return self.rpc('refund_command', {'p_action': action, 'p_data': data, 'p_key': key})
