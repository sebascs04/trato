"""Backend-only persistence for generic queued work, separate from browser sessions."""
import os
from .errors import ApiError
from .persistence import Repository


class ThreadStore:
    def __init__(self, settings):
        self.settings = settings
        key = os.environ.get('SUPABASE_SERVER_KEY', '')
        if not key or not (key.startswith('sb_secret_') or key.startswith('eyJ')):
            raise ApiError('THREAD_BACKEND_NOT_CONFIGURED', 503)
        self.repo = Repository(settings, 'Bearer internal')
        self.repo.headers['apikey'] = key
        if key.startswith('sb_secret_'):
            del self.repo.headers['Authorization']
        else:
            self.repo.headers['Authorization'] = 'Bearer ' + key

    def command(self, action, data):
        return self.repo.rpc('thread_backend', {'p_action': action, 'p_data': data})

    def original(self, thread_id, lease_id):
        document = self.command('input', {'message': {'thread_id': thread_id}, 'lease_id': lease_id})
        return self.repo.download(document)
