"""Immutable settlement PDFs, rendered from a server-frozen artifact context."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm

from ..errors import ApiError
from ..proposals.pdf import _LOCK, _FONT

LABELS = {
 'es': {'title':'Propuesta de cierre', 'project':'Proyecto','client':'Cliente','version':'Versión','snapshot':'Instantánea',
        'scope':'Alcance','payment_only':'Un pago','project_closure':'Cierre del proyecto','gross':'Total recibido','previous':'Devoluciones anteriores registradas',
        'retained':'Retenciones justificadas','credit':'Ajustes a favor del cliente','refund':'Devolución propuesta','due':'Saldo propuesto para un cobro independiente',
        'items':'Conceptos revisados','seller':'Vendedor','customer':'Cliente','conditions':'Condiciones','allocation':'Distribución por pago',
        'sources':'Evidencia documental','feedback':'Respuesta que motivó esta versión','signature':'Aceptación del cliente: nombre, firma y fecha',
        'notice':'Este documento no acredita que se haya ejecutado un reembolso. Comisión original y remanente actual del proveedor pendientes de comprobación.'},
 'en': {'title':'Settlement proposal','project':'Project','client':'Customer','version':'Version','snapshot':'Snapshot',
        'scope':'Scope','payment_only':'One payment','project_closure':'Project closure','gross':'Total received','previous':'Recorded prior refunds',
        'retained':'Justified retentions','credit':'Customer credits','refund':'Proposed refund','due':'Proposed balance for a separate charge',
        'items':'Reviewed items','seller':'Seller','customer':'Customer','conditions':'Conditions','allocation':'Allocation by payment',
        'sources':'Documentary evidence','feedback':'Reply that prompted this version','signature':'Customer acceptance: name, signature and date',
        'notice':'This document does not establish that a refund has been executed. The original fee and current provider balance await verification.'}}


def render_pdf(artifact):
    language=artifact['language']
    if language not in LABELS:raise ApiError('INVALID_OUTPUT_LANGUAGE',422)
    labels=LABELS[language];context=artifact['render_context'];snapshot=context['snapshot']
    terms=snapshot['terms'];b=snapshot['breakdown']
    def money(value):
        if type(value) is not int or value<0:raise ApiError('INVALID_REFUND_AMOUNT',409)
        return f'USD {value//100}.{value%100:02d}'
    with _LOCK:
        if _FONT not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(_FONT,str(Path(__file__).parent.parent/'proposals/assets/DejaVuSans.ttf')))
        font=pdfmetrics.getFont(_FONT)
        style=ParagraphStyle('refund',fontName=_FONT,fontSize=10,leading=15,spaceAfter=8)
        title=ParagraphStyle('refund-title',parent=style,fontSize=20,leading=25)
        story=[]
        def add(value,heading=False):
            text=str(value).replace('\r\n','\n').replace('\r','\n')
            if any(ord(c) not in font.face.charToGlyph for c in text if c not in '\n\t'):raise ApiError('PDF_UNSUPPORTED_CHARACTER',422)
            story.append(Paragraph(escape(text).replace('\n','<br/>'),title if heading else style))
        add(labels['title'],True)
        add(f"{labels['project']}: {context['project_name']}\n{labels['client']}: {context['client_name']}")
        add(f"{labels['version']}: {snapshot['version_no']}\n{labels['snapshot']}: {snapshot['id']}\n{labels['scope']}: {labels[context['scope']]}")
        for key,field in [('gross','gross_minor'),('previous','local_previous_refunds_minor'),('retained','seller_retention_minor'),('credit','customer_credit_minor'),('refund','refund_minor'),('due','additional_payment_due_minor')]:
            add(f'{labels[key]}: {money(b[field])}')
        add(labels['items'],True)
        for item in terms['adjustments']:
            add(f"{item['description']} · {labels[item['beneficiary']]} · {money(item['amount_minor'])}")
            if item.get('percentage'):add(f"{money(item['percentage']['base_minor'])} × {item['percentage']['basis_points']/100:g}%")
            for source in item['evidence']:add(f"{source['document_id']} · {source['document_sha256']}\n{source['quote']}")
        add(labels['allocation'],True)
        for payment in snapshot['payments']:
            add(f"{payment['payment_id']} · {payment['capture_id']}\n{money(payment['amount_minor'])} → {money(payment['refund_minor'])}")
        add(labels['conditions'],True);add(terms['conditions']);add(labels['sources'],True)
        for source in context['request_evidence']:add(f"{source['document_id']} · {source['document_sha256']}\n{source['quote']}")
        if context.get('feedback_text'):
            add(labels['feedback'],True);add(context['feedback_text'])
        add(labels['notice']);story.append(Spacer(1,8*mm));add(labels['signature']);add('________________________________________')
        out=BytesIO();SimpleDocTemplate(out,pagesize=(210*mm,297*mm),leftMargin=20*mm,rightMargin=20*mm,topMargin=18*mm,bottomMargin=18*mm,invariant=1,title=labels['title'],author='Trato').build(story)
        return out.getvalue()


class RefundPdfService:
    def __init__(self, backend):self.backend=backend

    def save(self,repo,owner,settlement_id,snapshot_id,language,key):
        data=repo.snapshot(settlement_id,snapshot_id)
        existing=data['artifacts']
        if existing:
            artifact=existing[0]
            if artifact['language']!=language:raise ApiError('REFUND_PDF_LANGUAGE_LOCKED',409)
        else:
            result=repo.command('reserve_pdf',{'settlement_id':settlement_id,'expected_snapshot_id':snapshot_id,'language':language},key)
            artifact=result['artifact']
        if artifact['document_id']:
            content=repo.download(repo.document(artifact['document_id']))
            if sha256(content).hexdigest()!=artifact['sha256']:raise ApiError('REFUND_PDF_HASH_MISMATCH',409)
            return {'settlement':repo.settlement(settlement_id),'artifact':artifact}
        content=render_pdf(artifact);digest=sha256(content).hexdigest()
        document=repo.reserve(data['settlement']['project_id'],f"Refund v{data['snapshot']['version_no']}",'addendum',f"refund-{artifact['id']}.pdf",'application/pdf',content,'refund-pdf-'+artifact['id'],
            context={'purpose':'refund_evidence','refund_case_id':settlement_id,'snapshot_id':snapshot_id})['document']
        repo.upload(document,content)
        artifact=self.backend().command(owner,'attach_pdf',{'settlement_id':settlement_id,'snapshot_id':snapshot_id,'document_id':document['id'],'sha256':digest})
        return {'settlement':repo.settlement(settlement_id),'artifact':artifact}
