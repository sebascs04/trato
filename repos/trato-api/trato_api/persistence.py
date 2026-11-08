"""User-scoped PostgREST/Storage repository. No service-role credential required."""
from concurrent.futures import ThreadPoolExecutor
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

    def account_role(self):
        # RLS returns only the caller's own row; every account gets one at signup.
        rows = self.rows('account_roles', {'select': 'role', 'limit': 1})
        if not rows or rows[0].get('role') not in ('freelancer', 'client'):
            raise ApiError('ACCOUNT_ROLE_MISSING', 409)
        return rows[0]['role']

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
        params={'select':'id,client_id,name,status,created_at,document_totals:documents(count),request_totals:documents(count),refund_totals:refund_settlements(count)','request_totals.kind':'eq.email_request','document_totals.deleted_at':'is.null','request_totals.deleted_at':'is.null','order':'created_at.desc','limit':100}
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
        rows = self.rows('projects', {'select': 'id,owner_id,client_id,name,status,created_at', 'id': 'eq.' + uuid(project_id),
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
                                       'project_id': 'eq.' + project['id'], 'deleted_at':'is.null', 'order': 'created_at.desc', 'limit': 100})
        ids='in.('+','.join(row['id'] for row in rows)+')' if rows else None
        refund_links={}
        dispute_links={}
        contexts=[]
        latest_outcomes={}
        def processing_outcomes():
            latest={}
            offset=0
            while True:
                outcomes=self.rows('file_processing_artifacts',{'select':'document_id,status:artifact->>status,error_code:artifact->>error_code,reason:artifact->treatment->>reason',
                    'document_id':ids,'project_id':'eq.'+project['id'],'owner_id':'eq.'+project['owner_id'],
                    'stage':'eq.outcome','order':'created_at.desc,document_id.asc,cache_key.desc','limit':100,'offset':offset})
                for outcome in outcomes:
                    latest.setdefault(outcome['document_id'],outcome)
                if len(outcomes)<100 or len(latest)==len(rows):return latest
                offset+=len(outcomes)
        if ids:
            # These reads depend only on the documents above, so they do not wait for each other.
            with ThreadPoolExecutor(max_workers=7) as pool:
                outcomes_read=pool.submit(processing_outcomes)
                reads={name:pool.submit(self.rows,table,params) for name,(table,params) in {
                    'contexts':('document_upload_contexts',{'select':'*','document_id':ids,'project_id':'eq.'+project['id'],'owner_id':'eq.'+project['owner_id']}),
                    'dispute_links':('project_dispute_documents',{'select':'document_id,dispute_id,role,created_at','document_id':ids,'project_id':'eq.'+project['id'],'owner_id':'eq.'+project['owner_id'],'order':'created_at.asc'}),
                    'artifacts':('refund_artifacts',{'select':'document_id,snapshot_id,settlement_id','document_id':ids}),
                    'acceptances':('refund_acceptances',{'select':'snapshot_id,settlement_id,evidence','evidence->>document_id':ids}),
                    'feedback':('refund_feedback',{'select':'snapshot_id,settlement_id,evidence','evidence->>document_id':ids}),
                    'cases':('refund_settlements',{'select':'id,request_evidence,created_at','project_id':'eq.'+project['id'],'owner_id':'eq.'+project['owner_id']})}.items()}
                latest_outcomes=outcomes_read.result()
                data={name:read.result() for name,read in reads.items()}
            contexts=data['contexts']
            for link in data['dispute_links']:
                dispute_links.setdefault(link['document_id'],[]).append({k:link[k] for k in ('dispute_id','role','created_at')})
        by_context={row['document_id']:row for row in contexts}
        context_revisions={row['revision_id'] for row in contexts if row.get('revision_id')}
        revision_numbers=self.rows('proposal_revisions',{'select':'id,revision_no','id':'in.('+','.join(sorted(context_revisions))+')',
            'project_id':'eq.'+project['id'],'owner_id':'eq.'+project['owner_id']}) if context_revisions else []
        revision_numbers={row['id']:row['revision_no'] for row in revision_numbers}
        if ids:
            cases=data['cases']
            references=[(a['document_id'],a,'proposal') for a in data['artifacts']]
            references += [(a['evidence']['document_id'],a,'acceptance') for a in data['acceptances']]
            references += [(a['evidence']['document_id'],a,'feedback') for a in data['feedback']]
            references += [(e['document_id'],{'settlement_id':case['id'],'snapshot_id':None},'request')
                for case in cases for e in case.get('request_evidence',[]) if isinstance(e,dict) and e.get('document_id') in {r['id'] for r in rows}]
            references += [(row['document_id'],{'settlement_id':row['refund_case_id'],'snapshot_id':row['snapshot_id']},'reference')
                for row in contexts if row.get('refund_case_id') and row['document_id'] not in {d for d,_,_ in references}]
            snapshot_ids={a['snapshot_id'] for _,a,_ in references if a.get('snapshot_id')}
            versions=self.rows('refund_snapshots',{'select':'id,version_no','id':'in.('+','.join(sorted(snapshot_ids))+')'}) if snapshot_ids else []
            for document_id,link,role in references:
                version=next((v['version_no'] for v in versions if v['id']==link['snapshot_id']),None)
                if link.get('snapshot_id') is not None and version is None:raise ApiError('REFUND_SNAPSHOT_NOT_FOUND',409)
                refund_links.setdefault(document_id,[]).append({'settlement_id':link['settlement_id'],'snapshot_id':link['snapshot_id'],'version_no':version,'role':role,
                    **({'case_created_at':case['created_at']} if (case:=next((c for c in cases if c['id']==link['settlement_id']),None)) and case.get('created_at') else {})})
        for row in rows:
            outcome=latest_outcomes.get(row['id'])
            row['processing_outcome']=({'status':outcome.get('status'),'error_code':outcome.get('error_code'),
                'reason':outcome.get('reason')} if outcome else None)
            row['refund_links']=refund_links.get(row['id'],[])
            row['dispute_links']=dispute_links.get(row['id'],[])
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
            context=by_context.get(row['id'])
            row['upload_context']=({k:v for k,v in context.items() if k not in ('owner_id','document_id','created_at')} if context else None)
            if context and context.get('request_document_id') and context['request_document_id']!=row['id']:
                role={'addendum_adjustments':'feedback','acceptance_evidence':'response','generated_addendum':'addendum'}.get(context['purpose'],'reference')
                # A file uploaded to answer v1 stays attached to v1 even before v2 exists.
                if role=='feedback':links=[link for link in links if link['role']!='feedback']
                if not any(link['request_document_id']==context['request_document_id'] and link['role'] in (role,'acceptance' if role=='response' else role) for link in links):
                    links.append({'request_document_id':context['request_document_id'],
                        'revision_no':revision_numbers.get(context.get('revision_id')),'role':role})
            row['request_links'] = links
        return rows

    def document(self, document_id):
        rows = self.rows('documents', {'select': '*', 'id': 'eq.' + uuid(document_id), 'deleted_at':'is.null'})
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

    def extractions(self, document_ids):
        """Same shape as extraction() for many documents, read with a few grouped queries instead of 4+ per document.

        Returns {document_id: value}; a document that is missing or deleted is simply absent, so callers keep
        raising DOCUMENT_NOT_FOUND exactly as with extraction().
        """
        ids = sorted({uuid(i) for i in document_ids})
        result = {}
        for start in range(0, len(ids), 50):
            batch = ids[start:start+50]; wanted = 'in.(' + ','.join(batch) + ')'
            docs = {d['id']: d for d in self.rows('documents', {'select': '*', 'id': wanted, 'deleted_at': 'is.null'})}
            projects = {pid: self.project(pid) for pid in {d['project_id'] for d in docs.values()}}
            extractions = {}
            for row in self.rows('document_extractions', {'select': 'id,document_id,status,parser,parser_version,warnings,error_code,completed_at,worker_thread_id', 'document_id': wanted}):
                extractions.setdefault(row.pop('document_id'), []).append(row)
            segments = {}
            for offset in range(0, 4096 * len(batch), 1000):
                page = self.rows('document_segments', {'select': 'id,document_id,ordinal,locator_kind,locator_number,text',
                    'document_id': wanted, 'order': 'document_id.asc,ordinal.asc,id.asc', 'limit': 1000, 'offset': offset})
                for row in page:
                    segments.setdefault(row.pop('document_id'), []).append(row)
                if len(page) < 1000:
                    break
            for doc_id, doc in docs.items():
                project = projects[doc['project_id']]
                extraction = (extractions.get(doc_id) or [None])[0]
                parts = segments.get(doc_id, [])[:4096]
                for segment in parts:
                    segment['source_context'] = {'owner_id': doc['owner_id'], 'client_id': project['client_id'],
                        'project_id': project['id'], 'document_id': doc['id'], 'extraction_id': extraction['id'] if extraction else None,
                        'segment_id': segment['id'], 'document_revision': doc['sha256'], 'origin_status': 'unverified'}
                public_doc = {key: value for key, value in doc.items() if key not in ('ingestion_key', 'command_hash', 'storage_path')}
                result[doc_id] = {'document': public_doc, 'extraction': extraction, 'segments': parts}
        return result

    def summary_artifacts(self, document_ids, generations):
        """Latest summary artifact per (document, generation), in one query for the whole inventory page."""
        ids, gens = sorted(set(document_ids)), sorted(set(generations))
        if not ids or not gens:
            return {}
        rows = self.rows('file_processing_artifacts', {'select': 'artifact,document_id,source_generation,created_at',
            'document_id': 'in.(' + ','.join(ids) + ')', 'source_generation': 'in.(' + ','.join(gens) + ')',
            'stage': 'eq.summary', 'order': 'created_at.desc'})
        latest = {}
        for row in rows:
            latest.setdefault((row['document_id'], row['source_generation']), row['artifact'])
        return latest

    def activity(self,project_id,*,group_kind=None,group_id=None):
        from concurrent.futures import ThreadPoolExecutor
        from datetime import datetime
        project=self.project(project_id)
        common={'project_id':'eq.'+project['id']}
        queries={
            'requests':('documents',{'select':'id,title,created_at','kind':'eq.email_request'}),
            'initial_sources':('documents',{'select':'id,title,created_at','kind':'eq.initial_agreement','deleted_at':'is.null'}),
            'proposals':('change_proposals',{'select':'id,request_document_id'}),
            'revisions':('proposal_revisions',{'select':'id,proposal_id,revision_no,additional_minor'}),
            'deliveries':('proposal_deliveries',{'select':'id,proposal_id,revision_id,kind,updated_at','status':'eq.accepted_by_gmail'}),
            'acceptances':('proposal_acceptances',{'select':'id,proposal_id,revision_id,method,created_at'}),
            'portal_requests':('client_portal_change_requests',{'select':'id,proposal_id,revision_id,created_at'}),
            'payments':('proposal_payments',{'select':'id,proposal_id,revision_id,amount_minor,currency,updated_at','status':'eq.completed'}),
            'closures':('request_closures',{'select':'request_document_id,reason,closed_at','order':'request_document_id.asc'})}
        from .refunds.activity import QUERIES,milestones
        queries.update(QUERIES)
        def all_rows(table,params):
            result=[];offset=0
            while True:
                page=self.rows(table,{'order':'id.asc',**common,**params,'limit':500,'offset':offset})
                result.extend(page)
                if len(page)<500:return result
                offset+=len(page)
        if group_kind is not None:
            from .history_scope import scoped_rows
            data=scoped_rows(self,project,group_kind,group_id,queries,all_rows)
        else:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures={name:pool.submit(all_rows,table,params) for name,(table,params) in queries.items()}
                data={name:future.result() for name,future in futures.items()}
        requests={row['id']:row for row in data['requests']}
        proposals={row['id']:row for row in data['proposals']}
        revisions={row['id']:row for row in data['revisions']}
        events=[]
        def add(id,kind,title,timestamp,request_id,**extra):
            if not timestamp:raise ApiError('ACTIVITY_TIMESTAMP_MISSING',502)
            request=requests.get(request_id)
            if request is None:raise ApiError('ACTIVITY_CONTEXT_MISSING',502)
            events.append({'id':id,'kind':kind,'title':title,'created_at':timestamp,'request_document_id':request_id,'request_title':request['title'],'group_kind':'change','group_id':request_id,'group_title':request['title'],**extra})
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
            portal=row.get('method')=='client_portal'
            add('acceptance-'+row['id'],'acceptance_recorded',f'Adenda v{version} aceptada por el cliente en el portal' if portal else f'Aceptación de adenda v{version} registrada',row['created_at'],request_id,revision_no=version,**({'source':'client_portal'} if portal else {}))
        for row in data['portal_requests']:
            request_id,version=context(row)
            add('portal-request-'+row['id'],'client_changes_requested',f'Ajustes pedidos por el cliente en el portal · v{version}',row['created_at'],request_id,revision_no=version,source='client_portal')
        for row in data['payments']:
            request_id,version=context(row);minor=row['amount_minor']
            add('payment-'+row['id'],'payment_completed',f'Pago confirmado · {row["currency"]} {minor//100}.{minor%100:02d}',row['updated_at'],request_id,revision_no=version,amount_minor=minor,currency=row['currency'])
        for row in data['closures']:
            add('closure-'+row['request_document_id'],'request_closed','Pedido cerrado · '+('Rechazado' if row['reason']=='rejected' else 'Retirado'),row['closed_at'],row['request_document_id'],reason=row['reason'])
        # Project start: its creation and the initial sources it was set up with.
        def start(id,kind,timestamp,**extra):
            if not timestamp:raise ApiError('ACTIVITY_TIMESTAMP_MISSING',502)
            events.append({'id':id,'kind':kind,'created_at':timestamp,'group_kind':'project','group_id':project['id'],'group_title':project['name'],**extra})
        if group_kind in (None,'project'):
            start('project-'+project['id'],'project_created',project.get('created_at'),title='Proyecto creado')
            for row in data['initial_sources']:
                start('source-'+row['id'],'initial_source_added',row['created_at'],title=row['title'],document_id=row['id'])
            # Initial plan: confirmation, delivery evidence and stage payments verified by the backend.
            plans=self.rows('project_start_plans',{'select':'created_at,currency',**common})
            if plans:
                plan=plans[0]
                stages={row['position']:row for row in self.rows('project_start_stages',{'select':'position,title,amount',**common,'order':'position.asc'})}
                minor=lambda value:int(round(float(value)*100))
                start('plan-'+project['id'],'plan_confirmed',plan['created_at'],stages=len(stages),amount_minor=sum(minor(s['amount']) for s in stages.values()),currency=plan['currency'])
                contexts=self.rows('document_upload_contexts',{'select':'document_id,stage_position',**common,'purpose':'eq.delivery_evidence','stage_position':'not.is.null','order':'document_id.asc'})
                delivered={row['id']:row for row in all_rows('documents',{'select':'id,title,created_at','kind':'eq.delivery','deleted_at':'is.null'})}
                for row in contexts:
                    doc=delivered.get(row['document_id'])
                    if doc:start('delivery-'+doc['id'],'delivery_evidence_added',doc['created_at'],stage_position=row['stage_position'],title=doc['title'],document_id=doc['id'])
                progress=self.rpc('project_plan_progress',{'p_project':project['id']}) or {}
                for row in progress.get('stages') or []:
                    stage=stages.get(row.get('position'))
                    if row.get('status')=='completed' and row.get('paid_at') and stage:
                        start('stage-paid-'+str(row['payment_id']),'stage_paid',row['paid_at'],stage_position=row['position'],stage_title=stage['title'],
                              amount_minor=minor(stage['amount']),currency=plan['currency'],**({'document_id':row['evidence_document_id']} if row.get('evidence_document_id') else {}))
                if progress.get('completed_at'):start('plan-completed-'+project['id'],'plan_completed',progress['completed_at'])
        events.extend(milestones(data))
        events.sort(key=lambda event:datetime.fromisoformat(event['created_at'].replace('Z','+00:00')),reverse=True)
        return events

    def request_status(self,project_id):
        project=self.project(project_id)
        status=self.rpc('project_request_status',{'p_project_id':uuid(project_id)})
        # The open change request and its place in the work plan, so the plan can show it before a proposal exists.
        active=status.get('active_request') if isinstance(status,dict) else None
        if isinstance(status,dict):
            status['open_request']=None
            if isinstance(active,dict) and active.get('kind')!='refund' and active.get('id'):
                rows=self.rows('change_request_plan_placements',{'select':'placement,stage_position',
                    'request_document_id':'eq.'+uuid(active['id']),'project_id':'eq.'+project['id']})
                status['open_request']={'request_document_id':active['id'],'plan_placement':rows[0]['placement'] if rows else None,
                    'plan_stage_position':rows[0]['stage_position'] if rows else None}
        return status

    def with_plan_placements(self,project_id,groups):
        """History change groups carry where their request sits in the plan (stage position/title or new work)."""
        if not isinstance(groups,list) or not any(isinstance(g,dict) and g.get('group_kind')=='change' for g in groups):return groups
        placed={p['request_document_id']:p for p in self.rows('change_request_plan_placements',{'select':'request_document_id,placement,stage_position','project_id':'eq.'+uuid(project_id)})}
        titles={s['position']:s['title'] for s in self.rows('project_start_stages',{'select':'position,title','project_id':'eq.'+uuid(project_id)})} if placed else {}
        for group in groups:
            if not isinstance(group,dict) or group.get('group_kind')!='change':continue
            where=placed.get(group.get('group_id'))
            group['plan_placement']=where['placement'] if where else None
            group['plan_stage_position']=where['stage_position'] if where else None
            group['plan_stage_title']=titles.get(where['stage_position']) if where and where['stage_position'] else None
        return groups

    def set_plan_placement(self,request_id,placement,stage_position):
        """Record once where a change request sits in the plan: under a stage or as new work. Never edited."""
        doc=self.document(request_id)
        if doc.get('kind')!='email_request':raise ApiError('REQUEST_NOT_FOUND',404)
        project=self.project(doc['project_id'])
        if (placement=='stage')!=(stage_position is not None):raise ApiError('INVALID_REQUEST',422)
        if not self.rows('project_start_plans',{'select':'project_id','project_id':'eq.'+project['id']}):raise ApiError('PLAN_NOT_FOUND',409)
        if placement=='stage' and not self.rows('project_start_stages',{'select':'position','project_id':'eq.'+project['id'],'position':'eq.'+str(stage_position)}):
            raise ApiError('PLAN_STAGE_NOT_FOUND',404)
        # A paid stage is closed: later work on it is a new request, never part of what was already paid.
        # project_initial_checkouts is service-role only; the owner reads payment state through project_plan_progress.
        if placement=='stage':
            progress=self.rpc('project_plan_progress',{'p_project':project['id']}) or {}
            if any(s.get('position')==stage_position and s.get('status')=='completed' for s in progress.get('stages') or []):
                raise ApiError('PLAN_STAGE_CLOSED',409)
        current=self.rows('change_request_plan_placements',{'select':'placement,stage_position','request_document_id':'eq.'+doc['id']})
        value={'request_document_id':doc['id'],'plan_placement':placement,'plan_stage_position':stage_position}
        if current:
            if (current[0]['placement'],current[0]['stage_position'])!=(placement,stage_position):raise ApiError('PLAN_PLACEMENT_FIXED',409)
            return value
        self.call('POST','/rest/v1/change_request_plan_placements',json={'request_document_id':doc['id'],'project_id':project['id'],
            'owner_id':doc['owner_id'],'placement':placement,'stage_position':stage_position})
        return value

    def close_request(self,request_id,reason,notes):
        return self.rpc('close_change_request',{'p_request_id':uuid(request_id),'p_reason':reason,'p_notes':notes})

    def events(self, project_id):
        project = self.project(project_id)
        return self.rows('project_events', {'select': 'id,project_id,document_id,event_type,actor_id,created_at',
            'project_id': 'eq.' + project['id'], 'order': 'created_at.desc', 'limit': 100})

    def reserve(self, project_id, title, kind, filename, mime, data, key, *, context=None):
        self.project(project_id)
        result=self.rpc('reserve_document_with_context', {'p_project_id': uuid(project_id), 'p_title': title, 'p_kind': kind,
            'p_filename': filename, 'p_mime': mime, 'p_size': len(data), 'p_sha256': sha256(data).hexdigest(), 'p_key': key, 'p_context': context or {}})
        if result['document'].get('deleted_at'):raise ApiError('DOCUMENT_RETIRED',409)
        return result

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
