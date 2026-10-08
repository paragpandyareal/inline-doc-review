import type { DocRow, Tone } from '../types'
import { markdownInline, plain, spacer, tableRows } from './format'

/**
 * Markdown read into formatted rows: headings, paragraphs (soft-wrapped
 * lines joined), bullet, numbered and task lists, quotes and GitHub-style
 * callouts (`> [!NOTE]`), fenced code, tables and rules.
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

export function markdownRows(source: string): DocRow[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const rows: DocRow[] = []
  let heading: string | null = null
  let i = 0

  const where = (from: number, to: number) => {
    const span = from === to ? `line ${from + 1}` : `lines ${from + 1}–${to + 1}`
    return heading ? `${span} (under "${heading}")` : span
  }
  const gap = () => {
    const last = rows[rows.length - 1]
    if (last && last.style !== 'space') rows.push(spacer(last))
  }
  const isBlockStart = (line: string) =>
    /^\s*$/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*(```|~~~)/.test(line) ||
    /^\s*\|/.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (/^\s*$/.test(line)) {
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

    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      const level = (h[1] ?? '#').length
      const spans = markdownInline(h[2] ?? '')
      heading = plain(spans) || heading
      gap()
      rows.push({ text: plain(spans), anchor: where(i, i), style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', unit: 'line', spans })
      if (level === 1) rows.push({ text: '', anchor: where(i, i), style: 'rule', unit: 'line' })
      i += 1
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      gap()
      rows.push({ text: '', anchor: where(i, i), style: 'rule', unit: 'line' })
      i += 1
      continue
    }

    const fence = line.match(/^\s*(```|~~~)\s*(\S*)/)
    if (fence) {
      const start = i
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence[1] ?? '```')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      gap()
      for (const [k, code] of body.entries()) {
        rows.push({ text: code, anchor: where(start + 1 + k, start + 1 + k), style: 'code', unit: 'line', spans: [{ t: code || ' ', c: 1 }] })
      }
      gap()
      continue
    }

    if (/^\s*\|/.test(line)) {
      const start = i
      const raw: string[][] = []
      let headerRows = 0
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? '')) {
        const cells = (lines[i] ?? '').trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) headerRows = raw.length
        else raw.push(cells)
        i += 1
      }
      const sourceLine: number[] = []
      for (let k = start, n = 0; k < i; k += 1) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[k] ?? '')) sourceLine[n++] = k
      }
      gap()
      rows.push(...tableRows(raw.map(row => row.map(markdownInline)), headerRows, r => where(sourceLine[r] ?? start, sourceLine[r] ?? start), 'line'))
      gap()
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
      gap()
      if (callout) {
        const tone = CALLOUT[(callout[1] ?? '').toUpperCase()] ?? 'note'
        const title = callout[2] || (callout[1] ?? 'Note').charAt(0) + (callout[1] ?? 'note').slice(1).toLowerCase()
        rows.push({ text: title, anchor: where(start, start), style: 'panel', unit: 'line', tone, spans: [{ t: title, b: 1 }] })
        const text = body.slice(1).join(' ').trim()
        if (text) rows.push({ text, anchor: where(start + 1, i - 1), style: 'panel', unit: 'line', tone, spans: markdownInline(text) })
      } else {
        const text = body.join(' ').trim()
        rows.push({ text, anchor: where(start, i - 1), style: 'quote', unit: 'line', spans: markdownInline(text) })
      }
      gap()
      continue
    }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/)
    if (item) {
      const start = i
      const depth = Math.floor((item[1] ?? '').replace(/\t/g, '  ').length / 2)
      let text = item[4] ?? ''
      i += 1
      // Lazy continuation lines belong to the item.
      while (i < lines.length && !isBlockStart(lines[i] ?? '') && /^\s+\S/.test(lines[i] ?? '')) {
        text += ` ${(lines[i] ?? '').trim()}`
        i += 1
      }
      const task = item[3]
      const marker = task ? (/x/i.test(task) ? '☑' : '☐') : /\d/.test(item[2] ?? '') ? `${(item[2] ?? '1.').replace(')', '.')}` : '•'
      const previous = rows[rows.length - 1]
      if (previous && previous.style !== 'li' && previous.style !== 'space') gap()
      const spans = markdownInline(text)
      rows.push({ text: plain(spans), anchor: where(start, i - 1), style: 'li', unit: 'line', spans, indent: depth, marker })
      const next = lines[i] ?? ''
      if (!/^\s*([-*+]|\d+[.)])\s/.test(next) && !/^\s*$/.test(next)) gap()
      continue
    }

    // A paragraph: this line and the ones after it until a blank or a new block.
    const start = i
    let text = line.trim()
    i += 1
    while (i < lines.length && !isBlockStart(lines[i] ?? '')) {
      const previous = lines[i - 1] ?? ''
      text += previous.endsWith('  ') || previous.endsWith('\\') ? `<br>${(lines[i] ?? '').trim()}` : ` ${(lines[i] ?? '').trim()}`
      i += 1
    }
    gap()
    const spans = markdownInline(text)
    rows.push({ text: plain(spans), anchor: where(start, i - 1), style: 'p', unit: 'line', spans })
  }

  while (rows[0]?.style === 'space') rows.shift()
  while (rows[rows.length - 1]?.style === 'space') rows.pop()
  return rows
}
