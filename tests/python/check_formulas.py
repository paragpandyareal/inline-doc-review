# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Inline Doc Review: https://github.com/paragpandyareal/inline-doc-review
"""Checks the safe formula calculator: run with `python3 -I tests/python/check_formulas.py`.

It must calculate the functions it supports, and give None (not calculated)
for anything else: unknown functions, code, huge ranges, deep or circular
references. It never runs code: the module imports no eval, exec or compile.
"""
import ast
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import formulas  # noqa: E402

SHEET = {
    (1, 1): 10, (2, 1): 20, (3, 1): 30, (4, 1): "x",
    (1, 2): "=SUM(A1:A3)", (2, 2): "=AVERAGE(A1:A3)", (3, 2): "=IF(A1>5,\"big\",\"small\")",
    (4, 2): "=ROUND(A2/3,2)", (5, 2): "=SUMIF(A1:A3,\">15\")", (6, 2): "=COUNTIF(A1:A4,\"x\")",
    (7, 2): "=IFERROR(1/0,\"none\")", (8, 2): "=A1*10%", (9, 2): "=MAX(A1:A3)-MIN(A1:A3)",
    (10, 2): "=DATE(2026,1,1)", (11, 2): "=1/0", (12, 2): "='Other sheet'!A1+1",
    (1, 3): "=VLOOKUP(1,A1:B3,2)", (2, 3): "=__import__('os').system('id')", (3, 3): "=SUM(A1:XFD1048576)",
    (4, 3): "=C5", (5, 3): "=C4", (6, 3): "=2^99999", (7, 3): "=" + "(" * 500 + "1" + ")" * 500,
    (8, 3): "=exec(\"print(1)\")", (9, 3): "=A1+" * 1000 + "1",
}
OTHER = {(1, 1): 41}


def cells(sheet, row, col):
    return (SHEET if sheet == "Main" else OTHER if sheet == "Other sheet" else {}).get((row, col))


calc = formulas.Calculator(cells)
value = lambda row, col: calc.evaluate("Main", row, col)  # noqa: E731

checks = [
    ("SUM", value(1, 2) == 60),
    ("AVERAGE", value(2, 2) == 20),
    ("IF with text", value(3, 2) == "big"),
    ("ROUND", value(4, 2) == 6.67),
    ("SUMIF", value(5, 2) == 50),
    ("COUNTIF", value(6, 2) == 1),
    ("IFERROR", value(7, 2) == "none"),
    ("percent", abs(value(8, 2) - 1) < 1e-9),
    ("MAX-MIN", value(9, 2) == 20),
    ("DATE", value(10, 2) is not None),
    ("division by zero is #DIV/0!", value(11, 2) == "#DIV/0!"),
    ("quoted sheet reference", value(12, 2) == 42),
    ("unsupported function gives None", value(1, 3) is None),
    ("Python code gives None", value(2, 3) is None),
    ("huge range gives None", value(3, 3) is None),
    ("circular reference gives None", value(4, 3) is None),
    ("huge power gives None", value(6, 3) is None),
    ("deep nesting gives None", value(7, 3) is None),
    ("exec gives None", value(8, 3) is None),
    ("over-long formula gives None", value(9, 3) is None),
]
tree = ast.parse(open(formulas.__file__).read())
code_runners = {"eval", "exec", "compile", "__import__", "getattr", "open"}
called = {node.func.id for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
checks.append(("no eval, exec, compile, __import__, getattr or open in the module", not called & code_runners))

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(("PASS " if ok else "FAIL ") + name)
print(f"\n{len(checks) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
