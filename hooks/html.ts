// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

import type { DocRow, Span, Tone } from '../types'
import { gap, plain, squash, tableRows, trimSpaces } from './format'

/**
 * HTML read into formatted rows: what a reader of the page sees (headings,
 * paragraphs, lists, tables, quotes, code), with styles, scripts and the
 * head left out. Anchors name the element and its source line
 * (`<h1> at line 15`, `<p> #2 at line 15` for the second on that line),
 * which is what Claude edits.
 */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°', plusmn: '±',
  times: '×', divide: '÷', minus: '−', le: '≤', ge: '≥', ne: '≠', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', frac12: '½', frac14: '¼', frac34: '¾', check: '✓', hearts: '♥',
}

const REPLACEMENT = String.fromCharCode(0xfffd)
const fromCode = (code: number) => {
  try {
    return String.fromCodePoint(code)
  } catch {
    return REPLACEMENT
  }
}
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,9}|\w{1,32});/gi, (whole, code: string) =>
    code[0] !== '#' ? (ENTITIES[code.toLowerCase()] ?? whole) : fromCode(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))),
  )

const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'table', 'ul', 'ol', 'hr', 'figure', 'figcaption', 'dt', 'dd', 'form', 'label', 'button', 'details', 'summary'])
const HIDDEN = /^(script|style|head|title|template|svg|noscript)$/

/** A tag (its attributes may quote a ">"), a declaration, text, or a lone "<". */
const TOKEN = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]{0,2000}"|'[^']{0,2000}'){0,400})\/?>|<[!?][^>]{0,2000}>|([^<]+)|(<)/g

type Open = { tag: string; attrs: string }

export function htmlRows(source: string): DocRow[] {
  const html = source.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
  const lower = html.toLowerCase()
  // Where each line starts, for a binary search from an offset to its line.
  const starts = [0]
  for (let at = html.indexOf('\n'); at >= 0; at = html.indexOf('\n', at + 1)) starts.push(at + 1)
  const lineAt = (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const rows: DocRow[] = []
  let heading: string | null = null
  let spans: Span[] = []
  let blockTag = 'p'
  let blockLine = 1
  let tone: Tone | undefined
  const stack: Open[] = []
  const lists: { ordered: boolean; n: number }[] = []
  let table: { cells: Span[][][]; header: number; isFirstRowTh: boolean; line: number; rowLines: number[] } | null = null
  let cell: Span[] | null = null
  let span = 1
  /** Elements of one tag already named on one line: the second is "#2". */
  const named = new Map<string, number>()

  const where = (tag: string, line: number) => {
    const key = `${tag}@${line}`
    const n = (named.get(key) ?? 0) + 1
    named.set(key, n)
    return `<${tag}>${n > 1 ? ` #${n}` : ''} at line ${line}${heading ? ` (under "${heading}")` : ''}`
  }
  const styleNow = (): Omit<Span, 't'> => {
    const style: Omit<Span, 't'> = {}
    for (const open of stack) {
      if (/^(b|strong|th)$/.test(open.tag)) style.b = 1
      if (/^(i|em|cite)$/.test(open.tag)) style.i = 1
      if (/^(code|kbd|samp|pre)$/.test(open.tag)) style.c = 1
      if (open.tag === 'a') style.l = 1
      if (/^(s|del|strike)$/.test(open.tag)) style.s = 1
    }
    return style
  }
  const flush = () => {
    const isPre = blockTag === 'pre'
    const content = isPre ? spans : squash(spans)
    spans = []
    if (plain(content).trim() === '') return
    if (isPre) {
      gap(rows)
      for (const [k, line] of plain(content).replace(/^\n/, '').split('\n').entries()) {
        rows.push({ text: line, anchor: where('pre', blockLine + k), style: 'code', unit: 'element', spans: [{ t: line || ' ', c: 1 }] })
      }
      gap(rows)
      return
    }
    const level = /^h[1-6]$/.test(blockTag) ? Number(blockTag[1]) : 0
    if (level > 0) {
      heading = plain(content).trim()
      gap(rows)
      const anchor = where(blockTag, blockLine)
      rows.push({ text: heading, anchor, style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', unit: 'element', spans: content })
      if (level === 1) rows.push({ text: '', anchor, style: 'rule', unit: 'element' })
      return
    }
    if (blockTag === 'li') {
      const list = lists[lists.length - 1]
      const marker = list?.ordered ? `${list.n}.` : '•'
      const previous = rows[rows.length - 1]
      if (previous && previous.style !== 'li' && previous.style !== 'space') gap(rows)
      rows.push({ text: plain(content), anchor: where('li', blockLine), style: 'li', unit: 'element', spans: content, indent: Math.max(0, lists.length - 1), marker })
      return
    }
    gap(rows)
    const anchor = where(blockTag, blockLine)
    if (tone) rows.push({ text: plain(content), anchor, style: 'panel', unit: 'element', spans: content, tone })
    else rows.push({ text: plain(content), anchor, style: blockTag === 'blockquote' ? 'quote' : 'p', unit: 'element', spans: content })
  }

  const body = /<body[\s>]/.exec(lower)
  TOKEN.lastIndex = body ? body.index : 0
  let skip: string | null = null

  for (let match = TOKEN.exec(html); match; match = TOKEN.exec(html)) {
    const [whole, closing, rawTag, attrs = '', text, lone] = match
    if (text !== undefined || lone !== undefined) {
      if (skip) continue
      const piece = { ...styleNow(), t: decode(text ?? '<') }
      if (cell) cell.push(piece)
      else spans.push(piece)
      continue
    }
    if (rawTag === undefined) continue
    const tag = rawTag.toLowerCase()
    if (skip) {
      if (closing && tag === skip) skip = null
      continue
    }
    // Hidden content: only when it is closed, so an unclosed <head> does not hide the page.
    if (!closing && HIDDEN.test(tag) && !whole.endsWith('/>') && lower.indexOf(`</${tag}`, TOKEN.lastIndex) >= 0) {
      skip = tag
      continue
    }
    if (!closing && (tag === 'head' || tag === 'title')) continue
    const line = lineAt(match.index)
    if (tag === 'br') {
      if (cell) cell.push({ t: ' ' })
      else {
        flush()
        blockLine = line
      }
      continue
    }
    if (tag === 'img' && !closing) {
      const alt = attrs.match(/alt\s*=\s*"([^"]*)"/i)?.[1]
      ;(cell ?? spans).push({ t: `[image${alt ? `: ${decode(alt)}` : ''}]`, d: 1 })
      continue
    }
    if (tag === 'hr' && !closing) {
      flush()
      gap(rows)
      rows.push({ text: '', anchor: where('hr', line), style: 'rule', unit: 'element' })
      continue
    }

    if (table && /^(td|th)$/.test(tag)) {
      if (!closing) {
        cell = []
        span = Math.min(10, Math.max(1, Number(attrs.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1)))
        if (tag === 'th' && table.cells.length === 1) table.isFirstRowTh = true
        stack.push({ tag, attrs })
      } else {
        const last = table.cells[table.cells.length - 1]
        if (last && cell) {
          last.push(squash(cell))
          // A cell across several columns: the ones it covers stay blank, so later cells keep their headers.
          for (let k = 1; k < span; k += 1) last.push([])
        }
        cell = null
        span = 1
        if (stack[stack.length - 1]?.tag === tag) stack.pop()
      }
      continue
    }
    if (table && tag === 'tr') {
      if (!closing) {
        table.cells.push([])
        table.rowLines.push(line)
      }
      continue
    }
    if (tag === 'thead' && table) {
      if (closing) table.header = table.cells.length
      continue
    }
    if (tag === 'table') {
      if (!closing) {
        flush()
        table = { cells: [], header: 0, isFirstRowTh: false, line, rowLines: [] }
      } else if (table) {
        const t = table
        const header = t.header || (t.isFirstRowTh ? 1 : 0)
        gap(rows)
        rows.push(...tableRows(t.cells.filter(row => row.length > 0), header, r => where('tr', t.rowLines[r] ?? t.line), 'element'))
        gap(rows)
        table = null
      }
      continue
    }

    if (BLOCKS.has(tag)) {
      flush()
      if (tag === 'ul' || tag === 'ol') {
        if (!closing) lists.push({ ordered: tag === 'ol', n: 0 })
        else lists.pop()
      }
      if (!closing && tag === 'li') {
        const list = lists[lists.length - 1]
        if (list) list.n += 1
      }
      if (!closing && /class\s*=\s*["'][^"']*\b(info|note|warning|error|success|tip|alert|callout)\b/i.test(attrs)) {
        const kind = attrs.match(/\b(info|note|warning|error|success|tip)\b/i)?.[1]?.toLowerCase()
        tone = (kind as Tone | undefined) ?? 'note'
      } else if (closing && tone && /^(div|aside|section)$/.test(tag)) tone = undefined
      blockTag = closing ? 'p' : tag
      blockLine = line
      continue
    }

    // Inline tags left open pile up on a broken page: only the newest hundred count.
    if (!closing) stack.push({ tag, attrs }) > 100 && stack.shift()
    else {
      const at = stack.map(open => open.tag).lastIndexOf(tag)
      if (at >= 0) stack.splice(at, 1)
    }
  }
  flush()

  return trimSpaces(rows)
}
