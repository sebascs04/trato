import os
from .analysis import OllamaModel


def configured_model():
    provider = os.environ.get('TRATO_MODEL_PROVIDER', '')
    if provider == 'ollama':
        return OllamaModel()
    if provider == 'gemini':
        from .gemini import GeminiLangChainModel
        return GeminiLangChainModel()
    raise ValueError('Configura TRATO_MODEL_PROVIDER explícitamente: gemini u ollama.')
