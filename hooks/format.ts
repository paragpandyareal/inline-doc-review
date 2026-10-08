import type { DocRow, Span } from '../types'

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

/** `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[text](url)`, `~~strike~~`, `<br>` in Markdown. */
export function markdownInline(text: string): Span[] {
  const out: Span[] = []
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`|!?\[([^\]]*)\]\(([^)]*)\)|~~(.+?)~~|<br\s*\/?>/g
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > at) out.push({ t: text.slice(at, index) })
    if (match[2] !== undefined) out.push(...markdownInline(match[2]).map(span => ({ ...span, b: 1 as const })))
    else if (match[4] !== undefined) out.push(...markdownInline(match[4]).map(span => ({ ...span, i: 1 as const })))
    else if (match[5] !== undefined) out.push({ t: match[5], c: 1 })
    else if (match[6] !== undefined) out.push({ t: match[6] || match[7] || 'link', l: 1 })
    else if (match[8] !== undefined) out.push({ t: match[8], s: 1 })
    else out.push({ t: ' ' })
    at = index + match[0].length
  }
  if (at < text.length) out.push({ t: text.slice(at) })
  return tidy(out)
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
    Math.min(28, Math.max(1, ...cells.map(row => plain(row[c] ?? []).length))),
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
        const t = span.t.length > room ? `${span.t.slice(0, Math.max(0, room - 1))}…` : span.t
        spans.push(r < headerRows ? { ...span, t, b: 1 } : { ...span, t })
        used += t.length
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
