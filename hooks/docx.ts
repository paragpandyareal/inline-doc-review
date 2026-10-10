// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Reads a Word document (.docx) for the pane: headings, paragraphs with bold,
 * italic, strike-through and links, bulleted and numbered lists, tables, and
 * a placeholder for each picture. Tracked insertions are shown and tracked
 * deletions are not, as Word shows the document with changes accepted.
 */

import type { DocRow, Picture, Span } from '../types'
import { checkTime } from './deadline'
import { decodePicture } from './picture'
import { attr, child, descendants, elements, parseTree, textOf } from './xml'
import type { XmlNode } from './xml'
import { clean } from './xlsx'
import { openZip } from './zip'

const MAX_ROWS = 4000
/** How much of the document's XML is unpacked: 4,000 rows fit well inside it, so a huge document opens as fast as a small one. */
const DOCUMENT_START_BYTES = 24 * 1024 * 1024

/** A row, or a table row with its cells, which the pane lays out as a table. */
export type ReadRow = DocRow & { cells?: string[]; isHeader?: boolean }
export type LinesResult = { kind: 'lines'; rows: ReadRow[]; isFormatted: true; note?: string; pictures?: Picture[] }

/** A picture found in a paragraph: the relationship naming its file (none for a chart or diagram), and what to call it. */
type Found = { rid?: string; label: string; kind?: string }

/** The pictures in a paragraph, in order: drawings, old-style (VML) pictures, charts and diagrams. Deleted ones and fallback copies are left out. */
function picturesIn(node: XmlNode, out: Found[] = []): Found[] {
  for (const c of elements(node)) {
    if (c.name === 'del' || c.name === 'moveFrom' || c.name === 'Fallback') continue
    if (c.name === 'drawing') {
      const doc = descendants(c, 'docPr')[0]
      const label = (attr(doc?.attrs ?? '', 'descr') || attr(doc?.attrs ?? '', 'title') || '').trim()
      const blip = descendants(c, 'blip')[0]
      if (blip) out.push({ rid: attr(blip.attrs, 'embed') ?? '', label })
      else if (descendants(c, 'chart').length > 0) out.push({ label, kind: 'a Word chart' })
      else if (descendants(c, 'relIds').length > 0) out.push({ label, kind: 'a SmartArt diagram' })
      continue
    }
    if (c.name === 'pict' || c.name === 'object') {
      const image = descendants(c, 'imagedata')[0]
      if (image) out.push({ rid: attr(image.attrs, 'id') ?? '', label: (attr(image.attrs, 'title') ?? '').trim() })
      continue
    }
    picturesIn(c, out)
  }
  return out
}

/** Word's built-in style names as python-docx (and Word's own menus) show them. */
const UI_NAMES: Record<string, string> = {
  caption: 'Caption',
  footer: 'Footer',
  header: 'Header',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, k) => [`heading ${k + 1}`, `Heading ${k + 1}`])),
}

/** Whether a run property such as <w:b/> is on (it is, unless its val says 0 or false). */
const isOn = (props: XmlNode | undefined, name: string) => {
  const el = child(props, name)
  if (!el) return false
  const val = attr(el.attrs, 'val')
  return val !== '0' && val !== 'false'
}

/** A paragraph's runs as spans; deleted text is left out, links marked. */
function spansOf(paragraph: XmlNode): Span[] {
  const spans: Span[] = []
  const walk = (node: XmlNode, isLink: boolean) => {
    for (const c of elements(node)) {
      // Deleted text is not shown; of Word's two forms of a drawing (mc:Choice and mc:Fallback), only the first is read.
      if (c.name === 'del' || c.name === 'moveFrom' || c.name === 'Fallback') continue
      if (c.name === 'r') {
        const text = textInRun(c)
        if (!text) continue
        const props = child(c, 'rPr')
        const span: Span = { t: clean(text) }
        if (isOn(props, 'b')) span.b = 1
        if (isOn(props, 'i')) span.i = 1
        if (isOn(props, 'strike')) span.s = 1
        if (isLink) span.l = 1
        spans.push(span)
      } else if (c.name !== 'pPr') {
        walk(c, isLink || c.name === 'hyperlink')
      }
    }
  }
  walk(paragraph, false)
  return spans
}

/** A run's text, with any text box inside it read once (not its fallback copy). */
function textInRun(node: XmlNode): string {
  let out = ''
  for (const c of elements(node)) {
    if (c.name === 'Fallback' || c.name === 'delText') continue
    out += c.name === 't' ? textOf(c) : textInRun(c)
  }
  return out
}

/** A table cell's text as python-docx gives it: its own paragraphs, words separated by single spaces. */
function cellText(tc: XmlNode): string {
  const parts: string[] = []
  const runText = (r: XmlNode) => {
    for (const c of elements(r)) {
      if (c.name === 't') parts.push(textOf(c))
      else if (c.name === 'tab' || c.name === 'ptab') parts.push('\t')
      else if (c.name === 'br' || c.name === 'cr') parts.push('\n')
      else if (c.name === 'noBreakHyphen') parts.push('-')
    }
  }
  for (const p of elements(tc, 'p')) {
    if (picturesIn(p).length > 0) parts.push(' [picture] ')
    for (const c of elements(p)) {
      if (c.name === 'r') runText(c)
      else if (c.name === 'hyperlink' || c.name === 'ins') elements(c, 'r').forEach(runText)
    }
    parts.push('\n')
  }
  return clean(parts.join('').split(/\s+/).filter(Boolean).join(' '))
}

/** The body's paragraphs and tables in order, looking inside content controls. */
function blocksOf(node: XmlNode, out: XmlNode[] = []): XmlNode[] {
  for (const c of elements(node)) {
    if (c.name === 'sdt') {
      const content = child(c, 'sdtContent')
      if (content) blocksOf(content, out)
    } else if (c.name === 'p' || c.name === 'tbl') {
      out.push(c)
    }
  }
  return out
}

export function readDocx(bytes: Uint8Array): LinesResult {
  const zip = openZip(bytes)
  const start = zip.textStart('word/document.xml', DOCUMENT_START_BYTES)
  if (start === null) throw new Error('it is not a Word document')
  const body = child(child(parseTree(start.text), 'document'), 'body')
  if (!body) throw new Error('it is not a Word document')
  const blocks = blocksOf(body)

  // Where each picture's file is: word/media/…, by relationship id.
  const media = new Map<string, string>()
  const relsXml = zip.side('word/_rels/document.xml.rels')
  if (relsXml) {
    for (const rel of descendants(parseTree(relsXml), 'Relationship')) {
      const target = attr(rel.attrs, 'Target') ?? ''
      if (attr(rel.attrs, 'TargetMode') === 'External') continue
      media.set(attr(rel.attrs, 'Id') ?? '', target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/\/[^/]+\/\.\.\//g, '/'))
    }
  }
  const pictures: Picture[] = []
  const addPicture = (found: Found): number => {
    const part = found.rid ? media.get(found.rid) : undefined
    pictures.push({
      label: clean(found.label).slice(0, 200),
      load: () => {
        if (found.kind) return `it is ${found.kind}, which the pane can’t draw`
        const bytes = part ? zip.read(part) : null
        return bytes ? decodePicture(bytes) : 'it is linked from outside the document, so it isn’t in the file'
      },
    })
    return pictures.length - 1
  }
  // Read from its start only, the last block may be cut off part-way: it is left out.
  if (start.isCut) blocks.pop()

  // Style names by id, and the default paragraph style.
  const styleNames = new Map<string, string>()
  let defaultStyle = ''
  const stylesXml = zip.side('word/styles.xml')
  if (stylesXml) {
    for (const style of descendants(parseTree(stylesXml), 'style')) {
      if (attr(style.attrs, 'type') !== 'paragraph') continue
      const raw = attr(child(style, 'name')?.attrs ?? '', 'val') ?? ''
      const name = UI_NAMES[raw] ?? raw
      const id = attr(style.attrs, 'styleId') ?? ''
      styleNames.set(id, name)
      if (['1', 'true'].includes(attr(style.attrs, 'default') ?? '')) defaultStyle = name
    }
  }

  // List formats: numId → abstractNum → per level, whether it is numbered (not a bullet).
  const numbered = new Map<string, Map<number, boolean>>()
  const numberingXml = zip.side('word/numbering.xml')
  if (numberingXml) {
    const tree = parseTree(numberingXml)
    const abstract = new Map<string, Map<number, boolean>>()
    for (const a of descendants(tree, 'abstractNum')) {
      const levels = new Map<number, boolean>()
      for (const lvl of elements(a, 'lvl')) {
        const fmt = attr(child(lvl, 'numFmt')?.attrs ?? '', 'val')
        levels.set(Number(attr(lvl.attrs, 'ilvl') ?? 0), fmt !== undefined && fmt !== 'bullet' && fmt !== 'none')
      }
      abstract.set(attr(a.attrs, 'abstractNumId') ?? '', levels)
    }
    for (const num of descendants(tree, 'num')) {
      const levels = abstract.get(attr(child(num, 'abstractNumId')?.attrs ?? '', 'val') ?? '')
      if (levels) numbered.set(attr(num.attrs, 'numId') ?? '', levels)
    }
  }

  const rows: ReadRow[] = []
  let heading: string | null = null
  let paragraphIndex = 0
  let tableIndex = 0
  let numbers = new Map<number, number>()
  let hasTitle = false
  let isCut = start.isCut
  const space = () => {
    const last = rows[rows.length - 1]
    if (last && last.style !== 'space') rows.push({ text: '', anchor: last.anchor, style: 'space', unit: last.unit ?? 'paragraph' })
  }

  for (const block of blocks) {
    checkTime()
    if (rows.length >= MAX_ROWS) {
      isCut = true
      break
    }
    if (block.name === 'p') {
      paragraphIndex += 1
      const spans = spansOf(block)
      const text = spans.map(s => s.t).join('').trim()
      const found = picturesIn(block)
      // Each picture gets a row of its own, after the paragraph's text: selecting it shows it.
      const pictureRows = () => {
        for (const one of found) {
          const pic = addPicture(one)
          const name = `Picture ${pic + 1}${one.label ? `: ${clean(one.label).slice(0, 200)}` : ''}`
          const under = heading ? ` (under "${heading}")` : ''
          space()
          rows.push({ text: `[${name}]`, anchor: `paragraph ${paragraphIndex}, picture ${pic + 1}${under}`, unit: 'paragraph', style: 'p', pic, spans: [{ t: `▣ ${name}`, d: 1 }] })
        }
      }
      if (!text) {
        pictureRows()
        continue
      }
      const pPr = child(block, 'pPr')
      const styleId = attr(child(pPr, 'pStyle')?.attrs ?? '', 'val')
      const style = (styleId !== undefined ? styleNames.get(styleId) : undefined) ?? defaultStyle
      // A document with a Title uses it as the top level; its Heading 1s sit one below.
      hasTitle ||= style === 'Title'
      const digits = /(\d+)/.exec(style)
      const level = style === 'Title' ? 1 : style.startsWith('Heading') ? Math.min(3, (digits ? Number(digits[1]) : 3) + (hasTitle ? 1 : 0)) : 0
      const under = heading && !level ? ` (under "${heading}")` : ''
      const row: DocRow = { text, anchor: `paragraph ${paragraphIndex}${under}`, unit: 'paragraph', spans }
      let kind: [number, boolean] | null = null
      const numPr = child(pPr, 'numPr')
      if (numPr) {
        const depth = Number(attr(child(numPr, 'ilvl')?.attrs ?? '', 'val') ?? 0) || 0
        const numId = attr(child(numPr, 'numId')?.attrs ?? '', 'val') ?? ''
        kind = [depth, numbered.get(numId)?.get(depth) ?? false]
      } else if (style.includes('List')) {
        const depthMatch = /(\d+)$/.exec(style)
        kind = [depthMatch ? Math.max(0, Number(depthMatch[1]) - 1) : 0, style.includes('Number')]
      }
      if (level) {
        heading = text
        numbers = new Map()
        space()
        row.style = `h${level}` as DocRow['style']
        rows.push(row)
        if (level === 1) rows.push({ text: '', anchor: row.anchor, style: 'rule', unit: 'paragraph' })
      } else if (kind) {
        const [depth, isNumbered] = kind
        for (const deeper of [...numbers.keys()].filter(d => d > depth)) numbers.delete(deeper)
        const last = rows[rows.length - 1]
        if (last && last.style !== 'li' && last.style !== 'space') space()
        if (isNumbered) numbers.set(depth, (numbers.get(depth) ?? 0) + 1)
        Object.assign(row, { style: 'li', indent: depth, marker: isNumbered ? `${numbers.get(depth)}.` : ['•', '◦', '▪'][depth % 3] })
        rows.push(row)
      } else {
        numbers = new Map()
        space()
        row.style = style.includes('Quote') ? 'quote' : 'p'
        rows.push(row)
      }
      pictureRows()
    } else {
      tableIndex += 1
      numbers = new Map()
      space()
      // Each row's cells; a vertically merged cell repeats the text of the one above it, as python-docx gives it.
      const above: (XmlNode | undefined)[] = []
      elements(block, 'tr').forEach((tr, r) => {
        const cells: string[] = []
        let gridCol = 0
        for (const tc of elements(tr, 'tc')) {
          const props = child(tc, 'tcPr')
          // Word's own limit is 63 columns: a larger span is a damaged (or hostile) file.
          const span = Math.min(64, Math.max(1, Number(attr(child(props, 'gridSpan')?.attrs ?? '', 'val') ?? 1) || 1))
          if (gridCol > 4096) break
          const vMerge = child(props, 'vMerge')
          const isContinue = vMerge !== undefined && (attr(vMerge.attrs, 'val') ?? 'continue') === 'continue'
          const source = isContinue ? (above[gridCol] ?? tc) : tc
          for (let k = 0; k < span; k += 1) above[gridCol + k] = source
          gridCol += span
          cells.push(cellText(source))
        }
        rows.push({ text: cells.join(' | '), cells, isHeader: r === 0, anchor: `table ${tableIndex}, row ${r + 1}`, unit: 'table row' })
      })
      space()
    }
  }
  while (rows.length > 0 && rows[rows.length - 1]!.style === 'space') rows.pop()
  const doc: LinesResult = { kind: 'lines', rows, isFormatted: true, ...(pictures.length > 0 ? { pictures } : {}) }
  if (isCut) doc.note = rows.length >= MAX_ROWS ? `Only the first ${MAX_ROWS} rows of this document are shown.` : 'This document is very long: only its first part is shown.'
  return doc
}
