"""Configure only Trato's private local processes. Never prints credential values."""
import json
from pathlib import Path
import secrets
from urllib.parse import quote

ROOT=Path(__file__).resolve().parent.parent
PORTS=json.loads((ROOT/'local-ports.json').read_text())


def read(path):
    result={}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#'):
                key,sep,value=line.partition('=')
                if not sep:raise ValueError('Archivo de configuración inválido.')
                result[key.strip()]=value.strip()
    return result


def write(path,values):
    old=read(path);old.update(values)
    path.write_text(''.join(f'{k}={v}\n' for k,v in old.items()))
    path.chmod(0o600)


if __name__=='__main__':
    api=ROOT/'repos/trato-api/.env';worker=ROOT/'repos/trato-worker/.env'
    config=read(api)
    if not all(config.get(k) for k in ('SUPABASE_SERVER_KEY','FILE_PROCESSOR_TOKEN')):
        raise SystemExit('Falta configurar la API de Trato antes de iniciar la cola.')
    if config.get('TRATO_REDIS_URL') or config.get('TRATO_WORKER_TOKEN'):
        raise SystemExit('La ingesta ya tiene configuración privada; no se reemplazan credenciales existentes.')
    redis_password=secrets.token_urlsafe(32);worker_token=secrets.token_urlsafe(32)
    redis_url=f'redis://:{quote(redis_password,safe="")}@127.0.0.1:{PORTS["redis_reserved"]}/0'
    write(api,{'TRATO_REDIS_URL':redis_url,'TRATO_WORKER_TOKEN':worker_token})
    write(worker,{'TRATO_REDIS_URL':redis_url,'TRATO_WORKER_TOKEN':worker_token,
                  'TRATO_API_URL':f'http://127.0.0.1:{PORTS["api"]}',
                  'FILE_PROCESSOR_URL':f'http://127.0.0.1:{PORTS["file_processor"]}',
                  'FILE_PROCESSOR_TOKEN':config['FILE_PROCESSOR_TOKEN']})
    folder=ROOT/'.local/redis';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    file=folder/'redis.conf'
    file.write_text(f'bind 127.0.0.1\nport {PORTS["redis_reserved"]}\nprotected-mode yes\nrequirepass {redis_password}\ndir {folder}\nappendonly yes\nappendfsync everysec\nmaxmemory-policy noeviction\nsave ""\nlogfile {folder}/redis.log\n')
    file.chmod(0o600)
    print('Configuración privada de ingesta creada para Trato; no se activó ningún proveedor de IA.')
