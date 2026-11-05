"""Explicit documentary choices constrain every agent tool, including archived evidence."""
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest import TestCase
from uuid import uuid4

from trato_api.errors import ApiError
from trato_api.project_assistant import ProjectAssistant, Call, Question
from trato_api.case_assistant import CaseAssistant, Message

OWNER, CLIENT, PROJECT, READY, PENDING, FOREIGN, JOB, LEASE = [str(uuid4()) for _ in range(8)]


class Repo:
    def project(self, value):
        return {'id': PROJECT, 'owner_id': OWNER, 'client_id': CLIENT}
    def rows(self, table, params):
        if table == 'clients': return [{'id': CLIENT}]
        if table == 'documents':
            assert params['owner_id'] == 'eq.' + OWNER
            assert params['project_id'] == 'eq.' + PROJECT
            return [] if params.get('offset', 0) else [
                {'id': READY, 'title': 'Prepared agreement', 'kind': 'initial_agreement'},
                {'id': PENDING, 'title': 'Pending acceptance', 'kind': 'reference'}]
        raise AssertionError(table)


class Redis:
    def __init__(self, data):
        self.row = {'owner': OWNER, 'status': 'running', 'execution_id': LEASE,
                    'input': json.dumps(data)}
    def hgetall(self, key): return self.row
    def hget(self, key, field): return self.row.get(field)
    def eval(self, *args): return 1


class Jobs:
    def __init__(self, data): self.redis = Redis(data); self.expired = False
    def connection(self): return self.redis
    def input(self, owner, job):
        if self.expired: raise ApiError('AI_NOT_FOUND', 404)
        return json.loads(self.redis.row['input'])


class Gateway:
    def __init__(self): self.calls = []
    def search(self, repo, owner, project, query, limit, file_ids):
        self.calls.append(('original', file_ids)); return {'matches': []}
    def search_summaries(self, repo, owner, project, query, limit, file_ids=None):
        self.calls.append(('summary', file_ids)); return {'matches': []}


class ExplicitAgentScopeTests(TestCase):
    def setUp(self):
        self.data = {'workflow': 'project_assistant', 'owner_id': OWNER, 'client_id': CLIENT,
                     'project_id': PROJECT, 'question': 'Scope?', 'source_document_ids': [READY]}
        self.jobs = Jobs(self.data); self.repo = Repo(); self.gateway = Gateway()
        self.assistant = ProjectAssistant(None, jobs=self.jobs, server=self.repo, gateway=self.gateway)

    def call(self, tool, params):
        return self.assistant.execute(JOB, Call(execution_id=LEASE, tool=tool, params=params))

    def test_source_choice_is_optional_but_never_empty_duplicated_or_foreign(self):
        project = self.repo.project(PROJECT)
        self.assertIsNone(self.assistant.selected_documents(self.repo, OWNER, project, None))
        self.assertEqual(self.assistant.selected_documents(self.repo, OWNER, project, [READY]), [READY])
        for selected in [[], [READY, READY], [FOREIGN]]:
            with self.subTest(selected=selected), self.assertRaises(ApiError):
                self.assistant.selected_documents(self.repo, OWNER, project, selected)
        for cls, fields in [(Question, {'project_id': PROJECT}), (Message, {})]:
            item = cls.model_validate({'question': 'Scope?', 'output_language': 'en', 'document_ids': [READY], **fields})
            self.assertEqual([str(value) for value in item.document_ids], [READY])

    def test_catalog_contains_only_explicit_sources_and_marks_limited_scope(self):
        catalog = self.call('catalog', {})
        self.assertEqual([document['id'] for document in catalog['documents']], [READY])
        self.assertEqual(catalog['source_scope'], {'document_ids': [READY], 'complete_project': False})

    def test_summary_and_original_searches_use_the_same_fixed_scope(self):
        self.call('search_document_summaries', {'query': 'Agreement?'})
        self.call('search_document_text', {'query': 'Agreement?'})
        self.assertEqual(self.gateway.calls, [('summary', [READY]), ('original', [READY])])

    def test_model_cannot_expand_original_search_or_read_excluded_summary(self):
        for tool, params in [
            ('search_document_text', {'query': 'Agreement?', 'document_ids': [PENDING]}),
            ('read_document_summary', {'document_id': PENDING}),
            ('search_document_text', {'query': 'Agreement?', 'document_ids': [READY, FOREIGN]}),
        ]:
            with self.subTest(tool=tool), self.assertRaisesRegex(ApiError, 'DOCUMENT_NOT_FOUND'):
                self.call(tool, params)
        self.assertEqual(self.gateway.calls, [])

    def test_citation_from_other_project_document_is_rejected_even_if_previously_stored(self):
        source_id = 'a' * 64
        self.jobs.redis.row['assistant_sources'] = json.dumps({source_id: {
            'source_id': source_id, 'file_id': PENDING, 'title': 'Excluded', 'generation': 'old',
            'source_kind': 'original', 'text': 'Excluded evidence'}})
        answer = {'kind': 'project_assistant', 'project_id': PROJECT, 'status': 'answered',
                  'citations': [{'source_id': source_id, 'quote': 'Excluded evidence'}]}
        with self.assertRaisesRegex(ApiError, 'AI_INVALID_CITATION'):
            self.assistant.validate_result(self.repo, OWNER, JOB, answer)

    def test_response_scope_is_bound_by_server_even_with_no_evidence(self):
        answer = {'kind': 'project_assistant', 'project_id': PROJECT, 'status': 'insufficient_evidence',
                  'citations': [], 'source_scope': {'document_ids': [FOREIGN], 'complete_project': True}}
        result = self.assistant.validate_result(self.repo, OWNER, JOB, answer)
        self.assertEqual(result['source_scope'], {'document_ids': [READY], 'complete_project': False})

    def test_case_retry_key_cannot_change_document_selection(self):
        service = CaseAssistant(None, assistant=self.assistant)
        message = {'job_id': JOB, 'status': 'queued'}
        service.check_message_scope(OWNER, message, [READY])
        for other in ([PENDING], None):
            with self.assertRaisesRegex(ApiError, 'AI_CONFLICT'):
                service.check_message_scope(OWNER, message, other)

    def test_expired_scope_uses_only_immutable_archive_or_fails(self):
        service = CaseAssistant(None, assistant=self.assistant); self.jobs.expired = True
        with self.assertRaisesRegex(ApiError, 'AI_JOB_EXPIRED'):
            service.check_message_scope(OWNER, {'job_id': JOB, 'status': 'failed'}, [READY])
        archived = {'job_id': JOB, 'status': 'completed', 'result': {
            'source_scope': {'document_ids': [READY], 'complete_project': False}}}
        service.check_message_scope(OWNER, archived, [READY])
        with self.assertRaisesRegex(ApiError, 'AI_CONFLICT'):
            service.check_message_scope(OWNER, archived, [PENDING])

    def test_scoped_archive_revalidates_without_redis_and_rejects_out_of_scope_source(self):
        from unittest.mock import patch
        service = CaseAssistant(None, assistant=self.assistant)
        self.jobs.expired = True
        source_id = 'a' * 64
        answer = {'kind': 'project_assistant', 'project_id': PROJECT, 'model': 'configured-model',
                  'output_language': 'en', 'tools_used': ['search_document_text'], 'status': 'answered',
                  'answer': 'The agreement includes a website.', 'question': 'What is included?',
                  'missing_information': [], 'citations': [{'source_id': source_id, 'quote': 'a website'}],
                  'sources': [{'source_id': source_id, 'file_id': READY, 'generation': 'g',
                               'source_kind': 'original', 'title': 'Agreement'}],
                  'source_scope': {'document_ids': [READY], 'complete_project': False}}
        with patch('trato_api.case_assistant.source', return_value={'generation': 'g', 'segments': [{'text': 'Includes a website.'}]}):
            self.assertEqual(service.revalidate_archive(self.repo, OWNER, self.repo.project(PROJECT), answer), answer)
            forged = deepcopy(answer); forged['sources'][0]['file_id'] = PENDING
            with self.assertRaisesRegex(ApiError, 'AI_INVALID_CITATION'):
                service.revalidate_archive(self.repo, OWNER, self.repo.project(PROJECT), forged)

    def test_case_message_explicit_scope_never_reads_excluded_mandatory_document(self):
        from unittest.mock import patch
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from trato_api.case_assistant import build_case_assistant_router
        case_id, revision_id, session_id = [str(uuid4()) for _ in range(3)]
        parent = self
        class CaseRepo(Repo):
            def rows(self, table, params):
                if table == 'change_proposals':
                    return [{'id': case_id, 'project_id': PROJECT, 'current_revision_id': revision_id,
                             'request_document_id': PENDING}]
                if table == 'proposal_revisions': return [{'id': revision_id, 'scope_summary': 'Proposed additional scope'}]
                if table == 'proposal_revision_sources': return [{'document_id': PENDING}]
                if table == 'documents' and params.get('kind') == 'eq.initial_agreement': return [{'id': READY}]
                return super().rows(table, params)
            def rpc(self, name, data): return {'reserved': True}
        class EnqueueJobs(Jobs):
            def enqueue(self, owner, job_id, data):
                self.enqueued = deepcopy(data)
                return {'id': job_id, 'status': 'queued'}
        repo = CaseRepo(); jobs = EnqueueJobs(self.data)
        assistant = ProjectAssistant(None, jobs=jobs, server=repo)
        session = {'id': session_id, 'case_kind': 'change', 'case_id': case_id, 'revision_id': revision_id,
                   'project_id': PROJECT, 'client_id': CLIENT, 'stale': False, 'messages': []}
        service = SimpleNamespace(assistant=assistant, session=lambda *args: deepcopy(session))
        preferences = SimpleNamespace(for_request=lambda *args: 'configured-model')
        app = FastAPI(); app.include_router(build_case_assistant_router(None, lambda: OWNER,
            repository_factory=lambda *args: repo, service=service, preferences=preferences))
        reads = []
        def original(repo, owner, project, document_id):
            reads.append(document_id)
            parent.assertEqual(document_id, READY, 'Excluded source must never be opened implicitly')
            return {'generation': 'g', 'segments': [{'segment_id': 'segment-1', 'text': 'A website.'}]}
        with patch('trato_api.case_assistant.source', side_effect=original):
            response = TestClient(app).post('/api/v1/ai/case-sessions/' + session_id + '/messages',
                headers={'Idempotency-Key': JOB}, json={'question': 'What is included?',
                    'output_language': 'en', 'document_ids': [READY]})
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(jobs.enqueued['source_document_ids'], [READY])
        self.assertEqual(jobs.enqueued['mandatory_context']['missing_document_ids'], [PENDING])
        self.assertEqual(reads, [READY])
        self.assertEqual([document['document_id'] for document in jobs.enqueued['mandatory_context']['documents']], [READY])
