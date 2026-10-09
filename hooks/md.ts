import type { DocRow, Tone } from '../types'
import { gap, markdownInline, plain, tableRows, trimSpaces } from './format'

/**
 * Markdown read into formatted rows: headings (# and underlined), paragraphs
 * (soft-wrapped lines joined), bullet, numbered and task lists, quotes and
 * GitHub-style callouts (`> [!NOTE]`), fenced code, tables and rules.
 *
 * Anchors name the source lines (`lines 12–14 (under "Budget")`), which is
 * what Claude edits.
 */

const CALLOUT: Record<string, Tone> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warning',
  CAUTION: 'error',
  INFO: 'info',
}

const BLANK = /^\s*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?(.*)$/
const SETEXT = /^ {0,3}(=+|-+)\s*$/
/** A table's delimiter row: `|---|:-:|`, `--|--`, single dashes allowed. */
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** A table row's cells: outer pipes dropped, split on pipes that are not escaped. */
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'))

export function markdownRows(source: string): DocRow[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const rows: DocRow[] = []
  let heading: string | null = null
  /** The indents of the list levels open now: an item's depth is its place here. */
  let levels: number[] = []
  let i = 0

  const where = (from: number, to: number) => {
    const span = from === to ? `line ${from + 1}` : `lines ${from + 1}–${to + 1}`
    return heading ? `${span} (under "${heading}")` : span
  }
  const isTableStart = (at: number) => {
    const line = lines[at] ?? ''
    const next = lines[at + 1] ?? ''
    return /^\s*\|/.test(line) || (line.includes('|') && next.includes('|') && next.includes('-') && DELIMITER.test(next))
  }
  const isBlockStart = (at: number) => {
    const line = lines[at] ?? ''
    return BLANK.test(line) || HEADING.test(line) || ITEM.test(line) || /^\s*>/.test(line) || FENCE.test(line) || RULE.test(line) || isTableStart(at)
  }
  const pushHeading = (level: number, text: string, from: number, to: number) => {
    const spans = markdownInline(text)
    heading = plain(spans) || heading
    gap(rows)
    const anchor = where(from, to)
    rows.push({ text: plain(spans), anchor, style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', unit: 'line', spans })
    if (level === 1) rows.push({ text: '', anchor, style: 'rule', unit: 'line' })
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (BLANK.test(line)) {
      i += 1
      continue
    }

    // Front matter at the very top: skip it.
    if (i === 0 && line === '---') {
      const end = lines.indexOf('---', 1)
      if (end > 0) {
        i = end + 1
        continue
      }
    }

    const isItem = ITEM.test(line)
    if (!isItem) levels = []

    const h = line.match(HEADING)
    if (h) {
      if (h[2]) pushHeading((h[1] ?? '#').length, h[2], i, i)
      i += 1
      continue
    }

    if (RULE.test(line)) {
      gap(rows)
      rows.push({ text: '', anchor: where(i, i), style: 'rule', unit: 'line' })
      i += 1
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      // Closed only by the same character, at least as many, and nothing after it.
      const mark = fence[1] ?? '```'
      const closes = new RegExp(`^\\s*${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`)
      const start = i
      const body: string[] = []
      i += 1
      while (i < lines.length && !closes.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      gap(rows)
      for (const [k, code] of body.entries()) {
        rows.push({ text: code, anchor: where(start + 1 + k, start + 1 + k), style: 'code', unit: 'line', spans: [{ t: code || ' ', c: 1 }] })
      }
      gap(rows)
      continue
    }

    if (isTableStart(i)) {
      const start = i
      const raw: string[][] = []
      const sourceLine: number[] = []
      let headerRows = 0
      while (i < lines.length && !BLANK.test(lines[i] ?? '') && (lines[i] ?? '').includes('|')) {
        const text = lines[i] ?? ''
        // Only the second line can be the delimiter: a later row of dashes is data.
        if (i === start + 1 && DELIMITER.test(text) && text.includes('-')) headerRows = raw.length
        else {
          raw.push(cellsOf(text))
          sourceLine.push(i)
        }
        i += 1
      }
      gap(rows)
      rows.push(...tableRows(raw.map(row => row.map(markdownInline)), headerRows, r => where(sourceLine[r] ?? start, sourceLine[r] ?? start), 'line'))
      gap(rows)
      continue
    }

    if (/^\s*>/.test(line)) {
      const start = i
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i += 1
      }
      const callout = body[0]?.match(/^\[!(\w+)\]\s*(.*)$/)
      gap(rows)
      if (callout) {
        const tone = CALLOUT[(callout[1] ?? '').toUpperCase()] ?? 'note'
        const title = callout[2] || (callout[1] ?? 'Note').charAt(0) + (callout[1] ?? 'note').slice(1).toLowerCase()
        rows.push({ text: title, anchor: where(start, start), style: 'panel', unit: 'line', tone, spans: [{ t: title, b: 1 }] })
        const text = body.slice(1).join(' ').trim()
        if (text) rows.push({ text: plain(markdownInline(text)), anchor: where(start + 1, i - 1), style: 'panel', unit: 'line', tone, spans: markdownInline(text) })
      } else {
        const spans = markdownInline(body.join(' ').trim())
        rows.push({ text: plain(spans), anchor: where(start, i - 1), style: 'quote', unit: 'line', spans })
      }
      gap(rows)
      continue
    }

    const item = line.match(ITEM)
    if (item) {
      const start = i
      const indent = (item[1] ?? '').replace(/\t/g, '    ').length
      while (levels.length > 0 && (levels[levels.length - 1] ?? 0) > indent) levels.pop()
      if (levels.length === 0 || (levels[levels.length - 1] ?? 0) < indent) levels.push(indent)
      const depth = levels.length - 1
      let text = item[4] ?? ''
      i += 1
      // Lazy continuation lines belong to the item.
      while (i < lines.length && !isBlockStart(i) && /^\s+\S/.test(lines[i] ?? '')) {
        text += ` ${(lines[i] ?? '').trim()}`
        i += 1
      }
      const task = item[3]
      const marker = task ? (/x/i.test(task) ? '☑' : '☐') : /\d/.test(item[2] ?? '') ? `${(item[2] ?? '1.').replace(')', '.')}` : '•'
      const previous = rows[rows.length - 1]
      if (previous && previous.style !== 'li' && previous.style !== 'space') gap(rows)
      const spans = markdownInline(text)
      rows.push({ text: plain(spans), anchor: where(start, i - 1), style: 'li', unit: 'line', spans, indent: depth, marker })
      const next = lines[i] ?? ''
      if (!ITEM.test(next) && !BLANK.test(next)) gap(rows)
      continue
    }

    // A paragraph: this line and the ones after it until a blank or a new block,
    // or an underline (=== or ---) that makes it a heading.
    const start = i
    let text = line.trim()
    i += 1
    let level = 0
    while (i < lines.length) {
      const underline = (lines[i] ?? '').match(SETEXT)
      if (underline) {
        level = underline[1]?.startsWith('=') ? 1 : 2
        break
      }
      if (isBlockStart(i)) break
      const previous = lines[i - 1] ?? ''
      text += previous.endsWith('  ') || previous.endsWith('\\') ? `<br>${(lines[i] ?? '').trim()}` : ` ${(lines[i] ?? '').trim()}`
      i += 1
    }
    if (level > 0) {
      pushHeading(level, text, start, i)
      i += 1
      continue
    }
    gap(rows)
    const spans = markdownInline(text)
    rows.push({ text: plain(spans), anchor: where(start, i - 1), style: 'p', unit: 'line', spans })
  }

  return trimSpaces(rows)
}
