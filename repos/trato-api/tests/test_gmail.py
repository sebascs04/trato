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
from trato_api.gmail.service import GmailSettings, GmailConnectionService, GoogleTransport, SEND_SCOPE, TOKEN_URL, USERINFO_URL, SEND_URL
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
        self.assertEqual(self.service.status('owner'),{'configured':True,'connected':True,'email':'sender@example.com'})
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
        self.assertEqual(result,{'status':'accepted_by_gmail','message_id':'gmail-id'})
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
