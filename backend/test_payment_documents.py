"""Mail boundaries using fictitious PDFs; no network, OAuth or SMTP delivery."""
from dataclasses import replace
from email import policy
from email.parser import BytesParser
import hashlib
import unittest

from paypal.email import PdfAttachment, PaymentEmail, EmailDeliveryError, build_payment_email
from paypal.notifications import AgreementEmailDocument, NotificationContext, NotificationClaim, PaymentNotificationService
from paypal.repository import PayableAcceptance, PaymentRecord


PDF=b'%PDF-1.4\nFictitious agreement fixture\n%%EOF\n'


class PaymentDocumentsTest(unittest.TestCase):
    def attachment(self,content=PDF):
        return PdfAttachment('adenda-v2.pdf',content,hashlib.sha256(content).hexdigest())

    def context(self):
        acceptance=PayableAcceptance('owner','project','acceptance','revision','version','180.00','USD','merchant','connected')
        payment=PaymentRecord('payment',acceptance,'pending_approval','create','capture',approval_url='https://www.sandbox.paypal.com/checkoutnow?token=ORDER')
        document=AgreementEmailDocument('document','owner','project','acceptance','version',self.attachment())
        return NotificationContext(payment,'client@example.com','Ana','Campaña',document)

    def test_pdf_survives_serialization_and_both_bodies_include_notice(self):
        item=PaymentEmail('payment','client@example.com','Ana','Campaña','180.00','USD',self.context().payment.approval_url,self.attachment())
        message=build_payment_email('studio@example.com',item,'notification')
        parsed=BytesParser(policy=policy.default).parsebytes(message.as_bytes())
        attachments=list(parsed.iter_attachments())
        self.assertEqual(len(attachments),1)
        self.assertEqual(attachments[0].get_payload(decode=True),PDF)
        self.assertEqual(attachments[0].get_content_type(),'application/pdf')
        self.assertEqual(attachments[0].get_filename(),'adenda-v2.pdf')
        for subtype in ['plain','html']:
            self.assertIn('Adjuntamos la adenda',parsed.get_body(preferencelist=(subtype,)).get_content())

    def test_invalid_pdf_hash_size_and_filename_are_rejected(self):
        original=self.attachment()
        invalid=[replace(original,sha256='wrong'),self.attachment(b'not a pdf'),self.attachment(b'%PDF-'+b'x'*(10*1024*1024)),replace(original,filename='../private.pdf'),replace(original,filename='x.pdf\r\nBcc:other@example.com')]
        for attachment in invalid:
            with self.subTest(attachment=attachment.filename):
                item=PaymentEmail('p','client@example.com','','Project','180.00','USD',self.context().payment.approval_url,attachment)
                with self.assertRaises(EmailDeliveryError):build_payment_email('studio@example.com',item,'notice')

    def service(self,context):
        class Repository:
            def __init__(self):self.hashes=[];self.finished=[]
            def resolve_email_context(self,*args):return context
            def reserve_notification(self,user,payment,key,message_hash):
                self.hashes.append(message_hash)
                return NotificationClaim('notice','acquired','lease')
            def start_delivery(self,*args,**kwargs):return NotificationClaim('notice','acquired','lease',1)
            def finish_notification(self,notice,result,**kwargs):self.finished.append(result)
        class Mailer:
            def __init__(self):self.items=[]
            def send(self,item,notice):
                self.items.append(item)
                return {'status':'accepted_by_smtp','message_id':'test-only'}
        repository,mailer=Repository(),Mailer()
        return PaymentNotificationService(repository,mailer),repository,mailer

    def test_wrong_project_owner_acceptance_or_version_never_reserves_or_sends(self):
        context=self.context()
        for field in ['owner_id','project_id','acceptance_id','agreement_version_id']:
            service,repo,mailer=self.service(replace(context,agreement=replace(context.agreement,**{field:'another'})))
            with self.subTest(field=field),self.assertRaises(EmailDeliveryError):service.send('owner','payment','key')
            self.assertEqual(repo.hashes,[])
            self.assertEqual(mailer.items,[])

    def test_attachment_changes_notification_hash_and_reaches_transport(self):
        first=self.context()
        changed=replace(first,agreement=replace(first.agreement,attachment=self.attachment(PDF+b'changed')))
        hashes=[]
        for context in [first,changed]:
            service,repo,mailer=self.service(context)
            result=service.send('owner','payment','key')
            self.assertEqual(result['status'],'accepted_by_smtp')
            self.assertEqual(mailer.items[0].agreement,context.agreement.attachment)
            self.assertEqual(len(repo.finished),1)
            hashes.append(repo.hashes[0])
        self.assertNotEqual(*hashes)

    def test_email_without_document_remains_compatible(self):
        service,repo,mailer=self.service(replace(self.context(),agreement=None))
        service.send('owner','payment','key')
        self.assertIsNone(mailer.items[0].agreement)

    def test_wrong_payment_id_never_reserves(self):
        service,repo,mailer=self.service(self.context())
        with self.assertRaises(EmailDeliveryError):service.send('owner','another-payment','key')
        self.assertEqual(repo.hashes,[])
        self.assertEqual(mailer.items,[])

    def test_paid_payment_cannot_trigger_another_payment_email(self):
        context=self.context()
        service,repo,mailer=self.service(replace(context,payment=replace(context.payment,status='completed')))
        with self.assertRaises(EmailDeliveryError):service.send('owner','payment','key')
        self.assertEqual(repo.hashes,[])
        self.assertEqual(mailer.items,[])

    def test_zero_extra_cannot_trigger_payment_email(self):
        context=self.context()
        payment=replace(context.payment,acceptance=replace(context.payment.acceptance,amount='0.00'))
        service,repo,mailer=self.service(replace(context,payment=payment))
        with self.assertRaises(EmailDeliveryError) as error:service.send('owner','payment','key')
        self.assertEqual(error.exception.code,'PAYMENT_NOT_REQUIRED')
        self.assertEqual(repo.hashes,[])
        self.assertEqual(mailer.items,[])

    def test_gmail_acceptance_is_deduplicated_without_sending_again(self):
        service,repo,mailer=self.service(self.context())
        repo.reserve_notification=lambda *args:NotificationClaim('notice','accepted_by_gmail')
        result=service.send('owner','payment','key')
        self.assertTrue(result['duplicate'])
        self.assertEqual(result['status'],'accepted_by_gmail')
        self.assertEqual(mailer.items,[])


if __name__=='__main__':unittest.main()
