"""Copy Trato's private Aura credentials into backend/worker environments; never print values."""
import ast
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parent.parent

def read(path,quoted=False):
    values={}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        key,sep,value=line.partition('=')
        if not sep:raise ValueError('Configuración inválida.')
        value=value.strip()
        if quoted and value[:1] in ('\"',"'"):
            value=ast.literal_eval(value)
        values[key.strip()]=value
    return values

if __name__=='__main__':
    config=read(ROOT/'.env.neo4j',quoted=True)
    if urlparse(config.get('NEO4J_URI','')).scheme!='neo4j+s' or not config.get('NEO4J_PASSWORD'):
        raise SystemExit('Faltan credenciales Aura con TLS.')
    fields={k:config[k] for k in ('NEO4J_URI','NEO4J_USERNAME','NEO4J_PASSWORD','NEO4J_DATABASE')}
    if any('\n' in value or '\r' in value for value in fields.values()):raise SystemExit('Valores multilínea no admitidos.')
    for repo in ('trato-api','trato-worker'):
        path=ROOT/'repos'/repo/'.env'
        existing=read(path);existing.update(fields)
        path.write_text(''.join(f'{key}={value}\n' for key,value in existing.items()));path.chmod(0o600)
    print('Configuración Aura privada actualizada en API y worker. No se alteraron otras credenciales.')
