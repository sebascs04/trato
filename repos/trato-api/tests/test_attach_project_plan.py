from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from trato_api.ai_routes import build_ai_router
from trato_api.errors import ApiError


class AttachProjectPlanTests(TestCase):
    """A project started outside Trato gets its Work plan from the same planning assistant, only for itself."""

    def setUp(self):
        self.client_id, self.project, self.job = str(uuid4()), str(uuid4()), str(uuid4())
        self.stages = [{'title': 'Design', 'body': 'Website design', 'percent': 40, 'when': 'Upfront'},
                       {'title': 'Build', 'body': 'Pages and store', 'percent': 60, 'when': 'After delivery'}]
        self.context = {'client_id': self.client_id, 'draft_id': self.project, 'brief': 'Website', 'budget': '600.00',
                        'target_date': '2027-01-01', 'reviews': [], 'output_language': 'en'}
        result = {'summary': 'Plan', 'observations': [], 'limitations': [], 'model': 'test-model', 'stages': self.stages}
        jobs = Mock()
        jobs.get.side_effect = lambda owner, id, *args: {'status': 'completed', 'result': deepcopy(result)}
        jobs.input.side_effect = lambda owner, id: deepcopy(self.context)
        self.repo = Mock()
        self.repo.project.return_value = {'id': self.project, 'client_id': self.client_id, 'name': 'Website'}
        self.repo.rpc.return_value = {'id': self.project, 'client_id': self.client_id, 'name': 'Website'}
        preferences = Mock()
        app = FastAPI()
        app.include_router(build_ai_router(None, lambda: 'owner', lambda *args: self.repo, jobs, preferences, usage_writer=Mock()))

        @app.exception_handler(ApiError)
        async def error(_, e):
            return JSONResponse({'error': {'code': e.code}}, status_code=e.status)
        self.client = TestClient(app)

    def post(self, stages=None):
        return self.client.post(f'/api/v1/ai/projects/{self.project}/plan', json={'plan_job_id': self.job, 'stages': stages or self.stages})

    def test_saves_the_confirmed_plan_on_the_existing_project(self):
        response = self.post()
        self.assertEqual(response.status_code, 201)
        name, args = self.repo.rpc.call_args.args
        self.assertEqual(name, 'attach_project_plan')
        self.assertEqual(args['p_project'], self.project)
        self.assertEqual(args['p_plan']['stages'], self.stages)
        self.assertEqual(args['p_plan']['budget'], '600.00')

    def test_a_plan_drafted_for_another_project_or_client_is_refused(self):
        self.context['draft_id'] = str(uuid4())
        self.assertEqual(self.post().status_code, 409)
        self.context['draft_id'] = self.project
        self.repo.project.return_value = {'id': self.project, 'client_id': str(uuid4())}
        self.assertEqual(self.post().status_code, 409)
        self.repo.rpc.assert_not_called()

    def test_edited_stages_still_need_the_ai_review(self):
        edited = [{**self.stages[0], 'when': 'Later'}, self.stages[1]]
        response = self.post(edited)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'AI_PLAN_REVIEW_REQUIRED')
        self.repo.rpc.assert_not_called()
