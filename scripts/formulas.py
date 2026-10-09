# Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
# Inline Doc Review: https://github.com/paragpandyareal/inline-doc-review
"""A small, safe Excel formula calculator for showing values in the pane.

Workbooks written by scripts (openpyxl, which Claude often uses) carry no
saved results, so their formula cells would show nothing. This works those
values out for the common cases: numbers, text, cell references and ranges
(also on other sheets), dates, + - * / ^ & and comparisons, and SUM AVERAGE
MIN MAX COUNT COUNTA ROUND ABS IF IFERROR AND OR NOT DATE SUMIF COUNTIF
AVERAGEIF.

It is an interpreter, not a compiler: formulas are parsed and evaluated here,
never turned into Python code, and nothing is passed to eval or exec. Limits
on formula length, range size, reference depth and total work stop a
malicious workbook from hanging it. Anything it does not support evaluates
to None, and the pane shows the formula as not calculated.
"""
import datetime
import re

MAX_FORMULA = 2000
MAX_RANGE_CELLS = 100_000
MAX_DEPTH = 60
MAX_STEPS = 2_000_000
# Excel counts days from this date (it keeps the 1900 leap-year quirk this offset absorbs).
EPOCH = datetime.date(1899, 12, 30)

TOKEN = re.compile(
    r"""\s*(?:
      (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
    | (?P<str>"(?:[^"]|"")*")
    | (?P<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)
    | (?P<func>[A-Za-z][A-Za-z0-9.]*)\s*\(
    | (?P<bool>TRUE|FALSE)\b
    | (?P<op><>|<=|>=|[-+*/^&=<>%(),])
    )""",
    re.VERBOSE | re.IGNORECASE,
)


class Unsupported(Exception):
    """The formula uses something this calculator does not handle."""


class ExcelError(Exception):
    """An Excel error value such as #DIV/0!; the pane shows it as text."""


def col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n


def split_ref(text, sheet):
    """'Sheet 1'!$A$1:B2 -> (sheet, (row1, col1), (row2, col2))."""
    if "!" in text:
        sheet, text = text.rsplit("!", 1)
        if sheet.startswith("'"):
            sheet = sheet[1:-1].replace("''", "'")
    parts = text.replace("$", "").split(":")
    cells = []
    for part in parts:
        m = re.match(r"([A-Za-z]+)(\d+)$", part)
        cells.append((int(m.group(2)), col_index(m.group(1))))
    return sheet, cells[0], cells[-1]


class Calculator:
    """Evaluates formula cells of one workbook, given its cell contents.

    `cells(sheet, row, col)` returns the raw content of a cell: a number,
    text, bool, None, or a formula string starting with '='.
    """

    def __init__(self, cells):
        self.cells = cells
        self.memo = {}
        self.busy = set()
        self.steps = 0

    def value(self, sheet, row, col, depth=0):
        key = (sheet, row, col)
        if key in self.memo:
            return self.memo[key]
        raw = self.cells(sheet, row, col)
        if not (isinstance(raw, str) and raw.startswith("=")):
            return raw
        if key in self.busy or depth > MAX_DEPTH:
            raise Unsupported("circular or too deep")
        self.busy.add(key)
        try:
            result = self.formula(raw, sheet, depth)
        finally:
            self.busy.discard(key)
        self.memo[key] = result
        return result

    def evaluate(self, sheet, row, col):
        """The cell's value, an Excel error text, or None when not supported."""
        try:
            return self.value(sheet, row, col)
        except ExcelError as error:
            return str(error)
        except (Unsupported, RecursionError, ValueError, TypeError, OverflowError, ZeroDivisionError):
            return None

    # Parsing: precedence climbing over the token list, evaluating as it goes.

    def formula(self, text, sheet, depth):
        if len(text) > MAX_FORMULA:
            raise Unsupported("too long")
        tokens, pos, body = [], 0, text[1:]
        while pos < len(body):
            m = TOKEN.match(body, pos)
            if not m or m.end() == pos:
                if body[pos:].strip() == "":
                    break
                raise Unsupported(f"cannot read {body[pos:pos + 10]!r}")
            kind = m.lastgroup
            tokens.append((kind, m.group(kind)))
            pos = m.end()
        state = {"i": 0}
        result = self.expr(tokens, state, sheet, depth, 0)
        if state["i"] != len(tokens):
            raise Unsupported("trailing input")
        return result

    LEVELS = [("=", "<>", "<", ">", "<=", ">="), ("&",), ("+", "-"), ("*", "/"), ("^",)]

    def expr(self, tokens, state, sheet, depth, level):
        if level == len(self.LEVELS):
            return self.unary(tokens, state, sheet, depth)
        left = self.expr(tokens, state, sheet, depth, level + 1)
        while state["i"] < len(tokens) and tokens[state["i"]] == ("op", tokens[state["i"]][1]) and tokens[state["i"]][1] in self.LEVELS[level]:
            op = tokens[state["i"]][1]
            state["i"] += 1
            right = self.expr(tokens, state, sheet, depth, level + 1)
            left = self.apply(op, self.scalar(left), self.scalar(right))
        return left

    def unary(self, tokens, state, sheet, depth):
        if state["i"] < len(tokens) and tokens[state["i"]] in (("op", "-"), ("op", "+")):
            sign = tokens[state["i"]][1]
            state["i"] += 1
            value = self.number(self.scalar(self.unary(tokens, state, sheet, depth)))
            return -value if sign == "-" else value
        value = self.atom(tokens, state, sheet, depth)
        if state["i"] < len(tokens) and tokens[state["i"]] == ("op", "%"):
            state["i"] += 1
            value = self.number(self.scalar(value)) / 100
        return value

    def atom(self, tokens, state, sheet, depth):
        self.tick()
        if state["i"] >= len(tokens):
            raise Unsupported("unexpected end")
        kind, text = tokens[state["i"]]
        state["i"] += 1
        if kind == "num":
            return float(text)
        if kind == "str":
            return text[1:-1].replace('""', '"')
        if kind == "bool":
            return text.upper() == "TRUE"
        if kind == "ref":
            target, (r1, c1), (r2, c2) = split_ref(text, sheet)
            if (r1, c1) == (r2, c2):
                return self.value(target, r1, c1, depth + 1)
            if (abs(r2 - r1) + 1) * (abs(c2 - c1) + 1) > MAX_RANGE_CELLS:
                raise Unsupported("range too large")
            return [self.value(target, r, c, depth + 1)
                    for r in range(min(r1, r2), max(r1, r2) + 1)
                    for c in range(min(c1, c2), max(c1, c2) + 1)]
        if kind == "func":
            args = []
            if not (state["i"] < len(tokens) and tokens[state["i"]] == ("op", ")")):
                while True:
                    start = state["i"]
                    args.append((start, self.skip(tokens, state)))
                    if state["i"] < len(tokens) and tokens[state["i"]] == ("op", ","):
                        state["i"] += 1
                        continue
                    break
            if not (state["i"] < len(tokens) and tokens[state["i"]] == ("op", ")")):
                raise Unsupported("missing )")
            state["i"] += 1
            return self.call(text.upper(), args, tokens, sheet, depth)
        if (kind, text) == ("op", "("):
            value = self.expr(tokens, state, sheet, depth, 0)
            if not (state["i"] < len(tokens) and tokens[state["i"]] == ("op", ")")):
                raise Unsupported("missing )")
            state["i"] += 1
            return value
        raise Unsupported(f"unexpected {text!r}")

    def skip(self, tokens, state):
        """Moves past one argument without evaluating it; returns where it ends."""
        nesting = 0
        while state["i"] < len(tokens):
            kind, text = tokens[state["i"]]
            if kind == "func" or (kind, text) == ("op", "("):
                nesting += 1
            elif (kind, text) == ("op", ")"):
                if nesting == 0:
                    break
                nesting -= 1
            elif (kind, text) == ("op", ",") and nesting == 0:
                break
            state["i"] += 1
        return state["i"]

    def arg(self, span, tokens, sheet, depth):
        start, end = span
        state = {"i": start}
        value = self.expr(tokens[:end], state, sheet, depth, 0)
        if state["i"] != end:
            raise Unsupported("bad argument")
        return value

    FUNCTIONS = {"IF", "IFERROR", "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "ABS", "ROUND", "AND", "OR", "NOT",
                 "DATE", "SUMIF", "COUNTIF", "AVERAGEIF"}

    def call(self, name, spans, tokens, sheet, depth):
        if name not in self.FUNCTIONS:
            raise Unsupported(f"function {name}")
        get = lambda k: self.arg(spans[k], tokens, sheet, depth)  # noqa: E731
        if name == "IF":
            if len(spans) not in (2, 3):
                raise Unsupported("IF arguments")
            return get(1) if self.truth(self.scalar(get(0))) else (get(2) if len(spans) == 3 else False)
        if name == "IFERROR":
            try:
                return self.scalar(get(0))
            except (ExcelError, ZeroDivisionError):
                return get(1)
        values = [get(k) for k in range(len(spans))]
        if name in ("SUMIF", "COUNTIF", "AVERAGEIF"):
            return self.conditional(name, values)
        if name == "DATE":
            y, m, d = (int(self.number(self.scalar(v))) for v in values[:3])
            if y < 1900:
                y += 1900
            month = datetime.date(y + (m - 1) // 12, (m - 1) % 12 + 1, 1)
            return float((month - EPOCH).days + d - 1)
        flat = [v for value in values for v in (value if isinstance(value, list) else [value])]
        numbers = [v for v in flat if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if name == "SUM":
            return sum(numbers)
        if name == "AVERAGE":
            if not numbers:
                raise ExcelError("#DIV/0!")
            return sum(numbers) / len(numbers)
        if name == "MIN":
            return min(numbers) if numbers else 0
        if name == "MAX":
            return max(numbers) if numbers else 0
        if name == "COUNT":
            return len(numbers)
        if name == "COUNTA":
            return len([v for v in flat if v not in (None, "")])
        if name == "ABS":
            return abs(self.number(self.scalar(values[0])))
        if name == "ROUND":
            digits = int(self.number(self.scalar(values[1]))) if len(values) > 1 else 0
            return round(self.number(self.scalar(values[0])), digits)
        if name == "AND":
            return all(self.truth(v) for v in flat if v is not None)
        if name == "OR":
            return any(self.truth(v) for v in flat if v is not None)
        if name == "NOT":
            return not self.truth(self.scalar(values[0]))
        raise Unsupported(f"function {name}")

    def conditional(self, name, values):
        """SUMIF / COUNTIF / AVERAGEIF with a criterion like 5, "Red", ">90" or "<>Done"."""
        if len(values) not in (2, 3) or not isinstance(values[0], list):
            raise Unsupported(f"{name} arguments")
        tested = values[0]
        summed = values[2] if len(values) == 3 else tested
        if not isinstance(summed, list) or len(summed) != len(tested):
            raise Unsupported(f"{name} ranges")
        criterion = self.scalar(values[1])
        op, target = "=", criterion
        if isinstance(criterion, str):
            m = re.match(r"(<>|<=|>=|=|<|>)?(.*)$", criterion, re.S)
            op, target = m.group(1) or "=", m.group(2)
            try:
                target = float(target)
            except ValueError:
                pass
        picked = []
        for value, add in zip(tested, summed):
            if isinstance(target, str) or isinstance(value, str):
                a, b = ("" if value is None else str(value)).lower(), str(target).lower()
            else:
                a, b = self.number(value), self.number(target)
            if {"=": a == b, "<>": a != b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]:
                picked.append(add)
        numbers = [v for v in picked if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if name == "COUNTIF":
            return len(picked)
        if name == "SUMIF":
            return sum(numbers)
        if not numbers:
            raise ExcelError("#DIV/0!")
        return sum(numbers) / len(numbers)

    # Values

    def tick(self):
        self.steps += 1
        if self.steps > MAX_STEPS:
            raise Unsupported("too much work")

    @staticmethod
    def scalar(value):
        if isinstance(value, list):
            raise Unsupported("range used as a value")
        if isinstance(value, str) and value.startswith("#"):
            raise ExcelError(value)
        return value

    @staticmethod
    def number(value):
        if value is None or value == "":
            return 0
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, datetime.datetime):
            return (value - datetime.datetime(1899, 12, 30)).total_seconds() / 86400
        if isinstance(value, datetime.date):
            return float((value - EPOCH).days)
        try:
            return float(value)
        except ValueError:
            raise ExcelError("#VALUE!")

    @classmethod
    def truth(cls, value):
        if isinstance(value, str):
            if value.upper() in ("TRUE", "FALSE"):
                return value.upper() == "TRUE"
            raise ExcelError("#VALUE!")
        return bool(cls.number(value))

    def apply(self, op, a, b):
        if op == "&":
            text = lambda v: "" if v is None else ("TRUE" if v is True else "FALSE" if v is False else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)))  # noqa: E731
            return text(a) + text(b)
        if op in ("=", "<>", "<", ">", "<=", ">="):
            if isinstance(a, str) or isinstance(b, str):
                a, b = ("" if a is None else str(a)).lower(), ("" if b is None else str(b)).lower()
            else:
                a, b = self.number(a), self.number(b)
            return {"=": a == b, "<>": a != b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
        a, b = self.number(a), self.number(b)
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            if b == 0:
                raise ExcelError("#DIV/0!")
            return a / b
        if op == "^":
            if abs(b) > 1000:
                raise Unsupported("exponent too large")
            return a ** b
        raise Unsupported(op)
