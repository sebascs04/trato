"""Server-side sandbox settings. Construct only after P2 provides a real repository."""
from dataclasses import dataclass,field
import os
from .client import PayPalSandboxClient,PayPalError
from .service import PaymentService


@dataclass(frozen=True)
class SandboxSettings:
    client_id:str=field(default='',repr=False)
    client_secret:str=field(default='',repr=False)
    merchant_id:str=field(default='',repr=False)
    webhook_id:str=field(default='',repr=False)
    return_url:str=''
    cancel_url:str=''
    environment:str='sandbox'

    @classmethod
    def from_env(cls):
        return cls(*(os.environ.get(name,'') for name in ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MERCHANT_ID','PAYPAL_WEBHOOK_ID','PAYPAL_RETURN_URL','PAYPAL_CANCEL_URL']),environment=os.environ.get('PAYPAL_ENVIRONMENT','sandbox'))

    def missing(self):
        return [name for name,value in [('PAYPAL_CLIENT_ID',self.client_id),('PAYPAL_CLIENT_SECRET',self.client_secret),('PAYPAL_MERCHANT_ID',self.merchant_id),('PAYPAL_RETURN_URL',self.return_url),('PAYPAL_CANCEL_URL',self.cancel_url)] if not value]


def build_payment_service(repository,settings=None,*,transport=None):
    settings=settings or SandboxSettings.from_env()
    if settings.environment!='sandbox':raise PayPalError('LIVE_PAYMENTS_DISABLED',status=503)
    if repository is None:raise PayPalError('PAYMENT_REPOSITORY_NOT_CONFIGURED',status=503)
    if settings.missing():raise PayPalError('PAYPAL_SANDBOX_NOT_CONFIGURED',status=503)
    options={'transport':transport} if transport is not None else {}
    client=PayPalSandboxClient(settings.client_id,settings.client_secret,settings.merchant_id,settings.webhook_id,**options)
    return PaymentService(client,repository,return_url=settings.return_url,cancel_url=settings.cancel_url)
