#!/usr/bin/env python3
"""Reads a document for the review pane and prints it as JSON.

    extract.py docx|pdf|xlsx <path>   one document, read only
    extract.py setup                   makes the venv the pane reads with

The libraries live in a venv of their own (~/.cache/review-pane/venv), so
nothing is installed into the system Python. Each run re-executes itself
under that venv when it exists.
"""
import json
import os
import re
import subprocess
import sys

VENV = os.path.join(os.path.expanduser("~"), ".cache", "review-pane", "venv")
VENV_PY = os.path.join(VENV, "bin", "python")
PACKAGES = ["python-docx", "openpyxl", "pypdf", "pycel"]

MAX_ROWS = 4000
MAX_SHEET_ROWS = 500
MAX_SHEET_COLS = 40


def reexec_in_venv():
    if os.path.exists(VENV_PY) and os.path.realpath(sys.prefix) != os.path.realpath(VENV):
        os.execv(VENV_PY, [VENV_PY, *sys.argv])


def setup():
    if not os.path.exists(VENV_PY):
        subprocess.run([sys.executable, "-m", "venv", VENV], check=True)
    subprocess.run([VENV_PY, "-m", "pip", "install", "--quiet", "--upgrade", *PACKAGES], check=True)
    return {"ok": True, "venv": VENV, "packages": PACKAGES}


def missing(package):
    return {
        "kind": "error",
        "message": f"Reading this file needs the Python package '{package}'. Run /review-pane setup once to install it.",
    }


def run_spans(paragraph):
    """A paragraph's runs as spans: bold, italic, strike; hyperlinks read as links."""
    spans = []
    for child in paragraph._p.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "r":
            from docx.text.run import Run
            run = Run(child, paragraph)
            if not run.text:
                continue
            span = {"t": run.text}
            if run.bold:
                span["b"] = 1
            if run.italic:
                span["i"] = 1
            if run.font.strike:
                span["s"] = 1
            spans.append(span)
        elif tag == "hyperlink":
            text = "".join(node.text or "" for node in child.iter() if node.tag.endswith("}t"))
            if text:
                spans.append({"t": text, "l": 1})
    return spans


def docx_rows(path):
    try:
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph
    except ImportError:
        return missing("python-docx")

    document = docx.Document(path)
    rows = []
    heading = None
    paragraph_index = 0
    table_index = 0
    numbers = {}
    has_title = False

    def space():
        if rows and rows[-1].get("style") != "space":
            rows.append({"text": "", "anchor": rows[-1]["anchor"], "style": "space", "unit": rows[-1]["unit"]})

    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph_index += 1
            paragraph = Paragraph(child, document)
            text = paragraph.text.strip()
            if not text:
                continue
            style = (paragraph.style.name if paragraph.style is not None else "") or ""
            # A document with a Title uses it as the top level; its Heading 1s sit one below.
            has_title = has_title or style == "Title"
            if style == "Title":
                level = 1
            elif style.startswith("Heading"):
                n = int(re.search(r"(\d+)", style).group(1)) if re.search(r"(\d+)", style) else 3
                level = min(3, n + (1 if has_title else 0))
            else:
                level = 0
            under = f' (under "{heading}")' if heading and not level else ""
            if level:
                heading = text
            row = {"text": text, "anchor": f"paragraph {paragraph_index}{under}", "unit": "paragraph", "spans": run_spans(paragraph) or [{"t": text}]}
            is_numbered = "Number" in style
            is_list = "List" in style or child.find(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}numPr") is not None
            if level:
                space()
                row["style"] = f"h{level}"
                rows.append(row)
                if level == 1:
                    rows.append({"text": "", "anchor": row["anchor"], "style": "rule", "unit": "paragraph"})
            elif is_list:
                depth = 0
                match = re.search(r"(\d+)$", style)
                if match:
                    depth = max(0, int(match.group(1)) - 1)
                if rows and rows[-1].get("style") not in ("li", "space"):
                    space()
                if is_numbered:
                    numbers[depth] = numbers.get(depth, 0) + 1
                row.update({"style": "li", "indent": depth, "marker": f"{numbers[depth]}." if is_numbered else ["•", "◦", "▪"][depth % 3]})
                rows.append(row)
            else:
                numbers = {}
                space()
                row["style"] = "quote" if "Quote" in style else "p"
                rows.append(row)
        elif tag == "tbl":
            table_index += 1
            numbers = {}
            space()
            table = Table(child, document)
            for row_index, row in enumerate(table.rows, start=1):
                cells = []
                for cell in row.cells:
                    value = " ".join(cell.text.split())
                    if not cells or cells[-1] != value:  # merged cells repeat
                        cells.append(value)
                rows.append({
                    "text": " | ".join(cells),
                    "cells": cells,
                    "isHeader": row_index == 1,
                    "anchor": f"table {table_index}, row {row_index}",
                    "unit": "table row",
                })
            space()
        if len(rows) >= MAX_ROWS:
            break
    while rows and rows[-1].get("style") == "space":
        rows.pop()
    return {"kind": "lines", "rows": rows, "isFormatted": True}


def pdf_rows(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        return missing("pypdf")

    reader = PdfReader(path)
    rows = []
    for page_number, page in enumerate(reader.pages, start=1):
        rows.append({"text": f"── Page {page_number} ──", "anchor": f"page {page_number}", "style": "heading", "unit": "page"})
        text = page.extract_text() or ""
        for line_number, line in enumerate(text.splitlines(), start=1):
            if line.strip():
                rows.append({"text": line.rstrip(), "anchor": f"page {page_number}, line {line_number}", "style": None, "unit": "line"})
        if len(rows) >= MAX_ROWS:
            break
    if len(rows) == len(reader.pages):
        return {"kind": "lines", "rows": rows, "note": "This PDF has no text layer (it may be scanned), so only page markers are shown."}
    return {"kind": "lines", "rows": rows}


def number_text(value, fmt):
    """A number as the sheet's format would show it, roughly: %, $, decimals, thousands."""
    fmt = fmt or "General"
    section = fmt.split(";")[0]
    if "." in section:
        decimals = len(re.match(r"[0#]*", section.split(".", 1)[1]).group(0))
    else:
        decimals = 2 if section == "General" and isinstance(value, float) and not value.is_integer() else 0
    if "%" in fmt:
        return f"{value * 100:,.{decimals}f}%"
    text = f"{abs(value):,.{decimals}f}"
    if "$" in fmt:
        text = "$" + text
    return ("-" if value < 0 else "") + text


def cell_text(value, fmt):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return number_text(value, fmt)
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d") if not getattr(value, "hour", 0) else value.strftime("%Y-%m-%d %H:%M")
    return str(value)


def xlsx_sheets(path):
    try:
        import openpyxl
        from openpyxl.utils import get_column_letter
    except ImportError:
        return missing("openpyxl")

    formulas = openpyxl.load_workbook(path, data_only=False, read_only=True)
    values = openpyxl.load_workbook(path, data_only=True, read_only=True)
    compiler = None
    note = None

    def calculate(name, coord):
        """A formula's result where the file stores none (openpyxl never writes one)."""
        nonlocal compiler, note
        if compiler is None:
            try:
                from pycel import ExcelCompiler
                compiler = ExcelCompiler(filename=path)
            except Exception:
                compiler = False
                note = "Formula results could not be calculated here; run /review-pane setup."
        if compiler is False:
            return None
        try:
            result = compiler.evaluate(f"'{name}'!{coord}")
        except Exception:
            return "#CALC?"
        return None if result is None or result == "" else result

    sheets = []
    for name in formulas.sheetnames:
        f_sheet, v_sheet = formulas[name], values[name]
        width = min(f_sheet.max_column or 1, MAX_SHEET_COLS)
        height = min(f_sheet.max_row or 1, MAX_SHEET_ROWS)
        f_rows = f_sheet.iter_rows(min_row=1, max_row=height, max_col=width)
        v_rows = v_sheet.iter_rows(min_row=1, max_row=height, max_col=width, values_only=True)
        rows = []
        for r, (f_row, v_row) in enumerate(zip(f_rows, v_rows), start=1):
            cells = []
            for c, (f_cell, value) in enumerate(zip(f_row, v_row), start=1):
                raw = getattr(f_cell, "value", None)
                fmt = getattr(f_cell, "number_format", "General")
                formula = raw if isinstance(raw, str) and raw.startswith("=") else None
                if formula and value is None:
                    value = calculate(name, f"{get_column_letter(c)}{r}")
                elif not formula:
                    value = raw
                cell = {"v": cell_text(value, fmt)}
                if formula:
                    cell["f"] = formula
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    cell["x"] = value
                cells.append(cell)
            rows.append(cells)
        while rows and all(not cell["v"] for cell in rows[-1]):
            rows.pop()
        sheets.append({
            "name": name,
            "cols": [get_column_letter(i) for i in range(1, width + 1)],
            "rows": rows,
            "isCut": (f_sheet.max_row or 0) > MAX_SHEET_ROWS or (f_sheet.max_column or 0) > MAX_SHEET_COLS,
        })
    doc = {"kind": "grid", "sheets": sheets}
    if note:
        doc["note"] = note
    return doc


def main():
    if sys.argv[1:2] == ["setup"]:
        print(json.dumps(setup()))
        return
    reexec_in_venv()
    kind, path = sys.argv[1], sys.argv[2]
    try:
        doc = {"docx": docx_rows, "pdf": pdf_rows, "xlsx": xlsx_sheets}[kind](path)
    except Exception as error:  # a corrupt or locked file: say so in the pane
        doc = {"kind": "error", "message": f"Could not read the file: {error}"}
    print(json.dumps(doc))


if __name__ == "__main__":
    main()
