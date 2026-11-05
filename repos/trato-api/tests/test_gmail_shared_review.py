"""Central-mail transport and revision matching regressions; local doubles only."""
from copy import deepcopy
from tests import test_gmail_shared as shared_fixture
from tests import test_gmail_inbound as inbound_fixture
from paypal.email import EmailDeliveryError
import unittest

class SharedMailboxSenderTests(unittest.TestCase):
 def setUp(self):
  self.fixture=shared_fixture.SharedGmailTest();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups);self.fixture.connect()
 def test_same_mailbox_with_different_casing_can_send_without_changing_stored_identity(self):
  f=self.fixture;saved=f.vault.get(f.manager);saved['email']='Sender@Example.com';f.vault.save(f.manager,saved)
  f.responses.append((200,{'id':'synthetic-message','threadId':'synthetic-thread'}))
  result=f.service.send(f.other,f.proposal(),'synthetic-notification',proposal=True,expected_sender=f.service.status(f.other)['email'])
  self.assertEqual(result['status'],'accepted_by_gmail')
  self.assertEqual(f.vault.get(f.manager)['email'],'Sender@Example.com')
  self.assertIsNone(f.vault.get(f.other))
 def test_an_actual_different_sender_remains_rejected_without_provider_send(self):
  f=self.fixture;count=len(f.calls)
  with self.assertRaises(EmailDeliveryError) as error:
   f.service.send(f.other,f.proposal(),'synthetic-notification',proposal=True,expected_sender='different@example.com')
  self.assertEqual(error.exception.code,'GMAIL_SENDER_CHANGED');self.assertEqual(len(f.calls),count)

class DirectRevisionReplyTests(unittest.TestCase):
 def sync(self,immediate,references):
  f=inbound_fixture.InboundReplyWorkflowTest();f.setUp();self.addCleanup(f.doCleanups)
  good=deepcopy(next(m for m in f.thread['messages'] if m['id']=='good-reply'))
  good['payload']['headers']=[h for h in good['payload']['headers'] if h['name'] not in ('In-Reply-To','References')]
  if immediate is not None:good['payload']['headers'].append({'name':'In-Reply-To','value':immediate})
  if references is not None:good['payload']['headers'].append({'name':'References','value':references})
  f.thread['messages']=[f.thread['messages'][0],good]
  result=f.workflow.sync_gmail_replies(None,'business-owner','project-1')
  return result,f.store
 def test_other_revision_cannot_match_only_an_older_reference(self):
  result,store=self.sync('<other-revision@example.com>','<sent-v1@example.com> <other-revision@example.com>')
  self.assertEqual(result,{'synced':0});self.assertEqual(store.messages,{})
 def test_without_direct_header_only_final_reference_may_match(self):
  for references,expected in [('<sent-v1@example.com> <other-revision@example.com>',0),('<older@example.com> <sent-v1@example.com>',1)]:
   with self.subTest(references=references):
    result,_=self.sync(None,references);self.assertEqual(result['synced'],expected)
 def test_direct_correct_revision_is_accepted_with_older_ancestors(self):
  result,store=self.sync('<sent-v1@example.com>','<older@example.com> <sent-v1@example.com>')
  self.assertEqual(result,{'synced':1});self.assertEqual(len(store.messages),1)
 def test_ambiguous_direct_reply_header_is_rejected(self):
  result,_=self.sync('<sent-v1@example.com> <other-revision@example.com>','<sent-v1@example.com>')
  self.assertEqual(result,{'synced':0})
