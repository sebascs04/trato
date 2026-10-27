"""Explicit contract demo; the Google SDK uses only MockTransport."""
import json
from trato_worker.analysis import analyze
from trato_worker.gemini_simulation import GeminiSimulationModel,response_fixture
sources=[{'id':'simulation-agreement','kind':'agreement','text':'Web en español con cinco secciones. No incluye tienda.'},
         {'id':'simulation-request','kind':'request','text':'Añadir una tienda.'}]
fixture={'relation':'matches','classification':'possible_extra','summary':'El pedido agrega una tienda excluida en el acuerdo de ejemplo.',
         'sources':[{'source_id':s['id'],'quote':s['text']} for s in sources]}
model=GeminiSimulationModel(model='gemini-simulation',response=response_fixture(fixture),mode='simulation')
try:
    output=analyze(sources,model)
    print(json.dumps({'mode':'simulation','provider':'gemini','backend':'vertex','network_calls':0,
                      'request':model.requests[0],'result':output},ensure_ascii=False))
finally:model.close()
