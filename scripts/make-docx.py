"""기획서 Markdown → Word(docx): python3 scripts/make-docx.py
docs/01_프로젝트_기획서.md 를 읽어 docs/01_프로젝트_기획서.docx 를 만듭니다(python-docx 필요: pip install python-docx).
제목(#) → 제목, ## → 제목 1, ### → 제목 2, 표 → 표(Table Grid), - → 글머리, 1. → 원문 번호 그대로, > → 인용, ``` → 고정폭 글자, **굵게** 유지."""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / '01_프로젝트_기획서.md'
OUT = ROOT / 'docs' / '01_프로젝트_기획서.docx'
FONT = 'Malgun Gothic'


def set_font(style, size=None):
    style.font.name = FONT
    style.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), FONT)
    if size:
        style.font.size = Pt(size)


def add_runs(par, text):
    """**굵게** 와 `코드` 만 서식으로, 나머지는 글자 그대로"""
    for part in re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text):
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            par.add_run(part[2:-2]).bold = True
        elif part.startswith('`') and part.endswith('`'):
            r = par.add_run(part[1:-1])
            r.font.name = 'Consolas'
        else:
            par.add_run(part.replace('<br/>', ' / '))


def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def main():
    lines = SRC.read_text(encoding='utf-8').splitlines()
    doc = Document()
    for name, size in (('Normal', 10), ('Title', 18), ('Heading 1', 14), ('Heading 2', 12), ('List Bullet', 10), ('List Number', 10), ('Quote', 10)):
        set_font(doc.styles[name], size)
    for name in ('Title', 'Heading 1', 'Heading 2'):
        doc.styles[name].font.color.rgb = RGBColor(0x13, 0x27, 0x4b)
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s or s == '---':
            i += 1
            continue
        if s.startswith('```'):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            p = doc.add_paragraph()
            r = p.add_run('\n'.join(buf).replace('<br/>', ' '))
            r.font.name = 'Consolas'
            r.font.size = Pt(8.5)
            continue
        if s.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                if not re.match(r'^\|?\s*:?-{2,}', lines[i].strip().strip('|').strip()):
                    rows.append(cells(lines[i]))
                i += 1
            n = max(len(r) for r in rows)
            t = doc.add_table(rows=len(rows), cols=n)
            t.style = 'Table Grid'
            t.alignment = WD_TABLE_ALIGNMENT.CENTER
            for ri, r in enumerate(rows):
                for ci in range(n):
                    c = t.cell(ri, ci)
                    c.text = ''
                    add_runs(c.paragraphs[0], r[ci] if ci < len(r) else '')
                    for run in c.paragraphs[0].runs:
                        run.font.size = Pt(9)
                        if ri == 0:
                            run.bold = True
            doc.add_paragraph()
            continue
        m = re.match(r'^(#{1,3})\s+(.*)$', s)
        if m:
            level = len(m.group(1))
            doc.add_paragraph(m.group(2), style={1: 'Title', 2: 'Heading 1', 3: 'Heading 2'}[level])
            i += 1
            continue
        if s.startswith('>'):
            add_runs(doc.add_paragraph(style='Quote'), s.lstrip('> ').strip())
            i += 1
            continue
        m = re.match(r'^[-*]\s+(.*)$', s)
        if m:
            add_runs(doc.add_paragraph(style='List Bullet'), m.group(1))
            i += 1
            continue
        m = re.match(r'^(\d+)\.\s+(.*)$', s)
        if m:
            # Word 의 자동 번호는 목록마다 이어 세어 버려(10장이 7번부터 시작) 원문 번호를 글자로 둡니다
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Pt(18)
            par.paragraph_format.first_line_indent = Pt(-14)
            par.add_run(m.group(1) + '. ')
            add_runs(par, m.group(2))
            i += 1
            continue
        add_runs(doc.add_paragraph(), s)
        i += 1
    doc.core_properties.title = '프레임 제작 생산성 개선 — 프로젝트 기획서'
    doc.core_properties.author = '제작팀'
    doc.save(OUT)
    print('만듦:', OUT.relative_to(ROOT))


if __name__ == '__main__':
    sys.exit(main())
