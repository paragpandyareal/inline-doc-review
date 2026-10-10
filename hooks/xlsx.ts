// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Reads an Excel workbook (.xlsx) for the pane: every worksheet's values as
 * Excel would show them, the formula behind each formula cell, and values
 * worked out by the calculator where the file saved none.
 */

import type { GridCell, GridSheet } from '../types'
import { Calculator, colIndex } from './formulas'
import type { Value } from './formulas'
import { isLate } from './deadline'
import { attr, scanXml } from './xml'
import { openZip } from './zip'

const MAX_SHEET_ROWS = 500
const MAX_SHEET_COLS = 40
/** Cells kept for the calculator, across the workbook: beyond this, formulas that reach further show as not calculated. */
const MAX_CELLS = 200_000
/**
 * How much of a sheet's XML is unpacked: the pane shows its first 500 rows,
 * so a huge sheet is read from its start only, and opens in a second or two
 * however large it is. Sheets after the first big ones get less.
 */
const SHEET_START_BYTES = 16 * 1024 * 1024
const SHEET_MIN_BYTES = 2 * 1024 * 1024
const WORKBOOK_SHEET_BYTES = 48 * 1024 * 1024
const SHARED_STRINGS_BYTES = 32 * 1024 * 1024
/** Sheets read: a workbook with more shows the first ones. */
const MAX_SHEETS = 256

export type GridResult = { kind: 'grid'; sheets: GridSheet[]; note?: string }

const CONTROL = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g

/** Text safe to draw: tabs as spaces, no terminal escape codes or control characters. */
export const clean = (text: string) => text.replace(/\t/g, '  ').replace(/\r/g, '').replace(CONTROL, '')

const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm',
  37: '#,##0_);(#,##0)', 38: '#,##0_);[Red](#,##0)', 39: '#,##0.00_);(#,##0.00)', 40: '#,##0.00_);[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_)_("$"* \\(#,##0.00\\)_("$"* "-"??_)_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
}

// ── Number formats ──

const STRIP = /".*?"|\[(?!hh?\]|mm?\]|ss?\])[^\]]*\]/g
const isDateFormat = (fmt: string) => /(?<![_\\])[dmhysDMHYS]/.test((fmt.split(';')[0] ?? '').replace(STRIP, ''))
const isTimedeltaFormat = (fmt: string) => /\[hh?\](:mm(:ss(\.0*)?)?)?|\[mm?\](:ss(\.0*)?)?|\[ss?\](\.0*)?/i.test(fmt.split(';')[0] ?? '')

/** 1234567.5 → "1,234,567.5": digits grouped in threes. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** x rounded to `decimals` places as Excel shows it: the decimal value rounded, halves away from zero (1.005 → 1.01). */
function fixed(x: number, decimals: number): string {
  if (Math.abs(x) >= 1e21) {
    // Beyond toFixed's range: every digit of the integer, as Python and Excel's #,##0 give them.
    const digits = BigInt(Math.round(x)).toString()
    return (digits.startsWith('-') ? '-' : '') + group(digits.replace('-', '')) + (decimals > 0 ? `.${'0'.repeat(Math.min(decimals, 100))}` : '')
  }
  const d = Math.min(decimals, 15)
  const sign = x < 0 ? -1 : 1
  const rounded = (sign * Math.round(Number(`${Math.abs(x)}e${d}`))) / 10 ** d
  const text = (Number.isFinite(rounded) ? rounded : x).toFixed(Math.min(decimals, 100))
  const [whole, part] = text.split('.')
  return group(whole!) + (part !== undefined ? `.${part}` : '')
}

/** Python's format(x, ',.Ng'): N significant digits, trailing zeros dropped, exponent outside 1e-4 … 1eN. */
function general(x: number, digits: number, isGrouped: boolean): string {
  if (x === 0) return '0'
  const [mantissa, exp] = x.toExponential(digits - 1).split('e') as [string, string]
  const e = Number(exp)
  if (e < -4 || e >= digits) {
    const m = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa
    return `${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  let text = x.toFixed(Math.max(0, digits - 1 - e))
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  if (!isGrouped) return text
  const negative = text.startsWith('-')
  const [whole, part] = text.replace('-', '').split('.')
  return (negative ? '-' : '') + group(whole!) + (part !== undefined ? `.${part}` : '')
}

/** A number as the cell's format would show it, roughly: %, currency, decimals, thousands, (negatives). */
function numberText(value: number, fmt: string): string {
  const section = fmt.split(';')[0] ?? ''
  let decimals = 0
  if (section.includes('.')) {
    decimals = (/^[0#]*/.exec(section.split('.')[1] ?? '')?.[0] ?? '').length
  } else if (section === 'General') {
    if (!Number.isInteger(value)) return Math.abs(value) >= 0.001 ? general(value, 10, true) : general(value, 4, false)
  }
  if (fmt.includes('%')) return `${fixed(value * 100, decimals)}%`
  let text = fixed(Math.abs(value), decimals)
  const symbol = ['$', '€', '£', '¥'].find(s => fmt.includes(s)) ?? ''
  text = symbol + text
  if (value < 0) {
    const sections = fmt.split(';')
    return (sections[fmt.includes(';') ? 1 : 0] ?? '').includes('(') ? `(${text})` : `-${text}`
  }
  return text
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A serial date as openpyxl reads it, shown the way the pane always has: 2026-03-01, 2026-03-01 09:30, or 09:30. */
function dateText(value: number, fmt: string, is1904: boolean): string {
  // Before day 0 or after 9999-12-31, Excel shows #####: there is no such date.
  if (value < 0 || value >= 2_958_466) return '#####'
  if (isTimedeltaFormat(fmt)) {
    const minutes = Math.floor(Math.round(value * 86_400_000) / 60_000)
    return `${Math.floor(minutes / 60)}:${pad(((minutes % 60) + 60) % 60)}`
  }
  let day = Math.floor(value)
  const ms = Math.round((value - day) * 86_400_000)
  if (value >= 0 && value < 1 && ms < 86_400_000) return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}`
  if (value > 0 && value < 60 && !is1904) day += 1
  const when = new Date((is1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + day * 86_400_000 + ms)
  const lower = fmt.toLowerCase()
  const time = `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}`
  if (when.getUTCFullYear() === 1900 && lower.includes('h') && !lower.includes('y')) return time
  const date = `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}`
  return when.getUTCHours() === 0 && when.getUTCMinutes() === 0 && when.getUTCSeconds() === 0 && when.getUTCMilliseconds() === 0 ? date : `${date} ${time}`
}

/** A cell's text is cut at this length, and once a workbook's shown text passes the budget, at the short one. */
const MAX_CELL_TEXT = 2000
const SHORT_CELL_TEXT = 80
const TEXT_BUDGET = 4_000_000

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most)}…` : text)

function cellText(value: Value, fmt: string, is1904: boolean): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#NUM!'
    // Excel's General format shows very large numbers in E notation.
    if (Math.abs(value) >= 1e15 && fmt === 'General') return general(value, 6, false).toUpperCase()
    return isDateFormat(fmt) ? dateText(value, fmt, is1904) : numberText(value, fmt)
  }
  return clean(value).replace(/\n/g, ' ⏎ ')
}

// ── Formulas shared across a range ──

const REF = /('(?:[^']|'')+'!|[A-Za-z_][\w.]*!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g

function colLetters(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** The master formula of a shared group, moved by rows and columns as Excel copies it: $-anchored parts stay. */
const COLUMNS = /(^|[^\w$.'!])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(])/g
const ROWS = /(^|[^\w$.:'!])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)(\d+):(\$?)(\d+)(?![\w.(:])/g

function shiftFormula(formula: string, rows: number, cols: number): string {
  const col = (abs: string, letters: string) => {
    const c = abs ? colIndex(letters) : colIndex(letters) + cols
    return c >= 1 && c <= 16_384 ? `${abs}${colLetters(c)}` : null
  }
  const row = (abs: string, digits: string) => {
    const r = abs ? Number(digits) : Number(digits) + rows
    return r >= 1 ? `${abs}${r}` : null
  }
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, k) =>
      k % 2 === 1
        ? part
        : part
            .replace(REF, (whole, sheet: string | undefined, colAbs: string, letters: string, rowAbs: string, digits: string) => {
              const c = col(colAbs, letters)
              const r = row(rowAbs, digits)
              return c && r ? `${sheet ?? ''}${c}${r}` : whole
            })
            // Whole columns (B:B) and whole rows (3:3) move with the copy too.
            .replace(COLUMNS, (whole, lead: string, sheet: string | undefined, a1: string, c1: string, a2: string, c2: string) => {
              const from = col(a1, c1)
              const to = col(a2, c2)
              return from && to ? `${lead}${sheet ?? ''}${from}:${to}` : whole
            })
            .replace(ROWS, (whole, lead: string, sheet: string | undefined, a1: string, r1: string, a2: string, r2: string) => {
              const from = row(a1, r1)
              const to = row(a2, r2)
              return from && to ? `${lead}${sheet ?? ''}${from}:${to}` : whole
            }),
    )
    .join('')
}

// ── Reading ──

type Cell = { value: Value; formula?: string; style: number }

const key = (row: number, col: number) => row * 16_385 + col

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

function relations(text: string | null, base: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>()
  if (!text) return out
  scanXml(text, {
    open: (name, attrs) => {
      if (name !== 'Relationship') return
      const id = attr(attrs, 'Id')
      const target = attr(attrs, 'Target')
      if (id && target && attr(attrs, 'TargetMode') !== 'External') out.set(id, { target: resolve(base, target), type: attr(attrs, 'Type') ?? '' })
    },
  })
  return out
}

export function readXlsx(bytes: Uint8Array): GridResult {
  const zip = openZip(bytes)
  const rootRels = relations(zip.side('_rels/.rels'), '')
  const workbookPath = [...rootRels.values()].find(r => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml'
  const workbook = zip.side(workbookPath)
  if (workbook === null) throw new Error('it is not an Excel workbook')
  const rels = relations(zip.side(resolve(workbookPath, `_rels/${workbookPath.split('/').pop()}.rels`)), workbookPath)

  let is1904 = false
  const sheetList: { name: string; path: string; isHidden: boolean }[] = []
  scanXml(workbook, {
    open: (name, attrs) => {
      if (name === 'workbookPr') is1904 = ['1', 'true'].includes(attr(attrs, 'date1904') ?? '')
      if (name !== 'sheet') return
      const rel = rels.get(attr(attrs, 'id') ?? '')
      if (!rel || !rel.type.endsWith('/worksheet')) return
      const state = attr(attrs, 'state') ?? 'visible'
      sheetList.push({ name: attr(attrs, 'name') ?? '', path: rel.target, isHidden: state !== 'visible' })
    },
  })
  const relOf = (suffix: string) => [...rels.values()].find(r => r.type.endsWith(suffix))?.target

  // Shared strings: each <si> is one string, from its <t> runs (not the phonetic guides).
  const strings: string[] = []
  const sharedPath = relOf('/sharedStrings')
  const shared = sharedPath ? (zip.textStart(sharedPath, SHARED_STRINGS_BYTES)?.text ?? null) : null
  if (shared) {
    let current: string[] | null = null
    let inT = false
    let phonetic = 0
    scanXml(shared, {
      open: (name, _attrs, isEmpty) => {
        if (name === 'si') current = []
        else if (name === 'rPh') phonetic += isEmpty ? 0 : 1
        else if (name === 't' && !isEmpty) inT = true
      },
      close: name => {
        if (name === 'si') {
          strings.push((current ?? []).join(''))
          current = null
        } else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1)
        else if (name === 't') inT = false
      },
      text: text => {
        if (inT && phonetic === 0 && current) current.push(text)
      },
    })
  }

  // Number formats by cell style.
  const formats = new Map<number, string>()
  const styleFormats: string[] = []
  const stylesPath = relOf('/styles')
  const styles = stylesPath ? zip.side(stylesPath) : null
  if (styles) {
    let inCellXfs = false
    scanXml(styles, {
      open: (name, attrs) => {
        if (name === 'numFmt') formats.set(Number(attr(attrs, 'numFmtId')), attr(attrs, 'formatCode') ?? 'General')
        else if (name === 'cellXfs') inCellXfs = true
        else if (name === 'xf' && inCellXfs) {
          const id = Number(attr(attrs, 'numFmtId') ?? 0)
          styleFormats.push(formats.get(id) ?? BUILTIN_FORMATS[id] ?? 'General')
        }
      },
      close: name => {
        if (name === 'cellXfs') inCellXfs = false
      },
    })
  }
  const formatOf = (style: number) => styleFormats[style] ?? 'General'

  // Every worksheet's cells, for the grid and for the calculator.
  let kept = 0
  let isTruncated = false
  let sheetBytesLeft = WORKBOOK_SHEET_BYTES
  const books = sheetList.slice(0, MAX_SHEETS).map(sheet => {
    const cells = new Map<number, Cell>()
    let maxRow = 0
    let maxCol = 0
    // Once the workbook's reading allowance (or its time) is used up, later sheets are listed but not read.
    if (sheetBytesLeft <= 0 || isLate()) {
      isTruncated = true
      return { ...sheet, cells, maxRow: 1, maxCol: 1, isPartial: true }
    }
    const start = zip.textStart(sheet.path, Math.max(SHEET_MIN_BYTES, Math.min(SHEET_START_BYTES, sheetBytesLeft)))
    const xml = start?.text ?? ''
    sheetBytesLeft -= xml.length
    // Only the start of the sheet was read, or the scan stopped once it had what the pane needs.
    let isPartial = start?.isCut === true
    const sharedFormulas = new Map<string, { formula: string; row: number; col: number }>()
    let row = 0
    let col = 0
    let cell: { row: number; col: number; type: string; style: number; v: string | null; f: string | null; fAttrs: string; inline: string[] } | null = null
    let inV = false
    let inF = false
    let inIs = false
    let inT = false
    scanXml(xml, {
      open: (name, attrs, isEmpty) => {
        if (name === 'row') {
          const r = attr(attrs, 'r')
          row = r ? Number(r) : row + 1
          col = 0
          // Past the rows shown, with the calculator's cells all kept, or out of time: nothing more is read.
          if ((row > MAX_SHEET_ROWS && kept >= MAX_CELLS) || isLate()) {
            isPartial = true
            return false
          }
        } else if (name === 'c') {
          const ref = attr(attrs, 'r')
          const m = ref ? /^([A-Za-z]+)(\d+)$/.exec(ref) : null
          col = m ? colIndex(m[1]!) : col + 1
          const r = m ? Number(m[2]) : row
          cell = { row: r, col, type: attr(attrs, 't') ?? 'n', style: Number(attr(attrs, 's') ?? 0), v: null, f: null, fAttrs: '', inline: [] }
          if (isEmpty) {
            maxRow = Math.max(maxRow, r)
            maxCol = Math.max(maxCol, col)
          }
        } else if (cell && name === 'v') {
          inV = !isEmpty
          cell.v = ''
        } else if (cell && name === 'f') {
          inF = !isEmpty
          cell.f = ''
          cell.fAttrs = attrs
        } else if (cell && name === 'is') {
          inIs = true
        } else if (cell && inIs && name === 't') {
          inT = !isEmpty
        }
      },
      close: name => {
        if (name === 'v') inV = false
        else if (name === 'f') inF = false
        else if (name === 'is') inIs = false
        else if (name === 't') inT = false
        else if (name === 'c' && cell) {
          const c = cell
          cell = null
          maxRow = Math.max(maxRow, c.row)
          maxCol = Math.max(maxCol, c.col)
          if (kept >= MAX_CELLS) {
            isTruncated = true
            return
          }
          let value: Value = null
          if (c.type === 'inlineStr') value = c.inline.join('')
          // An empty <v/> holds nothing; a saved text result of " " is still a space.
          else if (c.v !== null && c.v !== '') {
            if (c.type === 's') value = c.v.trim() === '' ? null : (strings[Number(c.v)] ?? '')
            else if (c.type === 'b') value = c.v.trim() === '1' || c.v.trim().toLowerCase() === 'true'
            else if (c.type === 'str' || c.type === 'e' || c.type === 'd') value = c.v
            else value = c.v.trim() === '' ? null : Number(c.v)
            if (typeof value === 'number' && Number.isNaN(value)) value = c.v
          }
          let formula: string | undefined
          if (c.f !== null) {
            const kind = attr(c.fAttrs, 't')
            const si = attr(c.fAttrs, 'si')
            if (kind === 'shared' && si !== undefined) {
              // A master formula longer than the calculator takes isn't copied down the range.
              if (c.f.trim() !== '' && c.f.length <= 2000) sharedFormulas.set(si, { formula: c.f, row: c.row, col: c.col })
              const master = sharedFormulas.get(si)
              if (master) formula = `=${c.f.trim() !== '' ? c.f : shiftFormula(master.formula, c.row - master.row, c.col - master.col)}`
            } else if (kind !== 'dataTable') {
              formula = `=${c.f}`
            }
          }
          kept += 1
          cells.set(key(c.row, c.col), formula !== undefined ? { value, formula, style: c.style } : { value, style: c.style })
        }
      },
      text: text => {
        if (!cell) return
        if (inV) cell.v += text
        else if (inF) cell.f += text
        else if (inIs && inT) cell.inline.push(text)
      },
    })
    isTruncated ||= isPartial
    return { ...sheet, cells, maxRow: Math.max(maxRow, 1), maxCol: Math.max(maxCol, 1), isPartial }
  })

  const byName = new Map(books.map(b => [b.name, b]))
  const calculator = new Calculator((sheetName, row, col) => {
    const cell = byName.get(sheetName)?.cells.get(key(row, col))
    if (!cell) return null
    // A saved result wins; a formula with none is worked out.
    return cell.formula !== undefined && cell.value === null ? cell.formula : cell.value
  }, sheetName => {
    // Known only for a sheet read whole: one read from its start may have more beyond.
    const book = byName.get(sheetName)
    return book && !book.isPartial ? { rows: book.maxRow, cols: book.maxCol } : undefined
  })

  let notCalculated = 0
  let shownText = 0
  let isTextCut = false
  const sheets: GridSheet[] = books.map(book => {
    const width = Math.min(book.maxCol, MAX_SHEET_COLS)
    const height = Math.min(book.maxRow, MAX_SHEET_ROWS)
    const rows: GridCell[][] = []
    for (let r = 1; r <= height; r += 1) {
      const out: GridCell[] = []
      for (let c = 1; c <= width; c += 1) {
        const cell = book.cells.get(key(r, c))
        const fmt = formatOf(cell?.style ?? 0)
        let value: Value = cell?.value ?? null
        const formula = cell?.formula
        if (formula !== undefined && value === null) {
          value = calculator.evaluate(book.name, r, c)
          if (value === null) notCalculated += 1
        }
        const full = cellText(value, fmt, is1904)
        const most = shownText > TEXT_BUDGET ? SHORT_CELL_TEXT : MAX_CELL_TEXT
        isTextCut ||= full.length > most
        const grid: GridCell = { v: cut(full, most) }
        shownText += grid.v.length
        if (formula !== undefined) grid.f = cut(clean(formula), MAX_CELL_TEXT)
        if (typeof value === 'number' && Number.isFinite(value) && !isDateFormat(fmt)) grid.x = value
        out.push(grid)
      }
      rows.push(out)
    }
    while (rows.length > 0 && rows[rows.length - 1]!.every(cell => !cell.v && cell.f === undefined)) rows.pop()
    const sheet: GridSheet = {
      name: clean(book.name),
      cols: Array.from({ length: width }, (_, k) => colLetters(k + 1)),
      rows,
      isCut: book.isPartial || book.maxRow > MAX_SHEET_ROWS || book.maxCol > MAX_SHEET_COLS,
    }
    if (book.isHidden) sheet.isHidden = true
    return sheet
  })
  const doc: GridResult = { kind: 'grid', sheets }
  const notes: string[] = []
  if (notCalculated > 0) {
    notes.push(
      `${notCalculated} formula cell${notCalculated === 1 ? '' : 's'} couldn’t be calculated here (a function the pane doesn’t know, or too much work); they show as ƒ with no value. Open the file in Excel to see them.`,
    )
  }
  if (isTextCut) notes.push('Some cells hold very long text; it is cut short here.')
  // Charts and pictures aren't drawn: said, so nobody thinks there are none.
  const charts = zip.names.filter(name => /^xl\/charts\/chart\d*\.xml$/i.test(name)).length
  const pictures = zip.names.filter(name => /^xl\/media\//i.test(name) && !name.endsWith('/')).length
  if (charts + pictures > 0) {
    const what = [charts ? `${charts} chart${charts === 1 ? '' : 's'}` : '', pictures ? `${pictures} picture${pictures === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')
    notes.push(`This workbook has ${what}, which the pane doesn’t draw: it shows the cells. Open it in Excel to see ${charts + pictures === 1 ? 'it' : 'them'}.`)
  }
  if (isTruncated && notCalculated > 0) notes.push('This workbook is very large: formulas that reach far beyond the cells shown may not be calculated.')
  if (notes.length > 0) doc.note = notes.join(' ')
  return doc
}
