from dataclasses import replace
import hashlib
import unittest

from paypal.email import ProposalEmail, PdfAttachment, build_proposal_email, EmailDeliveryError, SmtpConfig, SmtpPaymentMailer
from paypal.notifications import NotificationClaim
from paypal.proposal_notifications import ProposalNotificationContext, ProposalNotificationService


class ProposalNotificationTest(unittest.TestCase):
    def context(self,amount='180.00'):
        pdf=b'%PDF-1.4\nFictitious proposal\n%%EOF'
        attachment=PdfAttachment('adenda-propuesta.pdf',pdf,hashlib.sha256(pdf).hexdigest())
        item=ProposalEmail('proposal','client@example.com','Ana','Campaña','Tres versiones verticales <revisadas>.',amount,'USD','2026-11-02',attachment)
        return ProposalNotificationContext('proposal','revision','owner','project','connected','ready_for_review','document','owner','project','revision',item)

    def service(self,context=None,state='acquired'):
        context=context or self.context()
        class Repository:
            def __init__(self):self.events=[]
            def resolve_proposal_email_context(self,*args):return context
            def reserve_proposal_notification(self,*args):
                self.events.append(('reserve',args))
                return NotificationClaim('proposal-notice',state,'lease')
            def start_delivery(self,*args,**kwargs):
                self.events.append(('start',kwargs))
                return NotificationClaim('proposal-notice','acquired','lease',1)
            def finish_notification(self,notice,result,**kwargs):self.events.append(('finish',result))
        class Mailer:
            def __init__(self):self.items=[];self.error=None
            def send_proposal(self,item,notice):
                self.items.append(item)
                if self.error:raise self.error
                return {'status':'accepted_by_smtp','message_id':'test-only'}
        repo,mailer=Repository(),Mailer()
        return ProposalNotificationService(repo,mailer),repo,mailer

    def test_review_email_has_pdf_conditions_and_no_checkout(self):
        context=self.context()
        message=build_proposal_email('studio@example.com',context.email,'notice')
        self.assertEqual(message['To'],'client@example.com')
        for kind in ['plain','html']:
            text=message.get_body(preferencelist=(kind,)).get_content()
            self.assertIn('180.00',text)
            self.assertIn('2026-11-02',text)
            self.assertIn('documento firmado',text)
            self.assertNotIn('paypal.com',text)
            self.assertNotIn('checkout',text)
        self.assertIn('&lt;revisadas&gt;',message.get_body(preferencelist=('html',)).get_content())
        self.assertEqual(list(message.iter_attachments())[0].get_payload(decode=True),context.email.agreement.content)

    def test_zero_extra_still_sends_proposal_for_review(self):
        context=self.context('0.00')
        message=build_proposal_email('studio@example.com',context.email,'notice')
        self.assertIn('Sin adicional',message.get_body(preferencelist=('plain',)).get_content())
        service,repo,mailer=self.service(context)
        service.send('owner','proposal','key')
        self.assertEqual(len(mailer.items),1)

    def test_wrong_document_context_or_owner_never_reserves(self):
        for field in ['owner_id','proposal_id','document_owner_id','document_project_id','document_revision_id']:
            service,repo,mailer=self.service(replace(self.context(),**{field:'other'}))
            with self.subTest(field=field),self.assertRaises(EmailDeliveryError):service.send('owner','proposal','key')
            self.assertEqual(repo.events,[])
            self.assertEqual(mailer.items,[])

    def test_draft_simulation_and_already_accepted_are_not_review_requests(self):
        for change in [{'status':'draft'},{'status':'accepted'},{'status':'superseded'},{'mode':'simulation'}]:
            service,repo,mailer=self.service(replace(self.context(),**change))
            with self.subTest(change=change),self.assertRaises(EmailDeliveryError):service.send('owner','proposal','key')
            self.assertEqual(repo.events,[])
            self.assertEqual(mailer.items,[])

    def test_duplicate_or_uncertain_send_never_resends(self):
        for state in ['accepted_by_smtp','accepted_by_gmail','delivery_uncertain','in_progress']:
            service,repo,mailer=self.service(state=state)
            if state in ('accepted_by_smtp','accepted_by_gmail'):self.assertTrue(service.send('owner','proposal','key')['duplicate'])
            else:
                with self.assertRaises(EmailDeliveryError):service.send('owner','proposal','key')
            self.assertEqual(len(repo.events),1)
            self.assertEqual(mailer.items,[])

    def test_loss_after_delivery_persists_uncertain_without_accepting_proposal(self):
        service,repo,mailer=self.service()
        mailer.error=EmailDeliveryError('SMTP_DELIVERY_FAILED',uncertain=True)
        with self.assertRaises(EmailDeliveryError):service.send('owner','proposal','key')
        self.assertEqual(repo.events[-1],('finish',{'status':'delivery_uncertain','code':'SMTP_DELIVERY_FAILED'}))
        self.assertEqual([event[0] for event in repo.events],['reserve','start','finish'])

    def test_changed_price_or_pdf_changes_reserved_hash(self):
        first=self.context()
        hashes=[]
        for item in [first.email,replace(first.email,additional_amount='200.00'),replace(first.email,agreement=replace(first.email.agreement,filename='adenda-otra.pdf'))]:
            service,repo,mailer=self.service(replace(first,email=item))
            service.send('owner','proposal','same-key')
            hashes.append(repo.events[0][1][-1])
        self.assertEqual(len(set(hashes)),3)

    def test_smtp_proposal_transport_serializes_pdf(self):
        sent=[]
        class LocalMailbox:
            def __init__(self,*args,**kwargs):pass
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def ehlo(self):pass
            def send_message(self,message):sent.append(message);return {}
        mailer=SmtpPaymentMailer(SmtpConfig('localhost',1025,'studio@example.com',encryption='local'),smtp_factory=LocalMailbox)
        result=mailer.send_proposal(self.context().email,'notice')
        self.assertEqual(result['status'],'accepted_by_smtp')
        self.assertEqual(len(list(sent[0].iter_attachments())),1)
        self.assertIn('Adenda para revisión',sent[0]['Subject'])

    def test_bad_terms_do_not_enter_outbox(self):
        first=self.context()
        for changes in [{'additional_amount':'-10.00'},{'revised_due_date':'mañana'},{'project_name':'Project\nBcc:other@example.com'},{'recipient_email':'bad'},{'proposed_scope':''}]:
            service,repo,mailer=self.service(replace(first,email=replace(first.email,**changes)))
            with self.subTest(changes=changes),self.assertRaises(EmailDeliveryError):service.send('owner','proposal','key')
            self.assertEqual(repo.events,[])


if __name__=='__main__':unittest.main()
