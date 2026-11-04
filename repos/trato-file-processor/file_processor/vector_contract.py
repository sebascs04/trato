"""Fixed vector-space wire contract; mismatch must fail, never reindex silently."""
from hashlib import sha256
import json

COLLECTION = 'TratoSourceChunks'
MODEL = 'Snowflake/snowflake-arctic-embed-l-v2.0'
PROFILE = {'provider': 'weaviate_embeddings', 'model': MODEL, 'dimensions': 1024,
           'distance': 'cosine', 'input_version': 'chunk-text-v1', 'maximum_text_bytes': 4096}


def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


PROFILE_ID = digest(PROFILE)
KEY_FIELDS = ('owner_id', 'client_id', 'project_id', 'file_id', 'generation', 'embedding_identity',
              'segment_id', 'text_sha256')


PUBLIC_KEY_FIELDS = ('community_client_id', 'review_id', 'review_version')
