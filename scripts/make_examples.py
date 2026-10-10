#!/usr/bin/env python3
# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
"""Writes the Excel, Word and picture samples for /panda examples.

The mod writes the text samples itself; it can't write binary files, so
this writes the rest. The folder comes on standard input; the mod has just
made it, empty. Every file is created new (never overwriting, and never
through a link someone left there). Standard library only: the workbooks
and the document are written as their XML parts, zipped.

Prints "LPP1 wrote <path>" for each file.
"""
import os
import random
import struct
import sys
import zipfile
import zlib
from xml.sax.saxutils import escape


def col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# ── Excel ──

STYLES_XLSX = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEEDD"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""

# Cell styles above: 1 header (bold, green), 2 thousands (#,##0), 3 percent (0.0%), 4 bold.
HEADER, THOUSANDS, PERCENT, BOLD = 1, 2, 3, 4


def cell_xml(ref, value, style=0):
    s = ' s="%d"' % style if style else ""
    if value is None:
        return '<c r="%s"%s/>' % (ref, s) if style else ""
    if isinstance(value, str) and value.startswith("="):
        return '<c r="%s"%s><f>%s</f></c>' % (ref, s, escape(value[1:]))
    if isinstance(value, (int, float)):
        return '<c r="%s"%s><v>%s</v></c>' % (ref, s, value)
    return '<c r="%s"%s t="inlineStr"><is><t>%s</t></is></c>' % (ref, s, escape(value))


def sheet_xml(rows, widths=None):
    out = []
    for r, row in enumerate(rows, start=1):
        cells = "".join(cell_xml("%s%d" % (col(c), r), *(v if isinstance(v, tuple) else (v,))) for c, v in enumerate(row, start=1))
        out.append('<row r="%d">%s</row>' % (r, cells))
    cols = ""
    if widths:
        cols = "<cols>%s</cols>" % "".join('<col min="%d" max="%d" width="%s" customWidth="1"/>' % (k, k, w) for k, w in enumerate(widths, start=1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">%s<sheetData>%s</sheetData></worksheet>' % (cols, "".join(out)))


def write_xlsx(path, sheets):
    """sheets: [(name, rows, widths)]; a cell is a value or (value, style)."""
    types = "".join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % k
                    for k in range(1, len(sheets) + 1))
    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + types + "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>",
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>%s</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
        % "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), k, k) for k, (name, _, _) in enumerate(sheets, start=1)),
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s'
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
        % "".join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (k, k)
                  for k in range(1, len(sheets) + 1)),
        "xl/styles.xml": STYLES_XLSX,
    }
    for k, (_, rows, widths) in enumerate(sheets, start=1):
        parts["xl/worksheets/sheet%d.xml" % k] = sheet_xml(rows, widths)
    write_zip(path, parts)


def budget(path):
    head = [(h, HEADER) for h in ["Line item", "Jan", "Feb", "Mar", "Total"]]
    rows = [head]
    for r, (name, a, b, c) in enumerate([("Facebook ads", 8000, 8000, 8000), ("Letterbox print", 9600, 4800, 0),
                                          ("Info nights", 3200, 3200, 3200), ("Installer bonus", 0, 5000, 5000)], start=2):
        rows.append([name, a, b, c, "=SUM(B%d:D%d)" % (r, r)])
    rows.append([("Total", BOLD), "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)", "=SUM(E2:E5)"])
    signups = [[(h, HEADER) for h in ["Suburb", "Target", "Signed"]],
               ["Penrith", 200, 64], ["Blacktown", 180, 51], ["Mount Druitt", 120, 22]]
    write_xlsx(path, [("Budget", rows, [18, 10, 10, 10, 10]), ("Sign-ups", signups, [16, 10, 10])])


def big_sheet(path):
    rng = random.Random(7)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    rows = [[(h, HEADER) for h in ["Site", "Region", "Tariff"] + months + ["Total", "Average", "Change"]]]
    regions = ["Penrith", "Blacktown", "Parramatta", "Liverpool", "Campbelltown"]
    for i in range(2, 62):
        rows.append(["NMI-%d" % (4100 + i), rng.choice(regions), rng.choice(["Flat", "TOU", "Demand"])]
                    + [rng.randint(600, 2400) for _ in months]
                    + ["=SUM(D%d:O%d)" % (i, i), ("=AVERAGE(D%d:O%d)" % (i, i), THOUSANDS), ("=(O%d-D%d)/D%d" % (i, i, i), PERCENT)])
    rows.append([("Total", BOLD), "", ""] + ["=SUM(%s2:%s61)" % (c, c) for c in "DEFGHIJKLMNOP"])
    write_xlsx(path, [("Sites", rows, [12, 14, 9] + [8] * 15)])


# ── Word ──

STYLES_DOCX = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>"""

NUMBERING_DOCX = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"""


def para(text, style=None):
    ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % style if style else ""
    return '<w:p>%s<w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (ppr, escape(text))


def table(rows):
    grid = "".join('<w:gridCol w:w="2880"/>' for _ in rows[0])
    body = "".join("<w:tr>%s</w:tr>" % "".join('<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>%s</w:tc>' % para(v) for v in row) for row in rows)
    return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>%s</w:tblGrid>%s</w:tbl>' % (grid, body)


def proposal(path):
    body = "".join([
        para("Q1 Retail Energy Proposal", "Title"),
        para("Summary", "Heading1"),
        para("We propose a three-month pilot of the Green Saver Plan for 500 households in Western Sydney, funded by the state solar rebate."),
        para("Pricing", "Heading1"),
        para("The plan charges 29.4c per kWh with a 98c daily supply charge. Customers with solar receive a 6c feed-in tariff."),
        para("A 5% pay-on-time discount applies to usage charges only."),
        table([["Item", "Rate", "Unit"], ["Usage", "29.4", "c/kWh"], ["Supply", "98", "c/day"]]),
        para("Timeline", "Heading1"),
        para("Recruitment in January", "ListBullet"),
        para("Installs in February", "ListBullet"),
        para("First bills in March", "ListBullet"),
    ])
    write_zip(path, {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        "</Types>",
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>",
        "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
        "</Relationships>",
        "word/document.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>%s'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
        "</w:body></w:document>" % body,
        "word/styles.xml": STYLES_DOCX,
        "word/numbering.xml": NUMBERING_DOCX,
    })


# ── Writing ──

def create(path):
    """A new file, never an existing one nor a link: O_EXCL refuses both."""
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o644), "wb")


def write_zip(path, parts):
    with create(path) as handle, zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in parts.items():
            archive.writestr(name, text.encode("utf-8"))


# ── Picture ──


def price_chart(width=800, height=480):
    """A bar chart of four plans' daily prices, drawn pixel by pixel as a PNG."""
    background, axis = (248, 250, 252), (100, 116, 139)
    bars = [(46, (45, 212, 191)), (62, (139, 92, 246)), (38, (244, 114, 182)), (54, (251, 191, 36))]
    pixels = [[background] * width for _ in range(height)]
    base, left = height - 60, 70
    for x in range(left, width - 40):
        for y in (base, base + 1):
            pixels[y][x] = axis
    for y in range(40, base):
        pixels[y][left] = axis
    for i, (value, colour) in enumerate(bars):
        x0 = left + 40 + i * 170
        top = base - value * 5
        for y in range(top, base):
            for x in range(x0, x0 + 110):
                pixels[y][x] = colour
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    if sys.version_info < (3, 6):
        sys.exit(8)
    folder = sys.stdin.buffer.read().decode("utf-8", "replace").strip()
    if not os.path.isdir(folder) or os.path.islink(folder):
        sys.stdout.write("LPP1 error The folder for the samples is missing.\n")
        sys.exit(2)
    for name, make in [("pilot-budget.xlsx", budget), ("site-consumption.xlsx", big_sheet), ("energy-proposal.docx", proposal)]:
        path = os.path.join(folder, name)
        try:
            make(path)
            sys.stdout.write("LPP1 wrote %s\n" % path)
        except FileExistsError:
            pass
    picture = os.path.join(folder, "plan-prices.png")
    try:
        with create(picture) as target:
            target.write(price_chart())
        sys.stdout.write("LPP1 wrote %s\n" % picture)
    except (FileExistsError, OSError):
        pass


if __name__ == "__main__":
    main()
