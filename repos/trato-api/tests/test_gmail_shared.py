"""Central mailbox permissions and sender isolation. No real provider calls."""
from dataclasses import replace
from email import policy
from email.parser import BytesParser
import base64
from urllib.parse import parse_qs,urlparse
from uuid import uuid4
import unittest
from tests import test_gmail
from trato_api.gmail.shared import TratoGmailService
from trato_api.gmail.service import SEND_SCOPE,READ_SCOPE,SEND_URL
from trato_api.gmail.vault import GmailError

class SharedGmailTest(unittest.TestCase):
    token=test_gmail.GmailTest.token
    proposal=test_gmail.GmailTest.proposal
    def setUp(self):
        test_gmail.GmailTest.setUp(self)
        self.manager=str(uuid4());self.other=str(uuid4())
        settings=replace(self.settings,delivery_mode='trato',trato_owner=self.manager,trato_email='sender@example.com')
        self.service=TratoGmailService(settings,self.vault,self.service.transport,clock=lambda:self.now)
    def connect(self):
        query=parse_qs(urlparse(self.service.start(self.manager,'send_read')['authorization_url']).query)
        self.responses.extend([(200,self.token(scope='openid email '+SEND_SCOPE+' '+READ_SCOPE)),(200,{'sub':'central-subject','email':'sender@example.com','email_verified':True})])
        return self.service.complete(self.manager,query['state'][0],code='synthetic-code')
    def test_all_users_see_shared_availability_but_only_manager_can_authorize(self):
        self.connect()
        manager=self.service.status(self.manager);other=self.service.status(self.other)
        self.assertTrue(manager['can_manage_connection']);self.assertFalse(other['can_manage_connection'])
        self.assertTrue(other['connected']);self.assertEqual(other['delivery_mode'],'trato')
        self.assertNotIn('access_token',other);self.assertNotIn('refresh_token',other)
        for operation in [lambda:self.service.start(self.other),lambda:self.service.complete(self.other,'any-state',code='x'),lambda:self.service.disconnect(self.other)]:
            with self.assertRaises(GmailError) as caught:operation()
            self.assertEqual(caught.exception.status,403)
        self.assertTrue(self.service.status(self.manager)['connected'])
    def test_wrong_google_account_is_rejected_before_any_credentials_are_saved(self):
        query=parse_qs(urlparse(self.service.start(self.manager)['authorization_url']).query)
        self.responses.extend([(200,self.token(scope='openid email '+SEND_SCOPE+' '+READ_SCOPE)),(200,{'sub':'wrong-subject','email':'wrong@example.com','email_verified':True})])
        with self.assertRaises(GmailError) as caught:self.service.complete(self.manager,query['state'][0],code='wrong-mailbox')
        self.assertEqual(caught.exception.code,'GMAIL_TRATO_MAILBOX_MISMATCH')
        self.assertIsNone(self.vault.get(self.manager))
    def test_personal_connections_are_not_used_when_central_mail_is_disconnected(self):
        self.vault.save(self.other,{'email':'personal@example.com','scope':SEND_SCOPE+' '+READ_SCOPE,'access_token':'personal-token','refresh_token':'personal-refresh','expires_at':999999})
        with self.assertRaises(GmailError) as caught:self.service.credentials(self.other)
        self.assertEqual(caught.exception.code,'GMAIL_NOT_CONNECTED')
    def test_a_regular_user_sends_from_trato_to_an_outlook_recipient(self):
        self.connect();item=replace(self.proposal(),recipient_email='client@outlook.com')
        self.responses.append((200,{'id':'provider-message','threadId':'provider-thread'}))
        result=self.service.send(self.other,item,'notification-id',proposal=True)
        self.assertEqual(result['thread_id'],'provider-thread')
        sent=next(call for call in self.calls if call[1]==SEND_URL)
        message=BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(sent[2]['json']['raw']))
        self.assertEqual(message['From'],'sender@example.com');self.assertEqual(message['To'],'client@outlook.com')
        self.assertIsNone(self.vault.get(self.other))
    def test_central_account_requires_both_permissions(self):
        query=parse_qs(urlparse(self.service.start(self.manager)['authorization_url']).query)
        self.responses.append((200,self.token()))
        with self.assertRaises(GmailError):self.service.complete(self.manager,query['state'][0],code='partial')
        self.assertFalse(self.service.status(self.other)['connected'])

    def test_shared_access_token_is_renewed_for_any_authorized_business_caller(self):
        self.connect();self.now+=3601
        token=self.token(access_token='renewed-central-access',scope='openid email '+SEND_SCOPE+' '+READ_SCOPE)
        token.pop('refresh_token');self.responses.append((200,token))
        self.assertEqual(self.service.credentials(self.other)['access_token'],'renewed-central-access')
        self.assertEqual(self.vault.get(self.manager)['refresh_token'],'synthetic-refresh')
        self.assertIsNone(self.vault.get(self.other))

    def test_transient_provider_failure_does_not_erase_shared_authorization(self):
        self.connect();self.now+=3601;previous=self.vault.get(self.manager)
        self.responses.append((503,{'error':'temporarily_unavailable'}))
        with self.assertRaises(GmailError):self.service.credentials(self.other)
        self.assertEqual(self.vault.get(self.manager),previous)

    def test_expired_or_revoked_refresh_requires_human_reauthorization(self):
        self.connect();self.now+=3601;self.responses.append((400,{'error':'invalid_grant'}))
        with self.assertRaises(GmailError) as caught:self.service.credentials(self.other)
        self.assertEqual(caught.exception.code,'GMAIL_RECONNECT_REQUIRED')
        self.assertFalse(self.service.status(self.other)['connected'])
