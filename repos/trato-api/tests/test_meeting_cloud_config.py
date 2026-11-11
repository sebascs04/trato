"""Live meetings in the cloud reuse the workers' Vertex service account and accept the deployed site's own origin."""
import json
import os
import tempfile
import unittest
from unittest import mock

from trato_api.meeting_copilot import is_origin_allowed
from trato_api.meeting_copilot_provider import gemini_live_config, normalize_summary, vertex_settings


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

    def test_sentences_close_quickly_so_questions_are_answered_fast(self):
        detection = gemini_live_config('en')['realtime_input_config']['automatic_activity_detection']
        self.assertEqual(detection['silence_duration_ms'], 1000)
        self.assertEqual(gemini_live_config('en')['input_audio_transcription'], {'language_codes': ['en-US']})

    def test_a_summary_wrapped_differently_keeps_its_words(self):
        summary = normalize_summary({'title': ['Store review'], 'closing': ['Thanks', 'see you Friday'],
                                     'decisions': [{'text': 'Reservations are new work'}, 'Keep it simple'],
                                     'action_items': 'Send the addendum by Friday', 'risks': [], 'next_steps': None})
        self.assertEqual(summary['title'], 'Store review')
        self.assertEqual(summary['closing'], 'Thanks see you Friday')
        self.assertEqual(summary['decisions'], ['Reservations are new work', 'Keep it simple'])
        self.assertEqual(summary['action_items'], ['Send the addendum by Friday'])
        self.assertEqual(summary['risks'], [])
        self.assertEqual(summary['next_steps'], [])

    def test_an_answer_without_any_summary_list_is_still_refused(self):
        self.assertIsNone(normalize_summary({'title': 'x', 'closing': 'y'}))
        self.assertIsNone(normalize_summary(['not', 'an', 'object']))


if __name__ == '__main__':
    unittest.main()
