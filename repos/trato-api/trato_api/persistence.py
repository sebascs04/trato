"""User-scoped PostgREST/Storage repository. No service-role credential required."""
from hashlib import sha256
import re
from urllib.parse import quote, urlparse
from uuid import UUID

import httpx
from .errors import ApiError

BUCKET = 'project-documents'
DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


def uuid(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ApiError('INVALID_ID', 422)


class Repository:
    def __init__(self, settings, authorization, *, transport=None):
        if not settings.supabase_url or not settings.supabase_key:
            raise ApiError('PERSISTENCE_NOT_CONFIGURED', 503)
        self.base = settings.supabase_url.rstrip('/')
        if urlparse(self.base).scheme != 'https' or not authorization.startswith('Bearer '):
            raise ApiError('PERSISTENCE_NOT_CONFIGURED', 503)
        self.headers = {'apikey': settings.supabase_key, 'Authorization': authorization}
        self.transport = transport

    def call(self, method, path, *, json=None, params=None, content=None, headers=None, binary=False):
        request_headers = dict(self.headers, **(headers or {}))
        try:
            with httpx.Client(timeout=25, follow_redirects=False, transport=self.transport) as client:
                with client.stream(method, self.base + path, headers=request_headers,
                                   json=json, params=params, content=content) as response:
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > (10485760 if binary else 4_000_000):
                            raise ApiError('STORAGE_RESPONSE_TOO_LARGE', 502)
                        chunks.append(chunk)
                    raw = b''.join(chunks)
                    if response.is_success:
                        if binary:
                            return raw
                        if not raw:
                            return None
                        import json as json_module
                        return json_module.loads(raw)
                    import json as json_module
                    try:
                        error = json_module.loads(raw)
                    except ValueError:
                        error = {}
                    if not isinstance(error, dict):
                        error = {}
                    code = error.get('message', '')
                    if response.status_code == 401:
                        raise ApiError('UNAUTHORIZED', 401)
                    if response.status_code == 404:
                        raise ApiError('RESOURCE_NOT_FOUND', 404)
                    if response.status_code == 409 or error.get('code') == '23505':
                        raise ApiError(code if re.fullmatch('[A-Z][A-Z0-9_]{1,79}', code) else 'CONFLICT', 409)
                    if response.status_code in (400, 403, 413, 422):
                        safe = code if re.fullmatch('[A-Z][A-Z0-9_]{1,79}', code) else 'INVALID_OR_UNAUTHORIZED_OPERATION'
                        status = 404 if safe.endswith('_NOT_FOUND') else 409 if safe.endswith('_CONFLICT') or safe == 'ORIGINAL_NOT_STORED' else 422
                        raise ApiError(safe, status)
                    raise ApiError('PERSISTENCE_UNAVAILABLE', 503)
        except (httpx.HTTPError, ValueError, TypeError):
            raise ApiError('PERSISTENCE_UNAVAILABLE', 503)

    def rows(self, table, params):
        return self.call('GET', '/rest/v1/' + table, params=params)

    def rpc(self, name, data):
        return self.call('POST', '/rest/v1/rpc/' + name, json=data)

    def list_clients(self):
        return self.rows('clients', {'select': 'id,name,contact_email,created_at', 'order': 'created_at.desc', 'limit': 100})

    def create_client(self, name, email):
        return self.call('POST', '/rest/v1/clients', json={'name': name, 'contact_email': email},
                         headers={'Prefer': 'return=representation'})[0]

    def soft_delete_client(self,client_id):
        return self.rpc('soft_delete_client',{'p_client_id':uuid(client_id)})

    def soft_delete_project(self,project_id):
        return self.rpc('soft_delete_project',{'p_project_id':uuid(project_id)})

    def list_projects(self,client_id=None):
        params={'select':'id,client_id,name,status,created_at','order':'created_at.desc','limit':100}
        if client_id is not None:params['client_id']='eq.'+uuid(client_id)
        return self.rows('projects',params)

    def create_project(self, client_id, name, creation_key=None):
        client_id = uuid(client_id)
        if not self.rows('clients', {'select': 'id', 'id': 'eq.' + client_id}):
            raise ApiError('CLIENT_NOT_FOUND', 404)
        body = {'client_id': client_id, 'name': name}
        if creation_key is not None:
            body['id'] = uuid(creation_key)
        try:
            return self.call('POST', '/rest/v1/projects', json=body,
                             headers={'Prefer': 'return=representation'})[0]
        except ApiError as error:
            if creation_key is None or error.status != 409:
                raise
            # Retry of the same explicit creation command, scoped by the user's
            # JWT/RLS. Never overwrite a different project or another owner's row.
            existing = self.project(creation_key)
            if existing['client_id'] != client_id or existing['name'] != name:
                raise ApiError('PROJECT_CREATION_CONFLICT', 409) from None
            return existing

    def project(self, project_id):
        rows = self.rows('projects', {'select': 'id,owner_id,client_id,name,status', 'id': 'eq.' + uuid(project_id),
                                     'deleted_at': 'is.null'})
        if not rows:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        return rows[0]

    def list_documents(self, project_id):
        project = self.project(project_id)
        proposal = 'proposal:change_proposals!proposal_revisions_proposal_id_project_id_owner_id_fkey(request_document_id)'
        revision = 'revision_no,' + proposal
        # Explicit FK hints distinguish a returned acceptance from the document used for review.
        artifacts = 'proposal_artifacts(revision_id,revision:proposal_revisions!proposal_artifacts_revision_id_proposal_id_project_id_owne_fkey(' + revision + '))'
        acceptances = ('acceptances:proposal_acceptances!proposal_acceptances_returned_document_id_project_id_owner_fkey('
                       'review:proposal_reviews!proposal_acceptances_revision_id_proposal_id_project_id_ow_fkey('
                       'revision:proposal_revisions!proposal_reviews_revision_id_proposal_id_project_id_owner__fkey(' + revision + ')))')
        feedback = 'feedback:proposal_revisions!proposal_revisions_feedback_document_id_project_id_owner_i_fkey(' + revision + ')'
        select = ('id,project_id,title,kind,original_filename,mime_type,size_bytes,sha256,origin_status,created_at,'
                  'document_extractions(id,status,error_code,worker_thread_id,worker_threads(status,phase)),') + ','.join((artifacts, acceptances, feedback))
        rows = self.rows('documents', {'select': select,
                                       'project_id': 'eq.' + project['id'], 'order': 'created_at.desc', 'limit': 100})
        for row in rows:
            links = []
            def add_link(revision, role):
                if revision and revision.get('proposal'):
                    link = {'request_document_id': revision['proposal']['request_document_id'],
                            'revision_no': revision['revision_no'], 'role': role}
                    if link not in links:
                        links.append(link)
            for artifact in row.get('proposal_artifacts', []):
                add_link(artifact.pop('revision', None), 'addendum')
            for acceptance in row.pop('acceptances', []):
                add_link((acceptance.get('review') or {}).get('revision'), 'acceptance')
            for revision_row in row.pop('feedback', []):
                add_link(revision_row, 'feedback')
            row['request_links'] = links
        return rows

    def document(self, document_id):
        rows = self.rows('documents', {'select': '*', 'id': 'eq.' + uuid(document_id)})
        if not rows:
            raise ApiError('DOCUMENT_NOT_FOUND', 404)
        return rows[0]

    def extraction(self, document_id):
        doc = self.document(document_id)
        project = self.project(doc['project_id'])
        extractions = self.rows('document_extractions', {'select': 'id,status,parser,parser_version,warnings,error_code,completed_at,worker_thread_id', 'document_id': 'eq.' + doc['id']})
        # PostgREST caps each response (normally 1000 rows); never silently lose later pages.
        segments = []
        for offset in range(0, 4096, 1000):
            page = self.rows('document_segments', {'select': 'id,ordinal,locator_kind,locator_number,text',
                'document_id': 'eq.' + doc['id'], 'order': 'ordinal.asc', 'limit': min(1000, 4096-offset), 'offset': offset})
            segments.extend(page)
            if len(page) < min(1000, 4096-offset):
                break
        extraction = extractions[0] if extractions else None
        for segment in segments:
            segment['source_context'] = {'owner_id': doc['owner_id'], 'client_id': project['client_id'],
                'project_id': project['id'], 'document_id': doc['id'], 'extraction_id': extraction['id'],
                'segment_id': segment['id'], 'document_revision': doc['sha256'],
                'origin_status': 'unverified'}
        public_doc = {key: value for key, value in doc.items() if key not in ('ingestion_key', 'command_hash', 'storage_path')}
        return {'document': public_doc, 'extraction': extraction, 'segments': segments}

    def activity(self,project_id):
        from concurrent.futures import ThreadPoolExecutor
        from datetime import datetime
        project=self.project(project_id)
        common={'project_id':'eq.'+project['id'],'limit':1000}
        queries={
            'requests':('documents',{'select':'id,title,created_at','kind':'eq.email_request'}),
            'proposals':('change_proposals',{'select':'id,request_document_id'}),
            'revisions':('proposal_revisions',{'select':'id,proposal_id,revision_no,additional_minor'}),
            'deliveries':('proposal_deliveries',{'select':'id,proposal_id,revision_id,kind,updated_at','status':'eq.accepted_by_gmail'}),
            'acceptances':('proposal_acceptances',{'select':'id,proposal_id,revision_id,created_at'}),
            'payments':('proposal_payments',{'select':'id,proposal_id,revision_id,amount_minor,currency,updated_at','status':'eq.completed'}),
            'closures':('request_closures',{'select':'request_document_id,reason,closed_at'})}
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures={name:pool.submit(self.rows,table,{**common,**params}) for name,(table,params) in queries.items()}
            data={name:future.result() for name,future in futures.items()}
        requests={row['id']:row for row in data['requests']}
        proposals={row['id']:row for row in data['proposals']}
        revisions={row['id']:row for row in data['revisions']}
        events=[]
        def add(id,kind,title,timestamp,request_id,**extra):
            if not timestamp:raise ApiError('ACTIVITY_TIMESTAMP_MISSING',502)
            request=requests.get(request_id)
            if request is None:raise ApiError('ACTIVITY_CONTEXT_MISSING',502)
            events.append({'id':id,'kind':kind,'title':title,'created_at':timestamp,'request_document_id':request_id,'request_title':request['title'],**extra})
        def context(row):
            proposal=proposals.get(row['proposal_id']);revision=revisions.get(row['revision_id'])
            if proposal is None or revision is None:raise ApiError('ACTIVITY_CONTEXT_MISSING',502)
            return proposal['request_document_id'],revision['revision_no']
        for row in data['requests']:add('request-'+row['id'],'request_registered','Pedido registrado',row['created_at'],row['id'])
        for row in data['deliveries']:
            request_id,version=context(row)
            kind='adenda_sent' if row['kind']=='adenda' else 'payment_requested'
            title=f'Adenda v{version} enviada' if row['kind']=='adenda' else 'Solicitud de pago enviada'
            add('email-'+row['id'],kind,title,row['updated_at'],request_id,revision_no=version)
        for row in data['acceptances']:
            request_id,version=context(row)
            add('acceptance-'+row['id'],'acceptance_recorded',f'Aceptación de adenda v{version} registrada',row['created_at'],request_id,revision_no=version)
        for row in data['payments']:
            request_id,version=context(row);minor=row['amount_minor']
            add('payment-'+row['id'],'payment_completed',f'Pago confirmado · {row["currency"]} {minor//100}.{minor%100:02d}',row['updated_at'],request_id,revision_no=version,amount_minor=minor,currency=row['currency'])
        for row in data['closures']:
            add('closure-'+row['request_document_id'],'request_closed','Pedido cerrado · '+('Rechazado' if row['reason']=='rejected' else 'Retirado'),row['closed_at'],row['request_document_id'])
        events.sort(key=lambda event:datetime.fromisoformat(event['created_at'].replace('Z','+00:00')),reverse=True)
        return events

    def request_status(self,project_id):
        self.project(project_id)
        return self.rpc('project_request_status',{'p_project_id':uuid(project_id)})

    def close_request(self,request_id,reason,notes):
        return self.rpc('close_change_request',{'p_request_id':uuid(request_id),'p_reason':reason,'p_notes':notes})

    def events(self, project_id):
        project = self.project(project_id)
        return self.rows('project_events', {'select': 'id,project_id,document_id,event_type,actor_id,created_at',
            'project_id': 'eq.' + project['id'], 'order': 'created_at.desc', 'limit': 100})

    def reserve(self, project_id, title, kind, filename, mime, data, key):
        self.project(project_id)
        return self.rpc('reserve_document', {'p_project_id': uuid(project_id), 'p_title': title, 'p_kind': kind,
            'p_filename': filename, 'p_mime': mime, 'p_size': len(data), 'p_sha256': sha256(data).hexdigest(), 'p_key': key})

    def upload(self, document, data):
        path = '/storage/v1/object/' + BUCKET + '/' + quote(document['storage_path'], safe='/')
        try:
            return self.call('POST', path, content=data, headers={'Content-Type': document['mime_type'], 'x-upsert': 'false'})
        except ApiError as error:
            # Storage versions may report duplicate as 400 or 409. Verify original bytes;
            # never overwrite. Re-raise the initial failure if no original exists.
            if error.status not in (409, 422):
                raise
            try:
                existing = self.download(document)
            except ApiError:
                raise error
            if sha256(existing).hexdigest() != document['sha256']:
                raise ApiError('ORIGINAL_HASH_MISMATCH', 409)

    def download(self, document):
        data = self.call('GET', '/storage/v1/object/authenticated/' + BUCKET + '/' +
                         quote(document['storage_path'], safe='/'), binary=True)
        if len(data) != document['size_bytes'] or sha256(data).hexdigest() != document['sha256']:
            raise ApiError('ORIGINAL_HASH_MISMATCH', 409)
        return data

    def complete(self, document_id, result):
        return self.rpc('complete_document_ingestion', {'p_document_id': uuid(document_id), 'p_result': result})

    def fail(self, document_id, code):
        return self.rpc('fail_document_ingestion', {'p_document_id': uuid(document_id), 'p_code': code})

    def queue_document(self, document_id):
        return self.rpc('queue_document', {'p_document_id': uuid(document_id)})

    def thread_status(self, thread_id):
        rows = self.rows('worker_threads', {'select':'id,workflow,subject_id,status,phase,error_code,created_at,updated_at', 'id':'eq.'+uuid(thread_id)})
        if not rows:
            raise ApiError('THREAD_NOT_FOUND',404)
        return rows[0]
