import type { DocRow, Span, Tone } from '../types'
import { plain, spacer, squash, tableRows } from './format'

/**
 * HTML read into formatted rows: what a reader of the page sees (headings,
 * paragraphs, lists, tables, quotes, code), with styles, scripts and the
 * head left out. Anchors name the element and its source line
 * (`<h1> at line 15`), which is what Claude edits.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code.startsWith('#x') ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? whole),
  )

const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'table', 'ul', 'ol', 'hr', 'figure', 'figcaption', 'dt', 'dd', 'form', 'label', 'button', 'details', 'summary'])

type Open = { tag: string; attrs: string }

export function htmlRows(source: string): DocRow[] {
  const html = source.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
  const lineAt = (offset: number) => html.slice(0, offset).split('\n').length
  const rows: DocRow[] = []
  let heading: string | null = null
  let spans: Span[] = []
  let blockTag = 'p'
  let blockLine = 1
  let tone: Tone | undefined
  const stack: Open[] = []
  const lists: { ordered: boolean; n: number }[] = []
  let table: { cells: Span[][][]; header: number; line: number; rowLines: number[] } | null = null
  let cell: Span[] | null = null

  const where = (tag: string, line: number) => `<${tag}> at line ${line}${heading ? ` (under "${heading}")` : ''}`
  const gap = () => {
    const last = rows[rows.length - 1]
    if (last && last.style !== 'space') rows.push(spacer(last))
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
      gap()
      for (const [k, line] of plain(content).replace(/^\n/, '').split('\n').entries()) {
        rows.push({ text: line, anchor: where('pre', blockLine + k), style: 'code', unit: 'element', spans: [{ t: line || ' ', c: 1 }] })
      }
      gap()
      return
    }
    const level = /^h[1-6]$/.test(blockTag) ? Number(blockTag[1]) : 0
    if (level > 0) {
      heading = plain(content).trim()
      gap()
      rows.push({ text: heading, anchor: where(blockTag, blockLine), style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', unit: 'element', spans: content })
      if (level === 1) rows.push({ text: '', anchor: where(blockTag, blockLine), style: 'rule', unit: 'element' })
      return
    }
    if (blockTag === 'li') {
      const list = lists[lists.length - 1]
      const marker = list?.ordered ? `${list.n}.` : '•'
      const previous = rows[rows.length - 1]
      if (previous && previous.style !== 'li' && previous.style !== 'space') gap()
      rows.push({ text: plain(content), anchor: where('li', blockLine), style: 'li', unit: 'element', spans: content, indent: Math.max(0, lists.length - 1), marker })
      return
    }
    gap()
    if (tone) rows.push({ text: plain(content), anchor: where(blockTag, blockLine), style: 'panel', unit: 'element', spans: content, tone })
    else rows.push({ text: plain(content), anchor: where(blockTag, blockLine), style: blockTag === 'blockquote' ? 'quote' : 'p', unit: 'element', spans: content })
  }

  const body = html.match(/<body[^>]*>/i)
  const startAt = body ? (body.index ?? 0) + body[0].length : 0
  const pattern = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g
  pattern.lastIndex = startAt
  let skip: string | null = null

  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const [, closing, rawTag, attrs = '', text] = match
    if (text !== undefined) {
      if (skip) continue
      const style = styleNow()
      const piece = { ...style, t: decode(text) }
      if (cell) cell.push(piece)
      else spans.push(piece)
      continue
    }
    const tag = (rawTag ?? '').toLowerCase()
    if (skip) {
      if (closing && tag === skip) skip = null
      continue
    }
    if (!closing && /^(script|style|head|title|template|svg|noscript)$/.test(tag)) {
      skip = tag
      continue
    }
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
      const alt = attrs.match(/alt="([^"]*)"/i)?.[1]
      ;(cell ?? spans).push({ t: `[image${alt ? `: ${decode(alt)}` : ''}]`, d: 1 })
      continue
    }
    if (tag === 'hr' && !closing) {
      flush()
      gap()
      rows.push({ text: '', anchor: where('hr', line), style: 'rule', unit: 'element' })
      continue
    }

    if (table && /^(td|th)$/.test(tag)) {
      if (!closing) {
        cell = []
        stack.push({ tag, attrs })
      } else {
        const last = table.cells[table.cells.length - 1]
        if (last && cell) last.push(squash(cell))
        cell = null
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
        table = { cells: [], header: 0, line, rowLines: [] }
      } else if (table) {
        const t = table
        const header = t.header || (/<th[\s>]/i.test(html.slice(html.indexOf('<tr', 0), html.length)) && t.cells[0]?.length ? 1 : 0)
        gap()
        rows.push(...tableRows(t.cells.filter(row => row.length > 0), header, r => where('tr', t.rowLines[r] ?? t.line), 'element'))
        gap()
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
      if (!closing && /class="[^"]*\b(info|note|warning|error|success|tip|alert|callout)\b/i.test(attrs)) {
        const kind = attrs.match(/\b(info|note|warning|error|success|tip)\b/i)?.[1]?.toLowerCase()
        tone = (kind as Tone | undefined) ?? 'note'
      } else if (closing && tone && /^(div|aside|section)$/.test(tag)) tone = undefined
      blockTag = closing ? 'p' : tag
      blockLine = line
      continue
    }

    if (!closing) stack.push({ tag, attrs })
    else {
      const at = stack.map(open => open.tag).lastIndexOf(tag)
      if (at >= 0) stack.splice(at, 1)
    }
  }
  flush()

  while (rows[0]?.style === 'space') rows.shift()
  while (rows[rows.length - 1]?.style === 'space') rows.pop()
  return rows
}
