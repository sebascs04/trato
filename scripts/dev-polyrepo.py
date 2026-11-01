"""Local supervisor. Reads only the two task-specific .env files, never prints keys."""
import os
import argparse
import json
from pathlib import Path
import re
import subprocess
import socket
import time

ROOT = Path(__file__).resolve().parent.parent
REPOS = ROOT / 'repos'
PYTHON = REPOS / 'trato-file-processor/.venv/bin/python'
PORTS = json.loads((ROOT / 'local-ports.json').read_text())


def check_ports(services):
    """Fail before starting children; never stop an existing service or select another port."""
    if any(type(port) is not int or not 1 <= port <= 65535 for _, port in services):
        raise ValueError('Los puertos deben ser enteros entre 1 y 65535.')
    if len({port for _, port in services}) != len(services):
        raise ValueError('Cada servicio de Trato necesita un puerto distinto.')
    sockets = []
    try:
        for name, port in services:
            listener = socket.socket()
            listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            sockets.append(listener)
            try:
                listener.bind(('127.0.0.1', port))
            except OSError as exc:
                raise RuntimeError(f'No se puede reservar {name} en 127.0.0.1:{port}: {exc}. '
                                   'No se detuvo ningún proceso ni se eligió otro puerto.') from exc
    finally:
        for listener in sockets:
            listener.close()


def environment(repo):
    result = os.environ.copy()
    path = repo / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            key, separator, value = line.partition('=')
            if not separator or not re.fullmatch('[A-Z][A-Z0-9_]*', key.strip()):
                raise ValueError('Formato de configuración local inválido.')
            result[key.strip()] = value.strip()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Inicia los servicios y la interfaz oficial de Trato.')
    parser.add_argument('--with-worker',action='store_true',help='Iniciar Redis propio, publicador/resultados y worker de ingesta.')
    parser.add_argument('--with-ai',action='store_true',help='Iniciar Redis propio y workers IA sin ingesta de documentos.')
    parser.add_argument('--tools', action='store_true', help='Usar la pantalla técnica de 5174 en lugar de la interfaz oficial.')
    parser.add_argument('--api-port',type=int,default=PORTS['api'])
    parser.add_argument('--processor-port',type=int,default=PORTS['file_processor'])
    args = parser.parse_args()
    web_port = PORTS['tools' if args.tools else 'web']
    queue_requested=args.with_worker or args.with_ai
    try:
        services=[('web',web_port),('API',args.api_port),('file processor',args.processor_port)]
        if queue_requested:services.append(('Redis de Trato',PORTS['redis_reserved']))
        check_ports(services)
    except (ValueError, RuntimeError) as exc:
        raise SystemExit(str(exc)) from exc
    if not PYTHON.exists():
        raise SystemExit('Instala primero el entorno de trato-file-processor según su README.')
    if queue_requested and not (ROOT/'.local/redis/redis.conf').exists():
        raise SystemExit('Ejecuta primero scripts/configure-ingestion.py para configurar la cola privada de Trato.')
    children = []
    try:
        if queue_requested:
            children.append(subprocess.Popen(['redis-server',str(ROOT/'.local/redis/redis.conf')],cwd=ROOT))

        for name, service_port, module in [('trato-file-processor', str(args.processor_port), 'file_processor.app:app'),
                                   ('trato-api', str(args.api_port), 'trato_api.app:app')]:
            repo = REPOS / name
            service_env=environment(repo)
            if name=='trato-api':service_env['FILE_PROCESSOR_URL']=f'http://127.0.0.1:{args.processor_port}'
            children.append(subprocess.Popen([str(PYTHON), '-m', 'uvicorn', module, '--host', '127.0.0.1',
                '--port', service_port, '--limit-concurrency', '8', '--no-access-log'], cwd=repo, env=service_env))
        if queue_requested:
            worker_env=environment(REPOS/'trato-worker')
            worker_env['TRATO_API_URL']=f'http://127.0.0.1:{args.api_port}'
            worker_env['FILE_PROCESSOR_URL']=f'http://127.0.0.1:{args.processor_port}'
            # Wait for these exact local endpoints; no alternative port or transport is selected.
            import urllib.request
            deadline=time.monotonic()+60
            for ready_port in (args.api_port,args.processor_port):
                while True:
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{ready_port}/health',timeout=1):break
                    except OSError:
                        if time.monotonic()>deadline:raise RuntimeError('No arrancaron los servicios de Trato.')
                        time.sleep(.1)
            if args.with_worker:
                children.append(subprocess.Popen([str(PYTHON),'-m','trato_api.thread_runner','--mode','connected'],cwd=REPOS/'trato-api',env=environment(REPOS/'trato-api')))
                children.append(subprocess.Popen([str(REPOS/'trato-worker/.venv/bin/python'),'-m','trato_worker.run','--mode','connected'],cwd=REPOS/'trato-worker',env=worker_env))
            if worker_env.get('TRATO_AI_WORKFLOWS_ENABLED')=='true':
                children.append(subprocess.Popen([str(REPOS/'trato-worker/.venv/bin/python'),'-m','trato_worker.ai_jobs'],cwd=REPOS/'trato-worker',env=worker_env))
            if worker_env.get('TRATO_REHEARSAL_EVALUATOR_ENABLED')=='true':
                children.append(subprocess.Popen([str(REPOS/'trato-worker/.venv/bin/python'),'-m','trato_worker.rehearsal_jobs'],cwd=REPOS/'trato-worker',env=worker_env))
        frontend = REPOS / 'trato-web' if args.tools else ROOT
        frontend_env=os.environ.copy();frontend_env['TRATO_API_URL']=f'http://127.0.0.1:{args.api_port}'
        frontend_env['PORT']=str(web_port)
        children.append(subprocess.Popen(['node', 'dev-server.mjs' if args.tools else 'server.mjs'], cwd=frontend,env=frontend_env))
        print(f'Trato: http://localhost:{web_port}/#clientes | API: http://localhost:{args.api_port} | Ctrl+C para detener', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
