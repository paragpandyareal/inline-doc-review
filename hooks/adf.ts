import type { DocRow, Span, Tone } from '../types'
import { plain, spacer, tableRows, tidy } from './format'

/**
 * Atlassian Document Format (the JSON Confluence and Jira pages are stored
 * and published as) read into formatted rows: headings, paragraphs with
 * their marks, lists, task lists, panels, quotes, code, tables and rules.
 *
 * Every row's anchor carries the node's JSON path (`content[3].content[1]`)
 * and its nearest heading, so a comment tells Claude exactly which node to
 * edit.
 */

type AdfMark = { type?: string; attrs?: Record<string, unknown> }
type AdfNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: AdfMark[]
  content?: AdfNode[]
}

/** Whether parsed JSON is an ADF document: `{ type: "doc", content: [...] }`. */
export function isAdf(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && (value as AdfNode).type === 'doc' && Array.isArray((value as AdfNode).content)
}

const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))

/** Inline content with its marks: text, mentions, emoji, status lozenges, dates, links. */
function inline(nodes: AdfNode[] | undefined): Span[] {
  const out: Span[] = []
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text': {
        const span: Span = { t: node.text ?? '' }
        for (const mark of node.marks ?? []) {
          if (mark.type === 'strong') span.b = 1
          if (mark.type === 'em') span.i = 1
          if (mark.type === 'code') span.c = 1
          if (mark.type === 'link') span.l = 1
          if (mark.type === 'strike') span.s = 1
        }
        out.push(span)
        break
      }
      case 'hardBreak':
        out.push({ t: ' ' })
        break
      case 'mention':
        out.push({ t: `@${str(node.attrs?.text).replace(/^@/, '') || 'someone'}`, l: 1 })
        break
      case 'emoji':
        out.push({ t: str(node.attrs?.text) || str(node.attrs?.shortName) })
        break
      case 'status':
        out.push({ t: ` ${str(node.attrs?.text).toUpperCase()} `, b: 1, c: 1 })
        break
      case 'date': {
        const ms = Number(node.attrs?.timestamp)
        out.push({ t: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'date', c: 1 })
        break
      }
      case 'inlineCard':
        out.push({ t: str(node.attrs?.url) || 'link', l: 1 })
        break
      case 'placeholder':
        out.push({ t: str(node.attrs?.text), d: 1 })
        break
      default:
        if (node.content) out.push(...inline(node.content))
    }
  }
  return tidy(out)
}

const TONES: Record<string, Tone> = { info: 'info', note: 'note', warning: 'warning', error: 'error', success: 'success', tip: 'tip' }
const TONE_TITLE: Record<Tone, string> = { info: 'Info', note: 'Note', warning: 'Warning', error: 'Important', success: 'Success', tip: 'Tip' }

export function adfRows(doc: AdfNode): DocRow[] {
  const rows: DocRow[] = []
  let heading: string | null = null

  const where = (path: string) => `${path}${heading ? ` (under "${heading}")` : ''}`
  const gap = () => {
    const last = rows[rows.length - 1]
    if (last && last.style !== 'space') rows.push(spacer(last))
  }
  const row = (spans: Span[], path: string, extra: Partial<DocRow>) => {
    rows.push({ text: plain(spans), anchor: where(path), unit: 'node', spans, style: 'p', ...extra })
  }

  /** Walks a block node; `tone` and `depth` carry a panel's colour and a list's nesting. */
  const walk = (node: AdfNode, path: string, ctx: { tone?: Tone; depth: number; quote?: boolean }) => {
    const kids = node.content ?? []
    const styleFor = (): DocRow['style'] => (ctx.tone ? 'panel' : ctx.quote ? 'quote' : 'p')
    switch (node.type) {
      case 'heading': {
        const spans = inline(kids)
        heading = plain(spans).trim() || heading
        const level = Number(node.attrs?.level ?? 1)
        if (!ctx.tone) gap()
        row(spans, path, { style: ctx.tone ? 'panel' : level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3', ...(ctx.tone ? { tone: ctx.tone } : {}) })
        if (level <= 1 && !ctx.tone) rows.push({ text: '', anchor: where(path), unit: 'node', style: 'rule' })
        return
      }
      case 'paragraph': {
        const spans = inline(kids)
        if (plain(spans).trim() === '') return
        if (!ctx.tone && ctx.depth === 0) gap()
        row(spans, path, { style: styleFor(), ...(ctx.tone ? { tone: ctx.tone } : {}) })
        return
      }
      case 'rule':
        gap()
        rows.push({ text: '', anchor: where(path), unit: 'node', style: 'rule' })
        return
      case 'codeBlock': {
        gap()
        const code = plain(inline(kids))
        for (const line of code.split('\n')) rows.push({ text: line, anchor: where(path), unit: 'node', style: 'code', spans: [{ t: line || ' ', c: 1 }] })
        gap()
        return
      }
      case 'blockquote':
        gap()
        kids.forEach((kid, i) => walk(kid, `${path}.content[${i}]`, { ...ctx, quote: true }))
        return
      case 'panel': {
        const tone = TONES[str(node.attrs?.panelType)] ?? 'note'
        gap()
        row([{ t: TONE_TITLE[tone], b: 1 }], path, { style: 'panel', tone })
        kids.forEach((kid, i) => walk(kid, `${path}.content[${i}]`, { ...ctx, tone }))
        gap()
        return
      }
      case 'expand':
      case 'nestedExpand':
        gap()
        row([{ t: `▾ ${str(node.attrs?.title) || 'Details'}`, b: 1 }], path, { style: 'h3' })
        kids.forEach((kid, i) => walk(kid, `${path}.content[${i}]`, ctx))
        return
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
      case 'decisionList': {
        if (ctx.depth === 0 && !ctx.tone) gap()
        const start = Number(node.attrs?.order ?? 1) || 1
        kids.forEach((item, i) => {
          const itemPath = `${path}.content[${i}]`
          const marker =
            node.type === 'orderedList'
              ? `${start + i}.`
              : node.type === 'taskList'
                ? item.attrs?.state === 'DONE'
                  ? '☑'
                  : '☐'
                : node.type === 'decisionList'
                  ? '◆'
                  : ['•', '◦', '▪'][ctx.depth % 3] ?? '•'
          if (item.type === 'taskItem' || item.type === 'decisionItem') {
            const spans = inline(item.content)
            row(spans, itemPath, { style: 'li', indent: ctx.depth, marker, ...(item.attrs?.state === 'DONE' ? { spans: spans.map(s => ({ ...s, d: 1 as const })) } : {}) })
            return
          }
          ;(item.content ?? []).forEach((kid, j) => {
            const kidPath = `${itemPath}.content[${j}]`
            if (j === 0 && kid.type === 'paragraph') row(inline(kid.content), kidPath, { style: 'li', indent: ctx.depth, marker })
            else walk(kid, kidPath, { ...ctx, depth: ctx.depth + 1 })
          })
        })
        return
      }
      case 'table': {
        gap()
        const cells = kids.map(r => (r.content ?? []).map(c => tidy((c.content ?? []).flatMap((part, k) => [...(k > 0 ? [{ t: ' ' }] : []), ...inline(part.content ?? [part])]))))
        const header = (kids[0]?.content ?? []).every(c => c.type === 'tableHeader') ? 1 : 0
        rows.push(...tableRows(cells, header, r => where(`${path}.content[${r}]`), 'node'))
        gap()
        return
      }
      case 'mediaSingle':
      case 'mediaGroup':
      case 'media': {
        const media = node.type === 'media' ? node : kids.find(kid => kid.type === 'media')
        gap()
        row([{ t: `▣ image${media?.attrs?.alt ? `: ${str(media.attrs.alt)}` : ''}`, d: 1 }], path, { style: 'p' })
        return
      }
      case 'extension':
      case 'bodiedExtension':
        gap()
        row([{ t: `⚙ ${str(node.attrs?.extensionKey) || 'macro'}`, d: 1 }], path, { style: 'p' })
        return
      case 'blockCard':
      case 'embedCard':
        gap()
        row([{ t: str(node.attrs?.url) || 'link', l: 1 }], path, { style: 'p' })
        return
      default:
        kids.forEach((kid, i) => walk(kid, `${path}.content[${i}]`, ctx))
    }
  }

  ;(doc.content ?? []).forEach((node, i) => walk(node, `content[${i}]`, { depth: 0 }))
  while (rows[0]?.style === 'space') rows.shift()
  while (rows[rows.length - 1]?.style === 'space') rows.pop()
  return rows
}
