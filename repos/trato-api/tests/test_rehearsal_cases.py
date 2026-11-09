import os,unittest
from unittest.mock import patch
from trato_api.errors import ApiError
from trato_api.rehearsal import bank_case,hidden_intent,rehearsal_bank
from trato_api.rehearsal_routes import rehearsal_case

RID='11111111-2222-4333-8444-555555555555'
def payload(**extra):
    return {'action':'reply','scenario':'scope','output_language':'en','persona':{'patience':3,'flexibility':3,'price_sensitivity':3},
            'messages':[],'case_id':None,'rehearsal_id':None,'hidden_intent':False,**extra}

@patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'server-secret'})
class RehearsalCaseTests(unittest.TestCase):
    def test_bank_has_five_bilingual_cases_and_intents_per_scenario(self):
        for scenario,value in rehearsal_bank().items():
            self.assertEqual((len(value['cases']),len(value['intents'])),(5 if scenario in ('scope','payment','refund') else 3,5),scenario)
            for case in value['cases']:
                for field in ('theme','agreement','request'):self.assertTrue(case[field]['es'] and case[field]['en'],(case['id'],field))
            for intent in value['intents']:self.assertTrue(intent['brief'] and intent['label']['es'] and intent['label']['en'])

    def test_case_is_validated_and_returned_in_the_rehearsal_language(self):
        self.assertEqual(bank_case('scope','scope-web','en')['request'],'We want to sell bagged coffee from the website, with a cart and PayPal payments.')
        with self.assertRaisesRegex(ApiError,'INVALID_REHEARSAL'):bank_case('scope','payment-web','es')

    def test_hidden_intent_is_stable_per_rehearsal_and_never_sent_back_on_a_reply(self):
        self.assertEqual(hidden_intent('scope',RID),hidden_intent('scope',RID))
        data=rehearsal_case(payload(case_id='scope-web',rehearsal_id=RID,hidden_intent=True))
        self.assertEqual(data['case']['client_intent'],hidden_intent('scope',RID)['brief'])
        self.assertNotIn('client_intent_reveal',data)
        self.assertNotIn('case_id',data);self.assertNotIn('rehearsal_id',data)

    def test_evaluation_gets_the_label_to_reveal_and_hidden_intent_needs_case_and_id(self):
        data=rehearsal_case(payload(action='evaluate',case_id='scope-web',rehearsal_id=RID,hidden_intent=True))
        intent=hidden_intent('scope',RID)
        self.assertEqual(data['client_intent_reveal'],{'id':intent['id'],'label':intent['label']['en']})
        with self.assertRaisesRegex(ApiError,'INVALID_REHEARSAL'):rehearsal_case(payload(hidden_intent=True,rehearsal_id=RID))
        self.assertNotIn('client_intent',rehearsal_case(payload(case_id='scope-web'))['case'])

    def test_legacy_rehearsals_without_case_keep_the_original_fixture(self):
        self.assertEqual(set(rehearsal_case(payload())['case']),{'request','agreement'})


@patch.dict(os.environ,{'TRATO_WORKER_TOKEN':'server-secret'})
class ClientRehearsalTests(unittest.TestCase):
    def test_client_scenarios_use_the_bank_and_the_ai_plays_the_freelancer(self):
        for scenario in ('change','deadline','delivery'):
            value=rehearsal_bank()[scenario]
            self.assertGreaterEqual(len(value['cases']),3);self.assertEqual(len(value['intents']),5)
        data=rehearsal_case(payload(scenario='deadline',case_id='deadline-launch',rehearsal_id=RID,hidden_intent=True))
        self.assertEqual(data['counterpart'],'freelancer')
        self.assertEqual(data['case']['client_intent'],hidden_intent('deadline',RID)['brief'])
        self.assertEqual(rehearsal_case(payload(case_id='scope-web'))['counterpart'],'client')

    def test_client_scenarios_need_a_bank_case_of_their_own(self):
        with self.assertRaisesRegex(ApiError,'INVALID_REHEARSAL'):rehearsal_case(payload(scenario='change'))
        with self.assertRaisesRegex(ApiError,'INVALID_REHEARSAL'):rehearsal_case(payload(scenario='change',case_id='scope-web'))
