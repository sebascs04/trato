"""Inbound Gmail reply matching tests use synthetic messages and an in-memory backend double."""
from base64 import urlsafe_b64encode
from copy import deepcopy
from datetime import datetime, timezone
import threading
import unittest
from types import SimpleNamespace

from trato_api.errors import ApiError
from trato_api.proposals.workflow import ProposalWorkflow


def encoded(text):
    return urlsafe_b64encode(text.encode()).decode().rstrip('=')


def message(message_id, thread_id, received_at, headers, body=''):
    return {
        'id': message_id,
        'threadId': thread_id,
        'internalDate': str(int(datetime.fromisoformat(received_at.replace('Z', '+00:00')).timestamp() * 1000)),
        'payload': {
            'headers': [{'name': name, 'value': value} for name, value in headers.items()],
            'mimeType': 'text/plain',
            'body': {'data': encoded(body)} if body else {},
        },
    }


class GmailDouble:
    def __init__(self, thread):
        self.thread = thread
        self.reads = []

    def status(self, owner):
        return {'connected': True, 'email': 'sender@example.com', 'can_read': True}

    def read_thread(self, owner, thread_id):
        self.reads.append((owner, thread_id))
        if isinstance(self.thread, dict) and thread_id in self.thread:
            return {'id':thread_id,'messages':deepcopy(self.thread[thread_id])}
        return deepcopy(self.thread)

    @staticmethod
    def _header(item, name):
        return next((str(header.get('value', '')) for header in item.get('payload', {}).get('headers', [])
                     if str(header.get('name', '')).lower() == name.lower()), '')

    @staticmethod
    def message_content(item):
        import base64
        payload = item['payload']
        raw = base64.urlsafe_b64decode(payload['body']['data'] + '=' * ((4 - len(payload['body']['data']) % 4) % 4))
        return {'body_text': raw.decode(), 'attachments': []}


class BackendDouble:
    def __init__(self, target):
        self.target = target
        self.calls = []
        self.messages = {}

    def gmail_inbox(self, owner, action, data):
        self.calls.append((owner, action, deepcopy(data)))
        if action == 'targets':
            return deepcopy(self.target if isinstance(self.target,list) else [self.target])
        if action == 'record_sent_header':
            return {'provider_rfc_message_id': data['provider_rfc_message_id']}
        if action == 'known':
            return [message_id for message_id in data['provider_message_ids']
                    if (self.target.get('mailbox_email', 'sender@example.com'), message_id) in self.messages]
        if action == 'record':
            key = (data['mailbox_email'], data['provider_message_id'])
            previous = self.messages.get(key)
            if previous:
                if previous['body_sha256'] != data['body_sha256']:
                    raise AssertionError('duplicate Gmail ID with changed content must conflict')
                if not previous['attachment_metadata'] and data['attachment_metadata'] and not previous.get('used_at'):
                    previous['attachment_metadata']=deepcopy(data['attachment_metadata'])
                return previous
            value = {'id': 'inbound-row-' + data['provider_message_id'], **deepcopy(data)}
            self.messages[key] = value
            return value
        raise AssertionError('unexpected Gmail inbox action: ' + action)


class InboundReplyWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.sent_at = '2026-10-28T10:00:00Z'
        self.target = {
            'delivery_id': 'delivery-1',
            'provider_message_id': 'outbound-1',
            'provider_thread_id': 'thread-1',
            'recipient': 'client@example.com',
            'sent_at': self.sent_at,
            'client_email': 'client@example.com',
        }
        self.thread = {
            'id': 'thread-1',
            'messages': [
                message('outbound-1', 'thread-1', self.sent_at,
                        {'Message-ID': '<sent-v1@example.com>', 'From': 'sender@example.com', 'To': 'client@example.com'},
                        'The proposal terms.'),
                message('old-reply', 'thread-1', '2026-10-28T09:59:00Z',
                        {'Message-ID': '<old@example.com>', 'From': 'client@example.com', 'To': 'sender@example.com',
                         'In-Reply-To': '<sent-v1@example.com>'}, 'An earlier response.'),
                message('wrong-sender', 'thread-1', '2026-10-28T10:05:00Z',
                        {'Message-ID': '<spoof@example.com>', 'From': 'attacker@example.com', 'To': 'sender@example.com',
                         'In-Reply-To': '<sent-v1@example.com>'}, 'Wrong sender.'),
                message('wrong-recipient', 'thread-1', '2026-10-28T10:06:00Z',
                        {'Message-ID': '<wrong-to@example.com>', 'From': 'client@example.com', 'To': 'other@example.com',
                         'In-Reply-To': '<sent-v1@example.com>'}, 'Wrong recipient.'),
                message('wrong-reference', 'thread-1', '2026-10-28T10:07:00Z',
                        {'Message-ID': '<unrelated@example.com>', 'From': 'client@example.com', 'To': 'sender@example.com',
                         'In-Reply-To': '<unrelated-sent@example.com>'}, 'Unrelated thread content.'),
                message('good-reply', 'thread-1', '2026-10-28T10:08:00Z',
                        {'Message-ID': '<reply@example.com>', 'From': 'Client Name <client@example.com>',
                         'To': 'sender@example.com', 'In-Reply-To': '<sent-v1@example.com>',
                         'References': '<sent-v1@example.com>'}, 'Please change the deadline to December.'),
                message('other-thread', 'thread-2', '2026-10-28T10:09:00Z',
                        {'Message-ID': '<other@example.com>', 'From': 'client@example.com', 'To': 'sender@example.com',
                         'In-Reply-To': '<sent-v1@example.com>'}, 'Different Gmail thread.'),
            ],
        }
        self.gmail = GmailDouble(self.thread)
        self.store = BackendDouble(self.target)
        self.workflow = ProposalWorkflow(SimpleNamespace(web_origin='https://trato.example'), self.gmail, store=self.store)

    def test_sync_records_only_new_reply_matching_thread_headers_and_participants(self):
        result = self.workflow.sync_gmail_replies(None, 'authenticated-owner', 'project-1')
        self.assertEqual(result['synced'], 1)
        self.assertEqual(len(self.store.messages), 1)
        saved = next(iter(self.store.messages.values()))
        self.assertEqual(saved['provider_message_id'], 'good-reply')
        self.assertEqual(saved['from_email'], 'client@example.com')
        self.assertEqual(saved['body_text'], 'Please change the deadline to December.')
        self.assertEqual(saved['provider_rfc_message_id'], 'sent-v1@example.com')
        self.assertEqual(self.gmail.reads, [('authenticated-owner', 'thread-1')])
        self.assertEqual([action for _, action, _ in self.store.calls].count('record'), 1)

    def test_repeated_sync_does_not_create_a_second_local_message_record(self):
        first = self.workflow.sync_gmail_replies(None, 'authenticated-owner', 'project-1')
        key=('authenticated-owner','project-1')
        lock,started=self.workflow._gmail_sync_state[key]
        self.workflow._gmail_sync_state[key]=(lock,started-31)
        second = self.workflow.sync_gmail_replies(None, 'authenticated-owner', 'project-1')
        self.assertEqual(first['synced'], 1)
        self.assertEqual(second['synced'], 0)
        self.assertEqual(len(self.store.messages), 1)
        self.assertEqual([action for _, action, _ in self.store.calls].count('record'), 1)
        self.assertEqual(self.gmail.reads, [('authenticated-owner', 'thread-1'), ('authenticated-owner', 'thread-1')])

    def test_sync_recovers_missing_metadata_without_duplicating_known_reply(self):
        self.workflow.sync_gmail_replies(None,'authenticated-owner','project-1')
        saved=next(iter(self.store.messages.values()))
        original_body=saved['body_text'];original_hash=saved['body_sha256']
        parse=self.gmail.message_content
        attachment={'attachment_id':'part-1','filename':'counteroffer.pdf','mime_type':'application/pdf','size_bytes':100,'supported':True}
        self.gmail.message_content=lambda item:{**parse(item),'attachments':[attachment]}
        lock,started=self.workflow._gmail_sync_state[('authenticated-owner','project-1')]
        self.workflow._gmail_sync_state[('authenticated-owner','project-1')]=(lock,started-31)
        self.assertEqual(self.workflow.sync_gmail_replies(None,'authenticated-owner','project-1'),{'synced':0})
        self.assertEqual(len(self.store.messages),1)
        self.assertEqual(saved['attachment_metadata'],[attachment])
        self.assertEqual(saved['body_text'],original_body)
        self.assertEqual(saved['body_sha256'],original_hash)

    def test_missing_read_capability_fails_without_syncing(self):
        self.gmail.status = lambda owner: {'connected': True, 'email': 'sender@example.com', 'can_read': False}
        with self.assertRaises(Exception) as caught:
            self.workflow.sync_gmail_replies(None, 'authenticated-owner', 'project-1')
        self.assertEqual(getattr(caught.exception, 'code', None), 'GMAIL_READ_PERMISSION_REQUIRED')
        self.assertEqual(self.store.calls, [])
        self.assertEqual(self.gmail.reads, [])

    def test_sync_reads_at_most_five_known_adenda_threads(self):
        targets=[];threads={}
        for index in range(6):
            target={**self.target,'delivery_id':f'delivery-{index}','provider_message_id':f'outbound-{index}',
                    'provider_thread_id':f'thread-{index}'}
            targets.append(target)
            threads[target['provider_thread_id']]=[message(target['provider_message_id'],target['provider_thread_id'],self.sent_at,
                {'Message-ID':f'<sent-{index}@example.com>','From':'sender@example.com','To':'client@example.com'})]
        gmail=GmailDouble(threads);store=BackendDouble(targets)
        workflow=ProposalWorkflow(SimpleNamespace(web_origin='https://trato.example'),gmail,store=store)
        result=workflow.sync_gmail_replies(None,'owner','project-1')
        self.assertEqual(result,{'synced':0})
        self.assertEqual(len(gmail.reads),5)
        self.assertEqual([item[1] for item in gmail.reads],[f'thread-{index}' for index in range(5)])

    def test_sync_stops_after_twenty_five_new_replies_across_threads(self):
        replies=[]
        for index in range(26):
            replies.append(message(f'reply-{index}','thread-1',f'2026-10-28T10:{index+1:02d}:00Z',
                {'Message-ID':f'<reply-{index}@example.com>','From':'client@example.com','To':'sender@example.com',
                 'In-Reply-To':'<sent-v1@example.com>'},f'Change request {index}.'))
        thread_messages=[message('outbound-1','thread-1',self.sent_at,
            {'Message-ID':'<sent-v1@example.com>','From':'sender@example.com','To':'client@example.com'})]+replies
        gmail=GmailDouble({'thread-1':thread_messages});store=BackendDouble(self.target)
        workflow=ProposalWorkflow(SimpleNamespace(web_origin='https://trato.example'),gmail,store=store)
        result=workflow.sync_gmail_replies(None,'owner','project-1')
        self.assertEqual(result,{'synced':25})
        self.assertEqual(len(store.messages),25)
        self.assertEqual([action for _,action,_ in store.calls].count('record'),25)

    def test_sync_rejects_overlapping_and_rate_limited_runs_without_extra_gmail_reads(self):
        entered=threading.Event();release=threading.Event()
        class BlockingGmail(GmailDouble):
            def read_thread(self,owner,thread_id):
                entered.set()
                if not release.wait(3):raise AssertionError('test did not release blocked sync')
                return super().read_thread(owner,thread_id)
        gmail=BlockingGmail(self.thread);store=BackendDouble(self.target)
        workflow=ProposalWorkflow(SimpleNamespace(web_origin='https://trato.example'),gmail,store=store)
        outcome=[]
        runner=threading.Thread(target=lambda:outcome.append(workflow.sync_gmail_replies(None,'owner','project-1')))
        runner.start()
        self.assertTrue(entered.wait(2),'first sync did not reach Gmail')
        with self.assertRaises(ApiError) as overlap:
            workflow.sync_gmail_replies(None,'owner','project-1')
        self.assertEqual(overlap.exception.code,'GMAIL_SYNC_IN_PROGRESS')
        release.set();runner.join(3)
        self.assertFalse(runner.is_alive())
        self.assertEqual(outcome,[{'synced':1}])
        calls=len(gmail.reads)
        with self.assertRaises(ApiError) as limited:
            workflow.sync_gmail_replies(None,'owner','project-1')
        self.assertEqual(limited.exception.code,'GMAIL_SYNC_RATE_LIMITED')
        self.assertEqual(len(gmail.reads),calls)

    def test_sync_uses_only_targets_returned_for_requested_project(self):
        class ProjectScopedBackend(BackendDouble):
            def gmail_inbox(self,owner,action,data):
                if action=='targets' and data['project_id']!='project-1':
                    self.calls.append((owner,action,deepcopy(data)))
                    return []
                return super().gmail_inbox(owner,action,data)
        gmail=GmailDouble(self.thread);store=ProjectScopedBackend(self.target)
        workflow=ProposalWorkflow(SimpleNamespace(web_origin='https://trato.example'),gmail,store=store)
        result=workflow.sync_gmail_replies(None,'owner','project-other')
        self.assertEqual(result,{'synced':0})
        self.assertEqual(gmail.reads,[])
        self.assertFalse(any(action=='record' for _,action,_ in store.calls))
