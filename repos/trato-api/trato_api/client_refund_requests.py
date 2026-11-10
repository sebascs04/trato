"""Refund requests the client sent from their own space, freelancer side.

Every read uses the freelancer's session, so row-level security returns only their projects' requests. A request never
moves money: the freelancer registers it in Refunds with the usual form, using the PDF below (the client's own words) as
its evidence, and then the request points to that refund. Only PayPal confirms money back.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .persistence import Repository, uuid

FIELDS = 'id,project_id,received_payment_id,stage_position,proposal_id,client_email,requested_minor,reason,status,settlement_id,created_at,closed_note,closed_by,closed_at'

PDF_LABELS = {
    'es': {'title': 'Solicitud de devolución del cliente', 'project': 'Proyecto', 'item': 'Pago', 'stage': 'Entregable {n} · {title}',
           'addendum': 'Adenda v{n}', 'amount': 'Importe solicitado', 'date': 'Fecha', 'client': 'Cliente', 'reason': 'Lo que escribió el cliente'},
    'en': {'title': 'Client refund request', 'project': 'Project', 'item': 'Payment', 'stage': 'Deliverable {n} · {title}',
           'addendum': 'Addendum v{n}', 'amount': 'Amount requested', 'date': 'Date', 'client': 'Client', 'reason': 'What the client wrote'}}


def money(minor):
    return f'USD {minor // 100}.{minor % 100:02d}'


def render_request_pdf(item, project_name, paid_item, language):
    """The client's request as a PDF, so the usual refund form can cite it. Same engine and font as other Trato PDFs."""
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
        style = ParagraphStyle('refund-request', fontName=_FONT, fontSize=10, leading=15, spaceAfter=8)
        title = ParagraphStyle('refund-request-title', parent=style, fontSize=20, leading=25)
        story = []

        def add(value, heading=False):
            text = str(value).replace('\r\n', '\n').replace('\r', '\n')
            if any(ord(c) not in font.face.charToGlyph for c in text if c not in '\n\t'):
                raise ApiError('PDF_UNSUPPORTED_CHARACTER', 422)
            story.append(Paragraph(escape(text).replace('\n', '<br/>'), title if heading else style))
        add(labels['title'], True)
        add(f"{labels['project']}: {project_name}\n{labels['item']}: {paid_item}\n{labels['amount']}: {money(item['requested_minor'])}\n"
            f"{labels['date']}: {item['created_at'][:10]}\n{labels['client']}: {item['client_email']}")
        add(labels['reason'], True)
        add(item['reason'])
        out = BytesIO()
        SimpleDocTemplate(out, pagesize=(210 * mm, 297 * mm), leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm,
                          bottomMargin=18 * mm, invariant=1, title=labels['title'], author='Trato').build(story)
        return out.getvalue()


def own_request(repo, project_id, request_id):
    rows = repo.rows('client_refund_requests', {'select': FIELDS, 'id': 'eq.' + uuid(request_id), 'project_id': 'eq.' + uuid(project_id)})
    if len(rows) != 1:
        raise ApiError('REFUND_REQUEST_NOT_FOUND', 404)
    return rows[0]


def paid_item_label(repo, item, labels):
    if item.get('stage_position'):
        stages = repo.rows('project_start_stages', {'select': 'title', 'project_id': 'eq.' + uuid(item['project_id']),
                                                    'position': 'eq.' + str(item['stage_position'])})
        return labels['stage'].format(n=item['stage_position'], title=stages[0]['title'] if stages else '')
    paid = repo.rows('proposal_payments', {'select': 'revision_id', 'proposal_id': 'eq.' + uuid(item['proposal_id']), 'status': 'eq.completed', 'limit': 1})
    revisions = repo.rows('proposal_revisions', {'select': 'revision_no', 'id': 'eq.' + paid[0]['revision_id']}) if paid else []
    return labels['addendum'].format(n=revisions[0]['revision_no'] if revisions else '')


def project_requests(repo, project_id):
    repo.project(uuid(project_id))  # 404 unless the signed-in freelancer owns this active project.
    items = repo.rows('client_refund_requests', {'select': FIELDS, 'project_id': 'eq.' + uuid(project_id), 'order': 'created_at.desc', 'limit': 100})
    # The conversation of each request, like a reported problem: the client's reason first, then both sides.
    messages = repo.rows('client_refund_request_messages', {'select': 'request_id,author,body,created_at', 'project_id': 'eq.' + uuid(project_id),
                                                            'order': 'created_at.asc', 'limit': 1000}) if items else []
    for item in items:
        item['messages'] = [{k: m[k] for k in ('author', 'body', 'created_at')} for m in messages if m['request_id'] == item['id']]
    return items


def reply(repo, project_id, request_id, body):
    item = own_request(repo, project_id, request_id)
    if not isinstance(body, str) or not 1 <= len(body.strip()) <= 4000:
        raise ApiError('REFUND_REQUEST_MESSAGE_REQUIRED', 422)
    repo.rpc('client_refund_request_reply', {'p_request': item['id'], 'p_body': body.strip()})
    return project_requests(repo, project_id)


def decline(repo, project_id, request_id, note):
    # Nothing moves: the request closes and the client can go on with Report a problem.
    item = own_request(repo, project_id, request_id)
    if note is not None and (not isinstance(note, str) or len(note) > 4000):
        raise ApiError('INVALID_REQUEST', 422)
    repo.rpc('client_refund_request_decline', {'p_request': item['id'], 'p_note': (note or '').strip() or None})
    return project_requests(repo, project_id)


def request_pdf(repo, project_id, request_id, language):
    item = own_request(repo, project_id, request_id)
    project = repo.project(uuid(project_id))
    return render_request_pdf(item, project['name'], paid_item_label(repo, item, PDF_LABELS['en' if language == 'en' else 'es']), language)


def register(repo, project_id, request_id, settlement_id):
    item = own_request(repo, project_id, request_id)
    repo.rpc('client_refund_request_register', {'p_request': item['id'], 'p_settlement': uuid(settlement_id)})
    return project_requests(repo, project_id)


def build_client_refund_request_router(settings, require_user, repository_factory=None):
    router = APIRouter(prefix='/api/v1')

    def repository(request):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))

    def answer(data):
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    @router.get('/projects/{project_id}/client-refund-requests')
    async def client_refund_requests(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(project_requests, repository(request), str(project_id)))

    @router.get('/projects/{project_id}/client-refund-requests/{request_id}/pdf')
    async def client_refund_request_pdf(project_id: UUID, request_id: UUID, request: Request, owner=Depends(require_user)):
        # Attached in the usual «Register refund request» form; nothing is saved here.
        language = 'en' if request.headers.get('accept-language', '').lower().startswith('en') else 'es'
        content = await run_in_threadpool(request_pdf, repository(request), str(project_id), str(request_id), language)
        return Response(content, media_type='application/pdf', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                                                        'Content-Disposition': 'inline; filename="client-refund-request.pdf"'})

    async def json_body(request):
        try:
            data = await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None
        if not isinstance(data, dict):
            raise ApiError('INVALID_REQUEST', 422)
        return data

    @router.post('/projects/{project_id}/client-refund-requests/{request_id}/messages')
    async def client_refund_request_message(project_id: UUID, request_id: UUID, request: Request, owner=Depends(require_user)):
        data = await json_body(request)
        return answer(await run_in_threadpool(reply, repository(request), str(project_id), str(request_id), data.get('body')))

    @router.post('/projects/{project_id}/client-refund-requests/{request_id}/decline')
    async def client_refund_request_decline(project_id: UUID, request_id: UUID, request: Request, owner=Depends(require_user)):
        data = await json_body(request)
        return answer(await run_in_threadpool(decline, repository(request), str(project_id), str(request_id), data.get('note')))

    @router.post('/projects/{project_id}/client-refund-requests/{request_id}/registered')
    async def client_refund_request_registered(project_id: UUID, request_id: UUID, request: Request, owner=Depends(require_user)):
        try:
            data = await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None
        settlement = data.get('settlement_id') if isinstance(data, dict) else None
        return answer(await run_in_threadpool(register, repository(request), str(project_id), str(request_id), settlement))

    return router
