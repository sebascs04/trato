"""Interactive local setup; never logs the Google secret or vault encryption key."""
import getpass
import os
from pathlib import Path
import tempfile
from cryptography.fernet import Fernet

ROOT=Path(__file__).resolve().parent.parent

def main():
    print('Configura primero un cliente OAuth web y habilita Gmail API en Google Cloud.')
    print('URI de redirección local: http://localhost:5173/gmail-callback.html')
    client_id=input('ID del cliente OAuth web: ').strip()
    secret=getpass.getpass('Secreto del cliente OAuth (oculto): ').strip()
    if not client_id.endswith('.apps.googleusercontent.com') or not secret or any(ord(c)<33 or ord(c)>126 for c in client_id+secret):
        raise SystemExit('Credenciales vacías o formato inválido; no se guardaron cambios.')
    path=ROOT/'repos/trato-api/.env'
    lines=path.read_text().splitlines() if path.exists() else []
    existing={line.split('=',1)[0].strip():line.split('=',1)[1].strip() for line in lines if '=' in line and not line.lstrip().startswith('#')}
    key=existing.get('GMAIL_TOKEN_ENCRYPTION_KEY') or Fernet.generate_key().decode()
    try:Fernet(key.encode())
    except (ValueError,TypeError):raise SystemExit('La clave local de cifrado existente es inválida; revisa la configuración sin reemplazarla a ciegas.')
    values={'GOOGLE_GMAIL_CLIENT_ID':client_id,'GOOGLE_GMAIL_CLIENT_SECRET':secret,'GOOGLE_GMAIL_REDIRECT_URI':'http://localhost:5173/gmail-callback.html','GMAIL_TOKEN_ENCRYPTION_KEY':key,'GMAIL_VAULT_PATH':'.local/gmail/vault.sqlite3'}
    kept=[line for line in lines if line.split('=',1)[0].strip() not in values]
    private_dir=path.parent/'.local'
    private_dir.mkdir(mode=0o700,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=private_dir,prefix='.gmail-config-')
    try:
        with os.fdopen(fd,'w') as output:output.write('\n'.join(kept+[f'{k}={v}' for k,v in values.items()])+'\n')
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if Path(tmp).exists():Path(tmp).unlink()
    print('Configuración privada guardada. Reinicia los servicios y conecta Gmail desde tu perfil de Trato.')

if __name__=='__main__':main()
