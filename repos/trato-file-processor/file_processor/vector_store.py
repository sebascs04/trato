"""Execute embeddings/index/search in the file processor. No user/business permissions."""
from contextlib import contextmanager
import os
from urllib.parse import urlparse
from .vector_contract import COLLECTION, MODEL, PROFILE, PROFILE_ID, KEY_FIELDS, PUBLIC_KEY_FIELDS, digest

class VectorError(Exception):
    def __init__(self, code, status=503):
        self.code, self.status = code, status
        super().__init__(code)

class WeaviateStore:
    def __init__(self, url=None, key=None):
        self.url = os.getenv('WEAVIATE_URL', '') if url is None else url
        self.key = os.getenv('WEAVIATE_API_KEY', '') if key is None else key

    @contextmanager
    def connection(self):
        p = urlparse(self.url)
        if (p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or
                p.fragment or p.path not in ('', '/') or not self.key):
            raise VectorError('VECTOR_NOT_CONFIGURED', 503)
        import weaviate
        from weaviate.classes.init import Auth, AdditionalConfig, Timeout
        from weaviate.config import ConnectionConfig
        from weaviate.exceptions import WeaviateBaseError
        try:
            with weaviate.connect_to_weaviate_cloud(
                cluster_url=self.url, auth_credentials=Auth.api_key(self.key),
                additional_config=AdditionalConfig(timeout=Timeout(init=15, query=45, insert=120),
                    connection=ConnectionConfig(session_pool_max_retries=0))) as client:
                yield client
        except WeaviateBaseError as error:
            status = getattr(error, 'status_code', None)
            if callable(status):
                status = status()
            code = ('VECTOR_QUOTA_EXCEEDED' if status == 429 else 'VECTOR_ACCESS_DENIED'
                    if status in (401, 403) else 'VECTOR_PROVIDER_CONFIGURATION_INVALID'
                    if status == 422 else 'VECTOR_PROVIDER_UNAVAILABLE')
            raise VectorError(code, 503) from None

    @staticmethod
    def tenant(owner):
        # Fixed privacy boundary, never one tenant per person/client/project.
        return 'projects_private'

    def provision(self):
        """Explicit administrative action, never automatic recovery during search."""
        from weaviate.classes.config import Configure, DataType, Property, Tokenization, VectorDistances, StopwordsPreset
        with self.connection() as client:
            if not client.collections.exists(COLLECTION):
                properties = [Property(name=k, data_type=DataType.TEXT, tokenization=Tokenization.FIELD,
                                      index_searchable=False, vectorize_property_name=False) for k in KEY_FIELDS]
                properties += [Property(name='chunk_text', data_type=DataType.TEXT,
                                        vectorize_property_name=False),
                               Property(name='start_char', data_type=DataType.INT),
                               Property(name='end_char', data_type=DataType.INT)]
                client.collections.create(COLLECTION, properties=properties,
                    description='Trato project-private text chunks; profile ' + PROFILE_ID,
                    vector_config=Configure.Vectors.text2vec_weaviate(name='text', source_properties=['chunk_text'],
                        model=MODEL, dimensions=1024, vectorize_collection_name=False,
                        vector_index_config=Configure.VectorIndex.hfresh(distance_metric=VectorDistances.COSINE)),
                    inverted_index_config=Configure.inverted_index(stopwords_preset=StopwordsPreset.NONE),
                    multi_tenancy_config=Configure.multi_tenancy(enabled=True, auto_tenant_creation=False))
            collection = client.collections.use(COLLECTION)
            existing = {p.name for p in collection.config.get().properties}
            for name in PUBLIC_KEY_FIELDS:
                if name not in existing:
                    collection.config.add_property(Property(name=name, data_type=DataType.TEXT,
                        tokenization=Tokenization.FIELD, index_searchable=False, vectorize_property_name=False))
            self.validate(client)

    def validate(self, client):
        if not client.collections.exists(COLLECTION):
            raise VectorError('VECTOR_COLLECTION_NOT_CONFIGURED', 503)
        cfg = client.collections.use(COLLECTION).config.get()
        vector = cfg.vector_config.get('text') if cfg.vector_config else None
        raw = vector.to_dict() if vector else {}
        v = vector.vectorizer.model if vector else {}
        if (cfg.description != 'Trato project-private text chunks; profile ' + PROFILE_ID or
            not cfg.multi_tenancy_config.enabled or cfg.multi_tenancy_config.auto_tenant_creation or
            v.get('model') != MODEL or v.get('dimensions') != 1024 or
            str(vector.vectorizer.vectorizer) not in ('Vectorizers.TEXT2VEC_WEAVIATE', 'text2vec-weaviate') or
            vector.vectorizer.source_properties != ['chunk_text'] or v.get('vectorizeClassName') is not False or
            raw.get('vectorIndexConfig', {}).get('distanceMetric') != 'cosine' or
            raw.get('vectorIndexType') != 'hfresh' or
            set(cfg.vector_config) != {'text'}):
            raise VectorError('EMBEDDING_PROFILE_MISMATCH', 409)
        if ({p.name for p in cfg.properties} != {*KEY_FIELDS, *PUBLIC_KEY_FIELDS, 'chunk_text', 'start_char', 'end_char'} or
            any(p.index_searchable for p in cfg.properties if p.name != 'chunk_text')):
            raise VectorError('EMBEDDING_PROFILE_MISMATCH', 409)

    def ensure_tenant(self, client, owner):
        from weaviate.classes.tenants import Tenant
        col = client.collections.use(COLLECTION)
        name = self.tenant(owner)
        if name not in col.tenants.get():
            if len(col.tenants.get()) >= 3:
                raise VectorError('VECTOR_TENANT_LIMIT', 409)
            col.tenants.create([Tenant(name=name)])
        return col.with_tenant(name)

    def write(self, owner, records):
        from weaviate.classes.query import Filter
        p = records[0]['properties']
        filters = Filter.all_of([Filter.by_property(k).equal(p[k])
            for k in ('owner_id','client_id','project_id','file_id','generation')])
        return self._write('projects_private', records, filters)

    def write_public(self, profile, records):
        from weaviate.classes.query import Filter
        p = records[0]['properties']
        filters = Filter.all_of([Filter.by_property(k).equal(p[k])
            for k in ('community_client_id','review_id','generation')])
        return self._write('reputation_public', records, filters)

    def _write(self, tenant, records, filters):
        from weaviate.classes.data import DataObject
        from weaviate.classes.query import Filter
        if not records or len(records) > 512:
            raise VectorError('VECTOR_DOCUMENT_LIMIT', 422)
        with self.connection() as client:
            self.validate(client)
            base = client.collections.use(COLLECTION)
            if tenant not in base.tenants.get():
                raise VectorError('VECTOR_TENANT_NOT_CONFIGURED', 503)
            col = base.with_tenant(tenant)
            first = records[0]['properties']
            existing = col.query.fetch_objects(filters=filters, limit=513, return_properties=list(first)).objects
            expected = {r['id']: r['properties'] for r in records}
            if any(str(o.uuid) not in expected or o.properties != expected[str(o.uuid)] for o in existing):
                raise VectorError('VECTOR_GENERATION_CONFLICT', 409)
            present = {str(o.uuid) for o in existing}
            missing = [r for r in records if r['id'] not in present]
            # Count real objects, including old/partial generations, across all tenants.
            base = client.collections.use(COLLECTION)
            count = sum(base.with_tenant(t).aggregate.over_all(total_count=True).total_count
                        for t in base.tenants.get())
            if count + len(missing) > 99000:
                raise VectorError('VECTOR_CAPACITY_LIMIT', 409)
            for start in range(0, len(missing), 200):
                result = col.data.insert_many([DataObject(uuid=r['id'], properties=r['properties'])
                                               for r in missing[start:start+200]])
                if result.has_errors:
                    # A partial write is deliberately not active. Retry uses the same IDs.
                    raise VectorError('VECTOR_BATCH_FAILED', 503)
            objects = col.query.fetch_objects(filters=filters, limit=513, return_properties=list(first), include_vector=True).objects
            if (len(objects) != len(records) or {str(o.uuid) for o in objects} != set(expected) or
                any(o.properties != expected[str(o.uuid)] or not isinstance(o.vector, dict) or
                    not isinstance(o.vector.get('text'), list) or len(o.vector['text']) != 1024 for o in objects)):
                raise VectorError('VECTOR_INDEX_INCOMPLETE', 503)
            return {'objects': len(records), 'embedding_identity': PROFILE_ID}

    def search(self, owner, client_id, project_id, files, query, limit):
        from weaviate.classes.query import Filter, HybridFusion, MetadataQuery
        if not isinstance(query, str) or not query.strip() or len(query.encode()) > 4096:
            raise VectorError('EMBEDDING_INPUT_LIMIT', 422)
        with self.connection() as client:
            self.validate(client)
            col = client.collections.use(COLLECTION)
            if self.tenant(owner) not in col.tenants.get():
                raise VectorError('VECTOR_INDEX_INCOMPLETE', 409)
            filters = Filter.all_of([
                Filter.by_property('owner_id').equal(owner), Filter.by_property('client_id').equal(client_id),
                Filter.by_property('project_id').equal(project_id),
                Filter.by_property('embedding_identity').equal(PROFILE_ID),
                Filter.any_of([Filter.all_of([Filter.by_property('file_id').equal(f['id']),
                    Filter.by_property('generation').equal(f['generation'])]) for f in files])])
            response = col.with_tenant(self.tenant(owner)).query.hybrid(query=query, alpha=0.7,
                fusion_type=HybridFusion.RELATIVE_SCORE, target_vector='text', query_properties=['chunk_text'],
                filters=filters, limit=limit, return_metadata=MetadataQuery(score=True),
                return_properties=[*KEY_FIELDS, 'chunk_text', 'start_char', 'end_char'])
            return [{'id': str(o.uuid), 'properties': o.properties, 'score': o.metadata.score}
                    for o in response.objects]

    def search_public(self, profile, files, query, limit, expected_chunks):
        from weaviate.classes.query import Filter, HybridFusion, MetadataQuery
        with self.connection() as client:
            self.validate(client)
            col = client.collections.use(COLLECTION).with_tenant('reputation_public')
            filters = Filter.all_of([Filter.by_property('community_client_id').equal(profile),
                Filter.by_property('embedding_identity').equal(PROFILE_ID),
                Filter.any_of([Filter.all_of([Filter.by_property('review_id').equal(f['id']),
                    Filter.by_property('generation').equal(f['generation'])]) for f in files])])
            if col.aggregate.over_all(filters=filters,total_count=True).total_count != expected_chunks:
                raise VectorError('REPUTATION_VECTOR_INDEX_INCOMPLETE',409)
            response = col.query.hybrid(query=query, alpha=0.7, fusion_type=HybridFusion.RELATIVE_SCORE,
                target_vector='text', query_properties=['chunk_text'], filters=filters, limit=limit,
                return_metadata=MetadataQuery(score=True), return_properties=[*PUBLIC_KEY_FIELDS,
                    'generation','embedding_identity','segment_id','text_sha256','chunk_text','start_char','end_char'])
            if col.aggregate.over_all(filters=filters,total_count=True).total_count != expected_chunks:
                raise VectorError('REPUTATION_VECTOR_INDEX_INCOMPLETE',409)
            return [{'id':str(o.uuid),'properties':o.properties,'score':o.metadata.score} for o in response.objects]

    def prune_public(self, profile, files):
        from weaviate.classes.query import Filter
        with self.connection() as client:
            self.validate(client)
            col = client.collections.use(COLLECTION).with_tenant('reputation_public')
            scope = Filter.by_property('community_client_id').equal(profile)
            keep = Filter.any_of([Filter.all_of([Filter.by_property('review_id').equal(f['id']),
                       Filter.by_property('generation').equal(f['generation'])]) for f in files]) if files else None
            stale = Filter.all_of([scope, ~keep]) if keep is not None else scope
            result = col.data.delete_many(where=stale)
            if result.failed or col.aggregate.over_all(filters=stale,total_count=True).total_count != 0:
                raise VectorError('VECTOR_PRUNE_INCOMPLETE',503)
            return {'pruned':True,'embedding_identity':PROFILE_ID}
