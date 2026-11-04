"""Explicit central Trato mailbox. Business ownership remains with the caller."""
from .service import GmailConnectionService,SEND_SCOPE,READ_SCOPE
from .vault import GmailError

class TratoGmailService(GmailConnectionService):
    def _require_manager(self,user):
        if user!=self.settings.trato_owner:raise GmailError('GMAIL_TRATO_ACCOUNT_MANAGED',403)
    def validate_mailbox_identity(self,user,profile):
        if profile['email'].lower()!=self.settings.trato_email.lower():raise GmailError('GMAIL_TRATO_MAILBOX_MISMATCH',409)
    def status(self,user):
        data=super().status(self.settings.trato_owner)
        matching=bool(data['email'] and data['email'].lower()==self.settings.trato_email.lower())
        return {**data,'connected':matching and data['can_send'] and data['can_read'],
                'email':self.settings.trato_email,'delivery_mode':'trato','can_manage_connection':user==self.settings.trato_owner,
                'error_code':'GMAIL_TRATO_MAILBOX_MISMATCH' if data['connected'] and not matching else None}
    def start(self,user,purpose='send_read'):
        self._require_manager(user)
        if purpose not in ('send','read','send_read'):raise GmailError('INVALID_GMAIL_PURPOSE',422)
        return super().start(self.settings.trato_owner,'send_read')
    def complete(self,user,state,code=None,error=None):
        self._require_manager(user)
        return super().complete(self.settings.trato_owner,state,code=code,error=error)
    def credentials(self,user):
        saved=self.vault.get(self.settings.trato_owner)
        if not saved:raise GmailError('GMAIL_NOT_CONNECTED',409)
        if saved.get('email','').lower()!=self.settings.trato_email.lower():raise GmailError('GMAIL_TRATO_MAILBOX_MISMATCH',409)
        if not {SEND_SCOPE,READ_SCOPE}.issubset(set(saved.get('scope','').split())):raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        result=super().credentials(self.settings.trato_owner)
        if not {SEND_SCOPE,READ_SCOPE}.issubset(set(result.get('scope','').split())):raise GmailError('GMAIL_READ_PERMISSION_REQUIRED',409)
        return result
    def disconnect(self,user):
        self._require_manager(user)
        data=super().disconnect(self.settings.trato_owner)
        return {**self.status(user),'revoked':data['revoked']}
