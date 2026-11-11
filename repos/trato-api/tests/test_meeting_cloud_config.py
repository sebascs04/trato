"""Live meetings in the cloud reuse the workers' Vertex service account and accept the deployed site's own origin."""
import json
import os
import tempfile
import unittest
from unittest import mock

from trato_api.meeting_copilot import is_origin_allowed
from trato_api.meeting_copilot_provider import vertex_settings


class MeetingCloudConfigTests(unittest.TestCase):
    def credentials(self, project='trato-project'):
        handle = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
        json.dump({'type': 'service_account', 'project_id': project}, handle)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_the_project_comes_from_the_service_account_when_not_set(self):
        path = self.credentials()
        settings = vertex_settings({'TRATO_GEMINI_BACKEND': 'vertex', 'TRATO_GOOGLE_CREDENTIALS_FILE': path})
        self.assertEqual(settings, {'project': 'trato-project', 'credentials_file': path, 'location': 'global'})

    def test_an_explicit_project_still_wins(self):
        path = self.credentials()
        settings = vertex_settings({'TRATO_GEMINI_BACKEND': 'vertex', 'TRATO_GOOGLE_CREDENTIALS_FILE': path,
                                    'TRATO_GOOGLE_CLOUD_PROJECT': 'other-project'})
        self.assertEqual(settings['project'], 'other-project')

    def test_without_vertex_or_credentials_the_meeting_is_not_configured(self):
        self.assertIsNone(vertex_settings({'TRATO_GEMINI_BACKEND': 'vertex', 'TRATO_GOOGLE_CREDENTIALS_FILE': '/missing.json'}))
        self.assertIsNone(vertex_settings({'TRATO_GOOGLE_CREDENTIALS_FILE': self.credentials()}))

    def test_the_deployed_site_origin_is_accepted(self):
        with mock.patch.dict(os.environ, {'WEB_ORIGIN': 'https://trato.example.app/'}, clear=False):
            self.assertTrue(is_origin_allowed('https://trato.example.app'))
            self.assertFalse(is_origin_allowed('https://other.example.app'))


if __name__ == '__main__':
    unittest.main()
