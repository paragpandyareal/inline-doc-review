# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
"""Generates tricky inputs for check_extract.py into the folder named by $IDR_INPUTS."""
import datetime as dt
import os
import zipfile

import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.worksheet.formula import ArrayFormula
import docx
from docx.shared import Inches
from pypdf import PdfWriter, PdfReader
from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject)

OUT = os.environ["IDR_INPUTS"]
os.makedirs(OUT, exist_ok=True)
p = lambda name: os.path.join(OUT, name)

# ---------- Excel ----------
wb = openpyxl.Workbook()
wb.save(p("empty.xlsx"))

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Main"
ws.append(["Name", "Date", "Bool", "Err", "Pct", "Money", "Neg", "Time", "Late", "Small", "Paren"])
ws.append(["Alice", dt.date(2024, 3, 1), True, "=1/0", 0.256, 1234.5, -50, dt.time(9, 30), dt.datetime(2024, 1, 1, 0, 30), 0.00001, -1000])
ws["B2"].number_format = "yyyy-mm-dd"
ws["E2"].number_format = "0.0%"
ws["F2"].number_format = '"€"#,##0.00'
ws["H2"].number_format = "hh:mm"
ws["I2"].number_format = "yyyy-mm-dd hh:mm"
ws["K2"].number_format = "#,##0;(#,##0)"
ws.append(["Bob", "=B2+1", False, "=#REF!+1", "=E2*2", "=F2*2", "=G2*2", None, None, "=J2*3", "=K2*2"])
ws.append(["Line1\nLine2", "=UNKNOWNFUNC(1)", "=[1]Ext!A1", "=INDIRECT(\"A1\")", "=SUM(A:A)", "x" * 300])
ws.merge_cells("A6:C6")
ws["A6"] = "Merged across A6:C6"
ws["A7"] = "=A6"
ws["B8"] = ArrayFormula("B8:B8", "=SUM(E2:E3*2)")
ws.append([])
# hidden sheet, quoted / unicode names
hs = wb.create_sheet("Hidden One")
hs["A1"] = "secret"
hs.sheet_state = "hidden"
q = wb.create_sheet("Bob's Q1")
q.append(["Item", "Amt"])
q.append(["x", 5])
q.append(["sum", "=SUM(B2:B2)"])
u = wb.create_sheet("数据 📊")
u.append(["名前", "金額"])
u.append(["東京都", 1000])
u.append(["🙂emoji", 2])
d = wb.create_sheet("2024")
d.append(["Year", "Val"])
d.append(["a", 1])
e = wb.create_sheet("Empty")
wb.save(p("tricky.xlsx"))

# big sheets
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Wide"
for r in range(1, 6):
    ws.append([f"r{r}c{c}" for c in range(1, 121)])
t = wb.create_sheet("Tall")
t.append(["n", "sq"])
for r in range(2, 5002):
    t.append([r, r * r])
wb.save(p("big.xlsx"))

# chart sheet
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Data"
for i in range(1, 5):
    ws.append([i, i * 2])
cs = wb.create_chartsheet("Chart1")
ch = BarChart()
ch.add_data(Reference(ws, min_col=2, min_row=1, max_row=4))
cs.add_chart(ch)
wb.save(p("chartsheet.xlsx"))

# offset data starting at C3 and a sheet with wrong/missing dimension
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Offset"
ws["C3"] = "start"
ws["D4"] = 42
wb.save(p("offset.xlsx"))
# Rewrite <dimension ref> to A1 to mimic writers that emit a bogus dimension.
src = p("offset.xlsx")
dst = p("baddim.xlsx")
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/worksheets/sheet1.xml":
            import re
            data = re.sub(rb'<dimension ref="[^"]*"/>', b'<dimension ref="A1"/>', data)
        zout.writestr(item, data)

# ---------- Word ----------
D = docx.Document()
D.add_heading("Section without title", level=1)
D.add_paragraph("")
D.add_paragraph("Intro paragraph.")
D.add_paragraph("First", style="List Number")
D.add_paragraph("Second", style="List Number")
D.add_paragraph("Nested bullet", style="List Bullet 2")
D.add_paragraph("Third", style="List Number")
D.add_paragraph("Deep A", style="List Number 2")
D.add_paragraph("Fourth", style="List Number")
D.add_paragraph("Deep B (should restart at 1)", style="List Number 2")
D.add_heading("Second list", level=2)
D.add_paragraph("Restart one", style="List Number")
D.add_paragraph("Restart two", style="List Number")
tbl = D.add_table(rows=3, cols=3)
tbl.cell(0, 0).text, tbl.cell(0, 1).text, tbl.cell(0, 2).text = "H1", "H2", "H3"
a = tbl.cell(1, 0).merge(tbl.cell(1, 1))
a.text = "merged"
tbl.cell(1, 2).text = "R1C3"
tbl.cell(2, 0).text, tbl.cell(2, 1).text, tbl.cell(2, 2).text = "Yes", "Yes", "No"
D.add_paragraph("After table.")
D.save(p("tricky.docx"))

# numPr-based numbered list (what Word itself writes: List Paragraph + numPr)
D = docx.Document()
D.add_paragraph("Steps:")
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
for i, txt in enumerate(["alpha", "beta", "gamma-nested"]):
    para = D.add_paragraph(txt, style="List Paragraph")
    pPr = para._p.get_or_add_pPr()
    numPr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl"); ilvl.set(qn("w:val"), "1" if i == 2 else "0")
    numId = OxmlElement("w:numId"); numId.set(qn("w:val"), "1")
    numPr.append(ilvl); numPr.append(numId); pPr.append(numPr)
D.save(p("numpr.docx"))

# tracked changes + text box + footnote-ish via raw XML edits
D = docx.Document()
para = D.add_paragraph("Keep ")
D.add_paragraph("Box host paragraph")
D.save(p("tracked.docx"))
with zipfile.ZipFile(p("tracked.docx")) as zin:
    files = {n: zin.read(n) for n in zin.namelist()}
xml = files["word/document.xml"].decode()
ins = ('<w:ins w:id="1" w:author="QA" w:date="2024-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">INSERTED </w:t></w:r></w:ins>'
       '<w:del w:id="2" w:author="QA" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>DELETED </w:delText></w:r></w:del>'
       '<w:r><w:t>end.</w:t></w:r>')
xml = xml.replace('<w:t xml:space="preserve">Keep </w:t></w:r>', '<w:t xml:space="preserve">Keep </w:t></w:r>' + ins, 1)
sdt = ('<w:sdt><w:sdtContent><w:p><w:r><w:t>Inside a content control</w:t></w:r></w:p></w:sdtContent></w:sdt>')
xml = xml.replace('<w:sectPr', sdt + '<w:sectPr', 1)
files["word/document.xml"] = xml.encode()
with zipfile.ZipFile(p("tracked.docx"), "w") as zout:
    for n, data in files.items():
        zout.writestr(n, data)

# image-only paragraph
import base64, io
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
D = docx.Document()
D.add_paragraph("Before image")
D.add_picture(io.BytesIO(PNG), width=Inches(1))
D.add_paragraph("After image")
D.save(p("image.docx"))

# ---------- PDF ----------
def text_page(writer, text, rotate=0):
    page = writer.add_blank_page(612, 792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    lines = text.split("\n")
    ops = "BT /F1 12 Tf 72 720 Td 14 TL " + " ".join(f"({l}) Tj T*" for l in lines) + " ET"
    stream = DecodedStreamObject(); stream.set_data(ops.encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    if rotate:
        page.rotate(rotate)
    return page

w = PdfWriter(); text_page(w, "Hello page one\nsecond line"); w.write(p("simple.pdf"))
w = PdfWriter(); w.add_blank_page(612, 792); w.add_blank_page(612, 792); w.write(p("scanned.pdf"))
w = PdfWriter()
for i in range(300):
    text_page(w, "\n".join(f"page {i+1} line {k}" for k in range(20)))
w.write(p("many.pdf"))
w = PdfWriter(); text_page(w, "Rotated text", rotate=90); w.write(p("rotated.pdf"))
w = PdfWriter(); text_page(w, "Secret text"); w.encrypt(user_password="pw", owner_password="own", algorithm="RC4-128"); w.write(p("encrypted.pdf"))
w = PdfWriter(); text_page(w, "Owner only"); w.encrypt(user_password="", owner_password="own", algorithm="RC4-128"); w.write(p("owner-only.pdf"))
open(p("corrupt.pdf"), "wb").write(b"%PDF-1.4\n1 0 obj << /Type /Catalog >>\ngarbage garbage\n%%EOF")
open(p("notapdf.pdf"), "wb").write(b"just text pretending")
open(p("corrupt.xlsx"), "wb").write(b"PK\x03\x04 not really a zip")
open(p("corrupt.docx"), "wb").write(b"")
