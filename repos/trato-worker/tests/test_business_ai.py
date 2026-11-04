import unittest
from trato_worker.business_ai import run_business_ai,validate
from trato_worker.source_tools import ToolError

REVIEW={'id':'review-a','version':2,'body':'The client paid the deposit before work started.'}
OUTPUT={'summary':'One published experience describes a deposit.','observations':[{'finding':'The reviewer describes an initial payment.','recommendation':'Agree on the deposit before starting.','citations':[{'review_id':'review-a','version':2,'quote':'paid the deposit'}]}],'limitations':['Experiences are not verified facts.']}
class Model:
    name='test-gemini'
    def __init__(self,value):self.value=value;self.calls=[]
    def generate(self,messages,schema):self.calls.append((messages,schema));return self.value
class BusinessAITests(unittest.TestCase):
    def data(self,kind='reputation'):
        return {'workflow':kind,'output_language':'es','reviews':[REVIEW],'brief':'A small website','budget':'100.00','target_date':'2026-12-01','today':'2026-11-01'}
    def test_uses_actual_review_context_and_requires_structured_output(self):
        import json
        model=Model(OUTPUT);result=run_business_ai(self.data(),model)
        self.assertEqual(result['sources_read'],1);self.assertEqual(result['kind'],'reputation')
        self.assertEqual(json.loads(model.calls[0][0][1]['content'])['reviews'],[REVIEW])
        self.assertNotIn('client_id',model.calls[0][0][1]['content'])
    def test_rejects_invented_version_quote_and_free_text(self):
        from copy import deepcopy
        for field,value in [('version',1),('quote','always pays'),('review_id','foreign')]:
            output=deepcopy(OUTPUT);output['observations'][0]['citations'][0][field]=value
            with self.assertRaises(ToolError):validate(output,self.data())
        with self.assertRaises(ToolError):validate('free text',self.data())
    def test_no_reviews_cannot_produce_client_observations(self):
        with self.assertRaises(ToolError):validate(OUTPUT,{**self.data(),'reviews':[]})
        self.assertEqual(validate({**OUTPUT,'observations':[]},{**self.data(),'reviews':[]})['observations'],[])
    def test_plan_percentages_and_minimum_cent_are_checked(self):
        stages=[{'title':'Start','body':'Deliverables','percent':40,'when':'Before work'},{'title':'Finish','body':'Delivery','percent':60,'when':'On delivery'}]
        self.assertEqual(len(validate({**OUTPUT,'stages':stages},self.data('project_plan'))['stages']),2)
        with self.assertRaises(ToolError):validate({**OUTPUT,'stages':[stages[0]]},self.data('project_plan'))
        with self.assertRaises(ToolError):validate({**OUTPUT,'stages':stages},{**self.data('project_plan'),'budget':'0.01'})
