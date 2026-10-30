"""Run the explicitly installed Trato-only Ollama server. No system service or port fallback."""
import json
import os
from pathlib import Path
import socket

root=Path(__file__).resolve().parent.parent
port=json.loads((root/'local-ports.json').read_text())['ollama']
binary=root/'.local/ollama/runtime/bin/ollama'
if not binary.is_file():raise SystemExit('Instala el runtime local de Ollama de Trato antes de iniciar.')
with socket.socket() as listener:
    listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    try:listener.bind(('127.0.0.1',port))
    except OSError:raise SystemExit(f'Puerto {port} ocupado. No se cambia ni se detiene ningún proceso.')
models=root/'.local/ollama/models';models.mkdir(parents=True,exist_ok=True)
env=os.environ.copy()
env.update(OLLAMA_HOST=f'127.0.0.1:{port}',OLLAMA_MODELS=str(models),OLLAMA_NO_CLOUD='1',OLLAMA_GO_TEMPLATE='1',
           OLLAMA_NUM_PARALLEL='1',OLLAMA_MAX_LOADED_MODELS='1',OLLAMA_CONTEXT_LENGTH='8192',OLLAMA_KEEP_ALIVE='15m',
           OLLAMA_FLASH_ATTENTION='1',OLLAMA_KV_CACHE_TYPE='q8_0')
os.execve(str(binary),[str(binary),'serve'],env)
