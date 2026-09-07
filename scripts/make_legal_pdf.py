# -*- coding: utf-8 -*-
"""
KazNU Helper — 生成真实、可直接打印的《三语法律条款》PDF。
- 数据源：src/locales/legal_content.json（App 内同一份权威内容，非 HTML 转 PDF）
- 字体：嵌入 Arial TrueType（覆盖拉丁 + 西里尔），段落自动换行 / 分页
- 输出：KazNU_Helper_Legal_Notice_3Lang.pdf（仓库根目录）

用法：python scripts/make_legal_pdf.py [输出路径]
"""
import json
import os
import sys

from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_NAME = "KazNU Helper"
APP_VERSION = "1.2.2"
DOC_NAME = "Legal Notice · Құқықтық ақпарат · Правовая информация"

FONT_PATH = os.environ.get("KAZNU_PDF_FONT_REGULAR", "C:/Windows/Fonts/arial.ttf")
FONT_BOLD_PATH = os.environ.get("KAZNU_PDF_FONT_BOLD", "C:/Windows/Fonts/arialbd.ttf")


def load_content() -> dict:
    with open(os.path.join(BASE, "src", "locales", "legal_content.json"), encoding="utf-8") as fh:
        return json.load(fh)


def build_pdf(out_path: str) -> str:
    content = load_content()
    lang_order = ["en", "kk", "ru"]
    lang_title = {"en": "English", "kk": "Қазақша", "ru": "Русский"}

    page_w, page_h = A4
    left = 20 * mm
    right = 20 * mm
    top = 20 * mm
    bottom = 18 * mm
    frame = Frame(left, bottom, page_w - left - right, page_h - top - bottom, id="body")

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Kaznu", 8)
        canvas.setFillColor(colors.HexColor("#444444"))
        canvas.drawString(left, 12 * mm, f"{APP_NAME} · {DOC_NAME} · v{APP_VERSION}")
        canvas.drawRightString(page_w - right, 12 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(colors.HexColor("#C9CDD4"))
        canvas.setLineWidth(0.6)
        canvas.line(left, 14.5 * mm, page_w - right, 14.5 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=left,
        rightMargin=right,
        topMargin=top,
        bottomMargin=bottom,
        title=f"{APP_NAME} {DOC_NAME}",
        author=APP_NAME,
        subject="Terms of Service, Privacy Policy and Legal Information (KK/EN/RU)",
    )
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])

    styles = {
        "brand": ParagraphStyle(
            "brand", fontName="Kaznu", fontSize=15, leading=19, alignment=TA_CENTER,
            textColor=colors.HexColor("#0033A0"), spaceAfter=2,
        ),
        "brandSub": ParagraphStyle(
            "brandSub", fontName="Kaznu", fontSize=8.5, leading=12, alignment=TA_CENTER,
            textColor=colors.HexColor("#555555"), spaceAfter=10,
        ),
        "h1": ParagraphStyle(
            "h1", fontName="Kaznu-Bold", fontSize=13, leading=17, alignment=TA_CENTER,
            textColor=colors.HexColor("#111111"), spaceBefore=10, spaceAfter=4,
        ),
        "h1Meta": ParagraphStyle(
            "h1Meta", fontName="Kaznu", fontSize=8, leading=12, alignment=TA_CENTER,
            textColor=colors.HexColor("#666666"), spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2", fontName="Kaznu-Bold", fontSize=10.5, leading=15, spaceBefore=7,
            spaceAfter=3, textColor=colors.HexColor("#0033A0"),
        ),
        "body": ParagraphStyle(
            "body", fontName="Kaznu", fontSize=9.2, leading=13.4, alignment=TA_JUSTIFY,
            spaceAfter=5, textColor=colors.HexColor("#1a1a1a"),
        ),
    }

    story = []
    story.append(Paragraph(escape(APP_NAME), styles["brand"]))
    story.append(Paragraph(escape(DOC_NAME), styles["brandSub"]))
    story.append(Paragraph(f"Version {APP_VERSION} · Updated 2026-09-07", styles["brandSub"]))
    story.append(Spacer(1, 4))

    for idx, lang in enumerate(lang_order):
        if idx > 0:
            story.append(PageBreak())
        item = content[lang]
        story.append(Paragraph(f"{lang_title[lang]} · {escape(item['docTitle'])}", styles["h1"]))
        story.append(Paragraph(f"Updated {escape(item.get('updated', '2026-09-07'))} · KazNU Helper v{APP_VERSION}", styles["h1Meta"]))
        for section in item["sections"]:
            story.append(Paragraph(escape(section["title"]), styles["h2"]))
            for para in section["body"]:
                story.append(Paragraph(escape(para), styles["body"]))

    doc.build(story)
    return os.path.abspath(out_path)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "KazNU_Helper_Legal_Notice_3Lang.pdf")
    pdfmetrics.registerFont(TTFont("Kaznu", FONT_PATH))
    pdfmetrics.registerFont(TTFont("Kaznu-Bold", FONT_BOLD_PATH))
    pdfmetrics.registerFontFamily("Kaznu", normal="Kaznu", bold="Kaznu-Bold", italic="Kaznu", boldItalic="Kaznu-Bold")
    print("PDF => " + build_pdf(out))
