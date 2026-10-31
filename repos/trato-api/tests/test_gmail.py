"""OAuth and Gmail tests use synthetic credentials and local HTTP doubles only."""
import base64
from dataclasses import replace
from email import policy
from email.parser import BytesParser
import hashlib
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI, Request, HTTPException
from fastapi.testclient import TestClient
from paypal.email import ProposalEmail, PdfAttachment, EmailDeliveryError
from trato_api.gmail.vault import TokenVault, GmailError
from trato_api.gmail.service import GmailSettings, GmailConnectionService, GoogleTransport, SEND_SCOPE, READ_SCOPE, TOKEN_URL, USERINFO_URL, SEND_URL, THREADS_URL, ATTACHMENTS_URL, reply_text
from trato_api.gmail.routes import build_gmail_router


class GmailTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.now=1000
        self.settings=GmailSettings('fake-client','fake-secret','http://localhost:5173/gmail-callback.html',Fernet.generate_key().decode(),str(Path(self.temp.name)/'vault.sqlite3'))
        self.vault=TokenVault(self.settings.vault_path,self.settings.encryption_key,clock=lambda:self.now)
        self.calls=[];self.responses=[]
        def transport(method,url,**kwargs):
            self.calls.append((method,url,kwargs))
            response=self.responses.pop(0)
            if isinstance(response,Exception):raise response
            return response
        self.service=GmailConnectionService(self.settings,self.vault,transport,clock=lambda:self.now)

    def token(self,**changes):
        return {'access_token':'synthetic-access','refresh_token':'synthetic-refresh','token_type':'Bearer','scope':'openid email '+SEND_SCOPE,'expires_in':3600,**changes}

    def connect(self,owner='owner'):
        query=parse_qs(urlparse(self.service.start(owner)['authorization_url']).query)
        self.responses.extend([(200,self.token()),(200,{'sub':'google-subject','email':'sender@example.com','email_verified':True})])
        self.service.complete(owner,query['state'][0],code='synthetic-code')
        return query

    def proposal(self):
        content=b'%PDF-1.4\nFictitious adenda\n%%EOF'
        attachment=PdfAttachment('adenda.pdf',content,hashlib.sha256(content).hexdigest())
        return ProposalEmail('proposal','client@example.com','Client','Project','Extra revisado','180.00','USD','2026-11-12',attachment)

    def test_authorization_requests_send_only_plus_identity_and_pkce(self):
        data=self.service.start('owner')
        query=parse_qs(urlparse(data['authorization_url']).query)
        self.assertEqual(query['code_challenge_method'],['S256'])
        self.assertEqual(query['scope'][0].split(),['openid','email',SEND_SCOPE])
        self.assertEqual(query['redirect_uri'],[self.settings.redirect_uri])
        self.assertNotIn('fake-secret',data['authorization_url'])
        self.assertNotIn('code_verifier',query)

    def test_read_consent_is_incremental_and_bound_to_existing_sender(self):
        self.connect()
        query=parse_qs(urlparse(self.service.start('owner','read')['authorization_url']).query)
        self.assertEqual(query['scope'],[READ_SCOPE])
        self.assertEqual(query['include_granted_scopes'],['true'])
        self.assertEqual(query['login_hint'],['sender@example.com'])
        self.assertNotIn('gmail.modify',' '.join(query['scope']))
        self.assertNotIn('mail.google.com',' '.join(query['scope']))
        self.responses.extend([(200,self.token(scope='openid email '+SEND_SCOPE+' '+READ_SCOPE)),
                               (200,{'sub':'google-subject','email':'sender@example.com','email_verified':True})])
        status=self.service.complete('owner',query['state'][0],code='read-consent-code')
        self.assertTrue(status['can_send']);self.assertTrue(status['can_read'])
        self.assertEqual(self.vault.get('owner')['refresh_token'],'synthetic-refresh')

    def test_read_consent_requires_existing_send_account_and_does_not_replace_on_denial(self):
        with self.assertRaises(GmailError):self.service.start('owner','read')
        self.connect()
        previous=self.vault.get('owner')
        query=parse_qs(urlparse(self.service.start('owner','read')['authorization_url']).query)
        self.responses.extend([(200,self.token(scope='openid email '+SEND_SCOPE)),
                               (200,{'sub':'google-subject','email':'sender@example.com','email_verified':True})])
        with self.assertRaises(GmailError) as caught:self.service.complete('owner',query['state'][0],code='read-consent-code')
        self.assertEqual(caught.exception.code,'GMAIL_READ_PERMISSION_REQUIRED')
        self.assertEqual(self.vault.get('owner'),previous)
        self.assertTrue(self.service.status('owner')['can_send'])
        self.assertFalse(self.service.status('owner')['can_read'])

    def test_read_reconsent_cannot_switch_google_account(self):
        self.connect()
        before=self.vault.get('owner')
        query=parse_qs(urlparse(self.service.start('owner','read')['authorization_url']).query)
        self.responses.extend([(200,self.token(scope='openid email '+SEND_SCOPE+' '+READ_SCOPE)),
                               (200,{'sub':'different-subject','email':'other@example.com','email_verified':True})])
        with self.assertRaises(GmailError) as caught:self.service.complete('owner',query['state'][0],code='read-consent-code')
        self.assertEqual(caught.exception.code,'GMAIL_ACCOUNT_CHANGED')
        self.assertEqual(self.vault.get('owner'),before)

    def test_read_endpoints_require_read_scope_and_transport_allows_only_fixed_google_paths(self):
        self.connect()
        with self.assertRaises(GmailError) as caught:self.service.read_thread('owner','known-thread')
        self.assertEqual(caught.exception.code,'GMAIL_READ_PERMISSION_REQUIRED')
        transport=GoogleTransport(httpx.MockTransport(lambda request:httpx.Response(200,json={})))
        self.assertEqual(transport('GET',THREADS_URL+'/known-thread?format=full')[0],200)
        self.assertEqual(transport('GET',ATTACHMENTS_URL+'/known-message/attachments/known-part')[0],200)
        for method,url in [('POST',THREADS_URL+'/known-thread'),('GET','https://evil.invalid/gmail/v1/users/me/threads/known-thread'),
                           ('GET',THREADS_URL+'/../messages/send'),('GET',ATTACHMENTS_URL+'/m/attachments/p/extra')]:
            with self.subTest(method=method,url=url),self.assertRaises(GmailError):transport(method,url)

    def test_read_thread_and_attachment_require_read_scope_before_network(self):
        self.connect()
        call_count=len(self.calls)
        with self.assertRaises(GmailError):self.service.read_thread('owner','known-thread')
        with self.assertRaises(GmailError):self.service.read_attachment('owner','known-message','known-part')
        self.assertEqual(len(self.calls),call_count)

    def test_message_parser_preserves_plain_text_and_only_describes_pdf_attachment(self):
        import base64
        encoded=lambda value:base64.urlsafe_b64encode(value).decode().rstrip('=')
        message={'payload':{'mimeType':'multipart/mixed','parts':[
            {'mimeType':'text/plain','body':{'data':encoded(b'Please revise delivery date.')}},
            {'mimeType':'application/pdf','filename':'../offer.pdf','body':{'attachmentId':'attachment-1','size':7}},
            {'mimeType':'application/octet-stream','filename':'other.exe','body':{'attachmentId':'attachment-2','size':4}},
        ]}}
        value=self.service.message_content(message)
        self.assertEqual(value['body_text'],'Please revise delivery date.')
        self.assertEqual(value['attachments'][0],{'attachment_id':'attachment-1','filename':'offer.pdf','mime_type':'application/pdf','size_bytes':7,'supported':True})
        self.assertFalse(value['attachments'][1]['supported'])

    def test_reply_text_hides_wrapped_gmail_quotes_in_spanish_and_english(self):
        answer='Hola,\nProponemos USD 140.\nSaludos,\nCafé Mirador'
        for header in ['El vie, 30 oct 2026 a la(s) 9:26 p.m., <sender@example.com>\nescribió:',
                       'On Fri, Oct 30, 2026 at 9:26 PM Sender\n<sender@example.com> wrote:']:
            with self.subTest(header=header):
                original=answer+'\n\n'+header+'\n\n> Original proposal\n> USD 250.\n'
                self.assertEqual(reply_text(original),answer)
                self.assertIn('USD 250',original)
        self.assertEqual(reply_text(answer),answer)
        self.assertEqual(reply_text('Change the amount.\n\n> Previous terms'), 'Change the amount.')

    def test_reply_text_preserves_inline_feedback_after_a_quote(self):
        original='> Can you deliver Friday?\nYes, Friday works.\n\n> Original terms'
        self.assertIn('Yes, Friday works.',reply_text(original))
        self.assertEqual(reply_text('El cliente escribió: debemos cambiar el alcance.'),
                         'El cliente escribió: debemos cambiar el alcance.')

    def test_long_gmail_attachment_ids_are_parsed_and_downloaded(self):
        attachment_id='A'*404
        message={'payload':{'mimeType':'application/pdf','filename':'offer.pdf','body':{'attachmentId':attachment_id,'size':10}}}
        self.assertEqual(self.service.message_content(message)['attachments'][0]['attachment_id'],attachment_id)
        self.connect()
        credentials=self.vault.get('owner');credentials['scope']+=' '+READ_SCOPE;self.vault.save('owner',credentials)
        raw=b'%PDF-test'
        self.responses.append((200,{'data':base64.urlsafe_b64encode(raw).decode(),'size':len(raw)}))
        self.assertEqual(self.service.read_attachment('owner','message-1',attachment_id),raw)
        transport=GoogleTransport(httpx.MockTransport(lambda request:httpx.Response(200,json={})))
        self.assertEqual(transport('GET',ATTACHMENTS_URL+'/message-1/attachments/'+attachment_id)[0],200)
        call_count=len(self.calls)
        for invalid in [attachment_id+'/escape','A'*2049,'bad?token=x','é']:
            with self.subTest(invalid_length=len(invalid)),self.assertRaises(GmailError):
                self.service.read_attachment('owner','message-1',invalid)
            message['payload']['body']['attachmentId']=invalid
            with self.assertRaises(GmailError):self.service.message_content(message)
        self.assertEqual(len(self.calls),call_count)

    def test_message_parser_rejects_oversized_or_malformed_content(self):
        import base64
        huge=base64.urlsafe_b64encode(b'x'*65537).decode().rstrip('=')
        with self.assertRaises(GmailError):self.service.message_content({'payload':{'mimeType':'text/plain','body':{'data':huge}}})
        with self.assertRaises(GmailError):self.service.message_content({'payload':{'mimeType':'text/plain','body':{'data':'%%%'}}})

    def test_message_parser_enforces_mime_depth_and_total_part_limits(self):
        def chain(levels):
            root={'mimeType':'multipart/mixed','parts':[]};node=root
            for _ in range(levels):
                child={'mimeType':'multipart/mixed','parts':[]};node['parts'].append(child);node=child
            return {'payload':root}
        self.assertEqual(self.service.message_content(chain(20)),{'body_text':'','attachments':[]})
        with self.assertRaises(GmailError) as depth:self.service.message_content(chain(21))
        self.assertEqual(depth.exception.code,'GMAIL_MESSAGE_TOO_COMPLEX')
        exact={'payload':{'mimeType':'multipart/mixed','parts':[{'mimeType':'text/plain'} for _ in range(99)]}}
        extra={'payload':{'mimeType':'multipart/mixed','parts':[{'mimeType':'text/plain'} for _ in range(100)]}}
        self.assertEqual(self.service.message_content(exact),{'body_text':'','attachments':[]})
        with self.assertRaises(GmailError) as count:self.service.message_content(extra)
        self.assertEqual(count.exception.code,'GMAIL_MESSAGE_TOO_COMPLEX')

    def test_state_is_user_bound_single_use_and_exchange_uses_pkce(self):
        query=parse_qs(urlparse(self.service.start('owner')['authorization_url']).query)
        state=query['state'][0]
        with self.assertRaises(GmailError):self.service.complete('another',state,code='code')
        self.assertEqual(self.calls,[])
        self.responses.extend([(200,self.token()),(200,{'sub':'subject','email':'sender@example.com','email_verified':True})])
        result=self.service.complete('owner',state,code='code')
        verifier=self.calls[0][2]['data']['code_verifier']
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        self.assertEqual(query['code_challenge'],[challenge])
        self.assertTrue(result['connected'])
        with self.assertRaises(GmailError):self.service.complete('owner',state,code='code')
        self.assertEqual(len(self.calls),2)

    def test_expired_state_or_denied_consent_never_exchanges(self):
        state=parse_qs(urlparse(self.service.start('owner')['authorization_url']).query)['state'][0]
        self.now+=601
        with self.assertRaises(GmailError):self.service.complete('owner',state,code='code')
        state=parse_qs(urlparse(self.service.start('owner')['authorization_url']).query)['state'][0]
        with self.assertRaises(GmailError):self.service.complete('owner',state,error='access_denied')
        self.assertEqual(self.calls,[])
        self.assertFalse(self.service.status('owner')['connected'])

    def test_private_vault_encrypts_tokens_and_separates_users(self):
        self.connect()
        data=Path(self.settings.vault_path).read_bytes()
        self.assertNotIn(b'synthetic-access',data);self.assertNotIn(b'synthetic-refresh',data)
        self.assertEqual(Path(self.settings.vault_path).stat().st_mode & 0o777,0o600)
        self.assertIsNone(self.vault.get('another'))
        self.assertEqual(self.service.status('owner'),{'configured':True,'connected':True,'email':'sender@example.com','can_send':True,'can_read':False})
        self.assertNotIn('fake-secret',repr(self.settings))

    def test_swapping_encrypted_rows_is_detected(self):
        self.vault.save('owner',{'access_token':'synthetic'})
        with self.vault.connect() as db:db.execute("UPDATE connections SET owner='another' WHERE owner='owner'")
        with self.assertRaises(GmailError):self.vault.get('another')

    def test_missing_scope_does_not_connect(self):
        state=parse_qs(urlparse(self.service.start('owner')['authorization_url']).query)['state'][0]
        self.responses.append((200,self.token(scope='openid email')))
        with self.assertRaises(GmailError):self.service.complete('owner',state,code='code')
        self.assertFalse(self.service.status('owner')['connected'])
        self.assertEqual(len(self.calls),1)

    def test_unverified_google_identity_does_not_connect(self):
        state=parse_qs(urlparse(self.service.start('owner')['authorization_url']).query)['state'][0]
        self.responses.extend([(200,self.token()),(200,{'sub':'subject','email':'sender@example.com','email_verified':False})])
        with self.assertRaises(GmailError):self.service.complete('owner',state,code='code')
        self.assertFalse(self.service.status('owner')['connected'])

    def test_refresh_keeps_refresh_token_without_exposing_it(self):
        self.connect();self.now+=3601
        refreshed=self.token(access_token='fresh-access');refreshed.pop('refresh_token')
        self.responses.append((200,refreshed))
        self.assertEqual(self.service.credentials('owner')['access_token'],'fresh-access')
        self.assertEqual(self.vault.get('owner')['refresh_token'],'synthetic-refresh')
        self.assertNotIn('access_token',self.service.status('owner'))
        self.assertEqual(self.calls[-1][2]['data']['grant_type'],'refresh_token')

    def test_revoked_refresh_requires_reconnection_and_clears_vault(self):
        self.connect();self.now+=3601;self.responses.append((400,{'error':'invalid_grant'}))
        with self.assertRaises(GmailError):self.service.credentials('owner')
        self.assertIsNone(self.vault.get('owner'))

    def test_send_uses_connected_sender_and_preserves_pdf(self):
        self.connect();self.responses.append((200,{'id':'gmail-id'}))
        result=self.service.send('owner',self.proposal(),'notice',proposal=True)
        self.assertEqual(result,{'status':'accepted_by_gmail','message_id':'gmail-id','thread_id':None})
        self.assertEqual(self.calls[-1][1],SEND_URL)
        raw=base64.urlsafe_b64decode(self.calls[-1][2]['json']['raw'])
        message=BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(message['From'],'sender@example.com')
        self.assertEqual(message['To'],'client@example.com')
        self.assertEqual(list(message.iter_attachments())[0].get_payload(decode=True),self.proposal().agreement.content)

    def test_send_network_loss_is_uncertain_and_is_not_retried(self):
        self.connect();self.responses.append(GmailError('GOOGLE_UNAVAILABLE',uncertain=True))
        with self.assertRaises(EmailDeliveryError) as error:self.service.send('owner',self.proposal(),'notice',proposal=True)
        self.assertTrue(error.exception.uncertain)
        self.assertEqual(sum(call[1]==SEND_URL for call in self.calls),1)

    def test_disconnected_user_cannot_send(self):
        with self.assertRaises(EmailDeliveryError):self.service.send('other',self.proposal(),'notice',proposal=True)
        self.assertEqual(self.calls,[])

    def test_disconnect_removes_tokens_even_if_revocation_network_fails(self):
        self.connect();self.responses.append(GmailError('GOOGLE_UNAVAILABLE'))
        result=self.service.disconnect('owner')
        self.assertFalse(result['connected']);self.assertFalse(result['revoked'])
        self.assertIsNone(self.vault.get('owner'))

    def test_http_transport_never_follows_redirects_or_accepts_other_urls(self):
        calls=[]
        def response(request):calls.append(str(request.url));return httpx.Response(302,headers={'location':'https://example.invalid/steal'})
        transport=GoogleTransport(httpx.MockTransport(response))
        self.assertEqual(transport('POST',TOKEN_URL,data={})[0],302)
        self.assertEqual(calls,[TOKEN_URL])
        with self.assertRaises(GmailError):transport('POST','https://example.invalid/steal')

    def test_invalid_expiry_and_scope_shapes_are_rejected(self):
        for changes in [{'expires_in':float('inf')},{'expires_in':-1},{'scope':[]},{'access_token':'bad\r\nToken'}]:
            with self.subTest(changes=changes),self.assertRaises(GmailError):self.service.token_fields(self.token(**changes))


class GmailRoutesTest(unittest.TestCase):
    def client(self,service=None):
        app=FastAPI()
        def user(request:Request):
            if request.headers.get('Authorization')!='Bearer synthetic-user':raise HTTPException(401)
            return 'owner'
        app.include_router(build_gmail_router(service,user))
        return TestClient(app)

    def test_connection_requires_authentication_and_reports_missing_config(self):
        client=self.client();auth={'Authorization':'Bearer synthetic-user'}
        self.assertEqual(client.get('/api/v1/integrations/gmail').status_code,401)
        self.assertFalse(client.get('/api/v1/integrations/gmail',headers=auth).json()['data']['configured'])
        self.assertEqual(client.post('/api/v1/integrations/gmail/connect',headers=auth,json={}).status_code,503)

    def test_browser_cannot_supply_secrets_recipient_or_redirect(self):
        client=self.client();auth={'Authorization':'Bearer synthetic-user'}
        for extra in [{'recipient_email':'other@example.com'},{'redirect_uri':'https://example.invalid'},{'access_token':'synthetic'}]:
            self.assertEqual(client.post('/api/v1/integrations/gmail/connect',headers=auth,json=extra).status_code,422)
        self.assertEqual(client.post('/api/v1/integrations/gmail/complete',headers=auth,json={'state':'x'*40,'code':'test','owner_id':'other'}).status_code,422)
        self.assertEqual(client.post('/api/v1/integrations/gmail/complete',headers=auth,json={'state':'x'*40,'code':'test','error':'access_denied'}).status_code,422)
