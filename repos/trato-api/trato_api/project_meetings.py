"""Schedule meeting: a Google Meet link and time saved for a project, emailed to the client from Trato's central mailbox.

The freelancer reviews the exact email before sending it once (preview digest, then a claim in the database), like the
other emails Trato sends. The client sees upcoming meetings in their account. The call happens in Meet; TeTrato's
meeting page listens from the freelancer's side. Nothing here records audio or talks to Google Calendar.
"""
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formatdate
from hashlib import sha256
from html import escape
import json
import re
import secrets
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .errors import ApiError
from .persistence import Repository, uuid

MEET_URL = re.compile(r'^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$')
FIELDS = 'id,project_id,title,meet_url,starts_at,time_zone,recipient_email,output_language,mail_status,mail_sent_at,cancelled_at,created_at'
RECORD_FIELDS = 'id,project_id,meeting_id,title,summary,transcript,created_at'
SUMMARY_KEYS = ('decisions', 'actionItems', 'risks', 'nextSteps')


RECORD_PDF_LABELS = {
    'es': {'title': 'Pedido del cliente en una reunión', 'project': 'Proyecto', 'meeting': 'Reunión', 'date': 'Fecha',
           'decisions': 'Decisiones', 'actionItems': 'Compromisos', 'risks': 'Riesgos', 'nextSteps': 'Siguientes pasos',
           'conversation': 'Conversación transcrita por TeTrato', 'you': 'Freelancer', 'client': 'Cliente', 'call': 'Llamada'},
    'en': {'title': 'Client request from a meeting', 'project': 'Project', 'meeting': 'Meeting', 'date': 'Date',
           'decisions': 'Decisions', 'actionItems': 'Commitments', 'risks': 'Risks', 'nextSteps': 'Next steps',
           'conversation': 'Conversation transcribed by TeTrato', 'you': 'Freelancer', 'client': 'Client', 'call': 'Call'}}


def render_record_pdf(record, project_name, language):
    """What was asked in a meeting, as a PDF for the usual «Register client request» form. Same engine and font as Trato's PDFs."""
    from io import BytesIO
    from pathlib import Path
    from xml.sax.saxutils import escape as xml_escape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate
    from .proposals.pdf import _FONT, _LOCK
    labels = RECORD_PDF_LABELS['en' if language == 'en' else 'es']
    with _LOCK:
        if _FONT not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(_FONT, str(Path(__file__).parent / 'proposals/assets/DejaVuSans.ttf')))
        font = pdfmetrics.getFont(_FONT)
        style = ParagraphStyle('meeting', fontName=_FONT, fontSize=10, leading=15, spaceAfter=8)
        heading = ParagraphStyle('meeting-title', parent=style, fontSize=16, leading=21, spaceBefore=6)
        story = []

        def add(value, as_heading=False):
            # Characters the font cannot draw are left out rather than failing the whole request.
            text = ''.join(c for c in str(value).replace('\r\n', '\n').replace('\r', '\n') if c in '\n\t' or ord(c) in font.face.charToGlyph)
            story.append(Paragraph(xml_escape(text).replace('\n', '<br/>'), heading if as_heading else style))
        add(labels['title'], True)
        add(f"{labels['project']}: {project_name}\n{labels['meeting']}: {record['title']}\n{labels['date']}: {str(record['created_at'])[:10]}")
        summary = record.get('summary') or {}
        for key in SUMMARY_KEYS:
            if summary.get(key):
                add(labels[key], True)
                add('\n'.join(f'• {item}' for item in summary[key]))
        add(labels['conversation'], True)
        for line in record.get('transcript') or []:
            add(f"{labels.get(line.get('speaker'), labels['call'])}: {line.get('text', '')}")
        out = BytesIO()
        SimpleDocTemplate(out, pagesize=(210 * mm, 297 * mm), leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm,
                          bottomMargin=18 * mm, invariant=1, title=labels['title'], author='Trato').build(story)
        return out.getvalue()


def record_input(data):
    """A finished live meeting as TeTrato saw it: its title, the four summary lists and the transcribed lines."""
    if not isinstance(data, dict):
        raise ApiError('INVALID_JSON', 422)
    title, summary, transcript, meeting = data.get('title'), data.get('summary'), data.get('transcript'), data.get('meeting_id')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
        raise ApiError('MEETING_RECORD_TITLE_REQUIRED', 422)
    if not isinstance(summary, dict) or not isinstance(transcript, list) or not 1 <= len(transcript) <= 400:
        raise ApiError('MEETING_RECORD_INVALID', 422)
    clean_summary = {}
    for key in SUMMARY_KEYS:
        items = summary.get(key) or []
        if not isinstance(items, list) or len(items) > 30 or any(not isinstance(i, str) or len(i) > 1000 for i in items):
            raise ApiError('MEETING_RECORD_INVALID', 422)
        clean_summary[key] = [i.strip() for i in items if i.strip()]
    lines = []
    for line in transcript:
        if not isinstance(line, dict) or not isinstance(line.get('text'), str) or not isinstance(line.get('speaker', ''), str):
            raise ApiError('MEETING_RECORD_INVALID', 422)
        if line['text'].strip():
            lines.append({'speaker': line.get('speaker', '')[:40], 'text': line['text'].strip()[:2000]})
    if not lines:
        raise ApiError('MEETING_RECORD_INVALID', 422)
    return {'p_meeting': uuid(meeting) if meeting else None, 'p_title': title.strip(), 'p_summary': clean_summary, 'p_transcript': lines}


def meeting_input(data):
    if not isinstance(data, dict):
        raise ApiError('INVALID_JSON', 422)
    title, url, starts, zone = (data.get(k) for k in ('title', 'meet_url', 'starts_at', 'time_zone'))
    language = data.get('output_language')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
        raise ApiError('MEETING_TITLE_REQUIRED', 422)
    if not isinstance(url, str) or not MEET_URL.fullmatch(url.strip()):
        raise ApiError('MEETING_URL_INVALID', 422)
    try:
        moment = datetime.fromisoformat(starts)
        ZoneInfo(zone)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        raise ApiError('MEETING_TIME_INVALID', 422) from None
    if moment.tzinfo is None:
        raise ApiError('MEETING_TIME_INVALID', 422)
    if language not in ('es', 'en'):
        raise ApiError('INVALID_OUTPUT_LANGUAGE', 422)
    return {'p_title': title.strip(), 'p_meet_url': url.strip(), 'p_starts_at': moment.astimezone(timezone.utc).isoformat(),
            'p_time_zone': zone, 'p_language': language}


def local_time(meeting):
    moment = datetime.fromisoformat(meeting['starts_at'].replace('Z', '+00:00')).astimezone(ZoneInfo(meeting['time_zone']))
    english = meeting['output_language'] == 'en'
    months = (['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] if english
              else ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
    month = months[moment.month - 1]
    day = f'{month} {moment.day}, {moment.year}' if english else f'{moment.day} de {month} de {moment.year}'
    return f"{day} · {moment.strftime('%H:%M')} ({meeting['time_zone']})"


def build_meeting_email(sender, item, notification):
    from paypal.email_layout import email_layout
    english = item['output_language'] == 'en'
    when = local_time(item)
    subject = ('Meeting' if english else 'Reunión') + ' · ' + ' '.join(item['project_name'].split())
    intro = (f"{item['sender_name']} invited you to a meeting about {item['project_name']}." if english
             else f"{item['sender_name']} te invitó a una reunión sobre {item['project_name']}.")
    button = 'Join in Google Meet' if english else 'Entrar en Google Meet'
    msg = EmailMessage()
    msg['From'] = sender; msg['To'] = item['recipient_email']; msg['Subject'] = subject; msg['Date'] = formatdate(usegmt=True)
    msg['Message-ID'] = f'<trato-meeting-{notification}@{sender.rsplit("@", 1)[1]}>'
    msg.set_content(f"{intro}\n\n{item['title']}\n{when}\n\n{item['meet_url']}")
    msg.add_alternative(email_layout(item['title'], item['project_name'],
        f'<p>{escape(intro)}</p><h2>{escape(when)}</h2><p><a href="{escape(item["meet_url"], quote=True)}">{button}</a></p>'), subtype='html')
    return msg


class ProjectMeetings:
    def __init__(self, gmail):
        self.gmail = gmail

    def list(self, repo, project_id):
        return repo.rows('project_meetings', {'select': FIELDS, 'project_id': 'eq.' + uuid(project_id), 'cancelled_at': 'is.null',
                                              'order': 'starts_at.asc', 'limit': 20})

    def create(self, repo, project_id, data):
        return repo.rpc('project_meeting_create', {'p_project': uuid(project_id), **meeting_input(data)})

    # Past meetings: the conversation and summary of a live meeting with TeTrato, kept in the project. Text only.
    def records(self, repo, project_id):
        return repo.rows('project_meeting_records', {'select': RECORD_FIELDS, 'project_id': 'eq.' + uuid(project_id),
                                                     'order': 'created_at.desc', 'limit': 30})

    def save_record(self, repo, project_id, data):
        return repo.rpc('project_meeting_record_save', {'p_project': uuid(project_id), **record_input(data)})

    def record_pdf(self, repo, project_id, record_id, language):
        rows = repo.rows('project_meeting_records', {'select': RECORD_FIELDS, 'id': 'eq.' + uuid(record_id), 'project_id': 'eq.' + uuid(project_id)})
        project = repo.rows('projects', {'select': 'name', 'id': 'eq.' + uuid(project_id)})
        if len(rows) != 1 or len(project) != 1:
            raise ApiError('MEETING_RECORD_NOT_FOUND', 404)
        return render_record_pdf(rows[0], project[0]['name'], language)

    def delete_record(self, repo, project_id, record_id):
        rows = repo.rows('project_meeting_records', {'select': 'id', 'id': 'eq.' + uuid(record_id), 'project_id': 'eq.' + uuid(project_id)})
        if len(rows) != 1:
            raise ApiError('MEETING_RECORD_NOT_FOUND', 404)
        return repo.rpc('project_meeting_record_delete', {'p_record': uuid(record_id)})

    def cancel(self, repo, project_id, meeting_id):
        self.own(repo, project_id, meeting_id)
        return repo.rpc('project_meeting_cancel', {'p_meeting': uuid(meeting_id)})

    def own(self, repo, project_id, meeting_id):
        rows = repo.rows('project_meetings', {'select': FIELDS, 'id': 'eq.' + uuid(meeting_id), 'project_id': 'eq.' + uuid(project_id)})
        if len(rows) != 1:
            raise ApiError('MEETING_NOT_FOUND', 404)
        return rows[0]

    def preview(self, repo, owner, project_id, meeting_id):
        meeting = self.own(repo, project_id, meeting_id)
        if meeting['cancelled_at']:
            raise ApiError('MEETING_NOT_FOUND', 404)
        if not self.gmail:
            raise ApiError('GMAIL_NOT_CONFIGURED', 503)
        status = self.gmail.status(owner)
        if not status.get('connected'):
            raise ApiError('GMAIL_NOT_CONNECTED', 409)
        project = repo.rows('projects', {'select': 'name', 'id': 'eq.' + uuid(project_id)})
        if len(project) != 1:
            raise ApiError('PROJECT_NOT_FOUND', 404)
        item = {k: meeting[k] for k in ('title', 'meet_url', 'starts_at', 'time_zone', 'recipient_email', 'output_language')}
        item.update(project_name=project[0]['name'], sender_name=status['email'], sender=status['email'])
        digest = sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
        message = build_meeting_email(item['sender'], item, meeting['id'])
        return meeting, item, {'sender': item['sender'], 'recipient': item['recipient_email'], 'subject': str(message['Subject']),
                               'body': message.get_body(preferencelist=('plain',)).get_content(), 'digest': digest}

    def send(self, repo, owner, project_id, meeting_id, digest):
        from paypal.email import EmailDeliveryError
        meeting, item, preview = self.preview(repo, owner, project_id, meeting_id)
        if not isinstance(digest, str) or not secrets.compare_digest(preview['digest'], digest):
            raise ApiError('EMAIL_PREVIEW_CHANGED', 409)
        claim = repo.rpc('project_meeting_mail_claim', {'p_meeting': meeting['id'], 'p_digest': digest})
        if not claim.get('acquired'):
            # Sent, uncertain or in progress: never sent twice.
            return claim['meeting']
        try:
            result = self.gmail._send_built(owner, item, meeting['id'], build_meeting_email, preview['sender'])
        except EmailDeliveryError as error:
            repo.rpc('project_meeting_mail_finish', {'p_meeting': meeting['id'], 'p_status': 'uncertain' if error.uncertain else 'failed', 'p_message_id': None})
            raise ApiError(error.code, 503) from None
        return repo.rpc('project_meeting_mail_finish', {'p_meeting': meeting['id'], 'p_status': 'sent', 'p_message_id': result['message_id']})


def build_project_meeting_router(settings, require_user, repository_factory=None, *, gmail=None):
    router = APIRouter(prefix='/api/v1')
    service = ProjectMeetings(gmail)

    def repository(request):
        return (repository_factory or Repository)(settings, request.headers.get('authorization', ''))

    def answer(data):
        return JSONResponse({'data': data}, headers={'Cache-Control': 'no-store'})

    async def body(request):
        try:
            return await request.json()
        except ValueError:
            raise ApiError('INVALID_JSON', 422) from None

    @router.get('/projects/{project_id}/meetings')
    async def meetings(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.list, repository(request), str(project_id)))

    @router.post('/projects/{project_id}/meetings')
    async def schedule(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.create, repository(request), str(project_id), await body(request)))

    @router.get('/projects/{project_id}/meeting-records')
    async def records(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.records, repository(request), str(project_id)))

    @router.post('/projects/{project_id}/meeting-records')
    async def save_record(project_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.save_record, repository(request), str(project_id), await body(request)))

    @router.get('/projects/{project_id}/meeting-records/{record_id}/request-pdf')
    async def record_pdf(project_id: UUID, record_id: UUID, request: Request, owner=Depends(require_user)):
        # The freelancer attaches it in the usual «Register client request» form; nothing is saved here.
        language = 'en' if request.headers.get('accept-language', '').lower().startswith('en') else 'es'
        content = await run_in_threadpool(service.record_pdf, repository(request), str(project_id), str(record_id), language)
        return Response(content, media_type='application/pdf', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                                                        'Content-Disposition': 'inline; filename="meeting-request.pdf"'})

    @router.post('/projects/{project_id}/meeting-records/{record_id}/delete')
    async def delete_record(project_id: UUID, record_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.delete_record, repository(request), str(project_id), str(record_id)))

    @router.post('/projects/{project_id}/meetings/{meeting_id}/cancel')
    async def cancel(project_id: UUID, meeting_id: UUID, request: Request, owner=Depends(require_user)):
        return answer(await run_in_threadpool(service.cancel, repository(request), str(project_id), str(meeting_id)))

    @router.get('/projects/{project_id}/meetings/{meeting_id}/email-preview')
    async def preview(project_id: UUID, meeting_id: UUID, request: Request, owner=Depends(require_user)):
        return answer((await run_in_threadpool(service.preview, repository(request), owner, str(project_id), str(meeting_id)))[2])

    @router.post('/projects/{project_id}/meetings/{meeting_id}/send')
    async def send(project_id: UUID, meeting_id: UUID, request: Request, owner=Depends(require_user)):
        data = await body(request)
        digest = data.get('digest') if isinstance(data, dict) else None
        return answer(await run_in_threadpool(service.send, repository(request), owner, str(project_id), str(meeting_id), digest))

    return router
