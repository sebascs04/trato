"""Schedule meeting: input checks, the invitation email and sending it once, with in-memory doubles."""
import unittest

from trato_api.errors import ApiError
from trato_api.project_meetings import ProjectMeetings, build_meeting_email, local_time, meeting_input

PROJECT = '11111111-1111-4111-8111-111111111111'
MEETING = '22222222-2222-4222-8222-222222222222'
GOOD = {'title': ' Review the store ', 'meet_url': 'https://meet.google.com/abc-defg-hij', 'starts_at': '2026-11-12T15:00:00-05:00',
        'time_zone': 'America/Lima', 'output_language': 'en'}


def meeting(**extra):
    return {'id': MEETING, 'project_id': PROJECT, 'title': 'Review the store', 'meet_url': GOOD['meet_url'], 'starts_at': '2026-11-12T20:00:00+00:00',
            'time_zone': 'America/Lima', 'recipient_email': 'client@example.com', 'output_language': 'en', 'mail_status': 'none',
            'mail_sent_at': None, 'cancelled_at': None, 'created_at': 't', **extra}


class Repo:
    def __init__(self, row):
        self.row, self.rpcs = row, []

    def rows(self, table, params):
        if table == 'project_meetings':
            return [self.row] if params.get('id') == 'eq.' + MEETING and params.get('project_id') == 'eq.' + PROJECT else []
        if table == 'projects':
            return [{'name': 'Café Aurora Website'}]
        raise AssertionError(table)

    def rpc(self, name, data):
        self.rpcs.append(name)
        if name == 'project_meeting_mail_claim':
            acquired = self.row['mail_status'] in ('none', 'failed')
            if acquired:
                self.row['mail_status'] = 'sending'
            return {'acquired': acquired, 'meeting': self.row}
        if name == 'project_meeting_mail_finish':
            self.row['mail_status'] = data['p_status']
            return self.row
        return {}


class Gmail:
    def __init__(self, fail=None):
        self.sent, self.fail = [], fail

    def status(self, owner):
        return {'connected': True, 'email': 'hello@trato.example'}

    def _send_built(self, owner, item, notification, builder, sender):
        if self.fail:
            raise self.fail
        self.sent.append(builder(sender, item, notification))
        return {'message_id': 'gmail-1'}


class MeetingInputTests(unittest.TestCase):
    def test_a_valid_meeting_is_trimmed_and_sent_in_utc(self):
        data = meeting_input(GOOD)
        self.assertEqual(data['p_title'], 'Review the store')
        self.assertEqual(data['p_starts_at'], '2026-11-12T20:00:00+00:00')

    def test_only_google_meet_links_an_exact_time_and_a_real_zone_are_accepted(self):
        for bad in ({'meet_url': 'https://evil.example/abc-defg-hij'}, {'meet_url': 'https://meet.google.com/abc'},
                    {'starts_at': '2026-11-12T15:00:00'}, {'starts_at': 'tomorrow'}, {'time_zone': 'Mars/Base'},
                    {'title': '  '}, {'output_language': 'fr'}):
            with self.assertRaises(ApiError, msg=bad):
                meeting_input({**GOOD, **bad})


class InvitationTests(unittest.TestCase):
    def test_the_email_shows_the_local_time_and_the_meet_link(self):
        self.assertEqual(local_time(meeting()), 'November 12, 2026 · 15:00 (America/Lima)')
        self.assertEqual(local_time(meeting(output_language='es')), '12 de noviembre de 2026 · 15:00 (America/Lima)')
        item = {**meeting(), 'project_name': 'Café Aurora Website', 'sender_name': 'hello@trato.example'}
        message = build_meeting_email('hello@trato.example', item, MEETING)
        self.assertEqual(message['To'], 'client@example.com')
        self.assertIn('Café Aurora Website', message['Subject'])
        body = message.get_body(preferencelist=('plain',)).get_content()
        self.assertIn('https://meet.google.com/abc-defg-hij', body)
        self.assertIn('15:00', body)

    def test_the_reviewed_email_is_sent_once(self):
        repo, gmail = Repo(meeting()), Gmail()
        service = ProjectMeetings(gmail)
        digest = service.preview(repo, 'owner', PROJECT, MEETING)[2]['digest']
        with self.assertRaises(ApiError):
            service.send(repo, 'owner', PROJECT, MEETING, 'changed')
        self.assertEqual(service.send(repo, 'owner', PROJECT, MEETING, digest)['mail_status'], 'sent')
        service.send(repo, 'owner', PROJECT, MEETING, service.preview(repo, 'owner', PROJECT, MEETING)[2]['digest'])
        self.assertEqual(len(gmail.sent), 1)

    def test_a_failed_send_is_recorded_and_shown(self):
        from paypal.email import EmailDeliveryError
        repo = Repo(meeting())
        service = ProjectMeetings(Gmail(fail=EmailDeliveryError('GMAIL_SEND_FAILED', uncertain=False)))
        digest = service.preview(repo, 'owner', PROJECT, MEETING)[2]['digest']
        with self.assertRaises(ApiError):
            service.send(repo, 'owner', PROJECT, MEETING, digest)
        self.assertEqual(repo.row['mail_status'], 'failed')

    def test_a_meeting_of_another_project_is_not_found(self):
        with self.assertRaises(ApiError):
            ProjectMeetings(Gmail()).preview(Repo(meeting()), 'owner', '33333333-3333-4333-8333-333333333333', MEETING)


class MeetingRecordTests(unittest.TestCase):
    """Past meetings: only a clean title, the four summary lists and the transcribed lines are kept; no audio."""

    def test_a_finished_meeting_keeps_its_title_summary_and_conversation(self):
        from trato_api.project_meetings import record_input
        data = record_input({'title': ' Prueba ', 'meeting_id': MEETING,
                             'summary': {'decisions': [' Phase 2 ', ''], 'risks': ['Scope'], 'extra': ['ignored']},
                             'transcript': [{'speaker': 'client', 'text': ' Hola '}, {'speaker': 'you', 'text': '  '}]})
        self.assertEqual(data['p_title'], 'Prueba')
        self.assertEqual(data['p_meeting'], MEETING)
        self.assertEqual(data['p_summary'], {'decisions': ['Phase 2'], 'actionItems': [], 'risks': ['Scope'], 'nextSteps': []})
        self.assertEqual(data['p_transcript'], [{'speaker': 'client', 'text': 'Hola'}])

    def test_a_meeting_without_conversation_or_with_bad_data_is_not_saved(self):
        from trato_api.project_meetings import record_input
        for bad in ({'title': 'x', 'summary': {}, 'transcript': []}, {'title': '', 'summary': {}, 'transcript': [{'text': 'a'}]},
                    {'title': 'x', 'summary': {'decisions': 'no'}, 'transcript': [{'text': 'a'}]},
                    {'title': 'x', 'summary': {}, 'transcript': [{'text': 3}]}):
            with self.subTest(bad=bad), self.assertRaises(ApiError):
                record_input(bad)

    def test_deleting_a_past_meeting_checks_it_belongs_to_the_project(self):
        class Records:
            def __init__(self):
                self.rpcs = []

            def rows(self, table, params):
                return [{'id': MEETING}] if params.get('project_id') == 'eq.' + PROJECT else []

            def rpc(self, name, data):
                self.rpcs.append(name)
                return {'deleted': data['p_record']}
        repo = Records()
        self.assertEqual(ProjectMeetings(None).delete_record(repo, PROJECT, MEETING), {'deleted': MEETING})
        with self.assertRaises(ApiError):
            ProjectMeetings(None).delete_record(repo, '33333333-3333-4333-8333-333333333333', MEETING)
        self.assertEqual(repo.rpcs, ['project_meeting_record_delete'])

    def test_the_meeting_becomes_a_request_pdf_for_the_usual_form(self):
        from trato_api.project_meetings import render_record_pdf
        record = {'title': 'Prueba', 'created_at': '2026-11-10T10:00:00Z',
                  'summary': {'decisions': ['Tienda aparte'], 'actionItems': [], 'risks': ['Plazo'], 'nextSteps': []},
                  'transcript': [{'speaker': 'client', 'text': '¿Entra en el precio? 🛒'}, {'speaker': 'you', 'text': 'No, va aparte.'}]}
        content = render_record_pdf(record, 'Café Aurora', 'es')
        self.assertTrue(content.startswith(b'%PDF-'))
        self.assertGreater(len(content), 1000)


if __name__ == '__main__':
    unittest.main()
