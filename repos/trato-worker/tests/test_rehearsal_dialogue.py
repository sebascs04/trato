import unittest
from trato_worker.rehearsal_dialogue import reply_rehearsal, PROMPT, DialogueModel
from trato_worker.source_tools import ToolError

class Model:
    name='test-model'
    def __init__(self,result=None):self.result=result or {'message':'¿Qué incluiría esa alternativa?','ended':False};self.calls=[]
    def generate(self,messages,schema):self.calls.append(messages);return self.result

def data(messages=None,language='es'):
    return {'scenario':'scope','output_language':language,'persona':{'patience':2,'flexibility':4,'price_sensitivity':5},'case':{'agreement':'Trabajo ya acordado','request':'Trabajo adicional'},'messages':messages or []}

class DialogueTests(unittest.TestCase):
    def test_entire_history_over_forty_messages_reaches_worker_without_fixed_ending(self):
        messages=[{'role':'client','text':'Pregunta '+str(i)} if i%2==0 else {'role':'user','text':'Respuesta '+str(i)} for i in range(44)]
        model=Model();result=reply_rehearsal(data(messages),model)
        import json
        self.assertEqual(json.loads(model.calls[0][1]['content'])['messages'],messages)
        self.assertFalse(result['ended']);self.assertIn('no fixed number',PROMPT)

    def test_explicit_language_and_model_closure_are_preserved(self):
        result=reply_rehearsal(data(language='en'),Model({'message':'That concludes our discussion.','ended':True}))
        self.assertTrue(result['ended']);self.assertEqual(result['output_language'],'en')
        self.assertEqual(DialogueModel.output_tokens,4096)

    def test_invalid_output_is_error_not_script(self):
        for value in [{'message':'','ended':False},{'message':'Reply','ended':'yes'},{'message':'Reply','ended':False,'thinking':'private'}]:
            with self.assertRaises(ToolError):reply_rehearsal(data(),Model(value))

    def test_malformed_or_incomplete_history_is_rejected_before_model(self):
        model=Model()
        with self.assertRaises(ToolError):reply_rehearsal(data([{'role':'client','text':'Question'}]),model)
        self.assertEqual(model.calls,[])

class ConsumerReplyTests(unittest.TestCase):
    def test_reply_dispatch_does_not_read_coaching_library_or_generate_twice(self):
        from unittest.mock import MagicMock
        from uuid import uuid4
        import json
        from trato_worker.rehearsal_jobs import RehearsalConsumer
        redis=MagicMock();client=MagicMock();job=str(uuid4())
        redis.xautoclaim.return_value=('0-0',[('1-0',{'job_id':job})],[])
        redis.eval.return_value=1;redis.hget.return_value=json.dumps(dict(data(),action='reply'))
        model=Model();consumer=RehearsalConsumer(redis,client,model)
        self.assertTrue(consumer.process_once());client.catalog.assert_not_called()
        stored=json.loads(redis.hset.call_args.kwargs['mapping']['result'])
        self.assertEqual(stored['message'],'¿Qué incluiría esa alternativa?');self.assertEqual(len(model.calls),1)
        redis.eval.return_value=0;consumer.process_once();self.assertEqual(len(model.calls),1)


class ClientSideDialogueTests(unittest.TestCase):
    def test_client_accounts_rehearse_with_the_ai_as_freelancer(self):
        import json
        model=Model();reply_rehearsal({**data(language='en'),'scenario':'deadline','counterpart':'freelancer'},model)
        self.assertEqual(json.loads(model.calls[0][1]['content'])['counterpart'],'freelancer')
        self.assertIn('freelancer (the user is that freelancer',PROMPT)
        # Older jobs without counterpart keep the AI as the client.
        model=Model();reply_rehearsal(data(),model)
        self.assertEqual(json.loads(model.calls[0][1]['content'])['counterpart'],'client')

    def test_role_and_scenario_must_match(self):
        for bad in ({'scenario':'deadline'},{'scenario':'scope','counterpart':'freelancer'},{'scenario':'change','counterpart':'coach'}):
            with self.assertRaises(ToolError,msg=bad):reply_rehearsal({**data(),**bad},Model())
