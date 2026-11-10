"""Report a problem, freelancer side: read the client's complaints about paid addenda and reply to them.

Every read uses the freelancer's own session, so row-level security returns only their reports. Replying goes
through a database function that checks ownership again. Nothing here moves money, closes a report or touches PayPal:
only the client closes it, and only PayPal decides a dispute.
"""
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .persistence import Repository, uuid

REPORT_FIELDS = 'id,project_id,proposal_id,revision_id,reason,notes,status,created_at,updated_at,closed_at,request_document_id'

PDF_LABELS = {
    'es': {'title': 'Reporte del cliente', 'project': 'Proyecto', 'version': 'Adenda pagada', 'date': 'Fecha', 'reason': 'Motivo',
           'report': 'Lo que reportó el cliente', 'conversation': 'Conversación en Trato', 'client': 'Cliente', 'freelancer': 'Freelancer',
           'not_received': 'No lo recibió', 'not_as_agreed': 'No es lo acordado', 'quality': 'Problema de calidad', 'other': 'Otra cosa'},
    'en': {'title': 'Client report', 'project': 'Project', 'version': 'Paid addendum', 'date': 'Date', 'reason': 'Reason',
           'report': 'What the client reported', 'conversation': 'Conversation in Trato', 'client': 'Client', 'freelancer': 'Freelancer',
           'not_received': "Didn't receive it", 'not_as_agreed': 'Not what was agreed', 'quality': 'Quality problem', 'other': 'Something else'}}


def render_report_pdf(report, project_name, revision_no, messages, language):
    """The client's own words as a PDF, so the usual request upload can register it. Same engine and font as other Trato PDFs."""
    from io import BytesIO
    from pathlib import Path
    from xml.sax.saxutils import escape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate
    from .proposals.pdf import _FONT, _LOCK
    labels = PDF_LABELS['en' if language == 'en' else 'es']
    with _LOCK:
        if _FONT not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(_FONT, str(Path(__file__).parent / 'proposals/assets/DejaVuSans.ttf')))
        font = pdfmetrics.getFont(_FONT)
        style = ParagraphStyle('problem', fontName=_FONT, fontSize=10, leading=15, spaceAfter=8)
        title = ParagraphStyle('problem-title', parent=style, fontSize=20, leading=25)
        story = []

        def add(value, heading=False):
            text = str(value).replace('\r\n', '\n').replace('\r', '\n')
            if any(ord(c) not in font.face.charToGlyph for c in text if c not in '\n\t'):
                raise ApiError('PDF_UNSUPPORTED_CHARACTER', 422)
            story.append(Paragraph(escape(text).replace('\n', '<br/>'), title if heading else style))
        add(labels['title'], True)
        add(f"{labels['project']}: {project_name}\n{labels['version']}: v{revision_no}\n{labels['date']}: {report['created_at'][:10]}\n"
            f"{labels['reason']}: {labels.get(report['reason'], labels['other'])}")
        add(labels['report'], True)
        add(report['notes'])
        if messages:
            add(labels['conversation'], True)
            for m in messages:
                add(f"{labels['client' if m['author'] == 'client' else 'freelancer']} · {m['created_at'][:16].replace('T', ' ')}\n{m['body']}")
        out = BytesIO()
        SimpleDocTemplate(out, pagesize=(210 * mm, 297 * mm), leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm,
                          bottomMargin=18 * mm, invariant=1, title=labels['title'], author='Trato').build(story)
        return out.getvalue()


def own_report(repo, project_id, report_id):
    rows = repo.rows('client_problem_reports', {'select': REPORT_FIELDS, 'id': 'eq.' + uuid(report_id), 'project_id': 'eq.' + uuid(project_id)})
    if len(rows) != 1:
        raise ApiError('PROBLEM_NOT_FOUND', 404)
    return rows[0]


def report_pdf(repo, project_id, report_id, language):
    report = own_report(repo, project_id, report_id)
    project = repo.rows('projects', {'select': 'name', 'id': 'eq.' + uuid(project_id)})
    revision = repo.rows('proposal_revisions', {'select': 'revision_no', 'id': 'eq.' + uuid(report['revision_id'])})
    if len(project) != 1 or len(revision) != 1:
        raise ApiError('PROBLEM_NOT_FOUND', 404)
    return render_report_pdf(report, project[0]['name'], revision[0]['revision_no'], messages_by_report(repo, [report['id']])[report['id']], language)


def link_request(repo, project_id, report_id, document_id):
    report = own_report(repo, project_id, report_id)
    repo.rpc('problem_report_link_request', {'p_report': report['id'], 'p_document': uuid(document_id)})
    return project_reports(repo, project_id)


def in_list(ids):
    return 'in.(' + ','.join(uuid(value) for value in ids) + ')'


def your_turn(report, messages):
    # The freelancer's turn while the report is open and the client spoke last (its report counts as the first word).
    # Registering it as a request answers it too: then it is the client's turn until they write again.
    if report['status'] != 'open':
        return False
    if not messages:
        return not report.get('request_document_id')
    return messages[-1]['author'] == 'client'


def messages_by_report(repo, ids):
    found = {value: [] for value in ids}
    if ids:
        for row in repo.rows('client_problem_messages', {'select': 'report_id,author,body,created_at',
                                                        'report_id': in_list(ids), 'order': 'created_at.asc,id.asc'}):
            found.setdefault(row['report_id'], []).append({key: row[key] for key in ('author', 'body', 'created_at')})
    return found


def attention(repo):
    reports = repo.rows('client_problem_reports', {'select': REPORT_FIELDS, 'status': 'eq.open', 'order': 'created_at.asc', 'limit': 50})
    messages = messages_by_report(repo, [r['id'] for r in reports])
    projects = {}
    if reports:
        projects = {p['id']: p for p in repo.rows('projects', {'select': 'id,name,client_id',
                                                               'id': in_list({r['project_id'] for r in reports})})}
    rows = []
    for report in reports:
        project = projects.get(report['project_id'])
        if project is None:
            continue  # A deleted or foreign project is never shown.
        rows.append({'report_id': report['id'], 'project_id': report['project_id'], 'project_name': project['name'],
                     'client_id': project['client_id'], 'reason': report['reason'], 'created_at': report['created_at'],
                     'your_turn': your_turn(report, messages[report['id']])})
    rows.sort(key=lambda row: (not row['your_turn'], row['created_at']))
    return {'reports': rows}


def project_reports(repo, project_id):
    reports = repo.rows('client_problem_reports', {'select': REPORT_FIELDS, 'project_id': 'eq.' + uuid(project_id),
                                                   'order': 'created_at.desc', 'limit': 20})
    messages = messages_by_report(repo, [r['id'] for r in reports])
    versions = {}
    if reports:
        versions = {r['id']: r['revision_no'] for r in repo.rows('proposal_revisions', {'select': 'id,revision_no',
                                                                                         'id': in_list({r['revision_id'] for r in reports})})}
    return {'reports': [{'id': r['id'], 'reason': r['reason'], 'notes': r['notes'], 'status': r['status'],
                         'revision_no': versions.get(r['revision_id']), 'created_at': r['created_at'], 'closed_at': r['closed_at'],
                         'messages': messages[r['id']], 'your_turn': your_turn(r, messages[r['id']]),
                         'request_document_id': r.get('request_document_id')} for r in reports]}


def reply(repo, project_id, report_id, body):
    if not isinstance(body, str) or not 1 <= len(body.strip()) <= 4000:
        raise ApiError('PROBLEM_MESSAGE_REQUIRED', 422)
    # The report must belong to the project in the URL; the database checks the owner as well.
    found = repo.rows('client_problem_reports', {'select': 'id', 'id': 'eq.' + uuid(report_id), 'project_id': 'eq.' + uuid(project_id)})
    if len(found) != 1:
        raise ApiError('PROBLEM_NOT_FOUND', 404)
    repo.rpc('problem_report_reply', {'p_report': found[0]['id'], 'p_body': body.strip()})
    return project_reports(repo, project_id)


def build_problem_report_router(settings, require_user, repository_factory=None):
    router = APIRouter(prefix='/api/v1')

    def repository(request):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))

    def answer(data):
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.get('/problem-reports/attention')
    async def problems_attention(request: Request, owner=Depends(require_user)):
        data = await run_in_threadpool(attention, repository(request))
        # Counts only: no business data or identifiers.
        logging.getLogger(__name__).info(json.dumps({'event': 'problem_reports_attention', 'open': len(data['reports']),
                                                     'your_turn': sum(1 for row in data['reports'] if row['your_turn'])}))
        return answer(data)

    @router.get('/projects/{project_id}/problem-reports')
    async def problems_of_project(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(project_reports, repository(request), str(project_id)))

    @router.post('/projects/{project_id}/problem-reports/{report_id}/messages')
    async def reply_to_problem(project_id: UUID, report_id: UUID, request: Request, owner=Depends(require_user)):
        try:
            data = await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None
        body = data.get('body') if isinstance(data, dict) else None
        return answer(await run_in_threadpool(reply, repository(request), str(project_id), str(report_id), body))

    @router.get('/projects/{project_id}/problem-reports/{report_id}/request-pdf')
    async def problem_request_pdf(project_id: UUID, report_id: UUID, request: Request, owner=Depends(require_user)):
        # The freelancer attaches it in the usual «Register client request» form; nothing is saved here.
        language = 'en' if request.headers.get('accept-language', '').lower().startswith('en') else 'es'
        content = await run_in_threadpool(report_pdf, repository(request), str(project_id), str(report_id), language)
        return Response(content, media_type='application/pdf', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                                                        'Content-Disposition': 'inline; filename="client-report.pdf"'})

    @router.post('/projects/{project_id}/problem-reports/{report_id}/request')
    async def problem_registered_as_request(project_id: UUID, report_id: UUID, request: Request, owner=Depends(require_user)):
        try:
            data = await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None
        document = data.get('document_id') if isinstance(data, dict) else None
        return answer(await run_in_threadpool(link_request, repository(request), str(project_id), str(report_id), document))

    return router
