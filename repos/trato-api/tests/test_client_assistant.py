import unittest

from trato_api.errors import ApiError
from trato_api.client_assistant import account_facts, validate_answer

PLANS = [{'project_id': 'p1', 'project_name': 'Café Aurora Website', 'freelancer_email': 'f@example.com', 'position': 1, 'title': 'Planning',
          'amount': 180, 'payment_status': 'completed', 'paid_minor': 18000, 'refunded_minor': 0, 'review_decision': 'approved', 'delivery_document_id': 'd'},
         {'project_id': 'p1', 'project_name': 'Café Aurora Website', 'freelancer_email': 'f@example.com', 'position': 2, 'title': 'Build',
          'amount': 300, 'payment_status': 'pending_approval', 'pay_url': 'https://pay', 'refunded_minor': 0},
         {'project_id': 'p1', 'project_name': 'Café Aurora Website', 'freelancer_email': 'f@example.com', 'position': 3, 'title': 'Launch', 'amount': 120}]
AGREEMENTS = [{'project_id': 'p1', 'project_name': 'Café Aurora Website', 'proposal_id': 'a', 'revision_no': 1, 'status': 'accepted',
               'payment_status': 'completed', 'additional_minor': 100, 'refunded_minor': 100, 'scope_summary': 'Store'},
              {'project_id': 'p1', 'project_name': 'Café Aurora Website', 'proposal_id': 'b', 'revision_no': 2, 'status': 'ready_for_review',
               'additional_minor': 500, 'scope_summary': 'Newsletter'}]


class ClientAssistantTests(unittest.TestCase):
    def test_totals_are_computed_before_the_model_sees_them(self):
        facts, refs = account_facts(AGREEMENTS, PLANS)
        self.assertEqual((facts[0]['paid'], facts[0]['to_pay'], facts[0]['refunded']), ('USD 181.00', 'USD 300.00', 'USD 1.00'))
        states = {item['ref']: item.get('payment') or item.get('state') for item in facts[0]['items']}
        self.assertEqual(states, {'S1': 'paid', 'S2': 'payment requested, waiting for your payment', 'S3': 'not charged yet',
                                  'A1': 'refunded', 'A2': 'waiting for your answer'})
        self.assertEqual(refs['A1'], {'type': 'addendum', 'proposal_id': 'a', 'project_id': 'p1', 'label': 'Café Aurora Website · Addendum v1'})

    def test_answers_must_cite_only_this_clients_items(self):
        _, refs = account_facts(AGREEMENTS, PLANS)
        ok = validate_answer({'kind': 'client_account_assistant', 'status': 'answered', 'answer': 'USD 181.00', 'sources': ['S1', 'A1']}, refs)
        self.assertEqual([s['label'] for s in ok['sources']], ['Café Aurora Website · Deliverable 1', 'Café Aurora Website · Addendum v1'])
        for bad in (['S9'], [], ['S1', 'S1']):
            with self.assertRaises(ApiError):
                validate_answer({'kind': 'client_account_assistant', 'status': 'answered', 'answer': 'x', 'sources': bad}, refs)
        with self.assertRaises(ApiError):
            validate_answer({'kind': 'client_account_assistant', 'status': 'outside_account', 'answer': 'x', 'sources': ['S1']}, refs)


    def test_inside_a_project_only_that_projects_facts_are_sent(self):
        from types import SimpleNamespace
        from trato_api.client_assistant import ask
        sent = {}
        class Jobs:
            def connection(self):
                return SimpleNamespace(exists=lambda key: False, incr=lambda key: 1, expire=lambda key, ttl: None)
            def enqueue(self, owner, job_id, data):
                sent.update(data)
                return {'id': job_id, 'status': 'queued'}
        other = {**PLANS[0], 'project_id': '22222222-2222-4222-8222-222222222222', 'project_name': 'Other'}
        mine = [{**item, 'project_id': '11111111-1111-4111-8111-111111111111'} for item in PLANS]
        prefs = SimpleNamespace(configuration=lambda: (None, 'model'))
        data = {'job_id': '33333333-3333-4333-8333-333333333333', 'question': 'What is pending?', 'output_language': 'en',
                'project_id': '11111111-1111-4111-8111-111111111111'}
        ask(Jobs(), prefs, '44444444-4444-4444-8444-444444444444', [], mine + [other], data)
        self.assertEqual([p['project'] for p in sent['projects']], ['Café Aurora Website'])
        with self.assertRaises(ApiError):
            ask(Jobs(), prefs, '44444444-4444-4444-8444-444444444444', [], [other], data)


if __name__ == '__main__':
    unittest.main()
