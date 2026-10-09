# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
"""Checks scripts/extract.py on tricky Word, Excel and PDF files.

Run with the helper's Python (after /panda setup):
    ~/.cache/lazy-panda-panel/venv/bin/python -I tests/python/check_extract.py
It writes its inputs to a temporary folder first (make_inputs.py). Prints PASS/FAIL per expectation."""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
X = os.path.join(ROOT, "scripts", "extract.py")
I = tempfile.mkdtemp(prefix="idr-inputs-")
subprocess.run([sys.executable, "-I", os.path.join(HERE, "make_inputs.py")], env={**os.environ, "IDR_INPUTS": I}, check=True)

def run(kind, name):
    out = subprocess.run([sys.executable, X, kind, os.path.join(I, name)], capture_output=True, text=True)
    return json.loads(out.stdout)

def cell(doc, sheet, ref):
    s = next(s for s in doc["sheets"] if s["name"] == sheet)
    col = s["cols"].index("".join(ch for ch in ref if ch.isalpha()))
    row = int("".join(ch for ch in ref if ch.isdigit())) - 1
    return s["rows"][row][col]["v"]

results = []
def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  -> {detail}" if not ok else ""))

x = run("xlsx", "tricky.xlsx")
check("time-only cell shows 09:30", cell(x, "Main", "H2") == "09:30", cell(x, "Main", "H2"))
check("datetime 00:30 keeps its time", cell(x, "Main", "I2").endswith("00:30"), cell(x, "Main", "I2"))
check("0.00001 is not shown as 0.00", cell(x, "Main", "J2") not in ("0.00", "0"), cell(x, "Main", "J2"))
check("euro currency format keeps the symbol", "€" in cell(x, "Main", "F2"), cell(x, "Main", "F2"))
check("array formula shows a value, not a Python repr", "openpyxl" not in cell(x, "Main", "B8"), cell(x, "Main", "B8"))
check("hidden sheet is marked hidden", any(s.get("isHidden") or s.get("hidden") for s in x["sheets"] if s["name"] == "Hidden One"))
c = run("xlsx", "chartsheet.xlsx")
check("workbook with a chart sheet opens", c.get("kind") == "grid", c.get("message"))
b = run("xlsx", "baddim.xlsx")
check("sheet with a wrong <dimension> still shows its cells", any(any(v["v"] for v in r) for r in b["sheets"][0]["rows"]), b["sheets"][0])
g = run("xlsx", "big.xlsx")
check("cut sheets flagged", all(s["isCut"] for s in g["sheets"]))

d = run("docx", "tricky.docx")
rows = {r["text"]: r for r in d["rows"]}
check("numbering restarts after a heading", rows["Restart one"].get("marker") == "1.", rows["Restart one"].get("marker"))
check("nested numbering restarts under a new parent", rows["Deep B (should restart at 1)"].get("marker") == "1.", rows["Deep B (should restart at 1)"].get("marker"))
check("equal adjacent table cells are both kept", rows.get("Yes | Yes | No") is not None, [r["text"] for r in d["rows"] if "Yes" in r["text"]])
n = run("docx", "numpr.docx")
items = [r for r in n["rows"] if r.get("style") == "li"]
# numId 1 in python-docx's default template is a bullet list, so a bullet is right here.
check("Word list (List Paragraph + numPr) follows its numbering format", items and items[0].get("marker") == "•", [i.get("marker") for i in items])
check("numPr ilvl gives nesting", items and items[-1].get("indent") == 1, [i.get("indent") for i in items])
t = run("docx", "tracked.docx")
texts = " ".join(r["text"] for r in t["rows"])
check("tracked insertion is shown", "INSERTED" in texts, texts)
check("content-control (sdt) text is shown", "Inside a content control" in texts, texts)
im = run("docx", "image.docx")
check("image paragraph shows a placeholder", any("[image" in r["text"].lower() or "▣" in r["text"] for r in im["rows"]), [r["text"] for r in im["rows"]])

m = run("pdf", "many.pdf")
pages = sum(1 for r in m["rows"] if r["unit"] == "page")
check("300-page PDF: all pages shown or a note says it was cut", pages == 300 or bool(m.get("note")), f"{pages} pages, note={m.get('note')}")
e = run("pdf", "encrypted.pdf")
check("password PDF gives a plain-language message", "password" in e.get("message", "").lower(), e.get("message"))
print(f"\n{results.count(True)} passed, {results.count(False)} failed")
