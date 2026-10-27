"""Explicit Vertex AI simulation through the installed Google SDK HTTP contract."""
from copy import deepcopy
import json
import re
import httpx
from google.oauth2.credentials import Credentials
from google import genai
from google.genai import types
from .gemini import GeminiUnavailableError


class GeminiSimulationModel:
    mode='simulation'
    provider='gemini'

    def __init__(self, *, model, response, mode, status_code=200):
        if mode!='simulation' or not re.fullmatch('gemini-[a-z0-9.-]+',model):
            raise ValueError('Modelo y modo de simulación explícitos obligatorios.')
        self.model=model
        self.requests=[]
        self.last_usage=None
        def fake_provider(request):
            self.requests.append({'method':request.method,'path':request.url.path,'body':json.loads(request.content)})
            return httpx.Response(status_code,json=deepcopy(response))
        self._client=genai.Client(vertexai=True,project='simulation-project',location='us-central1',
            credentials=Credentials(token='simulation-only-not-a-real-token'),http_options=types.HttpOptions(api_version='v1',
            client_args={'transport':httpx.MockTransport(fake_provider)},retry_options=types.HttpRetryOptions(attempts=1)))

    def generate(self,messages,schema):
        self.last_usage=None
        system=[];contents=[]
        for message in messages:
            if message['role'] in ('system','developer'):
                system.append(types.Part(text=message['content']))
            elif message['role'] in ('user','assistant'):
                contents.append(types.Content(role='user' if message['role']=='user' else 'model',
                                               parts=[types.Part(text=message['content'])]))
            else:raise ValueError('Rol no admitido.')
        try:
            response=self._client.models.generate_content(model=self.model,contents=contents,
                config=types.GenerateContentConfig(system_instruction=types.Content(parts=system),
                    response_mime_type='application/json',response_json_schema=schema))
            if response.prompt_feedback and response.prompt_feedback.block_reason:
                raise ValueError('Blocked')
            if not response.candidates or len(response.candidates)!=1 or response.candidates[0].finish_reason!=types.FinishReason.STOP:
                raise ValueError('Incomplete')
            candidate=response.candidates[0]
            texts=[part.text for part in candidate.content.parts if part.text and not part.thought]
            if len(texts)!=1:raise ValueError('Invalid output')
            result=json.loads(texts[0])
            if not isinstance(result,dict):raise ValueError('Invalid JSON')
            if response.usage_metadata:
                usage=response.usage_metadata
                self.last_usage={'input_tokens':usage.prompt_token_count,'output_tokens':usage.candidates_token_count,
                                 'total_tokens':usage.total_token_count}
            return result
        except Exception:
            raise GeminiUnavailableError('La simulación de Gemini devolvió un error o una respuesta inválida.') from None

    def close(self):
        self._client.close()


def response_fixture(result):
    return {'candidates':[{'index':0,'finishReason':'STOP','content':{'role':'model','parts':[{'text':json.dumps(result,ensure_ascii=False)}]}}],
            'usageMetadata':{'promptTokenCount':0,'candidatesTokenCount':0,'totalTokenCount':0}}
