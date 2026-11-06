import json,unittest
from trato_worker.change_review import run_change_review
from trato_worker.source_tools import ToolError

ORIGINAL={'scope_summary':'Tienda de 10 productos','conditions':'Sin inventario','description':'Módulo de tienda','estimated_hours':'8'}
SAVED={'scope_summary':'Tienda de 10 productos con cupones','conditions':'Sin inventario','description':'Módulo de tienda','additional_amount':'USD 240.00','deadline':'2026-11-25'}
DATA={'workflow':'change_review','output_language':'es','revision_id':'rev','fingerprint':'f'*64,'original':ORIGINAL,'saved':SAVED}
class Model:
    name='test-gemini'
    def __init__(self,value):self.value=value;self.calls=[]
    def generate(self,messages,schema):self.calls.append((messages,schema));return self.value
OUTPUT={'material_change':True,'summary':'Añadiste cupones sin cambiar el precio.','changes':[{'field':'scope','assessment':'Más trabajo por el mismo importe.'}]}

class ChangeReviewTests(unittest.TestCase):
    def test_review_compares_original_and_saved_and_is_bound_to_the_fingerprint(self):
        model=Model(OUTPUT);result=run_change_review(DATA,model)
        payload=json.loads(model.calls[0][0][1]['content'])
        self.assertEqual((payload['original'],payload['saved']),(ORIGINAL,SAVED))
        self.assertEqual((result['kind'],result['revision_id'],result['fingerprint'],result['material_change']),('change_review','rev','f'*64,True))
    def test_free_text_unknown_fields_and_duplicates_are_rejected(self):
        for value in ['free text',{**OUTPUT,'changes':[{'field':'price','assessment':'x'}]},{**OUTPUT,'changes':[OUTPUT['changes'][0]]*2},{**OUTPUT,'material_change':'yes'},{**OUTPUT,'extra':1}]:
            with self.assertRaises(ToolError):run_change_review(DATA,Model(value))
    def test_input_contract_is_exact(self):
        for data in [{**DATA,'output_language':'fr'},{**DATA,'saved':{**SAVED,'hours':'9'}},{**DATA,'original':None}]:
            with self.assertRaises(ToolError):run_change_review(data,Model(OUTPUT))
