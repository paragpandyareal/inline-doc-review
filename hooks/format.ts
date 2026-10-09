import type { DocRow, Span } from '../types'
import { cutTo, strWidth } from './text'

/** Pieces the Markdown, HTML and ADF readers share. */

export const plain = (spans: Span[]) => spans.map(span => span.t).join('')

/** Joins neighbouring spans that look the same, and drops empty ones. */
export function tidy(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    if (span.t === '') continue
    const last = out[out.length - 1]
    const same = last && last.b === span.b && last.i === span.i && last.c === span.c && last.l === span.l && last.s === span.s && last.d === span.d
    if (last && same) last.t += span.t
    else out.push({ ...span })
  }
  return out
}

/** Collapses runs of whitespace to one space, as a page would show them. */
export function squash(spans: Span[]): Span[] {
  const out = spans.map(span => ({ ...span, t: span.c ? span.t : span.t.replace(/\s+/g, ' ') }))
  if (out[0]) out[0].t = out[0].t.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last) last.t = last.t.replace(/\s+$/, '')
  return tidy(out)
}

/** Backslash escapes are held as private-use characters while emphasis is read, then put back. */
const hold = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, (_, ch: string) => String.fromCharCode(0xe000 + ch.charCodeAt(0)))
const release = (text: string) => text.replace(/[\ue000-\ue07f]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xe000))

/** Inline Markdown longer than this is shown as written: no emphasis worth the time. */
const INLINE_MAX = 5000

/**
 * `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[text](url)`, `~~strike~~`,
 * `<br>` and backslash escapes. Every run is bounded and stays on one line, so
 * no input makes the patterns backtrack for long; `_` marks italics only at
 * word edges, so `my_var_name` stays as written.
 */
export function markdownInline(text: string): Span[] {
  if (text.length > INLINE_MAX) return [{ t: text }]
  return tidy(emphasis(hold(text)).map(span => ({ ...span, t: release(span.t) })))
}

const INLINE =
  /(\*\*|__)(?=\S)([^\n]{1,500}?)(?<=\S)\1|(?<![\w*])\*(?=[^\s*])([^\n*]{1,500}?)(?<=\S)\*(?!\*)|(?<![A-Za-z0-9_])_(?=[^\s_])([^\n_]{1,500}?)(?<=\S)_(?![A-Za-z0-9_])|`([^`\n]{1,500})`|!?\[([^\]\n]{0,300})\]\(([^)\n]{0,500})\)|~~(?=\S)([^\n]{1,500}?)~~|<br\s*\/?>/g

function emphasis(text: string): Span[] {
  const out: Span[] = []
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > at) out.push({ t: text.slice(at, index) })
    if (match[2] !== undefined) out.push(...emphasis(match[2]).map(span => ({ ...span, b: 1 as const })))
    else if (match[3] !== undefined) out.push(...emphasis(match[3]).map(span => ({ ...span, i: 1 as const })))
    else if (match[4] !== undefined) out.push(...emphasis(match[4]).map(span => ({ ...span, i: 1 as const })))
    else if (match[5] !== undefined) out.push({ t: match[5], c: 1 })
    else if (match[6] !== undefined) out.push({ t: match[6] || match[7] || 'link', l: 1 })
    else if (match[8] !== undefined) out.push({ t: match[8], s: 1 })
    else out.push({ t: ' ' })
    at = index + match[0].length
  }
  if (at < text.length) out.push({ t: text.slice(at) })
  return out
}

/**
 * Lays a table out with each column as wide as its widest cell (to a cap),
 * cells padded and joined by a dim bar, the header row bold.
 */
export function tableRows(
  cells: Span[][][],
  headerRows: number,
  anchorOf: (row: number) => string,
  unit: string,
): DocRow[] {
  const columns = Math.max(0, ...cells.map(row => row.length))
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.min(36, Math.max(1, ...cells.map(row => strWidth(plain(row[c] ?? []))))),
  )
  return cells.map((row, r) => {
    const spans: Span[] = []
    for (let c = 0; c < columns; c += 1) {
      const cell = row[c] ?? []
      const width = widths[c] ?? 1
      let used = 0
      for (const span of cell) {
        const room = width - used
        if (room <= 0) break
        const t = cutTo(span.t, room)
        spans.push(r < headerRows ? { ...span, t, b: 1 } : { ...span, t })
        used += strWidth(t)
      }
      spans.push({ t: ' '.repeat(Math.max(0, width - used)) })
      if (c < columns - 1) spans.push({ t: '  │  ', d: 1 })
    }
    return {
      text: row.map(cell => plain(cell)).join(' | '),
      anchor: anchorOf(r),
      style: r < headerRows ? 'th' : 'td',
      unit,
      spans: tidy(spans),
    }
  })
}

/** A blank row between blocks, carrying the block before it. */
export const spacer = (before: DocRow | undefined): DocRow => ({
  text: '',
  anchor: before?.anchor ?? '',
  style: 'space',
  unit: before?.unit ?? 'line',
})

/** Adds a blank row after the last block, unless there is one already. */
export function gap(rows: DocRow[]) {
  const last = rows[rows.length - 1]
  if (last && last.style !== 'space') rows.push(spacer(last))
}

/** Drops blank rows at either end. */
export function trimSpaces(rows: DocRow[]): DocRow[] {
  let a = 0
  let b = rows.length
  while (a < b && rows[a]?.style === 'space') a += 1
  while (b > a && rows[b - 1]?.style === 'space') b -= 1
  return a === 0 && b === rows.length ? rows : rows.slice(a, b)
}
