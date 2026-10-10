// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Reads the text of a PDF for the pane, page by page and line by line.
 *
 * It reads the file's structure (cross-reference tables and streams, object
 * streams, with a repair scan when those are broken), decompresses content
 * streams, and follows each page's text operators to place every piece of
 * text, so it can tell lines and spaces apart. Fonts' ToUnicode maps,
 * encodings and glyph names turn codes into text. Every loop is capped, so
 * a hostile file can't hang the pane.
 */

import type { DocRow, Picture, Pixels } from '../types'
import { decodePicture, samplesToPixels } from './picture'
import { checkTime, isLate } from './deadline'
import { openEncrypted } from './pdf-crypto'
import type { Decrypter } from './pdf-crypto'
import { MAC_ROMAN, STANDARD, SYMBOL, WIN_ANSI, glyphText, parseCMap, standardWidth, trueTypeGlyphText } from './pdf-fonts'
import type { CMap } from './pdf-fonts'
import { clean } from './xlsx'
import { inflate } from './zip'

const MAX_ROWS = 4000
/** Objects a PDF may list: far more than real documents have. */
const MAX_OBJECTS = 2_000_000
/** Bytes all of a PDF's streams may decode to, together: a small file can't make the pane unpack gigabytes. */
const MAX_DECODED = 384 * 1024 * 1024
/** Content decoded from one stream, and operators read across the whole document. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024
/** Work allowed across the document, and text pieces per page: past them the PDF is shown up to there, so it opens quickly however it is built. */
const MAX_OPERATORS = 1_500_000
const MAX_PIECES = 60_000
const MAX_FORM_DEPTH = 8

export class PdfError extends Error {}

// ── Objects ──

// Plain classes, so `instanceof` tells the kinds apart; each is made by the function after it.
class Name {
  declare readonly name: string
}
const nameObj = (name: string): Name => Object.assign(new Name(), { name })
class Ref {
  declare readonly num: number
  declare readonly gen: number
}
const refObj = (num: number, gen: number): Ref => Object.assign(new Ref(), { num, gen })
class PdfString {
  declare readonly bytes: Uint8Array
}
const stringObj = (bytes: Uint8Array): PdfString => Object.assign(new PdfString(), { bytes })
type Dict = Map<string, Value>
class Stream {
  declare readonly dict: Dict
  declare data: Uint8Array
}
const streamObj = (dict: Dict, data: Uint8Array): Stream => Object.assign(new Stream(), { dict, data })
class Op {
  declare readonly op: string
}
const opObj = (op: string): Op => Object.assign(new Op(), { op })
type Value = number | boolean | null | Name | Ref | PdfString | Value[] | Dict | Stream

const isDict = (v: unknown): v is Dict => v instanceof Map
const nameOf = (v: unknown) => (v instanceof Name ? v.name : undefined)
const latin = (bytes: Uint8Array) => {
  let s = ''
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return s
}

const WHITE = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) WHITE[c] = 1
const DELIM = new Uint8Array(256)
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1

/** A lexer over the bytes, from a position. */
const lexer = (b: Uint8Array, pos = 0): Lexer => Object.assign(new Lexer(), { b, pos })

/** Reads PDF words and objects from bytes, from a position. */
class Lexer {
  pos = 0
  declare readonly b: Uint8Array

  skipSpace() {
    const b = this.b
    for (;;) {
      while (this.pos < b.length && WHITE[b[this.pos]!]) this.pos += 1
      if (b[this.pos] === 0x25 /* % */) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos += 1
        continue
      }
      return
    }
  }

  /** The next object, or an operator keyword (in content streams), or undefined at the end. */
  next(depth = 0): Value | Op | undefined {
    if (depth > 100) throw new PdfError('it nests too deeply')
    this.skipSpace()
    const b = this.b
    if (this.pos >= b.length) return undefined
    const c = b[this.pos]!
    if (c === 0x2f /* / */) {
      let end = this.pos + 1
      while (end < b.length && !WHITE[b[end]!] && !DELIM[b[end]!]) end += 1
      const raw = latin(b.subarray(this.pos + 1, end)).replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
      this.pos = end
      return nameObj(raw)
    }
    if (c === 0x28 /* ( */) return this.literal()
    if (c === 0x3c /* < */) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2
        const dict: Dict = new Map()
        for (;;) {
          this.skipSpace()
          if (this.pos >= b.length) break
          if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
            this.pos += 2
            break
          }
          const key = this.next(depth + 1)
          if (!(key instanceof Name)) {
            if (key === undefined) break
            continue
          }
          const value = this.next(depth + 1)
          if (value instanceof Op) {
            this.pos -= value.op.length
            break
          }
          if (value !== undefined) dict.set(key.name, value)
        }
        return dict
      }
      const end = b.indexOf(0x3e, this.pos)
      const hex = latin(b.subarray(this.pos + 1, end < 0 ? b.length : end)).replace(/[^0-9A-Fa-f]/g, '')
      this.pos = end < 0 ? b.length : end + 1
      const even = hex.length % 2 ? `${hex}0` : hex
      const bytes = new Uint8Array(even.length / 2)
      for (let k = 0; k < bytes.length; k += 1) bytes[k] = Number.parseInt(even.slice(k * 2, k * 2 + 2), 16)
      return stringObj(bytes)
    }
    if (c === 0x5b /* [ */) {
      this.pos += 1
      const items: Value[] = []
      for (;;) {
        this.skipSpace()
        if (this.pos >= b.length) break
        if (b[this.pos] === 0x5d) {
          this.pos += 1
          break
        }
        const item = this.next(depth + 1)
        if (item === undefined) break
        if (item instanceof Op) continue
        items.push(item)
      }
      return items
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos += 1
      return opObj(String.fromCharCode(c))
    }
    let end = this.pos
    while (end < b.length && !WHITE[b[end]!] && !DELIM[b[end]!]) end += 1
    if (end === this.pos) end += 1
    const word = latin(b.subarray(this.pos, end))
    this.pos = end
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      // An integer may be the start of a reference: "12 0 R".
      if (/^\d+$/.test(word)) {
        const save = this.pos
        const m = /^\s+(\d+)\s+R(?![A-Za-z0-9])/.exec(latin(b.subarray(this.pos, this.pos + 24)))
        if (m) {
          this.pos = save + m[0].length
          return refObj(Number(word), Number(m[1]))
        }
      }
      return Number(word)
    }
    if (word === 'true') return true
    if (word === 'false') return false
    if (word === 'null') return null
    return opObj(word)
  }

  private literal(): PdfString {
    const b = this.b
    const out: number[] = []
    let depth = 1
    this.pos += 1
    while (this.pos < b.length) {
      const c = b[this.pos++]!
      if (c === 0x5c /* \ */) {
        const n = b[this.pos++]
        if (n === undefined) break
        const esc: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c }
        if (esc[n] !== undefined) out.push(esc[n]!)
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30
          for (let k = 0; k < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; k += 1) v = v * 8 + b[this.pos++]! - 0x30
          out.push(v & 0xff)
        } else if (n === 13) {
          if (b[this.pos] === 10) this.pos += 1
        } else if (n !== 10) out.push(n)
        continue
      }
      if (c === 0x28) depth += 1
      else if (c === 0x29 && --depth === 0) break
      out.push(c)
    }
    return stringObj(new Uint8Array(out))
  }
}

// ── Filters ──

/** Streams already decoded (a form drawn on every page is decoded once), and the bytes decoded so far for this PDF. */
let decoded = new WeakMap<Stream, Uint8Array>()
let decodedBytes = 0

function decodeStream(stream: Stream): Uint8Array {
  const known = decoded.get(stream)
  if (known) return known
  const out = decodeFilters(stream)
  decodedBytes += out.length
  if (decodedBytes > MAX_DECODED) throw new PdfError('it holds more than the pane can unpack')
  decoded.set(stream, out)
  return out
}

function decodeFilters(stream: Stream): Uint8Array {
  let data = stream.data
  const filters = ([] as Value[]).concat(stream.dict.get('Filter') ?? [])
  const params = ([] as Value[]).concat(stream.dict.get('DecodeParms') ?? stream.dict.get('DP') ?? [])
  filters.forEach((filter, k) => {
    const name = nameOf(filter)
    const parms = params[k]
    if (name === 'FlateDecode' || name === 'Fl') data = predict(flate(data), isDict(parms) ? parms : undefined)
    else if (name === 'ASCIIHexDecode' || name === 'AHx') data = asciiHex(data)
    else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(data)
    else if (name === 'LZWDecode' || name === 'LZW') data = predict(lzw(data, !(isDict(parms) && parms.get('EarlyChange') === 0)), isDict(parms) ? parms : undefined)
    else if (name === 'RunLengthDecode' || name === 'RL') data = runLength(data)
    else if (name !== undefined && name !== 'Crypt') throw new PdfError(`filter ${name}`)
  })
  return data
}

function flate(data: Uint8Array): Uint8Array {
  // A zlib header (two bytes) usually comes first; raw DEFLATE is tried when it doesn't.
  const hasHeader = data.length > 2 && (data[0]! & 0x0f) === 8 && ((data[0]! << 8) | data[1]!) % 31 === 0
  return inflate(hasHeader ? data.subarray(2) : data, MAX_STREAM_BYTES, true)
}

function predict(data: Uint8Array, parms: Dict | undefined): Uint8Array {
  const predictor = parms ? Number(parms.get('Predictor') ?? 1) : 1
  if (predictor < 10) return data
  const colors = Number(parms?.get('Colors') ?? 1)
  const bpc = Number(parms?.get('BitsPerComponent') ?? 8)
  const columns = Number(parms?.get('Columns') ?? 1)
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8))
  const rowLength = Math.ceil((colors * bpc * columns) / 8)
  const rows = Math.floor(data.length / (rowLength + 1))
  const out = new Uint8Array(rows * rowLength)
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (rowLength + 1)]!
    const src = r * (rowLength + 1) + 1
    const dst = r * rowLength
    for (let i = 0; i < rowLength; i += 1) {
      const raw = data[src + i]!
      const left = i >= bpp ? out[dst + i - bpp]! : 0
      const up = r > 0 ? out[dst - rowLength + i]! : 0
      const upLeft = r > 0 && i >= bpp ? out[dst - rowLength + i - bpp]! : 0
      let v = raw
      if (type === 1) v = raw + left
      else if (type === 2) v = raw + up
      else if (type === 3) v = raw + ((left + up) >> 1)
      else if (type === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      }
      out[dst + i] = v & 0xff
    }
  }
  return out
}

function asciiHex(data: Uint8Array): Uint8Array {
  const text = latin(data).split('>')[0]!.replace(/[^0-9A-Fa-f]/g, '')
  const even = text.length % 2 ? `${text}0` : text
  const out = new Uint8Array(even.length / 2)
  for (let k = 0; k < out.length; k += 1) out[k] = Number.parseInt(even.slice(k * 2, k * 2 + 2), 16)
  return out
}

function ascii85(data: Uint8Array): Uint8Array {
  const text = latin(data).replace(/^<~/, '').split('~>')[0]!.replace(/\s/g, '')
  const out: number[] = []
  let group: number[] = []
  for (const ch of text) {
    if (ch === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    const v = ch.charCodeAt(0) - 33
    if (v < 0 || v > 84) continue
    group.push(v)
    if (group.length === 5) {
      const n = group.reduce((a, d) => a * 85 + d, 0)
      out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
      group = []
    }
  }
  if (group.length > 1) {
    const size = group.length - 1
    while (group.length < 5) group.push(84)
    const n = group.reduce((a, d) => a * 85 + d, 0)
    out.push(...[(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].slice(0, size))
  }
  return new Uint8Array(out)
}

function lzw(data: Uint8Array, isEarly: boolean): Uint8Array {
  const out: number[] = []
  let table: number[][] = []
  const reset = () => {
    table = Array.from({ length: 258 }, (_, k) => (k < 256 ? [k] : []))
  }
  reset()
  let width = 9
  let bit = 0
  let bits = 0
  let pos = 0
  let previous: number[] | null = null
  for (;;) {
    while (bits < width && pos < data.length) {
      bit = (bit << 8) | data[pos++]!
      bits += 8
    }
    if (bits < width) break
    const code = (bit >>> (bits - width)) & ((1 << width) - 1)
    bits -= width
    if (code === 256) {
      reset()
      width = 9
      previous = null
      continue
    }
    if (code === 257) break
    let entry = table[code]
    if (!entry || entry.length === 0) {
      if (!previous) break
      entry = [...previous, previous[0]!]
    }
    for (const c of entry) out.push(c)
    if (out.length > MAX_STREAM_BYTES) throw new PdfError('a stream is too large')
    if (previous) table.push([...previous, entry[0]!])
    previous = entry
    const next = table.length + (isEarly ? 1 : 0)
    if (next >= 1 << width && width < 12) width += 1
  }
  return new Uint8Array(out)
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let k = 0; k < data.length; ) {
    const n = data[k++]!
    if (n === 128) break
    if (n < 128) {
      for (let i = 0; i <= n && k < data.length; i += 1) out.push(data[k++]!)
    } else {
      const v = data[k++]
      if (v === undefined) break
      for (let i = 0; i < 257 - n; i += 1) out.push(v)
    }
  }
  return new Uint8Array(out)
}

// ── The document ──

type Entry = { offset: number } | { stream: number; index: number }

class Doc {
  readonly entries = new Map<number, Entry>()
  /** Cross-reference streams a classic table pointed to (XRefStm), each read once. */
  private hybrids = new Set<number>()
  trailer: Dict = new Map()
  private cache = new Map<number, Value>()
  private busy = new Set<number>()
  decrypt: Decrypter | null = null
  encryptRef: Ref | null = null

  declare readonly b: Uint8Array

  /** The cross-reference data: from startxref through /Prev, or rebuilt by scanning when broken. */
  load() {
    try {
      const tail = latin(this.b.subarray(Math.max(0, this.b.length - 2048)))
      const m = /startxref\s+(\d+)/g
      let last: RegExpExecArray | null = null
      for (let x = m.exec(tail); x; x = m.exec(tail)) last = x
      if (!last) throw new PdfError('no startxref')
      const seen = new Set<number>()
      for (let at: number | undefined = Number(last[1]); at !== undefined && !seen.has(at) && seen.size < 64; ) {
        seen.add(at)
        at = this.section(at)
      }
      if (!this.trailer.get('Root')) throw new PdfError('no root')
    } catch {
      this.repair()
    }
  }

  /** Reads one cross-reference section at `at`; returns the previous section's offset, if any. */
  private section(at: number): number | undefined {
    const lex = lexer(this.b, at)
    lex.skipSpace()
    if (latin(this.b.subarray(lex.pos, lex.pos + 4)) === 'xref') {
      lex.pos += 4
      for (;;) {
        lex.skipSpace()
        if (latin(this.b.subarray(lex.pos, lex.pos + 7)) === 'trailer') {
          lex.pos += 7
          break
        }
        const start = lex.next()
        const count = lex.next()
        if (typeof start !== 'number' || typeof count !== 'number' || !Number.isSafeInteger(start) || count < 0) throw new PdfError('bad xref')
        for (let k = 0; k < count; k += 1) {
          checkTime()
          if (this.entries.size > MAX_OBJECTS) throw new PdfError('too many objects')
          const offset = lex.next()
          lex.next()
          const kind = lex.next()
          if (typeof offset !== 'number') throw new PdfError('bad xref')
          if (kind instanceof Op && kind.op === 'n' && !this.entries.has(start + k)) this.entries.set(start + k, { offset })
        }
      }
      const trailer = lex.next()
      if (!isDict(trailer)) throw new PdfError('bad trailer')
      for (const [key, value] of trailer) if (!this.trailer.has(key)) this.trailer.set(key, value)
      const hybrid = trailer.get('XRefStm')
      if (typeof hybrid === 'number' && hybrid !== at && !this.hybrids.has(hybrid)) {
        this.hybrids.add(hybrid)
        this.section(hybrid)
      }
      const prev = trailer.get('Prev')
      return typeof prev === 'number' ? prev : undefined
    }
    // A cross-reference stream: "n g obj << /Type /XRef … >> stream".
    const object = this.parseAt(at)
    if (!(object instanceof Stream) || nameOf(object.dict.get('Type')) !== 'XRef') throw new PdfError('bad xref stream')
    const data = decodeStream(object)
    const w = (object.dict.get('W') as number[] | undefined) ?? [1, 2, 1]
    const size = Number(object.dict.get('Size') ?? 0)
    const index = (object.dict.get('Index') as number[] | undefined) ?? [0, size]
    const rowSize = w.reduce((a, n) => a + n, 0)
    // Rows of no width, or numbers past what can be counted exactly: not a real table.
    if (!(rowSize > 0) || w.some(n => !Number.isSafeInteger(n) || n < 0 || n > 8) || index.some(n => !Number.isSafeInteger(n) || n < 0)) throw new PdfError('bad xref stream')
    let p = 0
    const field = (n: number, fallback: number) => {
      if (n === 0) return fallback
      let v = 0
      for (let k = 0; k < n; k += 1) v = v * 256 + (data[p++] ?? 0)
      return v
    }
    for (let i = 0; i + 1 < index.length; i += 2) {
      for (let k = 0; k < index[i + 1]!; k += 1) {
        if (p + rowSize > data.length || this.entries.size > MAX_OBJECTS) break
        const type = field(w[0]!, 1)
        const a = field(w[1]!, 0)
        const c = field(w[2]!, 0)
        const num = index[i]! + k
        if (this.entries.has(num)) continue
        if (type === 1) this.entries.set(num, { offset: a })
        else if (type === 2) this.entries.set(num, { stream: a, index: c })
      }
    }
    for (const [key, value] of object.dict) if (!this.trailer.has(key) && key !== 'Filter' && key !== 'DecodeParms') this.trailer.set(key, value)
    const prev = object.dict.get('Prev')
    return typeof prev === 'number' ? prev : undefined
  }

  /** Finds every "n g obj" by scanning, for files whose cross-references are missing or wrong. */
  private repair() {
    this.entries.clear()
    this.trailer = new Map()
    const text = latin(this.b)
    const re = /(?:^|[\s>])(\d{1,7})\s+(\d{1,5})\s+obj\b/g
    for (let m = re.exec(text); m; m = re.exec(text)) this.entries.set(Number(m[1]), { offset: m.index + m[0].indexOf(m[1]!) })
    const trailers = /trailer\s*<</g
    for (let m = trailers.exec(text); m; m = trailers.exec(text)) {
      const dict = lexer(this.b, m.index + 7).next()
      if (isDict(dict)) for (const [key, value] of dict) this.trailer.set(key, value)
    }
    if (!this.trailer.get('Root')) {
      for (const [num, entry] of this.entries) {
        if (!('offset' in entry)) continue
        const object = this.parseAt(entry.offset)
        const dict = object instanceof Stream ? object.dict : object
        if (isDict(dict) && nameOf(dict.get('Type')) === 'XRef') {
          for (const [key, value] of dict) if (!this.trailer.has(key)) this.trailer.set(key, value)
          // Its compressed objects live in object streams: list them.
          try {
            this.section(entry.offset)
          } catch {
            /* the scan already found the plain objects */
          }
        }
        if (isDict(dict) && nameOf(dict.get('Type')) === 'Catalog' && !this.trailer.get('Root')) this.trailer.set('Root', refObj(num, 0))
      }
    }
    if (!this.trailer.get('Root')) throw new PdfError('it is not a readable PDF')
  }

  private scanned: Map<number, number> | null = null

  /** Where "num gen obj" really is, found by scanning the file once: for offsets a damaged cross-reference got wrong. */
  private findByScan(num: number): number | undefined {
    if (!this.scanned) {
      this.scanned = new Map()
      const text = latin(this.b)
      const re = /(?:^|[\s>])(\d{1,7})\s+\d{1,5}\s+obj\b/g
      for (let m = re.exec(text); m; m = re.exec(text)) this.scanned.set(Number(m[1]), m.index + m[0].indexOf(m[1]!))
    }
    return this.scanned.get(num)
  }

  /** The object at a byte offset: "n g obj VALUE [stream … endstream]". With `num`, a different object there sends it to the scan. */
  private parseAt(at: number, num?: number): Value {
    const lex = lexer(this.b, at)
    const first = lex.next()
    lex.next()
    const keyword = lex.next()
    if (num !== undefined && (first !== num || !(keyword instanceof Op) || keyword.op !== 'obj')) {
      const found = this.findByScan(num)
      if (found !== undefined && found !== at) return this.parseAt(found)
    }
    if (!(keyword instanceof Op) || keyword.op !== 'obj') throw new PdfError('bad object')
    const value = lex.next()
    if (value instanceof Op || value === undefined) return null
    lex.skipSpace()
    if (isDict(value) && latin(this.b.subarray(lex.pos, lex.pos + 6)) === 'stream') {
      let start = lex.pos + 6
      if (this.b[start] === 13) start += 1
      if (this.b[start] === 10) start += 1
      let length = value.get('Length')
      if (length instanceof Ref) length = this.getSync(length)
      let end = typeof length === 'number' && length >= 0 ? start + length : -1
      // A wrong /Length is common: trust "endstream" when it isn't where /Length says.
      if (end < 0 || end > this.b.length || latin(this.b.subarray(end, end + 30)).trim().slice(0, 9) !== 'endstream') {
        const found = latin(this.b.subarray(start, Math.min(this.b.length, start + MAX_STREAM_BYTES))).indexOf('endstream')
        end = found < 0 ? this.b.length : start + found
        while (end > start && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end -= 1
      }
      return streamObj(value, this.b.subarray(start, end))
    }
    return value
  }

  /** An object without decryption (lengths, and objects inside object streams, which are not encrypted again). */
  private getSync(ref: Ref): Value {
    const entry = this.entries.get(ref.num)
    if (!entry || !('offset' in entry)) return null
    try {
      return this.parseAt(entry.offset)
    } catch {
      return null
    }
  }

  async get(value: Value | undefined): Promise<Value> {
    if (!(value instanceof Ref)) return value ?? null
    const num = value.num
    if (this.cache.has(num)) return this.cache.get(num)!
    if (this.busy.has(num)) return null
    this.busy.add(num)
    try {
      const entry = this.entries.get(num)
      let object: Value = null
      if (entry && 'offset' in entry) {
        try {
          object = this.parseAt(entry.offset, num)
        } catch {
          object = null
        }
        if (this.decrypt && !(this.encryptRef && this.encryptRef.num === num)) object = await this.decryptValue(object, num, value.gen)
      } else if (entry) {
        object = await this.fromObjectStream(entry.stream, entry.index)
      }
      this.cache.set(num, object)
      return object
    } finally {
      this.busy.delete(num)
    }
  }

  private async decryptValue(value: Value, num: number, gen: number): Promise<Value> {
    if (!this.decrypt) return value
    if (value instanceof PdfString) return stringObj(await this.decrypt(value.bytes, num, gen))
    if (Array.isArray(value)) return Promise.all(value.map(v => this.decryptValue(v, num, gen)))
    if (isDict(value)) {
      const out: Dict = new Map()
      for (const [key, v] of value) out.set(key, await this.decryptValue(v, num, gen))
      return out
    }
    if (value instanceof Stream) {
      const dict = (await this.decryptValue(value.dict, num, gen)) as Dict
      const isXref = nameOf(dict.get('Type')) === 'XRef'
      return streamObj(dict, isXref ? value.data : await this.decrypt(value.data, num, gen))
    }
    return value
  }

  private streams = new Map<number, { offsets: number[]; data: Uint8Array; first: number }>()

  private async fromObjectStream(streamNum: number, index: number): Promise<Value> {
    let os = this.streams.get(streamNum)
    if (!os) {
      const stream = await this.get(refObj(streamNum, 0))
      if (!(stream instanceof Stream)) return null
      const data = decodeStream(stream)
      const n = Number(stream.dict.get('N') ?? 0)
      const first = Number(stream.dict.get('First') ?? 0)
      const lex = lexer(data)
      const offsets: number[] = []
      for (let k = 0; k < n; k += 1) {
        lex.next()
        const off = lex.next()
        offsets.push(typeof off === 'number' ? off : 0)
      }
      os = { offsets, data, first }
      this.streams.set(streamNum, os)
    }
    const off = os.offsets[index]
    if (off === undefined) return null
    const value = lexer(os.data, os.first + off).next()
    return value instanceof Op || value === undefined ? null : value
  }

  async dict(value: Value | undefined): Promise<Dict | undefined> {
    const v = await this.get(value)
    return isDict(v) ? v : v instanceof Stream ? v.dict : undefined
  }
}

// ── Fonts ──

type Font = {
  /** Splits a string's bytes into codes. */
  codes: (bytes: Uint8Array) => number[]
  text: (code: number) => string
  /** Width in text space units per unit of font size (1000ths already scaled). */
  width: (code: number) => number
  isSimple: boolean
}

const numberArray = (v: Value): number[] => (Array.isArray(v) ? v.map(x => (typeof x === 'number' ? x : 0)) : [])

async function loadFont(doc: Doc, value: Value | undefined): Promise<Font> {
  const font = (await doc.dict(value)) ?? new Map()
  const subtype = nameOf(font.get('Subtype')) ?? 'Type1'
  const baseFont = nameOf(font.get('BaseFont')) ?? ''
  let toUnicode: CMap | null = null
  const tu = await doc.get(font.get('ToUnicode'))
  if (tu instanceof Stream) {
    try {
      toUnicode = parseCMap(latin(decodeStream(tu)))
    } catch {
      toUnicode = null
    }
  }

  if (subtype === 'Type0') {
    const descendant = await doc.dict(((await doc.get(font.get('DescendantFonts'))) as Value[] | null)?.[0] ?? null)
    const encoding = await doc.get(font.get('Encoding'))
    const encodingName = nameOf(encoding) ?? ''
    let codeMap: CMap | null = null
    if (encoding instanceof Stream) {
      codeMap = parseCMap(latin(decodeStream(encoding)))
      // Some writers put code → CID pairs in bfchar/bfrange rather than cidchar/cidrange: read them as CIDs, as pdf.js does.
      if (!codeMap.cids?.size && codeMap.unicode.size > 0) {
        codeMap.cids = new Map([...codeMap.unicode].filter(([, text]) => text.length === 1).map(([code, text]) => [code, text.charCodeAt(0)]))
      }
    }
    const ranges = codeMap?.ranges.length ? codeMap.ranges : toUnicode?.ranges.length ? toUnicode.ranges : [[2, 0, 0xffff] as [number, number, number]]
    const isUcs2 = /^Uni.*-(UCS2|UTF16)-[HV]$/.test(encodingName)
    // Widths: /DW, and /W as [c [w…]] or [c1 c2 w].
    const widths = new Map<number, number>()
    const dw = Number(descendant?.get('DW') ?? 1000)
    const w = (await doc.get(descendant?.get('W'))) as Value[] | null
    if (Array.isArray(w)) {
      for (let k = 0; k < w.length; ) {
        const first = w[k]
        const second = await doc.get(w[k + 1])
        if (typeof first !== 'number') break
        if (Array.isArray(second)) {
          numberArray(second).forEach((width, i) => widths.set(first + i, width))
          k += 2
        } else if (typeof second === 'number' && typeof w[k + 2] === 'number') {
          for (let c = first; c <= second && c - first < 65_536; c += 1) widths.set(c, w[k + 2] as number)
          k += 3
        } else break
      }
    }
    const cidOf = (code: number) => codeMap?.cids?.get(code) ?? code
    // Without a ToUnicode map: the embedded TrueType font's own table (CID → glyph → text), else the code read as Unicode, as pypdf does.
    let glyphs: Map<number, string> | null = null
    let cidToGid: Uint8Array | null = null
    if (!toUnicode || toUnicode.unicode.size === 0) {
      const descriptor = await doc.dict(descendant?.get('FontDescriptor'))
      const file = await doc.get(descriptor?.get('FontFile2'))
      if (file instanceof Stream) {
        try {
          glyphs = trueTypeGlyphText(decodeStream(file))
        } catch {
          glyphs = null
        }
        const map = await doc.get(descendant?.get('CIDToGIDMap'))
        if (map instanceof Stream) cidToGid = decodeStream(map)
      }
    }
    const fallback = (code: number) => {
      if (glyphs && glyphs.size > 0) {
        const cid = cidOf(code)
        const gid = cidToGid ? ((cidToGid[cid * 2] ?? 0) << 8) | (cidToGid[cid * 2 + 1] ?? 0) : cid
        const text = glyphs.get(gid)
        if (text !== undefined) return text
      }
      return isUcs2 || code >= 32 ? String.fromCharCode(code) : ''
    }
    return {
      isSimple: false,
      codes: bytes => splitCodes(bytes, ranges),
      text: code => toUnicode?.unicode.get(code) ?? fallback(code),
      width: code => (widths.get(cidOf(code)) ?? dw) / 1000,
    }
  }

  // Simple fonts: Type1, TrueType, Type3, MMType1.
  const encoding = await doc.get(font.get('Encoding'))
  const descriptor = await doc.dict(font.get('FontDescriptor'))
  const flags = Number(descriptor?.get('Flags') ?? 0)
  const isSymbolic = (flags & 4) !== 0 && (flags & 32) === 0
  const isSymbolFont = /Symbol/i.test(baseFont) && !/Wingding|Dingbat/i.test(baseFont)
  let table = isSymbolFont ? SYMBOL : subtype === 'TrueType' || isSymbolic ? WIN_ANSI : STANDARD
  const differences = new Map<number, string>()
  const pickBase = (name: string | undefined) => {
    if (name === 'WinAnsiEncoding') table = WIN_ANSI
    else if (name === 'MacRomanEncoding') table = MAC_ROMAN
    else if (name === 'StandardEncoding') table = STANDARD
  }
  if (encoding instanceof Name) pickBase(encoding.name)
  else if (isDict(encoding)) {
    pickBase(nameOf(encoding.get('BaseEncoding')))
    const diffs = await doc.get(encoding.get('Differences'))
    if (Array.isArray(diffs)) {
      let code = 0
      for (const item of diffs) {
        if (typeof item === 'number') code = item
        else if (item instanceof Name) {
          // A name this reader doesn't know falls back to the base encoding, as pdf.js does; TeX's aNNN names carry the code itself.
          const tex = /^a(\d{1,3})$/.exec(item.name)
          const text = tex ? (WIN_ANSI[Number(tex[1])] ?? '') : glyphText(item.name)
          if (text !== '') differences.set(code, text)
          code += 1
        }
      }
    }
  }
  const firstChar = Number(font.get('FirstChar') ?? 0)
  const widthList = numberArray((await doc.get(font.get('Widths'))) ?? [])
  const missing = Number(descriptor?.get('MissingWidth') ?? 0)
  // Type 3 glyphs are measured in their own space; FontMatrix scales them.
  const matrix = numberArray((await doc.get(font.get('FontMatrix'))) ?? [])
  const scale = subtype === 'Type3' && matrix.length === 6 ? matrix[0]! : 0.001
  return {
    isSimple: true,
    codes: bytes => Array.from(bytes),
    text: code => toUnicode?.unicode.get(code) ?? differences.get(code) ?? table[code] ?? '',
    width: code => {
      const listed = widthList[code - firstChar]
      if (listed !== undefined && listed > 0) return listed * scale
      if (widthList.length === 0 && subtype !== 'Type3') return standardWidth(baseFont, code) / 1000
      return (missing || 500) * scale
    },
  }
}

function splitCodes(bytes: Uint8Array, ranges: [number, number, number][]): number[] {
  const codes: number[] = []
  const lengths = [...new Set(ranges.map(r => r[0]))].sort((a, b) => a - b)
  for (let k = 0; k < bytes.length; ) {
    let matched = false
    for (const n of lengths) {
      if (k + n > bytes.length) break
      let code = 0
      for (let i = 0; i < n; i += 1) code = code * 256 + bytes[k + i]!
      if (ranges.some(([len, lo, hi]) => len === n && code >= lo && code <= hi)) {
        codes.push(code)
        k += n
        matched = true
        break
      }
    }
    if (!matched) {
      const n = lengths[0] ?? 1
      let code = 0
      for (let i = 0; i < n && k + i < bytes.length; i += 1) code = code * 256 + bytes[k + i]!
      codes.push(code)
      k += n
    }
  }
  return codes
}

// ── Pages and text ──

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

/** One run of text as placed: where it starts and ends along its baseline, and its size. */
type Piece = { text: string; x: number; y: number; end: number; size: number; dx: number; dy: number; pic?: number }

/** Pictures drawn smaller than this, in points (a 72nd of an inch), are decoration: rules, bullets, tiny icons. */
const MIN_PICTURE_POINTS = 24

/** A colour space as a pixel's sample count and its conversion to RGB, or why it can't be drawn. */
async function colourSpace(doc: Doc, value: Value | undefined, resources: Dict | undefined, depth = 0): Promise<{ n: number; rgb: (s: number[]) => [number, number, number] } | string> {
  const gray = (v: number): [number, number, number] => [v * 255, v * 255, v * 255]
  let cs = await doc.get(value)
  const named = nameOf(cs)
  if (named && !['DeviceGray', 'G', 'DeviceRGB', 'RGB', 'DeviceCMYK', 'CMYK', 'Indexed', 'I'].includes(named)) {
    // A name from the page's resources.
    const own = (await doc.dict(resources?.get('ColorSpace')))?.get(named)
    if (own !== undefined && depth < 4) return colourSpace(doc, own, resources, depth + 1)
  }
  const kind = named ?? nameOf(Array.isArray(cs) ? cs[0] : undefined) ?? ''
  if (kind === 'DeviceGray' || kind === 'G' || kind === 'CalGray') return { n: 1, rgb: s => gray(s[0]!) }
  if (kind === 'DeviceRGB' || kind === 'RGB' || kind === 'CalRGB') return { n: 3, rgb: s => [s[0]! * 255, s[1]! * 255, s[2]! * 255] }
  const cmyk = (s: number[]): [number, number, number] => [255 * (1 - s[0]!) * (1 - s[3]!), 255 * (1 - s[1]!) * (1 - s[3]!), 255 * (1 - s[2]!) * (1 - s[3]!)]
  if (kind === 'DeviceCMYK' || kind === 'CMYK') return { n: 4, rgb: cmyk }
  if (kind === 'Lab') return { n: 3, rgb: s => gray(s[0]!) }
  if (Array.isArray(cs) && kind === 'ICCBased') {
    const stream = await doc.get(cs[1])
    const n = stream instanceof Stream ? Number((await doc.get(stream.dict.get('N'))) ?? 3) : 3
    return n === 1 ? { n, rgb: s => gray(s[0]!) } : n === 4 ? { n, rgb: cmyk } : { n: 3, rgb: s => [s[0]! * 255, s[1]! * 255, s[2]! * 255] }
  }
  if (Array.isArray(cs) && (kind === 'Separation' || kind === 'DeviceN')) {
    // One ink (or several), shown as its darkness.
    const n = kind === 'DeviceN' && Array.isArray(await doc.get(cs[1])) ? ((await doc.get(cs[1])) as Value[]).length : 1
    return { n, rgb: s => gray(1 - Math.min(1, s.reduce((a, b) => a + b, 0))) }
  }
  if (Array.isArray(cs) && (kind === 'Indexed' || kind === 'I') && depth < 4) {
    const base = await colourSpace(doc, cs[1], resources, depth + 1)
    if (typeof base === 'string') return base
    const hival = Number((await doc.get(cs[2])) ?? 0)
    const table = await doc.get(cs[3])
    const lookup = table instanceof PdfString ? table.bytes : table instanceof Stream ? decodeStream(table) : new Uint8Array(0)
    const max = Math.max(1, hival)
    return {
      n: 1,
      rgb: s => {
        const index = Math.min(max, Math.round(s[0]! * 255))
        return base.rgb(Array.from({ length: base.n }, (_, k) => (lookup[index * base.n + k] ?? 0) / 255))
      },
    }
  }
  return 'its colours are in a form the pane can’t draw'
}

/** An image drawn on a page, as pixels, or why it can't be shown. */
async function pdfImage(doc: Doc, image: Stream, resources: Dict | undefined, bitsFor: (n: number) => number = n => n): Promise<Pixels | string> {
  // A picture is decoded on its own, later than the text: it gets a decoding allowance of its own.
  decodedBytes = 0
  const d = image.dict
  const width = Number((await doc.get(d.get('Width') ?? d.get('W'))) ?? 0)
  const height = Number((await doc.get(d.get('Height') ?? d.get('H'))) ?? 0)
  const filters = ([] as Value[]).concat((await doc.get(d.get('Filter') ?? d.get('F'))) ?? []).map(nameOf)
  const last = filters[filters.length - 1]
  const rest = streamObj(new Map([...d].map(([k, v]) => (k === 'Filter' ? [k, filters.slice(0, -1).map(f => nameObj(f ?? ''))] : [k, v]))), image.data)
  if (last === 'DCTDecode' || last === 'DCT') return decodePicture(filters.length > 1 ? decodeStream(rest) : image.data)
  if (last === 'JPXDecode') return 'it is a JPEG 2000 picture, which the pane can’t draw'
  if (last === 'JBIG2Decode' || last === 'CCITTFaxDecode' || last === 'CCF') return 'it is a scanned black-and-white page image, which the pane can’t draw'
  let data: Uint8Array
  try {
    data = decodeStream(image)
  } catch {
    return 'its data is in a form the pane can’t read'
  }
  const isMask = (await doc.get(d.get('ImageMask') ?? d.get('IM'))) === true
  const decode = ((await doc.get(d.get('Decode') ?? d.get('D'))) ?? []) as Value[]
  const isInverted = Array.isArray(decode) && decode[0] === 1 && decode[1] === 0
  if (isMask) return samplesToPixels(width, height, 1, 1, data, s => (s[0]! > 0.5 !== isInverted ? [255, 255, 255] : [0, 0, 0]))
  // A soft mask: a grey image of how opaque each pixel is, perhaps at another size.
  let alpha: ((x: number, y: number) => number) | undefined
  const smask = await doc.get(d.get('SMask'))
  if (smask instanceof Stream) {
    try {
      const mw = Number((await doc.get(smask.dict.get('Width'))) ?? 0)
      const mh = Number((await doc.get(smask.dict.get('Height'))) ?? 0)
      const mbits = Number((await doc.get(smask.dict.get('BitsPerComponent'))) ?? 8)
      const mask = decodeStream(smask)
      const stride = Math.ceil((mw * mbits) / 8)
      const max = 2 ** mbits - 1
      if (mw > 0 && mh > 0 && [1, 2, 4, 8].includes(mbits) && mask.length >= stride * mh) {
        alpha = (x, y) => {
          const mx = Math.min(mw - 1, Math.floor((x * mw) / width))
          const my = Math.min(mh - 1, Math.floor((y * mh) / height))
          const bit = mx * mbits
          return mbits === 8 ? mask[my * stride + mx]! / 255 : ((mask[my * stride + (bit >> 3)]! >> (8 - mbits - (bit & 7))) & max) / max
        }
      }
    } catch {
      alpha = undefined
    }
  }
  const space = await colourSpace(doc, d.get('ColorSpace') ?? d.get('CS'), resources)
  if (typeof space === 'string') return space
  const bits = bitsFor(Number((await doc.get(d.get('BitsPerComponent') ?? d.get('BPC'))) ?? 8))
  if (![1, 2, 4, 8, 16].includes(bits)) return 'its data is in a form the pane can’t read'
  try {
    return samplesToPixels(width, height, bits, space.n, data, s => space.rgb(isInverted ? s.map(v => 1 - v) : s), alpha)
  } catch (error) {
    return error instanceof Error ? error.message : 'the picture is damaged'
  }
}

async function pages(doc: Doc): Promise<Dict[]> {
  const root = await doc.dict(doc.trailer.get('Root'))
  const out: Dict[] = []
  const seen = new Set<Dict>()
  const walk = async (node: Value | undefined, inherited: Dict, depth: number) => {
    const dict = await doc.dict(node)
    if (!dict || seen.has(dict) || depth > 64 || out.length > 100_000) return
    seen.add(dict)
    const own = new Map(inherited)
    for (const key of ['Resources', 'MediaBox', 'Rotate']) if (dict.has(key)) own.set(key, dict.get(key)!)
    const kids = await doc.get(dict.get('Kids'))
    if (Array.isArray(kids)) {
      for (const kid of kids) await walk(kid, own, depth + 1)
    } else {
      const page = new Map(own)
      for (const [key, value] of dict) page.set(key, value)
      out.push(page)
    }
  }
  await walk(root?.get('Pages'), new Map(), 0)
  return out
}

/** Reads a page's text pieces, following its content streams and the forms they draw. */
async function pageText(doc: Doc, page: Dict, budget: { ops: number }, pictures: Picture[], drawn: Set<Value>, fonts: Map<Value, Font>): Promise<Piece[]> {
  const pieces: Piece[] = []

  const run = async (content: Uint8Array, resources: Dict | undefined, start: Matrix, depth: number, forms: Set<Value>) => {
    const fontDicts = await doc.dict(resources?.get('Font'))
    const xobjects = await doc.dict(resources?.get('XObject'))
    let ctm = start
    const stack: { ctm: Matrix; tc: number; tw: number; th: number; tl: number; rise: number; font: Font | null; size: number }[] = []
    let tm: Matrix = IDENTITY
    let tlm: Matrix = IDENTITY
    let tc = 0
    let tw = 0
    let th = 1
    let tl = 0
    let rise = 0
    let font: Font | null = null
    let size = 0
    const operands: Value[] = []
    const lex = lexer(content)

    const show = (bytes: Uint8Array) => {
      if (!font) return
      const trm0 = multiply([size * th, 0, 0, size, 0, rise], multiply(tm, ctm))
      let text = ''
      let advance = 0
      for (const code of font.codes(bytes)) {
        text += font.text(code)
        const isSpace = font.isSimple && code === 32
        advance += (font.width(code) * size + tc + (isSpace ? tw : 0)) * th
      }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + advance * tm[0], tm[5] + advance * tm[1]]
      const trm1 = multiply([size * th, 0, 0, size, 0, rise], multiply(tm, ctm))
      const len = Math.hypot(trm0[0], trm0[1]) || 1
      const dx = trm0[0] / len
      const dy = trm0[1] / len
      // Positions along the baseline direction (x) and across it (y): rotation doesn't matter.
      const along = (m: Matrix) => m[4] * dx + m[5] * dy
      const across = (m: Matrix) => -m[4] * dy + m[5] * dx
      pieces.push({ text, x: along(trm0), y: across(trm0), end: along(trm1), size: Math.hypot(trm0[2], trm0[3]) || 1, dx, dy })
    }

    for (;;) {
      // Out of work allowed: what was read so far is kept.
      if (--budget.ops < 0 || pieces.length > MAX_PIECES || isLate() || decodedBytes > MAX_DECODED) {
        budget.ops = -1
        return
      }
      const item = lex.next()
      if (item === undefined) break
      if (!(item instanceof Op)) {
        operands.push(item)
        if (operands.length > 64) operands.shift()
        continue
      }
      const op = item.op
      const num = (k: number) => {
        const v = operands[operands.length - k]
        return typeof v === 'number' ? v : 0
      }
      switch (op) {
        case 'BI': {
          // An inline image: skip its data up to "EI".
          const head = latin(content.subarray(lex.pos, Math.min(content.length, lex.pos + 4096)))
          const id = head.search(/\bID[\s]/)
          if (id < 0) break
          // A picture written into the page itself: named, when it's large enough to be more than decoration.
          const size = (key: string) => Number(new RegExp(`/(?:${key})\\s+(\\d+)`).exec(head.slice(0, id))?.[1] ?? 0)
          const across = Math.hypot(ctm[0], ctm[1])
          const tall = Math.hypot(ctm[2], ctm[3])
          if (size('W|Width') >= 16 && size('H|Height') >= 16 && across >= MIN_PICTURE_POINTS && tall >= MIN_PICTURE_POINTS) {
            pictures.push({ label: '', load: () => 'it is written into the page’s drawing commands, which the pane can’t draw yet' })
            pieces.push({ text: '', x: 0, y: 0, end: 0, size: 1, dx: 1, dy: 0, pic: pictures.length - 1 })
          }
          let at = lex.pos + id + 3
          for (; at < content.length - 1; at += 1) {
            if (content[at] === 0x45 && content[at + 1] === 0x49 && WHITE[content[at - 1] ?? 32] && (at + 2 >= content.length || WHITE[content[at + 2]!])) break
          }
          lex.pos = at + 2
          break
        }
        case 'q':
          if (stack.length < 256) stack.push({ ctm, tc, tw, th, tl, rise, font, size })
          break
        case 'Q': {
          const s = stack.pop()
          if (s) ({ ctm, tc, tw, th, tl, rise, font, size } = s)
          break
        }
        case 'cm':
          ctm = multiply([num(6), num(5), num(4), num(3), num(2), num(1)], ctm)
          break
        case 'BT':
          tm = IDENTITY
          tlm = IDENTITY
          break
        case 'Tf': {
          const ref = operands[operands.length - 2]
          const key = nameOf(ref) ?? ''
          const fontRef = fontDicts?.get(key)
          size = num(1)
          if (fontRef !== undefined) {
            let loaded = fonts.get(fontRef)
            if (!loaded) {
              loaded = await loadFont(doc, fontRef)
              fonts.set(fontRef, loaded)
            }
            font = loaded
          }
          break
        }
        case 'Tc':
          tc = num(1)
          break
        case 'Tw':
          tw = num(1)
          break
        case 'Tz':
          th = num(1) / 100
          break
        case 'TL':
          tl = num(1)
          break
        case 'Ts':
          rise = num(1)
          break
        case 'Td':
        case 'TD':
          if (op === 'TD') tl = -num(1)
          tlm = multiply([1, 0, 0, 1, num(2), num(1)], tlm)
          tm = tlm
          break
        case 'Tm':
          tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]
          tm = tlm
          break
        case 'T*':
          tlm = multiply([1, 0, 0, 1, 0, -tl], tlm)
          tm = tlm
          break
        case 'Tj':
        case "'":
        case '"': {
          if (op !== 'Tj') {
            if (op === '"') {
              tw = num(3)
              tc = num(2)
            }
            tlm = multiply([1, 0, 0, 1, 0, -tl], tlm)
            tm = tlm
          }
          const s = operands[operands.length - 1]
          if (s instanceof PdfString) show(s.bytes)
          break
        }
        case 'TJ': {
          const items = operands[operands.length - 1]
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item instanceof PdfString) show(item.bytes)
              else if (typeof item === 'number') {
                const tx = (-item / 1000) * size * th
                tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + tx * tm[0], tm[5] + tx * tm[1]]
              }
            }
          }
          break
        }
        case 'Do': {
          const key = nameOf(operands[operands.length - 1])
          const ref = key ? xobjects?.get(key) : undefined
          if (ref === undefined || forms.has(ref) || depth >= MAX_FORM_DEPTH) break
          const form = await doc.get(ref)
          if (form instanceof Stream && nameOf(form.dict.get('Subtype')) === 'Image') {
            // A picture: one row where it is first drawn (a logo on every page shows once), unless it is small decoration.
            const across = Math.hypot(ctm[0], ctm[1])
            const tall = Math.hypot(ctm[2], ctm[3])
            const pixels = [form.dict.get('Width'), form.dict.get('Height')].map(Number)
            if (drawn.has(ref) || across < MIN_PICTURE_POINTS || tall < MIN_PICTURE_POINTS || pixels.some(n => !(n >= 16))) break
            drawn.add(ref)
            const where = resources
            pictures.push({ label: '', load: () => pdfImage(doc, form, where) })
            pieces.push({ text: '', x: 0, y: 0, end: 0, size: 1, dx: 1, dy: 0, pic: pictures.length - 1 })
            break
          }
          if (!(form instanceof Stream) || nameOf(form.dict.get('Subtype')) !== 'Form') break
          const m = numberArray((await doc.get(form.dict.get('Matrix'))) ?? [])
          const formMatrix: Matrix = m.length === 6 ? (m as Matrix) : IDENTITY
          let data: Uint8Array
          try {
            data = decodeStream(form)
          } catch {
            break
          }
          const formResources = (await doc.dict(form.dict.get('Resources'))) ?? resources
          await run(data, formResources, multiply(formMatrix, ctm), depth + 1, new Set([...forms, ref]))
          break
        }
      }
      operands.length = 0
    }
  }

  const resources = await doc.dict(page.get('Resources'))
  const contents = await doc.get(page.get('Contents'))
  const parts = Array.isArray(contents) ? contents : [contents]
  const decoded: Uint8Array[] = []
  for (const part of parts) {
    const stream = await doc.get(part)
    if (!(stream instanceof Stream)) continue
    try {
      decoded.push(decodeStream(stream))
    } catch {
      /* an unreadable part: the others may still have text */
    }
  }
  // Parts are one content stream split up: join them with a space between.
  const total = decoded.reduce((n, d) => n + d.length + 1, 0)
  const content = new Uint8Array(total)
  let at = 0
  for (const d of decoded) {
    content.set(d, at)
    at += d.length
    content[at++] = 32
  }
  await run(content, resources, IDENTITY, 0, new Set())
  return pieces
}

/** Lines from the pieces, in reading order as drawn: a new line when the baseline moves or the text jumps back. */
function linesOf(pieces: Piece[]): (string | number)[] {
  const lines: (string | number)[] = []
  let line = ''
  let last: Piece | null = null
  for (const piece of pieces) {
    // A picture is a line of its own, where it was drawn.
    if (piece.pic !== undefined) {
      if (line !== '') lines.push(line)
      lines.push(piece.pic)
      line = ''
      last = null
      continue
    }
    if (piece.text === '') continue
    if (last) {
      const sameDirection = Math.abs(piece.dx - last.dx) < 0.01 && Math.abs(piece.dy - last.dy) < 0.01
      const size = Math.max(piece.size, last.size)
      const isNewLine = !sameDirection || Math.abs(piece.y - last.y) > size * 0.5 || piece.x < last.end - size * 2
      if (isNewLine) {
        lines.push(line)
        line = ''
      } else if (piece.x - last.end > size * 0.15 && !line.endsWith(' ') && !piece.text.startsWith(' ')) {
        line += ' '
      }
    }
    line += piece.text
    last = piece
  }
  if (line !== '') lines.push(line)
  return lines
}

const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/
const RTL_RUN = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]+(?:[ \t]+[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]+)*/g

/**
 * A line of Hebrew or Arabic as PDFs draw it (left to right on the page) put
 * back in reading order: a mostly right-to-left line has its runs reversed,
 * each right-to-left run's letters reversed, and numbers and Latin words kept as they are.
 */
function logicalOrder(line: string): string {
  if (!RTL.test(line)) return line
  const rtl = (line.match(RTL_RUN) ?? []).join('').length
  const letters = line.replace(/[\s\d\p{P}]/gu, '').length
  const flip = (run: string) => [...run].reverse().join('')
  if (rtl * 2 < letters) return line.replace(RTL_RUN, flip)
  const parts = line.split(/([\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]+(?:[ \t]+[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]+)*)/)
  return parts
    .reverse()
    .map(part => (RTL.test(part) ? flip(part) : part.replace(/[()[\]{}<>]/g, ch => ({ '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' })[ch] ?? ch)))
    .join('')
}

export type PdfResult = { kind: 'lines'; rows: DocRow[]; note?: string; pictures?: Picture[] } | { kind: 'error'; message: string }

export async function readPdf(bytes: Uint8Array): Promise<PdfResult> {
  // The %PDF- header is sometimes missing or damaged: what decides is whether a document can be found in the file.
  decoded = new WeakMap()
  decodedBytes = 0
  const doc = Object.assign(new Doc(), { b: bytes })
  doc.load()
  const encrypt = doc.trailer.get('Encrypt')
  if (encrypt !== undefined && encrypt !== null) {
    if (encrypt instanceof Ref) doc.encryptRef = encrypt
    const info = await doc.dict(encrypt)
    const protectedMessage = { kind: 'error' as const, message: 'This PDF is locked, so its text can’t be shown.' }
    if (!info || nameOf(info.get('Filter')) !== 'Standard') return protectedMessage
    const ids = await doc.get(doc.trailer.get('ID'))
    const id = Array.isArray(ids) && ids[0] instanceof PdfString ? ids[0].bytes : new Uint8Array(0)
    const v = Number(info.get('V') ?? 0)
    let method: 'RC4' | 'AES' | 'None' = 'RC4'
    if (v >= 4) {
      const filters = await doc.dict(info.get('CF'))
      const stmName = nameOf(info.get('StmF')) ?? 'Identity'
      const cf = stmName === 'Identity' ? undefined : await doc.dict(filters?.get(stmName))
      const cfm = nameOf(cf?.get('CFM'))
      method = stmName === 'Identity' || cfm === 'None' ? 'None' : cfm === 'AESV2' || cfm === 'AESV3' ? 'AES' : 'RC4'
    }
    const str = (key: string) => {
      const s = info.get(key)
      return s instanceof PdfString ? s.bytes : new Uint8Array(0)
    }
    const ue = info.get('UE')
    const decrypt = await openEncrypted({
      V: v,
      R: Number(info.get('R') ?? 2),
      length: Number(info.get('Length') ?? 40),
      O: str('O'),
      U: str('U'),
      ...(ue instanceof PdfString ? { UE: ue.bytes } : {}),
      P: Number(info.get('P') ?? 0),
      id,
      encryptMetadata: info.get('EncryptMetadata') !== false,
      method,
    })
    if (!decrypt) return protectedMessage
    doc.decrypt = decrypt
  }

  let all = await pages(doc)
  if (all.length === 0) {
    // A broken page tree: every page object in the file, in object order, as pypdf finds them.
    for (const num of [...doc.entries.keys()].sort((a, b) => a - b)) {
      const dict = await doc.dict(refObj(num, 0))
      if (dict && nameOf(dict.get('Type')) === 'Page') all.push(dict)
      if (all.length > 10_000) break
    }
  }
  if (all.length === 0) throw new PdfError('it has no pages that can be read')
  const rows: DocRow[] = []
  const pictures: Picture[] = []
  const drawn = new Set<Value>()
  // Fonts are read once for the whole document, not again on every page.
  const fonts = new Map<Value, Font>()
  const budget = { ops: MAX_OPERATORS }
  let shown = 0
  let isCut = false
  let isPartPage = false
  for (const [k, page] of all.entries()) {
    if (rows.length >= MAX_ROWS) {
      isCut = true
      break
    }
    // Out of time or of decoding allowed: shown up to here.
    if (isLate() || decodedBytes > MAX_DECODED) {
      isCut = true
      break
    }
    const number = k + 1
    rows.push({ text: `Page ${number}`, anchor: `page ${number}`, style: 'h3', unit: 'page' })
    let lines: (string | number)[] = []
    try {
      lines = linesOf(await pageText(doc, page, budget, pictures, drawn, fonts))
    } catch {
      lines = []
    }
    let lineNumber = 0
    for (const line of lines) {
      if (rows.length >= MAX_ROWS) break
      if (typeof line === 'number') {
        const name = `Picture ${line + 1}`
        rows.push({ text: `[${name}]`, anchor: `page ${number}, picture ${line + 1}`, unit: 'line', style: 'p', pic: line, spans: [{ t: `▣ ${name}`, d: 1 }] })
        continue
      }
      lineNumber += 1
      if (line.trim()) rows.push({ text: clean(logicalOrder(line).trimEnd()), anchor: `page ${number}, line ${lineNumber}`, unit: 'line' })
    }
    shown = number
    if (budget.ops < 0) {
      isPartPage = true
      isCut = true
      break
    }
  }
  const result: PdfResult = { kind: 'lines', rows, ...(pictures.length > 0 ? { pictures } : {}) }
  if (isPartPage) result.note = `This PDF holds more than the pane can read quickly: it is shown up to part of page ${shown} of ${all.length}. Ask Claude about the rest, or open it in your PDF reader.`
  else if (isCut) result.note = `Only the first ${shown} of ${all.length} pages are shown.`
  else if (rows.length > 0 && rows.every(row => row.unit === 'page' || row.pic !== undefined))
    result.note = pictures.length > 0 ? 'This PDF has no text layer (it may be scanned): its pages are the ▣ Picture rows, drawn in kitty and Ghostty.' : 'This PDF has no text layer (it may be scanned), so only page markers are shown.'
  return result
}
