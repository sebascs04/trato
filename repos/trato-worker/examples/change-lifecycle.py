"""Run only explicit simulated scenarios. Creates an isolated temporary database."""
import copy
import json
from pathlib import Path
import tempfile
from uuid import uuid4
from trato_worker.threads import ThreadWorker


def run():
    base = json.loads((Path(__file__).parent / 'document-upload.thread.json').read_text())
    with tempfile.TemporaryDirectory(prefix='trato-change-simulation-') as folder:
        worker = ThreadWorker(Path(folder) / 'threads.sqlite', mode='simulation')
        for baseline_reviewed in (True, False):
            message = copy.deepcopy(base)
            message.update(workflow='manage_change', thread_id=str(uuid4()), event_id=str(uuid4()))
            message['payload'] = {'request_id': str(uuid4()), 'project_brief': 'Web en español.',
                                  'fixture_id': 'extra', 'baseline_reviewed': baseline_reviewed}
            response = worker.handle(message)
            print(json.dumps({'scenario': 'existing' if baseline_reviewed else 'new', 'event': response}, ensure_ascii=False))
            revisions_requested = False
            edited_versions = set()
            while response['result']['pending']:
                pending = response['result']['pending']
                stage = pending['stage']
                actions = {
                    'review_baseline': {'action': 'confirm_baseline'},
                    'review_proposal': {'action': 'approve_proposal', 'scope': 'Sólo tienda' if revisions_requested else 'Tienda e inglés',
                                        'amount_cents': 25000 if revisions_requested else 45000, 'currency': 'USD',
                                        'due_date': '2026-11-13', 'terms': 'Condiciones ficticias para esta simulación.'},
                    'send_revision': {'action': 'simulate_send'},
                    'client_decision': ({'action': 'accept'} if revisions_requested else
                                        {'action': 'request_revision', 'feedback_notes': 'Sólo quiero tienda, sin inglés.', 'feedback_document_id': str(uuid4())}),
                    'confirm_payment': {'action': 'simulate_verified_payment'},
                }
                action = actions[stage]
                if stage == 'send_revision' and pending['revision']['version'] not in edited_versions:
                    edited_versions.add(pending['revision']['version'])
                    action = {**pending['revision']['proposal'], 'action': 'edit_draft',
                              'terms': 'Condiciones ficticias revisadas antes del envío.'}
                if stage == 'client_decision' and not revisions_requested:
                    revisions_requested = True
                command = {**message, 'action': 'resume', 'event_id': str(uuid4()),
                           'payload': {'interrupt_id': pending['interrupt_id'], 'input': action}}
                response = worker.handle(command)
                print(json.dumps({'scenario': 'existing' if baseline_reviewed else 'new', 'event': response}, ensure_ascii=False))


if __name__ == '__main__':
    run()
