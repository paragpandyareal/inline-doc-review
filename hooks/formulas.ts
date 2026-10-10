// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * A small, safe Excel formula calculator for showing values in the pane.
 *
 * Workbooks written by scripts (openpyxl, which Claude often uses) carry no
 * saved results, so their formula cells would show nothing. This works those
 * values out for the common cases: numbers, text, cell references and ranges
 * (also on other sheets), + - * / ^ & % and comparisons, and SUM AVERAGE MIN
 * MAX COUNT COUNTA ROUND ABS IF IFERROR AND OR NOT DATE SUMIF COUNTIF
 * AVERAGEIF.
 *
 * It is an interpreter: formulas are read and evaluated here, never turned
 * into code (the hooks environment has no eval either). Limits on formula
 * length, range size, nesting and total work, which counts every cell a
 * range reads, stop a hostile workbook from hanging the pane. Anything it
 * doesn't support evaluates to null, and the pane shows the formula as not
 * calculated.
 */

export type Value = number | string | boolean | null
type Result = Value | Value[]

import { isLate } from './deadline'

const MAX_FORMULA = 2000
const MAX_RANGE_CELLS = 100_000
const MAX_DEPTH = 60
const MAX_STEPS = 2_000_000

class Unsupported extends Error {}
class ExcelError extends Error {}

type Token = { kind: 'num' | 'str' | 'ref' | 'func' | 'bool' | 'op'; text: string }

const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|("(?:[^"]|"")*")|((?:(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-z][A-Za-z0-9.]*)\s*\(|(TRUE|FALSE)\b|(<>|<=|>=|[-+*/^&=<>%(),]))/iy
const KINDS = ['num', 'str', 'ref', 'func', 'bool', 'op'] as const

export function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}

/** `'Sheet 1'!$A$1:B2` → the sheet, and the first and last cells as [row, col]. */
function splitRef(text: string, sheet: string): [string, [number, number], [number, number]] {
  const bang = text.lastIndexOf('!')
  if (bang >= 0) {
    sheet = text.slice(0, bang)
    if (sheet.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
    text = text.slice(bang + 1)
  }
  const cells = text
    .replace(/\$/g, '')
    .split(':')
    .map(part => {
      const m = /^([A-Za-z]+)(\d+)$/.exec(part)
      if (!m) throw new Unsupported('reference')
      return [Number(m[2]), colIndex(m[1]!)] as [number, number]
    })
  return [sheet, cells[0]!, cells[cells.length - 1]!]
}

/** Raw content of a cell: a number, text, boolean or null, or a formula starting with '='. */
export type CellSource = (sheet: string, row: number, col: number) => Value

const LEVELS = [['=', '<>', '<', '>', '<=', '>='], ['&'], ['+', '-'], ['*', '/'], ['^']]
const FUNCTIONS = new Set(['IF', 'IFERROR', 'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'ABS', 'ROUND', 'AND', 'OR', 'NOT', 'DATE', 'SUMIF', 'COUNTIF', 'AVERAGEIF'])
const isNumber = (v: unknown): v is number => typeof v === 'number'

/** A sum with Neumaier's compensation, as Python's sum() does: no drift in the last digits. */
function total(values: number[]): number {
  let sum = 0
  let carry = 0
  for (const v of values) {
    const t = sum + v
    carry += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum
    sum = t
  }
  return sum + carry
}

export class Calculator {
  private memo = new Map<string, Result>()
  private busy = new Set<string>()
  private steps = 0

  /** `extent`: how far a sheet's cells reach, so a whole column (B:B) reads only the rows in use. */
  constructor(
    private cells: CellSource,
    private extent?: (sheet: string) => { rows: number; cols: number } | undefined,
  ) {}

  /** The cell's value, an Excel error text such as #DIV/0!, or null when not supported. */
  evaluate(sheet: string, row: number, col: number): Value {
    try {
      const value = this.value(sheet, row, col, 0)
      return Array.isArray(value) ? null : value
    } catch (error) {
      if (error instanceof ExcelError) return error.message
      return null
    }
  }

  private tick(cost = 1) {
    this.steps += cost
    if (this.steps > MAX_STEPS || isLate()) throw new Unsupported('too much work')
  }

  private value(sheet: string, row: number, col: number, depth: number): Result {
    this.tick()
    const key = `${sheet}\u0000${row}\u0000${col}`
    const known = this.memo.get(key)
    if (known !== undefined) return known
    const raw = this.cells(sheet, row, col)
    if (!(typeof raw === 'string' && raw.startsWith('='))) return raw
    if (this.busy.has(key) || depth > MAX_DEPTH) throw new Unsupported('circular or too deep')
    this.busy.add(key)
    try {
      const result = this.formula(raw, sheet, depth)
      this.memo.set(key, result)
      return result
    } finally {
      this.busy.delete(key)
    }
  }

  private formula(text: string, sheet: string, depth: number): Result {
    if (text.length > MAX_FORMULA) throw new Unsupported('too long')
    const body = text.slice(1)
    const tokens: Token[] = []
    let pos = 0
    while (pos < body.length) {
      TOKEN.lastIndex = pos
      const m = TOKEN.exec(body)
      if (!m || m.index !== pos || TOKEN.lastIndex === pos) {
        if (body.slice(pos).trim() === '') break
        throw new Unsupported('cannot read')
      }
      const k = m.slice(1).findIndex(g => g !== undefined)
      tokens.push({ kind: KINDS[k]!, text: m[k + 1]! })
      pos = TOKEN.lastIndex
    }
    const state = { i: 0 }
    const result = this.expr(tokens, state, sheet, depth, 0)
    if (state.i !== tokens.length) throw new Unsupported('trailing input')
    return result
  }

  private isOp(tokens: Token[], i: number, ...ops: string[]) {
    const t = tokens[i]
    return t !== undefined && t.kind === 'op' && ops.includes(t.text)
  }

  private expr(tokens: Token[], state: { i: number }, sheet: string, depth: number, level: number): Result {
    if (level === LEVELS.length) return this.unary(tokens, state, sheet, depth)
    let left = this.expr(tokens, state, sheet, depth, level + 1)
    while (this.isOp(tokens, state.i, ...LEVELS[level]!)) {
      const op = tokens[state.i]!.text
      state.i += 1
      const right = this.expr(tokens, state, sheet, depth, level + 1)
      left = this.apply(op, scalar(left), scalar(right))
    }
    return left
  }

  private unary(tokens: Token[], state: { i: number }, sheet: string, depth: number): Result {
    if (this.isOp(tokens, state.i, '-', '+')) {
      const sign = tokens[state.i]!.text
      state.i += 1
      const value = number(scalar(this.unary(tokens, state, sheet, depth)))
      return sign === '-' ? -value : value
    }
    let value = this.atom(tokens, state, sheet, depth)
    if (this.isOp(tokens, state.i, '%')) {
      state.i += 1
      value = number(scalar(value)) / 100
    }
    return value
  }

  private atom(tokens: Token[], state: { i: number }, sheet: string, depth: number): Result {
    this.tick()
    const token = tokens[state.i]
    if (!token) throw new Unsupported('unexpected end')
    state.i += 1
    const { kind, text } = token
    if (kind === 'num') return Number(text)
    if (kind === 'str') return text.slice(1, -1).replace(/""/g, '"')
    if (kind === 'bool') return text.toUpperCase() === 'TRUE'
    if (kind === 'ref') {
      const [target, [r1, c1], [r2, c2]] = splitRef(text, sheet)
      if (r1 === r2 && c1 === c2) return this.value(target, r1, c1, depth + 1)
      // Past the last row and column in use every cell is empty: the range stops there.
      const used = this.extent?.(target)
      const rowEnd = Math.min(Math.max(r1, r2), used?.rows ?? Infinity)
      const colEnd = Math.min(Math.max(c1, c2), used?.cols ?? Infinity)
      const [rowStart, colStart] = [Math.min(r1, r2), Math.min(c1, c2)]
      if (rowEnd < rowStart || colEnd < colStart) return []
      if ((rowEnd - rowStart + 1) * (colEnd - colStart + 1) > MAX_RANGE_CELLS) throw new Unsupported('range too large')
      const out: Value[] = []
      for (let r = rowStart; r <= rowEnd; r += 1) {
        for (let c = colStart; c <= colEnd; c += 1) {
          const v = this.value(target, r, c, depth + 1)
          if (Array.isArray(v)) throw new Unsupported('nested range')
          out.push(v)
        }
      }
      return out
    }
    if (kind === 'func') {
      const spans: [number, number][] = []
      if (!this.isOp(tokens, state.i, ')')) {
        for (;;) {
          const start = state.i
          spans.push([start, this.skip(tokens, state)])
          if (this.isOp(tokens, state.i, ',')) {
            state.i += 1
            continue
          }
          break
        }
      }
      if (!this.isOp(tokens, state.i, ')')) throw new Unsupported('missing )')
      state.i += 1
      return this.call(text.toUpperCase(), spans, tokens, sheet, depth)
    }
    if (kind === 'op' && text === '(') {
      const value = this.expr(tokens, state, sheet, depth, 0)
      if (!this.isOp(tokens, state.i, ')')) throw new Unsupported('missing )')
      state.i += 1
      return value
    }
    throw new Unsupported('unexpected token')
  }

  /** Moves past one argument without evaluating it; returns where it ends. */
  private skip(tokens: Token[], state: { i: number }): number {
    let nesting = 0
    for (; state.i < tokens.length; state.i += 1) {
      const t = tokens[state.i]!
      if (t.kind === 'func' || (t.kind === 'op' && t.text === '(')) nesting += 1
      else if (t.kind === 'op' && t.text === ')') {
        if (nesting === 0) break
        nesting -= 1
      } else if (t.kind === 'op' && t.text === ',' && nesting === 0) break
    }
    return state.i
  }

  private arg(span: [number, number], tokens: Token[], sheet: string, depth: number): Result {
    const [start, end] = span
    const state = { i: start }
    // Copying the tokens up to the argument's end is work too: it counts.
    this.tick(end)
    const value = this.expr(tokens.slice(0, end), state, sheet, depth, 0)
    if (state.i !== end) throw new Unsupported('bad argument')
    return value
  }

  private call(name: string, spans: [number, number][], tokens: Token[], sheet: string, depth: number): Result {
    if (!FUNCTIONS.has(name)) throw new Unsupported('function')
    const get = (k: number) => this.arg(spans[k]!, tokens, sheet, depth)
    if (name === 'IF') {
      if (spans.length !== 2 && spans.length !== 3) throw new Unsupported('IF arguments')
      return truth(scalar(get(0))) ? get(1) : spans.length === 3 ? get(2) : false
    }
    if (name === 'IFERROR') {
      if (spans.length !== 2) throw new Unsupported('IFERROR arguments')
      try {
        return scalar(get(0))
      } catch (error) {
        if (error instanceof ExcelError) return get(1)
        throw error
      }
    }
    const values = spans.map((_, k) => get(k))
    if (name === 'SUMIF' || name === 'COUNTIF' || name === 'AVERAGEIF') return this.conditional(name, values)
    if (name === 'DATE') {
      if (values.length !== 3) throw new Unsupported('DATE arguments')
      let [y, m, d] = values.map(v => Math.trunc(number(scalar(v)))) as [number, number, number]
      if (y < 1900) y += 1900
      const month = Date.UTC(y + Math.floor((m - 1) / 12), (((m - 1) % 12) + 12) % 12, 1)
      return Math.round((month - Date.UTC(1899, 11, 30)) / 86_400_000) + d - 1
    }
    const flat = values.flatMap(v => (Array.isArray(v) ? v : [v]))
    const numbers = flat.filter(isNumber)
    switch (name) {
      case 'SUM':
        return total(numbers)
      case 'AVERAGE':
        if (numbers.length === 0) throw new ExcelError('#DIV/0!')
        return total(numbers) / numbers.length
      case 'MIN':
        return numbers.length ? Math.min(...numbers) : 0
      case 'MAX':
        return numbers.length ? Math.max(...numbers) : 0
      case 'COUNT':
        return numbers.length
      case 'COUNTA':
        return flat.filter(v => v !== null && v !== '').length
      case 'ABS':
        return Math.abs(number(scalar(values[0] ?? null)))
      case 'ROUND': {
        const digits = values.length > 1 ? Math.trunc(number(scalar(values[1]!))) : 0
        return roundHalfAway(number(scalar(values[0] ?? null)), digits)
      }
      case 'AND':
        return flat.filter(v => v !== null).every(v => truth(v))
      case 'OR':
        return flat.filter(v => v !== null).some(v => truth(v))
      case 'NOT':
        return !truth(scalar(values[0] ?? null))
    }
    throw new Unsupported('function')
  }

  /** SUMIF / COUNTIF / AVERAGEIF with a criterion like 5, "Red", ">90" or "<>Done". */
  private conditional(name: string, values: Result[]): Result {
    if ((values.length !== 2 && values.length !== 3) || !Array.isArray(values[0])) throw new Unsupported('arguments')
    const tested = values[0]
    const summed = values.length === 3 ? values[2] : tested
    if (!Array.isArray(summed) || summed.length !== tested.length) throw new Unsupported('ranges')
    const criterion = scalar(values[1]!)
    let op = '='
    let target: Value = criterion
    if (typeof criterion === 'string') {
      const m = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(criterion)!
      op = m[1] ?? '='
      const rest = m[2]!
      target = rest.trim() !== '' && Number.isFinite(Number(rest)) ? Number(rest) : rest
    }
    const picked: Value[] = []
    tested.forEach((value, k) => {
      let a: string | number
      let b: string | number
      if (typeof target === 'string' || typeof value === 'string') {
        a = (value === null ? '' : String(value)).toLowerCase()
        b = String(target).toLowerCase()
      } else {
        a = number(value)
        b = number(target)
      }
      if (compare(op, a, b)) picked.push(summed[k] ?? null)
    })
    const numbers = picked.filter(isNumber)
    if (name === 'COUNTIF') return picked.length
    if (name === 'SUMIF') return total(numbers)
    if (numbers.length === 0) throw new ExcelError('#DIV/0!')
    return total(numbers) / numbers.length
  }

  private apply(op: string, a: Value, b: Value): Value {
    if (op === '&') {
      const joined = text(a) + text(b)
      // Excel's own limit for a cell's text.
      if (joined.length > 32_767) throw new Unsupported('text too long')
      return joined
    }
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
      if (typeof a === 'string' || typeof b === 'string') {
        return compare(op, (a === null ? '' : String(a)).toLowerCase(), (b === null ? '' : String(b)).toLowerCase())
      }
      return compare(op, number(a), number(b))
    }
    const x = number(a)
    const y = number(b)
    if (op === '+') return x + y
    if (op === '-') return x - y
    if (op === '*') return x * y
    if (op === '/') {
      if (y === 0) throw new ExcelError('#DIV/0!')
      return x / y
    }
    if (op === '^') {
      if (Math.abs(y) > 1000) throw new Unsupported('exponent too large')
      const r = x ** y
      if (!Number.isFinite(r)) throw new ExcelError('#NUM!')
      return r
    }
    throw new Unsupported(op)
  }
}

function compare(op: string, a: string | number, b: string | number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '<>':
      return a !== b
    case '<':
      return a < b
    case '>':
      return a > b
    case '<=':
      return a <= b
    default:
      return a >= b
  }
}

function scalar(value: Result): Value {
  if (Array.isArray(value)) throw new Unsupported('range used as a value')
  if (typeof value === 'string' && value.startsWith('#')) throw new ExcelError(value)
  return value
}

function number(value: Value): number {
  if (value === null || value === '') return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n)) throw new ExcelError('#VALUE!')
  return n
}

function truth(value: Value): boolean {
  if (typeof value === 'string') {
    const upper = value.toUpperCase()
    if (upper === 'TRUE' || upper === 'FALSE') return upper === 'TRUE'
    throw new ExcelError('#VALUE!')
  }
  return number(value) !== 0
}

function text(v: Value): string {
  if (v === null) return ''
  if (v === true) return 'TRUE'
  if (v === false) return 'FALSE'
  return String(v)
}

/** Excel's ROUND: halves go away from zero. */
function roundHalfAway(x: number, digits: number): number {
  const factor = 10 ** digits
  const scaled = Math.abs(x) * factor
  const rounded = Math.round(Number(scaled.toPrecision(15)))
  return (Math.sign(x) * rounded) / factor
}
