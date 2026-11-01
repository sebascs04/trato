"""Job/lease-bound HTTP port. The backend, never the model, resolves the file.

Requires the new backend contract before use. Existing training-library tools
are not repurposed as a universal credential for private documents.
"""
from ..source_tools import BackendToolClient


class BackendFileClient:
    def __init__(self, client: BackendToolClient):
        self.client = client

    def authorize(self, thread):
        return self.client.request('POST', '/internal/file-processing/authorize', json=thread)

    def execute(self, manifest, tool, params):
        return self.client.request('POST', '/internal/file-processing/execute', json={
            'workflow': 'process_file', 'thread_id': manifest['thread_id'], 'lease_id': manifest['lease_id'],
            'tool': tool, 'params': params})

    def revalidate(self, manifest):
        return self.execute(manifest, 'revalidate_file', {})

    def extract(self, manifest):
        return self.execute(manifest, 'read_extracted_file', {})

    def chunks(self, manifest, extraction, policy):
        # Only policy/expected fingerprint are sent: the backend retrieves its
        # canonical text rather than trusting a replacement supplied by a worker.
        return self.execute(manifest, 'chunk_extracted_file', {
            'policy': policy, 'source_fingerprint': extraction['source_fingerprint']})

    def load_artifact(self, manifest, stage, cache_key):
        return self.execute(manifest, 'read_file_artifact', {'stage': stage, 'cache_key': cache_key})

    def store_artifact(self, manifest, stage, cache_key, artifact):
        return self.execute(manifest, 'store_file_artifact', {
            'stage': stage, 'cache_key': cache_key, 'artifact': artifact})

    def publish_projection(self, manifest, projection):
        return self.execute(manifest, 'index_file_chunks', {'projection': projection})
