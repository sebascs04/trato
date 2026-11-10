from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
import unittest

from paypal.agent_toolkit import AgentToolkit, INVOICE_TOOLS, READ_ONLY_TOOLS
from paypal.client import PayPalError
from trato_api.errors import ApiError
from trato_api.proposals.invoices import AddendumInvoices, invoice_number
from trato_api.proposals.workflow import ProposalWorkflow

INVOICE = 'INV2-D5NQ-YGP2-8WTZ-2CMN'
URL = 'https://www.sandbox.paypal.com/invoice/p/#D5NQYGP28WTZ2CMN'
MERCHANT = 'MERCHANT123'


def paypal_invoice(number, status='SENT', *, value='1.00', transactions=None, due='1.00'):
    item = {'id': INVOICE, 'status': status, 'detail': {'invoice_number': number, 'metadata': {'recipient_view_url': URL}},
            'amount': {'currency_code': 'USD', 'value': value}, 'due_amount': {'currency_code': 'USD', 'value': due}}
    if transactions is not None:
        item['payments'] = {'paid_amount': {'currency_code': 'USD', 'value': value}, 'transactions': transactions}
    return item


PAID_BY_PAYPAL = [{'type': 'PAYPAL', 'method': 'PAYPAL', 'transaction_status': 'SUCCESS', 'payment_id': '95T10861V7248182D'}]


class Toolkit:
    def __init__(self, test):
        self.test, self.calls, self.status, self.found, self.fail_create = test, [], 'DRAFT', [], False
        self.transactions, self.due = None, '1.00'

    def create_invoice(self, params):
        self.calls.append(('create', params))
        if self.fail_create:
            raise PayPalError('PAYPAL_UNAVAILABLE', status=503, uncertain=True)
        self.test.number = params['invoice_number']
        return {'rel': 'self', 'href': 'https://api.sandbox.paypal.com/v2/invoicing/invoices/' + INVOICE}

    def send_invoice(self, invoice_id):
        self.calls.append(('send', invoice_id))
        self.status = 'SENT'

    def get_invoice(self, invoice_id):
        self.calls.append(('get', invoice_id))
        return paypal_invoice(self.test.number, self.status, transactions=self.transactions, due=self.due)

    def search_invoices(self, number):
        self.calls.append(('search', number))
        return {'items': self.found}


class Provider:
    def __init__(self):
        self.capture = {'id': '95T10861V7248182D', 'status': 'COMPLETED', 'invoice_id': INVOICE,
                        'amount': {'currency_code': 'USD', 'value': '1.00'}}
        self.order = None

    def get_capture(self, capture_id):
        return dict(self.capture)

    def get_order(self, order_id):
        return self.order


class InvoiceTest(unittest.TestCase):
    def setUp(self):
        self.commands, self.number, self.payment = [], None, None
        self.snapshot = {'proposal': {'id': 'p', 'project_id': 'project', 'current_revision_id': 'r'}, 'payments': []}
        parent = self

        class Repo:
            def get_revision(self, *args, **kwargs):
                return deepcopy(parent.snapshot)

            def project(self, project_id):
                return {'id': project_id, 'client_id': 'c', 'name': 'Café Aurora Website'}

            def rows(self, *args):
                return [{'contact_email': 'client@example.com'}]

        class Store:
            def command(self, owner, action, data):
                parent.commands.append((action, data))
                if action == 'claim':
                    if parent.payment is None:
                        parent.payment = {'id': 'pay', 'owner_id': owner, 'method': 'invoice', 'status': 'creating', 'amount_minor': 100,
                                          'currency': 'USD', 'merchant_id': MERCHANT, 'invoice_number': data['invoice_number'],
                                          'invoice_id': None}
                        parent.number = data['invoice_number']
                        return {**parent.payment, 'acquired': True}
                    return {**parent.payment, 'acquired': parent.payment['status'] in ('creating', 'reconciliation_required')}
                if action == 'record':
                    parent.payment.update(invoice_id=data['invoice_id'], invoice_url=data['invoice_url'], status='pending_approval')
                if action == 'uncertain':
                    parent.payment.update(status='reconciliation_required')
                if action == 'apply':
                    parent.payment.update(status='completed', capture_id=data['capture_id'])
                return dict(parent.payment)

        self.repo, self.toolkit, self.provider = Repo(), Toolkit(self), Provider()
        self.workflow = ProposalWorkflow(SimpleNamespace(web_origin='http://localhost:5173'), None, paypal=self.provider)
        self.invoices = AddendumInvoices(self.workflow, store=Store(), toolkit=self.toolkit)
        settings = patch('trato_api.proposals.invoices.SandboxSettings.from_env', return_value=SimpleNamespace(merchant_id=MERCHANT))
        settings.start()
        self.addCleanup(settings.stop)
        env = patch.dict('os.environ', {'TRATO_SANDBOX_INITIAL_PAYER_BINDINGS': ''})
        env.start()
        self.addCleanup(env.stop)

    def actions(self):
        return [action for action, _ in self.commands]

    def test_invoice_number_fits_paypal_and_the_database_rule(self):
        number = invoice_number()
        self.assertRegex(number, r'^TR-[A-Z0-9]{10}$')
        self.assertLess(len(number), 25)

    def test_write_tools_live_in_their_own_list(self):
        self.assertFalse(INVOICE_TOOLS & {'create_invoice', 'send_invoice'} & READ_ONLY_TOOLS)
        with self.assertRaises(PayPalError):
            AgentToolkit('id', 'secret', api=object())._run('create_invoice', {})

    def test_send_issues_one_invoice_with_backend_amount_and_recipient(self):
        result = self.invoices.send(self.repo, 'owner', 'p', 'r', '  Newsletter   signup ')
        create = next(params for kind, params in self.toolkit.calls if kind == 'create')
        self.assertEqual(create['items'], [{'name': 'Newsletter signup', 'quantity': '1', 'unit_amount': {'currency_code': 'USD', 'value': '1.00'}}])
        self.assertEqual(create['primary_recipients'], [{'billing_info': {'email_address': 'client@example.com'}}])
        self.assertIs(create['allow_partial_payment'], False)
        self.assertEqual(create['invoice_number'], self.number)
        self.assertIn(('send', INVOICE), self.toolkit.calls)
        self.assertEqual(self.actions(), ['claim', 'record'])
        self.assertEqual((result['status'], result['invoice_url']), ('pending_approval', URL))

    def test_retry_finds_the_reserved_invoice_instead_of_creating_another(self):
        self.toolkit.fail_create = True
        with self.assertRaises(ApiError):
            self.invoices.send(self.repo, 'owner', 'p', 'r', 'Newsletter signup')
        self.assertEqual(self.payment['status'], 'reconciliation_required')
        self.toolkit.fail_create = False
        self.toolkit.found = [{'id': INVOICE, 'detail': {'invoice_number': self.number}}]
        self.invoices.send(self.repo, 'owner', 'p', 'r', 'Newsletter signup')
        self.assertEqual(sum(kind == 'create' for kind, _ in self.toolkit.calls), 1)
        self.assertEqual(self.payment['invoice_id'], INVOICE)

    def test_concept_is_required(self):
        with self.assertRaises(ApiError) as caught:
            self.invoices.send(self.repo, 'owner', 'p', 'r', '   ')
        self.assertEqual(caught.exception.code, 'INVOICE_CONCEPT_REQUIRED')
        self.assertEqual(self.commands, [])

    def test_an_existing_order_is_read_back_before_it_is_retired(self):
        self.snapshot['payments'] = [{'id': 'old', 'status': 'pending_approval', 'order_id': 'ORDER1', 'capture_attempted': False}]
        seen = []
        with patch.object(ProposalWorkflow, 'apply', side_effect=lambda pay, order: seen.append((pay['id'], order))):
            self.provider.order = {'id': 'ORDER1', 'status': 'APPROVED'}
            self.invoices.send(self.repo, 'owner', 'p', 'r', 'Newsletter signup')
        self.assertEqual(seen, [('old', {'id': 'ORDER1', 'status': 'APPROVED'})])
        self.assertEqual(self.actions()[0], 'claim')

    def paid(self):
        self.invoices.send(self.repo, 'owner', 'p', 'r', 'Newsletter signup')
        self.toolkit.status, self.toolkit.due = 'PAID', '0.00'

    def test_paid_invoice_completes_only_with_its_verified_capture(self):
        self.paid()
        self.toolkit.transactions = PAID_BY_PAYPAL
        result = self.invoices.verify(dict(self.payment))
        self.assertEqual((result['status'], result['capture_id']), ('completed', '95T10861V7248182D'))
        self.assertEqual(self.commands[-1][1]['invoice_id'], INVOICE)

    def test_sent_invoice_stays_pending(self):
        self.paid()
        self.toolkit.status, self.toolkit.due = 'SENT', '1.00'
        self.assertEqual(self.invoices.verify(dict(self.payment))['status'], 'pending_approval')

    def test_marked_as_paid_or_external_payment_never_completes(self):
        self.paid()
        self.toolkit.transactions = [{'type': 'EXTERNAL', 'method': 'CASH', 'transaction_status': 'SUCCESS', 'payment_id': 'X'}]
        with self.assertRaises(ApiError) as caught:
            self.invoices.verify(dict(self.payment))
        self.assertEqual(caught.exception.code, 'PAYMENT_EVIDENCE_MISMATCH')
        self.assertNotIn('apply', self.actions())

    def test_capture_of_another_invoice_never_completes(self):
        self.paid()
        self.toolkit.transactions = PAID_BY_PAYPAL
        self.provider.capture['invoice_id'] = 'INV2-AAAA-BBBB-CCCC-DDDD'
        with self.assertRaises(ApiError):
            self.invoices.verify(dict(self.payment))
        self.assertNotIn('apply', self.actions())

    def test_portal_payment_opens_the_invoice_instead_of_an_order(self):
        self.invoices.send(self.repo, 'owner', 'p', 'r', 'Newsletter signup')
        pay = {**self.payment, 'acquired': False}
        with patch.object(ProposalWorkflow, 'invoices', return_value=self.invoices):
            result = self.workflow.invoice_payment(pay)
        self.assertEqual(result['approval_url'], URL)
        self.assertEqual(ProposalWorkflow.public_payment(result)['method'], 'invoice')


class InvoiceEmailTest(unittest.TestCase):
    def test_trato_email_links_the_invoice_and_explains_paypal_may_email_it_too(self):
        from paypal.email import PaymentEmail, build_payment_email
        item = PaymentEmail('pay', 'client@example.com', 'Café Aurora', 'Café Aurora Website', '1.00', 'USD', URL, None, language='en', invoice=True)
        message = build_payment_email('sender@example.com', item, 'n1')
        self.assertEqual(message['Subject'], 'PayPal invoice · Café Aurora Website')
        self.assertIn('Pay invoice in PayPal Sandbox', message.get_body(preferencelist=('html',)).get_content())
        text = message.get_body(preferencelist=('plain',)).get_content()
        self.assertIn(URL, text)
        self.assertIn('PayPal may also email you this same invoice', text)
        self.assertIn('PayPal may also email you this same invoice', message.get_body(preferencelist=('html',)).get_content())
        order = PaymentEmail('pay', 'client@example.com', 'Café Aurora', 'Café Aurora Website', '1.00', 'USD', URL, None, language='en')
        self.assertNotIn('same invoice', build_payment_email('sender@example.com', order, 'n2').get_body(preferencelist=('plain',)).get_content())


if __name__ == '__main__':
    unittest.main()


class PortalInvoiceTest(unittest.TestCase):
    def store(self, payments):
        from trato_api.client_portal import PortalStore
        store = PortalStore.__new__(PortalStore)
        view = {'payment_required': True, 'revision_id': '11111111-1111-4111-8111-111111111111', 'status': 'accepted'}
        store.repo = SimpleNamespace(rpc=lambda name, data: dict(view), rows=lambda table, params: payments)
        return store

    def test_portal_names_the_invoice_by_its_number(self):
        from trato_api.client_portal import public_view
        view = public_view(self.store([{'method': 'invoice', 'invoice_number': 'TR-KRW6ZG4LV6'}]).view('digest'))
        self.assertEqual((view['payment_method'], view['invoice_number']), ('invoice', 'TR-KRW6ZG4LV6'))

    def test_orders_keep_the_usual_payment(self):
        from trato_api.client_portal import public_view
        view = public_view(self.store([{'method': 'order', 'invoice_number': None}]).view('digest'))
        self.assertIsNone(view['payment_method'])


class AccountInvoiceTest(unittest.TestCase):
    def test_client_overview_marks_invoiced_addenda_still_to_pay(self):
        from trato_api.client_portal import PortalStore
        a, b = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'
        items = [{'proposal_id': a, 'status': 'accepted', 'payment_status': None},
                 {'proposal_id': b, 'status': 'accepted', 'payment_status': None}]
        queries = []
        store = PortalStore.__new__(PortalStore)
        store.repo = SimpleNamespace(rpc=lambda name, data: [dict(x) for x in items],
                                     rows=lambda table, params: queries.append(params) or [{'proposal_id': a}])
        result = store.agreements('33333333-3333-4333-8333-333333333333')
        self.assertEqual([x.get('payment_method') for x in result], ['invoice', None])
        self.assertEqual(queries[0]['method'], 'eq.invoice')


class StageInvoiceTest(unittest.TestCase):
    """A Work plan deliverable reuses the same invoice issue and verification."""
    def setUp(self):
        from trato_api.proposals.invoices import StageInvoices
        self.commands, self.number = [], None
        parent = self
        self.row = {'id': 'stage-pay', 'owner_id': 'owner', 'method': 'order', 'status': 'pending_approval', 'order_id': 'ORDER9',
                    'amount_minor': 100, 'currency': 'USD', 'merchant_id': MERCHANT, 'invoice_id': None, 'invoice_number': None}

        class Workflow:
            position, settings, reconciled = 2, None, []
            def get(self, repo, owner, project):
                return dict(parent.row)
            def reconcile(self, repo, owner, project):
                self.reconciled.append(project)
            def provider(self):
                return parent.provider

        class Store:
            def command(self, owner, action, data):
                parent.commands.append((action, data))
                row = parent.row
                if action == 'claim':
                    row.update(method='invoice', order_id=None, status='creating', invoice_number=data['invoice_number'])
                    parent.number = data['invoice_number']
                    return {**row, 'acquired': True}
                if action == 'record':
                    row.update(invoice_id=data['invoice_id'], invoice_url=data['invoice_url'], status='pending_approval')
                if action == 'apply':
                    row.update(status='completed', capture_id=data['capture_id'])
                return dict(row)

        class Repo:
            def project(self, project_id):
                return {'id': project_id, 'client_id': 'c', 'name': 'Café Aurora Website'}
            def rows(self, *args):
                return [{'contact_email': 'client@example.com'}]

        self.workflow, self.provider, self.toolkit = Workflow(), Provider(), Toolkit(self)
        self.invoices = StageInvoices(self.workflow, store=Store(), toolkit=self.toolkit)
        self.repo = Repo()
        env = patch.dict('os.environ', {'TRATO_SANDBOX_INITIAL_PAYER_BINDINGS': ''})
        env.start()
        self.addCleanup(env.stop)

    def test_stage_invoice_reads_the_order_back_then_replaces_it(self):
        result = self.invoices.send(self.repo, 'owner', 'project', 'Deliverable 2 · Interface design')
        self.assertEqual(self.workflow.reconciled, ['project'])
        self.assertEqual(self.commands[0], ('claim', {'project_id': 'project', 'stage_position': 2, 'invoice_number': self.number}))
        self.assertEqual((result['status'], result['invoice_url']), ('pending_approval', URL))

    def test_paid_stage_invoice_completes_with_its_capture(self):
        self.invoices.send(self.repo, 'owner', 'project', 'Deliverable 2')
        self.toolkit.status, self.toolkit.due, self.toolkit.transactions = 'PAID', '0.00', PAID_BY_PAYPAL
        self.assertEqual(self.invoices.verify(dict(self.row))['status'], 'completed')
        self.assertEqual(self.commands[-1][0], 'apply')


class StageInvoiceEmailTest(unittest.TestCase):
    def test_stage_email_is_titled_and_linked_as_an_invoice(self):
        from trato_api.initial_payments.workflow import build_email
        item = {'project_name': 'Café Aurora Website', 'recipient_email': 'client@example.com', 'amount_minor': 100,
                'conditions': 'On delivery', 'output_language': 'en', 'stage_position': 2, 'url': URL, 'invoice': True}
        message = build_email('sender@example.com', item, 'n')
        self.assertEqual(message['Subject'], 'PayPal invoice · Café Aurora Website')
        text = message.get_body(preferencelist=('plain',)).get_content()
        self.assertIn(URL, text)
        self.assertIn('PayPal may also email you this same invoice', text)
        item.pop('invoice')
        self.assertTrue(build_email('sender@example.com', item, 'n')['Subject'].startswith('Deliverable payment'))


class ClientPlanTest(unittest.TestCase):
    def test_client_sees_each_deliverable_and_only_the_link_already_sent(self):
        from trato_api.client_portal import client_plans
        rows = [
            {'project_id': 'p', 'position': 1, 'title': 'Design', 'amount': '180.00', 'payment_status': 'completed'},
            {'project_id': 'p', 'position': 2, 'title': 'Build', 'amount': '300.00', 'payment_status': 'pending_approval',
             'payment_method': 'invoice', 'invoice_url': URL, 'invoice_number': 'TR-KRW6ZG4LV6'},
            {'project_id': 'p', 'position': 3, 'title': 'Launch', 'amount': '120.00', 'payment_status': 'pending_approval',
             'payment_method': 'order', 'checkout_token': 'x' * 43, 'output_language': 'en'},
        ]
        result = client_plans(rows, 'http://localhost:5173/')
        self.assertNotIn('pay_url', result[0])
        self.assertEqual(result[1]['pay_url'], URL)
        self.assertEqual(result[2]['pay_url'], 'http://localhost:5173/initial-payment.html?checkout=' + 'x' * 43 + '&lang=en')
        self.assertTrue(all('checkout_token' not in item and 'invoice_url' not in item for item in result))

    def test_client_sees_how_much_of_a_paid_stage_was_refunded(self):
        from trato_api.client_portal import client_plans
        rows = [{'project_id': 'p', 'position': 1, 'title': 'Design', 'amount': '180.00', 'payment_status': 'completed',
                 'paid_minor': 18000, 'refunded_minor': 5000}]
        result = client_plans(rows, 'http://localhost:5173/')
        self.assertEqual((result[0]['paid_minor'], result[0]['refunded_minor']), (18000, 5000))


class ClientStageReviewRouteTest(unittest.TestCase):
    PROJECT, DOC = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'

    def client(self):
        from fastapi import FastAPI, Request
        from fastapi.testclient import TestClient
        from trato_api.app import create_app
        from trato_api.client_portal import build_client_portal_router
        calls = self.calls = []

        class Store:
            def stage_review(self, user, project, position, document, decision, notes):
                calls.append((user, project, position, document, decision, notes))
            def plans(self, user):
                return [{'project_id': ClientStageReviewRouteTest.PROJECT, 'position': 1, 'review_decision': 'approved'}]

        app = create_app()
        app.router.routes = [r for r in app.router.routes if not getattr(r, 'path', '').startswith('/api/v1/portal')]
        def require_user(request: Request):
            if request.headers.get('authorization') != 'Bearer client':
                raise ApiError('UNAUTHORIZED', 401)
            return 'client-user'
        app.include_router(build_client_portal_router(SimpleNamespace(web_origin='http://localhost:5173'), Store(), None, require_user))
        return TestClient(app)

    def post(self, client, body, position=1):
        return client.post(f'/api/v1/portal/account/projects/{self.PROJECT}/stages/{position}/review', json=body,
                           headers={'Authorization': 'Bearer client'})

    def test_client_approves_the_delivery_they_saw(self):
        client = self.client()
        response = self.post(client, {'document_id': self.DOC, 'decision': 'approved'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, [('client-user', self.PROJECT, 1, self.DOC, 'approved', None)])
        self.assertEqual(response.json()['data'][0]['review_decision'], 'approved')

    def test_changes_need_notes_and_stage_must_exist(self):
        client = self.client()
        self.assertEqual(self.post(client, {'document_id': self.DOC, 'decision': 'changes_requested', 'notes': '  '}).status_code, 422)
        self.assertEqual(self.post(client, {'document_id': self.DOC, 'decision': 'approved'}, position=9).status_code, 422)
        self.assertEqual(self.post(client, {'document_id': self.DOC, 'decision': 'paid'}).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_review_requires_a_client_session(self):
        client = self.client()
        response = client.post(f'/api/v1/portal/account/projects/{self.PROJECT}/stages/1/review', json={'document_id': self.DOC, 'decision': 'approved'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])



class InvoiceConceptResultTest(unittest.TestCase):
    def test_only_a_short_concept_is_shown(self):
        from trato_api.invoice_concept import validate_concept
        self.assertEqual(validate_concept({'kind': 'invoice_concept', 'target': 'stage', 'concept': ' Design  work '})['concept'], 'Design work')
        for bad in ({'kind': 'invoice_concept', 'concept': ''}, {'kind': 'invoice_concept', 'concept': 'x' * 201}, {'kind': 'other', 'concept': 'x'}):
            with self.assertRaises(ApiError):
                validate_concept(bad)

    def test_request_names_exactly_one_target(self):
        from pydantic import ValidationError
        from trato_api.invoice_concept import ConceptRequest
        ConceptRequest(target='stage', output_language='en', project_id='p', position=1)
        for bad in ({'target': 'stage', 'output_language': 'en'}, {'target': 'addendum', 'output_language': 'en', 'proposal_id': 'p'},
                    {'target': 'stage', 'output_language': 'fr', 'project_id': 'p', 'position': 1}):
            with self.assertRaises(ValidationError):
                ConceptRequest(**bad)

    def test_approval_date_reads_like_a_sentence(self):
        from trato_api.invoice_concept import readable_date
        self.assertEqual(readable_date('2026-11-09T20:50:00+00:00', 'en'), 'November 9, 2026')
        self.assertEqual(readable_date('2026-11-09T20:50:00+00:00', 'es'), '9 de noviembre de 2026')
