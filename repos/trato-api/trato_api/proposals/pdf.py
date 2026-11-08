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

def render_pdf(snapshot, project_name, client_name, *, language='es'):
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
        english = language == 'en'
        name = 'Addendum' if english else 'Adenda'
        version = 'version' if english else 'versión'
        add(f'{name} · {version} {revision["revision_no"]}', title)
        add(f'{"Project" if english else "Proyecto"}: {project_name}')
        add(f'{"Client" if english else "Cliente"}: {client_name}')
        add(f'{"Revision ID" if english else "Identificador de revisión"}: {revision["id"]}')
        add(f'{"Proposed due date" if english else "Fecha límite propuesta"}: {revision["deadline"]}')
        add('Scope of change' if english else 'Alcance del cambio', label)
        add(revision['scope_summary'])
        add('Additional charges' if english else 'Detalle del adicional', label)
        for item in items:
            add(f'{item["quantity"]} × {item["description"]} · {money(item["unit_amount_minor"])} {"per unit" if english else "por unidad"} · {money(item["quantity"] * item["unit_amount_minor"])}')
        add(f'{"Total additional charge" if english else "Adicional total"}: {money(revision["additional_minor"])}', label)
        add('Terms' if english else 'Condiciones', label)
        add(revision['conditions'])
        add('Sources for this version' if english else 'Fuentes de esta versión', label)
        for source in sorted(snapshot['sources'], key=lambda x: x['document_id']):
            add(f'{"Document" if english else "Documento"} {source["document_id"]}\nSHA-256: {source["document_sha256"]}')
        if revision.get('base_acceptance_id'):
            add(f'{"Previous acceptance reference" if english else "Aceptación anterior de referencia"}: {revision["base_acceptance_id"]}')
        add('Client acceptance' if english else 'Aceptación del cliente', label)
        fields = ('Name', 'Signature', 'Date') if english else ('Nombre', 'Firma', 'Fecha')
        add('\n'.join(f'{field}: ____________________' for field in fields))
        doc = SimpleDocTemplate(output, pagesize=(210*mm,297*mm), leftMargin=22*mm, rightMargin=22*mm, topMargin=20*mm, bottomMargin=20*mm, invariant=1, title=f'{name} v{revision["revision_no"]}', author='Trato')
        doc.build(story)
        return output.getvalue()


class ProposalPdfService:
    def save(self, repo, proposal_id, revision_id, *, language='es'):
        snapshot = repo.get_revision(proposal_id, revision_id, collections=('line_items','sources','artifacts'))
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
        content = render_pdf(snapshot, project['name'], clients[0]['name'], language=language)
        name = 'Addendum' if language == 'en' else 'Adenda'
        reservation = repo.reserve(project['id'], f'{name} v{revision["revision_no"]}', 'addendum', f'{name.lower()}-v{revision["revision_no"]}.pdf', 'application/pdf', content, 'proposal-pdf-' + revision_id,
            context={'purpose':'generated_addendum','revision_id':revision_id})
        document = reservation['document']
        if document['sha256'] != sha256(content).hexdigest():
            raise ApiError('PROPOSAL_PDF_HASH_MISMATCH', 409)
        repo.upload(document, content)
        # A generated PDF needs no extraction to bind it to its structured terms.
        # Original source processing/IA belongs to its separate worker workflow.
        repo.command('attach_pdf', {'proposal_id':proposal_id, 'expected_revision_id':revision_id, 'document_id':document['id']}, 'proposal-pdf-bind-' + revision_id)
        artifacts=repo.rows('proposal_artifacts',{'select':'document_id,sha256,created_at','proposal_id':'eq.'+proposal_id,'revision_id':'eq.'+revision_id})
        if len(artifacts)!=1:raise ApiError('PROPOSAL_PDF_REQUIRED',409)
        return artifacts[0]
