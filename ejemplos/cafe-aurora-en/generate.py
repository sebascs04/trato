"""Regenerates the case PDFs from their editable Markdown sources."""
from pathlib import Path
from xml.sax.saxutils import escape
import json
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph

ROOT = Path(__file__).resolve().parent
PURPLE = colors.HexColor('#7051c6')
INK = colors.HexColor('#302837')
MUTED = colors.HexColor('#766c82')
STYLES = {
    'title': ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=21, leading=26,
                            textColor=INK, spaceAfter=16),
    'heading': ParagraphStyle('Heading', fontName='Helvetica-Bold', fontSize=12, leading=17,
                              textColor=PURPLE, spaceBefore=15, spaceAfter=7, keepWithNext=True),
    'body': ParagraphStyle('Body', fontName='Helvetica', fontSize=10.5, leading=16,
                           textColor=INK, spaceAfter=9),
    'bullet': ParagraphStyle('Bullet', fontName='Helvetica', fontSize=10.5, leading=16,
                             textColor=INK, leftIndent=10, firstLineIndent=-8, spaceAfter=5),
}


def frame(canvas, doc):
    canvas.saveState()
    width, height = doc.pagesize
    canvas.setFillColor(PURPLE)
    canvas.setFont('Helvetica-Bold', 17)
    canvas.drawString(22 * mm, height - 17 * mm, 'trato.')
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(width - 22 * mm, height - 17 * mm, 'Café Aurora | Sample case')
    canvas.setStrokeColor(colors.HexColor('#e7dfef'))
    canvas.line(22 * mm, 20 * mm, width - 22 * mm, 20 * mm)
    canvas.drawString(22 * mm, 14 * mm, 'Fictional data for testing Trato')
    canvas.drawRightString(width - 22 * mm, 14 * mm, f'Page {doc.page}')
    canvas.restoreState()


def story_from_markdown(text):
    story = []
    for block in text.strip().split('\n\n'):
        lines = block.strip().splitlines()
        if not lines:
            continue
        if lines[0].startswith('# '):
            story.append(Paragraph(escape(lines[0][2:]), STYLES['title']))
        elif lines[0].startswith('## '):
            story.append(Paragraph(escape(lines[0][3:]), STYLES['heading']))
            if len(lines) > 1:
                story.append(Paragraph('<br/>'.join(escape(line) for line in lines[1:]), STYLES['body']))
        elif all(line.startswith('- ') for line in lines):
            for line in lines:
                story.append(Paragraph('• ' + escape(line[2:]), STYLES['bullet']))
        else:
            story.append(Paragraph('<br/>'.join(escape(line) for line in lines), STYLES['body']))
    return story


def main():
    case = json.loads((ROOT / 'case.json').read_text(encoding='utf-8'))
    for item in case['documents']:
        source = (ROOT / item['source']).resolve()
        if not source.is_relative_to((ROOT / 'sources').resolve()) or not source.is_file():
            raise ValueError('Source must be inside sources/')
        if Path(item['pdf']).name != item['pdf'] or not item['pdf'].endswith('.pdf'):
            raise ValueError('Invalid PDF name')
        text = source.read_text(encoding='utf-8')
        title = text.splitlines()[0].removeprefix('# ')
        pdf = SimpleDocTemplate(str(ROOT / item['pdf']), pagesize=(210 * mm, 297 * mm),
            leftMargin=22 * mm, rightMargin=22 * mm, topMargin=29 * mm, bottomMargin=28 * mm,
            title=title, author='Trato', invariant=1, pageCompression=1)
        pdf.build(story_from_markdown(text), onFirstPage=frame, onLaterPages=frame)
        print(item['pdf'])


if __name__ == '__main__':
    main()
