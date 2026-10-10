// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * A small XML scanner for the parts of Word and Excel files. It reads tags,
 * attributes and text in one pass and builds no tree, so a large sheet
 * costs little. Only the five standard entities and numeric references are
 * decoded: a DOCTYPE and its entities are skipped, never expanded. Namespace
 * prefixes are dropped (`x:row` is `row`), as Office files written by other
 * tools use them.
 */

import { checkTime } from './deadline'

export type XmlHandler = {
  open?: (name: string, attrs: string, isEmpty: boolean) => void | false
  close?: (name: string) => void | false
  text?: (text: string) => void | false
}

const ENTITY = /&(?:(lt|gt|amp|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(ENTITY, (whole, name: string | undefined, dec: string | undefined, hex: string | undefined) => {
    if (name) return NAMED[name] ?? whole
    const code = dec ? Number(dec) : Number.parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  })
}

const localName = (name: string) => {
  const colon = name.indexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

/** One attribute's value from a tag's attribute text, decoded; undefined when absent. Prefixes are ignored (`r:id` is `id`). */
const ATTR_RES = new Map<string, RegExp>()
export function attr(attrs: string, name: string): string | undefined {
  if (attrs === '' || !attrs.includes(name)) return undefined
  let re = ATTR_RES.get(name)
  if (!re) {
    re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`)
    ATTR_RES.set(name, re)
  }
  const m = re.exec(attrs)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined
}

/** Scans `xml`, calling the handler for each tag and run of text. A handler returning false stops the scan. */
export function scanXml(xml: string, handler: XmlHandler): void {
  let at = 0
  const end = xml.length
  while (at < end) {
    const lt = xml.indexOf('<', at)
    if (lt < 0) {
      if (handler.text && handler.text(decodeEntities(xml.slice(at))) === false) return
      break
    }
    if (lt > at && handler.text && handler.text(decodeEntities(xml.slice(at, lt))) === false) return
    const next = xml.charCodeAt(lt + 1)
    if (next === 0x21 /* ! */) {
      if (xml.startsWith('<!--', lt)) {
        const close = xml.indexOf('-->', lt + 4)
        at = close < 0 ? end : close + 3
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const close = xml.indexOf(']]>', lt + 9)
        const text = xml.slice(lt + 9, close < 0 ? end : close)
        if (handler.text && handler.text(text) === false) return
        at = close < 0 ? end : close + 3
      } else {
        // <!DOCTYPE …>, with an internal subset in brackets: skipped whole, never expanded.
        const bracket = xml.indexOf('[', lt)
        const gt = xml.indexOf('>', lt)
        if (bracket >= 0 && gt >= 0 && bracket < gt) {
          const close = xml.indexOf(']>', bracket)
          at = close < 0 ? end : close + 2
        } else {
          at = gt < 0 ? end : gt + 1
        }
      }
      continue
    }
    if (next === 0x3f /* ? */) {
      const close = xml.indexOf('?>', lt + 2)
      at = close < 0 ? end : close + 2
      continue
    }
    // A tag: find its end outside quoted attribute values.
    let gt = lt + 1
    let quote = 0
    for (; gt < end; gt += 1) {
      const ch = xml.charCodeAt(gt)
      if (quote) {
        if (ch === quote) quote = 0
      } else if (ch === 0x22 || ch === 0x27) {
        quote = ch
      } else if (ch === 0x3e /* > */) {
        break
      }
    }
    if (gt >= end) return
    if (next === 0x2f /* / */) {
      if (handler.close && handler.close(localName(xml.slice(lt + 2, gt).trim())) === false) return
    } else {
      const isEmpty = xml.charCodeAt(gt - 1) === 0x2f
      const body = xml.slice(lt + 1, isEmpty ? gt - 1 : gt)
      const space = body.search(/\s/)
      const name = localName(space < 0 ? body : body.slice(0, space))
      const attrs = space < 0 ? '' : body.slice(space)
      if (handler.open && handler.open(name, attrs, isEmpty) === false) return
      if (isEmpty && handler.close && handler.close(name) === false) return
    }
    at = gt + 1
  }
}

/** How deep a tree may nest: real Word parts stay well under this. */
const MAX_DEPTH = 256

/** An element of a small document part, as a tree. Text children are strings, entities decoded. */
export type XmlNode = { name: string; attrs: string; children: (XmlNode | string)[] }

/** Builds a tree of a whole part. For parts of modest size: a Word document body, numbering, styles. */
export function parseTree(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: '', children: [] }
  const stack: XmlNode[] = [root]
  // How many elements of each name are open, so a stray close tag is known at once; and opens past the depth cap, by name.
  const open = new Map<string, number>()
  const tooDeep = new Map<string, number>()
  // An empty element (<p/>) is never opened on the stack, so its own close is skipped: it must not close an ancestor of the same name.
  let isEmptyClose = false
  scanXml(xml, {
    open: (name, attrs, isEmpty) => {
      checkTime()
      const node: XmlNode = { name, attrs, children: [] }
      stack[stack.length - 1]!.children.push(node)
      isEmptyClose = isEmpty
      if (isEmpty) return
      // Deeper than any real document: its contents join this level rather than nesting further.
      if (stack.length > MAX_DEPTH) {
        tooDeep.set(name, (tooDeep.get(name) ?? 0) + 1)
        return
      }
      stack.push(node)
      open.set(name, (open.get(name) ?? 0) + 1)
    },
    close: name => {
      if (isEmptyClose) {
        isEmptyClose = false
        return
      }
      const deep = tooDeep.get(name) ?? 0
      if (deep > 0) {
        tooDeep.set(name, deep - 1)
        return
      }
      // A stray close tag is ignored; otherwise the nearest open element of this name closes, and any left open inside it.
      if (!open.get(name)) return
      while (stack.length > 1) {
        const top = stack.pop()!
        open.set(top.name, (open.get(top.name) ?? 1) - 1)
        if (top.name === name) break
      }
    },
    text: text => {
      stack[stack.length - 1]!.children.push(text)
    },
  })
  return root
}

export const elements = (node: XmlNode, name?: string) =>
  node.children.filter((c): c is XmlNode => typeof c !== 'string' && (name === undefined || c.name === name))

export const child = (node: XmlNode | undefined, name: string) => (node ? elements(node, name)[0] : undefined)

/** Every element of that name below `node`, in document order. */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

/** The text directly inside an element. */
export const textOf = (node: XmlNode) => node.children.filter((c): c is string => typeof c === 'string').join('')
