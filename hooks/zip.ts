// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Reads the parts of a zip file (Word and Excel files are zips), with the
 * DEFLATE decompressor written out here: the hooks environment has none,
 * and no compiled code. Every size is capped, so a zip bomb stops early.
 */

export class ZipError extends Error {}

/** What a part may expand to, and all the parts read from one file together. */
export const MAX_PART_BYTES = 200 * 1024 * 1024
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024

type Entry = { method: number; crc: number; compressed: number; size: number; offset: number; isEncrypted: boolean }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let k = 0; k < bytes.length; k += 1) c = CRC_TABLE[(c ^ bytes[k]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type Zip = {
  names: string[]
  /** The part's bytes, or null when the zip has no part of that name. */
  read: (name: string) => Uint8Array | null
  /** The part as UTF-8 text, or null. */
  text: (name: string) => string | null
  /**
   * The start of a part as UTF-8 text, at most `most` bytes of it: a large
   * sheet or document is shown from its start, so the rest is never unpacked.
   * `isCut` when there was more.
   */
  textStart: (name: string, most: number) => { text: string; isCut: boolean } | null
  /** A small part (styles, relationships, a workbook's sheet list) as text, at most 8 MB of it. */
  side: (name: string) => string | null
}

const u16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0

export function openZip(bytes: Uint8Array): Zip {
  // The end-of-directory record: 22 bytes, then a comment of up to 65,535.
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at -= 1) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new ZipError('it is not a valid Office file')
  const count = u16(bytes, end + 10)
  let at = u32(bytes, end + 16)
  if (count === 0xffff || at === 0xffffffff) throw new ZipError('it is too large to show here')
  const entries = new Map<string, Entry>()
  let total = 0
  const decoder = new TextDecoder('utf-8')
  for (let k = 0; k < count; k += 1) {
    if (u32(bytes, at) !== 0x02014b50) throw new ZipError('it is damaged')
    const flags = u16(bytes, at + 8)
    const nameLength = u16(bytes, at + 28)
    const entry: Entry = {
      method: u16(bytes, at + 10),
      crc: u32(bytes, at + 16),
      compressed: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      offset: u32(bytes, at + 42),
      isEncrypted: (flags & 1) === 1,
    }
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength)
    let name = decoder.decode(rawName)
    // An Info-ZIP Unicode Path field (0x7075) names the part in UTF-8 when it matches the plain name's checksum.
    const extraStart = at + 46 + nameLength
    const extraEnd = extraStart + u16(bytes, at + 30)
    for (let x = extraStart; x + 4 <= extraEnd; ) {
      const id = u16(bytes, x)
      const size = u16(bytes, x + 2)
      if (id === 0x7075 && size >= 5 && bytes[x + 4] === 1 && u32(bytes, x + 5) === crc32(rawName)) name = decoder.decode(bytes.subarray(x + 9, x + 4 + size))
      x += 4 + size
    }
    entries.set(name, entry)
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32)
  }
  // What has been unpacked so far, across every part read: a zip bomb stops here.
  let unpacked = 0
  const unpack = (name: string, most?: number): { bytes: Uint8Array; isCut: boolean } | null => {
    const entry = entries.get(name)
    if (!entry) return null
    if (entry.isEncrypted) throw new ZipError('it is password-protected')
    const isCut = most !== undefined && entry.size > most
    if (!isCut && entry.size > MAX_PART_BYTES) throw new ZipError('it expands to more than 200 MB, too large to show here')
    unpacked += isCut ? most : entry.size
    if (unpacked > MAX_TOTAL_BYTES) throw new ZipError('it expands to more than 300 MB, too large to show here')
    const local = entry.offset
    if (u32(bytes, local) !== 0x04034b50) throw new ZipError('it is damaged')
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
    const data = bytes.subarray(start, start + entry.compressed)
    let part: Uint8Array
    if (entry.method === 0) part = data.subarray(0, isCut ? most : entry.size)
    else if (entry.method === 8) part = inflate(data, entry.size, false, isCut ? most : undefined)
    else throw new ZipError('it uses a compression this pane can’t read')
    // A whole part that doesn't match its checksum is damaged: refused, as Excel and Word do.
    if (!isCut && crc32(part) !== entry.crc) throw new ZipError('it is damaged')
    return { bytes: part, isCut }
  }
  return {
    names: [...entries.keys()],
    read: name => unpack(name)?.bytes ?? null,
    text: name => {
      const part = unpack(name)
      return part === null ? null : decoder.decode(part.bytes)
    },
    textStart: (name, most) => {
      const part = unpack(name, most)
      return part === null ? null : { text: decoder.decode(part.bytes), isCut: part.isCut }
    },
    side: name => {
      const part = unpack(name, 8 * 1024 * 1024)
      return part === null ? null : decoder.decode(part.bytes)
    },
  }
}

// ── DEFLATE (RFC 1951) ──

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/** A canonical Huffman code: how many codes of each length, the symbols in code order, and a lookup table for codes of up to FAST bits. */
type Huffman = { counts: Uint16Array; symbols: Uint16Array; table: Int32Array }

/** Codes this short are found in one table lookup (`symbol << 4 | length`); longer ones bit by bit. */
const FAST = 9

function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16)
  for (let k = 0; k < lengths.length; k += 1) counts[lengths[k] ?? 0]! += 1
  counts[0] = 0
  const offsets = new Uint16Array(16)
  for (let len = 1; len < 16; len += 1) offsets[len] = offsets[len - 1]! + counts[len - 1]!
  const symbols = new Uint16Array(lengths.length)
  for (let k = 0; k < lengths.length; k += 1) {
    const len = lengths[k] ?? 0
    if (len !== 0) symbols[offsets[len]!++] = k
  }
  // DEFLATE sends codes first bit first, so the table is indexed by each code reversed.
  const table = new Int32Array(1 << FAST)
  let code = 0
  let index = 0
  for (let len = 1; len <= FAST; len += 1) {
    for (let n = 0; n < counts[len]!; n += 1) {
      let reversed = 0
      for (let b = 0; b < len; b += 1) reversed |= ((code >> b) & 1) << (len - 1 - b)
      for (let at = reversed; at < 1 << FAST; at += 1 << len) table[at] = (symbols[index]! << 4) | len
      index += 1
      code += 1
    }
    code <<= 1
  }
  return { counts, symbols, table }
}

let FIXED: { lit: Huffman; dist: Huffman } | null = null
function fixedCodes() {
  if (!FIXED) {
    const lengths = new Uint8Array(288)
    lengths.fill(8, 0, 144)
    lengths.fill(9, 144, 256)
    lengths.fill(7, 256, 280)
    lengths.fill(8, 280, 288)
    FIXED = { lit: huffman(lengths), dist: huffman(new Uint8Array(30).fill(5)) }
  }
  return FIXED
}

/**
 * Decompresses raw DEFLATE data that should expand to at most `expected`
 * bytes; more than that is refused. When `isLenient`, damaged data gives what
 * was read before the damage (PDF streams are often cut short) instead of an error.
 * With `stopAt`, it stops after that many bytes: the start of a large part.
 */
class Enough extends Error {}

export function inflate(input: Uint8Array, expected: number, isLenient = false, stopAt?: number): Uint8Array {
  const limit = Math.min(expected, stopAt ?? MAX_PART_BYTES, MAX_PART_BYTES)
  let out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)))
  let length = 0
  let pos = 0
  let bit = 0
  let bits = 0

  const need = (n: number) => {
    while (bits < n) {
      if (pos >= input.length) throw new ZipError('it is damaged (cut short)')
      bit |= input[pos++]! << bits
      bits += 8
    }
  }
  const take = (n: number) => {
    if (n === 0) return 0
    need(n)
    const value = bit & ((1 << n) - 1)
    bit >>>= n
    bits -= n
    return value
  }
  const decode = (h: Huffman) => {
    while (bits < FAST && pos < input.length) {
      bit |= input[pos++]! << bits
      bits += 8
    }
    const hit = h.table[bit & ((1 << FAST) - 1)]!
    if (hit !== 0 && (hit & 15) <= bits) {
      bit >>>= hit & 15
      bits -= hit & 15
      return hit >> 4
    }
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len += 1) {
      code |= take(1)
      const count = h.counts[len]!
      if (code - first < count) return h.symbols[index + code - first]!
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    throw new ZipError('it is damaged (bad code)')
  }
  const room = (n: number) => {
    if (length + n > limit) throw stopAt !== undefined && length + n > stopAt ? new Enough() : new ZipError('it expands to more than its own directory says')
    if (length + n > out.length) {
      const bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, length + n)))
      bigger.set(out.subarray(0, length))
      out = bigger
    }
  }

  let isLast = false
  try {
  while (!isLast) {
    isLast = take(1) === 1
    const type = take(2)
    if (type === 0) {
      bit = 0
      bits = 0
      if (pos + 4 > input.length) throw new ZipError('it is damaged (cut short)')
      const size = u16(input, pos)
      pos += 4
      if (pos + size > input.length) throw new ZipError('it is damaged (cut short)')
      room(size)
      out.set(input.subarray(pos, pos + size), length)
      length += size
      pos += size
      continue
    }
    let lit: Huffman
    let dist: Huffman
    if (type === 1) {
      ;({ lit, dist } = fixedCodes())
    } else if (type === 2) {
      const litCount = take(5) + 257
      const distCount = take(5) + 1
      const codeCount = take(4) + 4
      const codeLengths = new Uint8Array(19)
      for (let k = 0; k < codeCount; k += 1) codeLengths[CODE_LENGTH_ORDER[k]!] = take(3)
      const codeCode = huffman(codeLengths)
      const lengths = new Uint8Array(litCount + distCount)
      for (let k = 0; k < litCount + distCount; ) {
        const symbol = decode(codeCode)
        if (symbol < 16) {
          lengths[k++] = symbol
          continue
        }
        let repeat: number
        let value = 0
        if (symbol === 16) {
          if (k === 0) throw new ZipError('it is damaged (bad lengths)')
          value = lengths[k - 1]!
          repeat = 3 + take(2)
        } else if (symbol === 17) repeat = 3 + take(3)
        else repeat = 11 + take(7)
        if (k + repeat > lengths.length) throw new ZipError('it is damaged (bad lengths)')
        lengths.fill(value, k, k + repeat)
        k += repeat
      }
      lit = huffman(lengths.subarray(0, litCount))
      dist = huffman(lengths.subarray(litCount))
    } else {
      throw new ZipError('it is damaged (bad block)')
    }
    for (;;) {
      const symbol = decode(lit)
      if (symbol < 256) {
        room(1)
        out[length++] = symbol
      } else if (symbol === 256) {
        break
      } else {
        const lk = symbol - 257
        if (lk >= 29) throw new ZipError('it is damaged (bad length)')
        const size = LENGTH_BASE[lk]! + take(LENGTH_EXTRA[lk]!)
        const dk = decode(dist)
        if (dk >= 30) throw new ZipError('it is damaged (bad distance)')
        const back = DIST_BASE[dk]! + take(DIST_EXTRA[dk]!)
        if (back > length) throw new ZipError('it is damaged (bad distance)')
        room(size)
        for (let k = 0; k < size; k += 1, length += 1) out[length] = out[length - back]!
      }
    }
  }
  } catch (error) {
    if (error instanceof Enough) return out.subarray(0, length)
    if (!isLenient || !(error instanceof ZipError) || /more than/.test(error.message)) throw error
  }
  return out.subarray(0, length)
}
