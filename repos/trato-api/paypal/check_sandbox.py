"""Explicit OAuth-only diagnostic, never creates orders or sends emails.
Run: python3 -m backend.paypal.check_sandbox [--check-auth]
Variables must already be configured in the process environment.
"""
import argparse
import json
import os
from .client import PayPalSandboxClient,PayPalError


def main():
    parser=argparse.ArgumentParser(description='Comprobar configuración PayPal sandbox sin crear cobros.')
    parser.add_argument('--check-auth',action='store_true',help='Contacta exclusivamente el endpoint OAuth sandbox, sin imprimir el token.')
    args=parser.parse_args()
    names=['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MERCHANT_ID']
    missing=[name for name in names if not os.environ.get(name)]
    if missing:
        print(json.dumps({'configured':False,'missing':missing,'network_called':False},ensure_ascii=False));return 2
    client=PayPalSandboxClient(*(os.environ[name] for name in names),webhook_id=os.environ.get('PAYPAL_WEBHOOK_ID',''))
    if not args.check_auth:
        print(json.dumps({'configured':True,'network_called':False,'webhook_configured':bool(client.webhook_id)}));return 0
    try:
        client._access_token()
    except PayPalError as error:
        print(json.dumps({'configured':True,'authenticated':False,'error':error.code}));return 1
    print(json.dumps({'configured':True,'authenticated':True,'environment':'sandbox','orders_created':0}));return 0

if __name__=='__main__':raise SystemExit(main())
