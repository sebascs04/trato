"""Render immutable contractual snapshots. No LLM, signature or current-time input."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from threading import RLock
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

from ..errors import ApiError

_LOCK = RLock()
_FONT = 'TratoDejaVu'

def money(minor):
    if type(minor) is not int or minor < 0:
        raise ApiError('INVALID_PROPOSAL_AMOUNT', 409)
    return f'USD {minor // 100:,}.{minor % 100:02d}'

def render_pdf(snapshot, project_name, client_name):
    revision = snapshot['revision']
    items = snapshot['line_items']
    if sum(item['quantity'] * item['unit_amount_minor'] for item in items) != revision['additional_minor']:
        raise ApiError('PROPOSAL_AMOUNT_MISMATCH', 409)
    with _LOCK:
        if _FONT not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(_FONT, str(Path(__file__).parent / 'assets/DejaVuSans.ttf')))
        font = pdfmetrics.getFont(_FONT)
        output = BytesIO()
        style = ParagraphStyle('body', fontName=_FONT, fontSize=10, leading=15, spaceAfter=8)
        title = ParagraphStyle('title', parent=style, fontSize=22, leading=27, spaceAfter=15)
        label = ParagraphStyle('label', parent=style, textColor=colors.HexColor('#385548'), fontSize=11, spaceBefore=12)
        story = []
        def add(value, selected=style):
            text = str(value).replace('\r\n', '\n').replace('\r', '\n')
            if any(ord(c) not in font.face.charToGlyph for c in text if c not in '\n\t'):
                raise ApiError('PDF_UNSUPPORTED_CHARACTER', 422)
            story.append(Paragraph(escape(text).replace('\n', '<br/>'), selected))
        add(f'Adenda · versión {revision["revision_no"]}', title)
        add(f'Proyecto: {project_name}')
        add(f'Cliente: {client_name}')
        add(f'Identificador de revisión: {revision["id"]}')
        add(f'Fecha límite propuesta: {revision["deadline"]}')
        add('Alcance del cambio', label)
        add(revision['scope_summary'])
        add('Detalle del adicional', label)
        for item in items:
            add(f'{item["quantity"]} × {item["description"]} · {money(item["unit_amount_minor"])} por unidad · {money(item["quantity"] * item["unit_amount_minor"])}')
        add(f'Adicional total: {money(revision["additional_minor"])}', label)
        add('Condiciones', label)
        add(revision['conditions'])
        add('Fuentes de esta versión', label)
        for source in sorted(snapshot['sources'], key=lambda x: x['document_id']):
            add(f'Documento {source["document_id"]}\nSHA-256: {source["document_sha256"]}')
        if revision.get('base_acceptance_id'):
            add(f'Aceptación anterior de referencia: {revision["base_acceptance_id"]}')
        add('Aceptación del cliente', label)
        add('Nombre: ____________________\nFirma: ____________________\nFecha: ____________________')
        doc = SimpleDocTemplate(output, pagesize=(210*mm,297*mm), leftMargin=22*mm, rightMargin=22*mm, topMargin=20*mm, bottomMargin=20*mm, invariant=1, title=f'Adenda v{revision["revision_no"]}', author='Trato')
        doc.build(story)
        return output.getvalue()


class ProposalPdfService:
    def save(self, repo, proposal_id, revision_id):
        snapshot = repo.get_revision(proposal_id, revision_id)
        existing = snapshot['artifacts']
        if existing:
            # Return the exact stored original, even for historical revisions.
            document = repo.document(existing[0]['document_id'])
            if sha256(repo.download(document)).hexdigest() != existing[0]['sha256']:
                raise ApiError('PROPOSAL_PDF_HASH_MISMATCH', 409)
            return existing[0]
        proposal, revision = snapshot['proposal'], snapshot['revision']
        if proposal['locked_at'] or proposal['current_revision_id'] != revision_id:
            raise ApiError('PROPOSAL_REVISION_CONFLICT', 409)
        if proposal['status'] != 'draft':
            raise ApiError('PROPOSAL_ALREADY_REVIEWED', 409)
        project = repo.project(proposal['project_id'])
        clients = repo.rows('clients', {'select':'id,name', 'id':'eq.' + project['client_id']})
        if not clients:
            raise ApiError('CLIENT_NOT_FOUND', 404)
        content = render_pdf(snapshot, project['name'], clients[0]['name'])
        reservation = repo.reserve(project['id'], f'Adenda v{revision["revision_no"]}', 'addendum', f'adenda-v{revision["revision_no"]}.pdf', 'application/pdf', content, 'proposal-pdf-' + revision_id)
        document = reservation['document']
        if document['sha256'] != sha256(content).hexdigest():
            raise ApiError('PROPOSAL_PDF_HASH_MISMATCH', 409)
        repo.upload(document, content)
        # A generated PDF needs no extraction to bind it to its structured terms.
        # Original source processing/IA belongs to its separate worker workflow.
        repo.command('attach_pdf', {'proposal_id':proposal_id, 'expected_revision_id':revision_id, 'document_id':document['id']}, 'proposal-pdf-bind-' + revision_id)
        return repo.get_revision(proposal_id, revision_id)['artifacts'][0]
