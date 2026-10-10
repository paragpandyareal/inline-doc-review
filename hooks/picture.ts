// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Pictures inside documents, for the pane's preview: PNG, JPEG and GIF
 * decoded here (the hooks environment has no image decoder), scaled down
 * to a preview as they are read, and drawn as coloured half-block cells,
 * which any terminal shows. Formats the pane can't decode are named, so it
 * can say so plainly.
 */

import type { Pixels } from '../types'
import { TooSlow, checkTime } from './deadline'
import { inflate } from './zip'

export type { Pixels }

/** The longest side a picture is decoded at: what an Image shows sharply, and still under its 2 MiB of pixels. */
const PREVIEW_SIDE = 720
/** Larger pictures aren't decoded: a phone photo is 12 million pixels. */
const MAX_PIXELS = 16_000_000
/** JPEG scans a picture may have: progressive ones use about 10. */
const MAX_SCANS = 64

export class PictureError extends Error {}

/** The format of a picture's bytes, by their first bytes. */
export function sniff(b: Uint8Array): string {
  const at = (k: number) => b[k] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8) return 'jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'gif'
  if (at(0) === 0x42 && at(1) === 0x4d) return 'bmp'
  if ((at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a) || (at(0) === 0x4d && at(1) === 0x4d && at(3) === 0x2a)) return 'tiff'
  if (at(0) === 0x01 && at(1) === 0 && at(2) === 0 && at(3) === 0 && at(40) === 0x20 && at(41) === 0x45 && at(42) === 0x4d && at(43) === 0x46) return 'emf'
  if ((at(0) === 0xd7 && at(1) === 0xcd && at(2) === 0xc6 && at(3) === 0x9a) || (at(0) === 0x01 && at(1) === 0 && at(2) === 0x09 && at(3) === 0)) return 'wmf'
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) return 'webp'
  if (at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0x0c && at(4) === 0x6a && at(5) === 0x50) return 'jp2'
  const head = String.fromCharCode(...b.subarray(0, 256)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return 'unknown'
}

/** How the pane names a format it can't preview. */
const FORMAT_NAMES: Record<string, string> = {
  bmp: 'a BMP picture',
  tiff: 'a TIFF picture',
  emf: 'an EMF drawing',
  wmf: 'a WMF drawing',
  webp: 'a WebP picture',
  jp2: 'a JPEG 2000 picture',
  svg: 'an SVG drawing',
  unknown: 'in a format the pane doesn’t know',
}

/** A picture file's pixels, or why it can't be shown: a format the pane doesn't decode, or damaged data. */
export function decodePicture(bytes: Uint8Array): Pixels | string {
  const kind = sniff(bytes)
  try {
    if (kind === 'png') return decodePng(bytes)
    if (kind === 'jpeg') return decodeJpeg(bytes)
    if (kind === 'gif') return decodeGif(bytes)
  } catch (error) {
    if (error instanceof TooSlow) return 'it takes too long to draw here'
    return error instanceof PictureError ? error.message : 'the picture is damaged'
  }
  return kind === 'unknown' || !FORMAT_NAMES[kind] ? 'it is in a format the pane doesn’t know' : `it is ${FORMAT_NAMES[kind]}, which the pane can’t draw`
}

// ── Scaling down as the rows come ──

/** Averages a picture's rows into a smaller one, composited on white, as they are decoded: the full picture is never held. */
export class Shrink {
  readonly width: number
  readonly height: number
  private sums: Float64Array
  private counts: Uint32Array
  constructor(
    readonly fullWidth: number,
    readonly fullHeight: number,
    side = PREVIEW_SIDE,
  ) {
    if (fullWidth < 1 || fullHeight < 1) throw new PictureError('the picture has no size')
    if (fullWidth * fullHeight > MAX_PIXELS) throw new PictureError('the picture is too large to preview')
    const scale = Math.min(1, side / Math.max(fullWidth, fullHeight))
    this.width = Math.max(1, Math.round(fullWidth * scale))
    this.height = Math.max(1, Math.round(fullHeight * scale))
    this.sums = new Float64Array(this.width * this.height * 3)
    this.counts = new Uint32Array(this.width * this.height)
  }
  /** One full-size row, `rgba` 4 bytes a pixel. */
  row(y: number, rgba: Uint8Array | Uint8ClampedArray) {
    checkTime()
    const ty = Math.min(this.height - 1, Math.floor((y * this.height) / this.fullHeight))
    const base = ty * this.width
    for (let x = 0; x < this.fullWidth; x += 1) {
      const tx = Math.min(this.width - 1, Math.floor((x * this.width) / this.fullWidth))
      const a = rgba[x * 4 + 3]! / 255
      const at = (base + tx) * 3
      this.sums[at] = this.sums[at]! + rgba[x * 4]! * a + 255 * (1 - a)
      this.sums[at + 1] = this.sums[at + 1]! + rgba[x * 4 + 1]! * a + 255 * (1 - a)
      this.sums[at + 2] = this.sums[at + 2]! + rgba[x * 4 + 2]! * a + 255 * (1 - a)
      this.counts[base + tx] = this.counts[base + tx]! + 1
    }
  }
  done(): Pixels {
    const rgb = new Uint8Array(this.width * this.height * 3)
    for (let k = 0; k < this.counts.length; k += 1) {
      const n = this.counts[k]! || 1
      const fill = this.counts[k] ? 0 : 255
      rgb[k * 3] = fill || Math.round(this.sums[k * 3]! / n)
      rgb[k * 3 + 1] = fill || Math.round(this.sums[k * 3 + 1]! / n)
      rgb[k * 3 + 2] = fill || Math.round(this.sums[k * 3 + 2]! / n)
    }
    return { width: this.width, height: this.height, rgb, fullWidth: this.fullWidth, fullHeight: this.fullHeight }
  }
}

// ── PNG ──

function decodePng(b: Uint8Array): Pixels {
  const u32 = (at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
  let at = 8
  let width = 0
  let height = 0
  let depth = 8
  let color = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (at + 8 <= b.length) {
    const length = u32(at)
    const type = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!)
    const data = b.subarray(at + 8, Math.min(b.length, at + 8 + length))
    if (type === 'IHDR') {
      width = u32(at + 8)
      height = u32(at + 12)
      depth = data[8]!
      color = data[9]!
      interlace = data[12]!
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    at += 12 + length
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new PictureError('the PNG is damaged')
  const shrink = new Shrink(width, height)
  const zdata = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  let o = 0
  for (const d of idat) {
    zdata.set(d, o)
    o += d.length
  }
  const bitsPerPixel = channels * depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const passes =
    interlace === 1
      ? [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ]
      : [[0, 0, 1, 1]]
  const sizes = passes.map(([x0, y0, dx, dy]) => {
    const w = Math.ceil((width - x0!) / dx!)
    const h = Math.ceil((height - y0!) / dy!)
    return { w: Math.max(0, w), h: w > 0 ? Math.max(0, h) : 0 }
  })
  const expected = sizes.reduce((n, s) => n + s.h * (1 + Math.ceil((s.w * bitsPerPixel) / 8)), 0)
  // 16-bit colour with transparency unpacks to 8 bytes a pixel: more than the pane will hold for a preview.
  if (expected > 96 * 1024 * 1024) throw new PictureError('the picture is too large to preview')
  const raw = inflate(zdata.subarray(2), expected, true)
  const max = (1 << depth) - 1
  // An interlaced picture is put together whole first; a plain one goes row by row.
  const whole = interlace === 1 ? new Uint8Array(width * height * 4) : null
  const line = new Uint8Array(width * 4)
  let pos = 0
  passes.forEach(([x0, y0, dx, dy], p) => {
    const { w, h } = sizes[p]!
    if (w === 0 || h === 0) return
    const stride = Math.ceil((w * bitsPerPixel) / 8)
    let prev = new Uint8Array(stride)
    for (let y = 0; y < h; y += 1) {
      const filter = raw[pos] ?? 0
      const cur = new Uint8Array(stride)
      cur.set(raw.subarray(pos + 1, pos + 1 + stride))
      pos += 1 + stride
      for (let k = 0; k < stride; k += 1) {
        const left = k >= bpp ? cur[k - bpp]! : 0
        const up = prev[k]!
        const ul = k >= bpp ? prev[k - bpp]! : 0
        if (filter === 1) cur[k] = cur[k]! + left
        else if (filter === 2) cur[k] = cur[k]! + up
        else if (filter === 3) cur[k] = cur[k]! + ((left + up) >> 1)
        else if (filter === 4) {
          const pa = Math.abs(up - ul)
          const pb = Math.abs(left - ul)
          const pc = Math.abs(left + up - 2 * ul)
          cur[k] = cur[k]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
        }
      }
      prev = cur
      const sample = (i: number) => {
        if (depth === 8) return cur[i]!
        if (depth === 16) return cur[i * 2]!
        const bit = i * depth
        return (((cur[bit >> 3]! >> (8 - depth - (bit & 7))) & max) * 255) / max
      }
      const raw16 = (i: number) => (depth === 16 ? (cur[i * 2]! << 8) | cur[i * 2 + 1]! : depth < 8 ? (((cur[(i * depth) >> 3]! >> (8 - depth - ((i * depth) & 7))) & max)) : cur[i]!)
      for (let x = 0; x < w; x += 1) {
        let r: number, g: number, bl: number
        let a = 255
        if (color === 0) {
          r = g = bl = sample(x)
          if (trns && trns.length >= 2 && raw16(x) === ((trns[0]! << 8) | trns[1]!)) a = 0
        } else if (color === 2) {
          r = sample(x * 3)
          g = sample(x * 3 + 1)
          bl = sample(x * 3 + 2)
          if (trns && trns.length >= 6 && raw16(x * 3) === ((trns[0]! << 8) | trns[1]!) && raw16(x * 3 + 1) === ((trns[2]! << 8) | trns[3]!) && raw16(x * 3 + 2) === ((trns[4]! << 8) | trns[5]!)) a = 0
        } else if (color === 3) {
          const index = raw16(x)
          r = palette?.[index * 3] ?? 0
          g = palette?.[index * 3 + 1] ?? 0
          bl = palette?.[index * 3 + 2] ?? 0
          a = trns?.[index] ?? 255
        } else if (color === 4) {
          r = g = bl = sample(x * 2)
          a = sample(x * 2 + 1)
        } else {
          r = sample(x * 4)
          g = sample(x * 4 + 1)
          bl = sample(x * 4 + 2)
          a = sample(x * 4 + 3)
        }
        const tx = whole ? ((y0! + y * dy!) * width + x0! + x * dx!) * 4 : x * 4
        const target = whole ?? line
        target[tx] = r
        target[tx + 1] = g
        target[tx + 2] = bl
        target[tx + 3] = a
      }
      if (!whole) shrink.row(y, line)
    }
  })
  if (whole) for (let y = 0; y < height; y += 1) shrink.row(y, whole.subarray(y * width * 4, (y + 1) * width * 4))
  return shrink.done()
}

// ── GIF (the first frame) ──

function decodeGif(b: Uint8Array): Pixels {
  const u16 = (at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
  const width = u16(6)
  const height = u16(8)
  const flags = b[10] ?? 0
  let at = 13
  let global: Uint8Array | null = null
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1))
    global = b.subarray(at, at + size)
    at += size
  }
  let transparent = -1
  while (at < b.length) {
    const block = b[at]!
    if (block === 0x21) {
      // An extension: a graphic control one may name the transparent colour.
      if (b[at + 1] === 0xf9 && (b[at + 3]! & 1)) transparent = b[at + 6]!
      at += 2
      while (at < b.length && b[at] !== 0) at += b[at]! + 1
      at += 1
    } else if (block === 0x2c) {
      const left = u16(at + 1)
      const top = u16(at + 3)
      const w = u16(at + 5)
      const h = u16(at + 7)
      const lflags = b[at + 9]!
      at += 10
      let table = global
      if (lflags & 0x80) {
        const size = 3 * (1 << ((lflags & 7) + 1))
        table = b.subarray(at, at + size)
        at += size
      }
      // The frame is drawn on the picture: it can't be larger, nor make the pane decode more.
      if (w < 1 || h < 1 || w * h > MAX_PIXELS || width * height > MAX_PIXELS) throw new PictureError('the picture is too large to preview')
      const isInterlaced = (lflags & 0x40) !== 0
      const minCode = b[at++]!
      if (minCode < 2 || minCode > 11) throw new PictureError('the GIF is damaged')
      const parts: number[] = []
      while (at < b.length && b[at] !== 0) {
        for (let k = 1; k <= b[at]!; k += 1) parts.push(b[at + k]!)
        at += b[at]! + 1
      }
      const indices = lzwGif(Uint8Array.from(parts), minCode, w * h)
      const shrink = new Shrink(width, height)
      const rows: number[] = []
      const [shownW, shownH] = [Math.min(w, width - left), Math.min(h, height - top)]
      if (isInterlaced) for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) rows.push(y)
      else for (let y = 0; y < h; y += 1) rows.push(y)
      const frame = new Uint8Array(width * height * 4)
      rows.forEach((y, k) => {
        checkTime()
        if (y >= shownH) return
        for (let x = 0; x < shownW; x += 1) {
          const index = indices[k * w + x] ?? 0
          const tx = ((top + y) * width + left + x) * 4
          if (top + y >= height || left + x >= width) continue
          frame[tx] = table?.[index * 3] ?? 0
          frame[tx + 1] = table?.[index * 3 + 1] ?? 0
          frame[tx + 2] = table?.[index * 3 + 2] ?? 0
          frame[tx + 3] = index === transparent ? 0 : 255
        }
      })
      for (let y = 0; y < height; y += 1) shrink.row(y, frame.subarray(y * width * 4, (y + 1) * width * 4))
      return shrink.done()
    } else break
  }
  throw new PictureError('the GIF has no picture')
}

function lzwGif(data: Uint8Array, minCode: number, size: number): Uint8Array {
  const out = new Uint8Array(size)
  const clear = 1 << minCode
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const lengths = new Uint16Array(4096)
  for (let k = 0; k < clear; k += 1) {
    suffix[k] = k
    lengths[k] = 1
  }
  let codeSize = minCode + 1
  let next = clear + 2
  let old = -1
  let bit = 0
  let n = 0
  const stack = new Uint8Array(4097)
  while (n < size) {
    checkTime()
    if ((bit >> 3) + 2 >= data.length + 2) break
    let code = 0
    for (let k = 0; k < codeSize; k += 1, bit += 1) code |= (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) << k
    if (code === clear) {
      codeSize = minCode + 1
      next = clear + 2
      old = -1
      continue
    }
    if (code === clear + 1) break
    let cur = code
    let first: number
    let depth = 0
    if (code >= next) {
      if (old < 0) break
      cur = old
    }
    while (cur >= clear && depth < 4096) {
      stack[depth++] = suffix[cur]!
      cur = prefix[cur]!
    }
    first = cur
    stack[depth++] = first
    if (code >= next) {
      // The code being defined: the old string and its own first letter.
      const last = stack[depth - 1]!
      for (let k = depth; k > 0; k -= 1) stack[k] = stack[k - 1]!
      stack[0] = last
      depth += 1
    }
    for (let k = depth - 1; k >= 0 && n < size; k -= 1) out[n++] = stack[k]!
    if (old >= 0 && next < 4096) {
      prefix[next] = old
      suffix[next] = first
      next += 1
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    old = code
  }
  return out
}

// ── JPEG (baseline and progressive) ──

const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

type JpegHuffman = { fast: Int32Array; maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; values: Uint8Array }

function jpegHuffman(counts: Uint8Array, values: Uint8Array): JpegHuffman {
  const fast = new Int32Array(512).fill(-1)
  const maxcode = new Int32Array(18).fill(-1)
  const valptr = new Int32Array(17)
  const mincode = new Int32Array(17)
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len += 1) {
    valptr[len] = k
    mincode[len] = code
    for (let n = 0; n < counts[len - 1]!; n += 1) {
      if (len <= 9) {
        const shift = 9 - len
        for (let f = 0; f < 1 << shift; f += 1) fast[(code << shift) | f] = (len << 8) | values[k]!
      }
      code += 1
      k += 1
    }
    maxcode[len] = counts[len - 1] ? code - 1 : -1
    code <<= 1
  }
  maxcode[17] = 0x7fffffff
  return { fast, maxcode, valptr, mincode, values }
}

type Component = { id: number; h: number; v: number; tq: number; perLine: number; perColumn: number; coefs: Int16Array; pred: number; dc?: JpegHuffman; ac?: JpegHuffman }

function decodeJpeg(d: Uint8Array): Pixels {
  const u16 = (at: number) => ((d[at] ?? 0) << 8) | (d[at + 1] ?? 0)
  const quant: Int32Array[] = []
  const dcTables: JpegHuffman[] = []
  const acTables: JpegHuffman[] = []
  let frame: { width: number; height: number; progressive: boolean; comps: Component[]; hmax: number; vmax: number; mcusX: number; mcusY: number } | null = null
  let restart = 0
  let scans = 0
  let adobe: number | null = null
  let pos = 2
  for (;;) {
    while (pos < d.length && d[pos] !== 0xff) pos += 1
    while (pos < d.length && d[pos] === 0xff) pos += 1
    if (pos >= d.length) break
    const marker = d[pos++]!
    if (marker === 0xd9) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    const length = u16(pos)
    const end = pos + length
    const seg = pos + 2
    if (marker === 0xdb) {
      for (let at = seg; at < end; ) {
        const pq = d[at]! >> 4
        const tq = d[at]! & 15
        at += 1
        const table = new Int32Array(64)
        for (let k = 0; k < 64; k += 1) {
          table[ZIGZAG[k]!] = pq ? u16(at + k * 2) : d[at + k]!
        }
        at += pq ? 128 : 64
        quant[tq] = table
      }
    } else if (marker === 0xc4) {
      for (let at = seg; at < end; ) {
        const tc = d[at]! >> 4
        const th = d[at]! & 15
        const counts = d.subarray(at + 1, at + 17)
        const total = counts.reduce((n, c) => n + c, 0)
        const values = d.slice(at + 17, at + 17 + total)
        ;(tc === 0 ? dcTables : acTables)[th] = jpegHuffman(counts, values)
        at += 17 + total
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = u16(seg + 1)
      const width = u16(seg + 3)
      const count = d[seg + 5]!
      const comps: Component[] = []
      for (let k = 0; k < count; k += 1) {
        const at = seg + 6 + k * 3
        comps.push({ id: d[at]!, h: Math.max(1, d[at + 1]! >> 4), v: Math.max(1, d[at + 1]! & 15), tq: d[at + 2]!, perLine: 0, perColumn: 0, coefs: new Int16Array(0), pred: 0 })
      }
      if (width * height > MAX_PIXELS) throw new PictureError('the picture is too large to preview')
      if (width === 0 || height === 0 || ![1, 3, 4].includes(count)) throw new PictureError('this JPEG can’t be previewed')
      const hmax = Math.max(...comps.map(c => c.h))
      const vmax = Math.max(...comps.map(c => c.v))
      const mcusX = Math.ceil(width / (8 * hmax))
      const mcusY = Math.ceil(height / (8 * vmax))
      for (const c of comps) {
        c.perLine = mcusX * c.h
        c.perColumn = mcusY * c.v
        c.coefs = new Int16Array(c.perLine * c.perColumn * 64)
      }
      frame = { width, height, progressive: marker === 0xc2, comps, hmax, vmax, mcusX, mcusY }
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      throw new PictureError('this JPEG uses a kind of compression the pane can’t preview')
    } else if (marker === 0xdd) {
      restart = u16(seg)
    } else if (marker === 0xee) {
      if (String.fromCharCode(...d.subarray(seg, seg + 5)) === 'Adobe') adobe = d[seg + 11] ?? 0
    } else if (marker === 0xda) {
      if (!frame) throw new PictureError('the JPEG is damaged')
      // Each scan decodes the whole picture again: a baseline JPEG has one, a progressive one about ten.
      scans += 1
      if (scans > (frame.progressive ? MAX_SCANS : 1)) break
      const ns = d[seg]!
      const scan: Component[] = []
      for (let k = 0; k < ns; k += 1) {
        const c = frame.comps.find(one => one.id === d[seg + 1 + k * 2])
        if (!c) throw new PictureError('the JPEG is damaged')
        const t = d[seg + 2 + k * 2]!
        c.dc = dcTables[t >> 4]
        c.ac = acTables[t & 15]
        scan.push(c)
      }
      const p = seg + 1 + ns * 2
      pos = decodeScan(d, end, frame, scan, restart, d[p]!, d[p + 1]!, d[p + 2]! >> 4, d[p + 2]! & 15)
      continue
    }
    pos = end
  }
  if (!frame) throw new PictureError('the JPEG has no picture')
  return jpegPixels(frame, quant, adobe)
}

/** Decodes one scan's coefficients; returns where the data after it starts. */
function decodeScan(
  d: Uint8Array,
  start: number,
  frame: { width: number; height: number; progressive: boolean; hmax: number; vmax: number; mcusX: number; mcusY: number },
  scan: Component[],
  restart: number,
  ss: number,
  se: number,
  ah: number,
  al: number,
): number {
  let pos = start
  let buf = 0
  let count = 0
  let isMarker = false
  const fill = () => {
    while (count <= 24) {
      let byte = 0
      if (!isMarker && pos < d.length) {
        byte = d[pos]!
        if (byte === 0xff) {
          const next = d[pos + 1] ?? 0
          if (next === 0) pos += 2
          else {
            isMarker = true
            byte = 0
          }
        } else pos += 1
      }
      buf = (buf | (byte << (24 - count))) >>> 0
      count += 8
    }
  }
  const bits = (n: number) => {
    if (n === 0) return 0
    if (count < n) fill()
    const v = buf >>> (32 - n)
    buf = (buf << n) >>> 0
    count -= n
    return v
  }
  const extend = (v: number, n: number) => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v)
  const decode = (h: JpegHuffman | undefined) => {
    if (!h) throw new PictureError('the JPEG is damaged')
    if (count < 16) fill()
    const hit = h.fast[buf >>> 23]!
    if (hit >= 0) {
      const len = hit >> 8
      buf = (buf << len) >>> 0
      count -= len
      return hit & 255
    }
    for (let len = 10; len <= 16; len += 1) {
      const code = buf >>> (32 - len)
      if (code <= h.maxcode[len]!) {
        buf = (buf << len) >>> 0
        count -= len
        return h.values[h.valptr[len]! + code - h.mincode[len]!] ?? 0
      }
    }
    throw new PictureError('the JPEG is damaged')
  }
  let eobrun = 0
  const block = (c: Component, row: number, col: number) => {
    if (row >= c.perColumn || col >= c.perLine) return
    const off = (row * c.perLine + col) * 64
    const z = c.coefs
    if (!frame.progressive) {
      const t = decode(c.dc)
      c.pred += extend(bits(t), t)
      z[off] = c.pred
      for (let k = 1; k < 64; ) {
        const rs = decode(c.ac)
        const s = rs & 15
        const r = rs >> 4
        if (s === 0) {
          if (r < 15) break
          k += 16
          continue
        }
        k += r
        if (k > 63) break
        z[off + ZIGZAG[k]!] = extend(bits(s), s)
        k += 1
      }
      return
    }
    if (ss === 0) {
      if (ah === 0) {
        const t = decode(c.dc)
        c.pred += extend(bits(t), t)
        z[off] = c.pred * (1 << al)
      } else if (bits(1)) z[off] = z[off]! | (1 << al)
      return
    }
    if (ah === 0) {
      if (eobrun > 0) {
        eobrun -= 1
        return
      }
      for (let k = ss; k <= se; ) {
        const rs = decode(c.ac)
        const s = rs & 15
        const r = rs >> 4
        if (s === 0) {
          if (r < 15) {
            eobrun = (1 << r) - 1 + (r ? bits(r) : 0)
            break
          }
          k += 16
          continue
        }
        k += r
        if (k > 63) break
        z[off + ZIGZAG[k]!] = extend(bits(s), s) * (1 << al)
        k += 1
      }
      return
    }
    const p1 = 1 << al
    const m1 = -1 << al
    let k = ss
    if (eobrun === 0) {
      for (; k <= se; k += 1) {
        const rs = decode(c.ac)
        let r = rs >> 4
        const s = rs & 15
        let value = 0
        if (s) value = bits(1) ? p1 : m1
        else if (r !== 15) {
          eobrun = (1 << r) + (r ? bits(r) : 0)
          break
        }
        while (k <= se) {
          const at = off + ZIGZAG[k]!
          if (z[at] !== 0) {
            if (bits(1) && (z[at]! & p1) === 0) z[at] = z[at]! + (z[at]! >= 0 ? p1 : m1)
          } else {
            if (r === 0) break
            r -= 1
          }
          k += 1
        }
        if (value && k <= se) z[off + ZIGZAG[k]!] = value
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k += 1) {
        const at = off + ZIGZAG[k]!
        if (z[at] !== 0 && bits(1) && (z[at]! & p1) === 0) z[at] = z[at]! + (z[at]! >= 0 ? p1 : m1)
      }
      eobrun -= 1
    }
  }

  const single = scan.length === 1 ? scan[0]! : null
  const total = single
    ? Math.ceil(Math.ceil((frame.width * single.h) / frame.hmax) / 8) * Math.ceil(Math.ceil((frame.height * single.v) / frame.vmax) / 8)
    : frame.mcusX * frame.mcusY
  const perRow = single ? Math.ceil(Math.ceil((frame.width * single.h) / frame.hmax) / 8) : frame.mcusX
  for (let n = 0; n < total; n += 1) {
    checkTime()
    if (restart && n > 0 && n % restart === 0) {
      // A restart marker: the bits start afresh, and so do the predictions.
      buf = 0
      count = 0
      isMarker = false
      eobrun = 0
      for (const c of scan) c.pred = 0
      while (pos < d.length && !(d[pos] === 0xff && d[pos + 1]! >= 0xd0 && d[pos + 1]! <= 0xd7)) pos += 1
      pos += 2
    }
    if (single) block(single, Math.floor(n / perRow), n % perRow)
    else {
      const my = Math.floor(n / frame.mcusX)
      const mx = n % frame.mcusX
      for (const c of scan) for (let v = 0; v < c.v; v += 1) for (let h = 0; h < c.h; h += 1) block(c, my * c.v + v, mx * c.h + h)
    }
  }
  for (const c of scan) c.pred = 0
  // On to the next marker.
  while (pos < d.length && !(d[pos] === 0xff && d[pos + 1] !== 0 && !(d[pos + 1]! >= 0xd0 && d[pos + 1]! <= 0xd7))) pos += 1
  return pos
}

const IDCT_COS = (() => {
  const table = new Float64Array(64)
  for (let x = 0; x < 8; x += 1) for (let u = 0; u < 8; u += 1) table[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2
  return table
})()

function jpegPixels(
  frame: { width: number; height: number; comps: Component[]; hmax: number; vmax: number },
  quant: Int32Array[],
  adobe: number | null,
): Pixels {
  const { width, height, comps, hmax, vmax } = frame
  // A big picture is read at an eighth of its size, from each block's average alone: plenty for a preview, and fast.
  const isEighth = Math.max(width, height) / 8 >= PREVIEW_SIDE
  const scale = isEighth ? 1 : 8
  const planes = comps.map(c => {
    const q = quant[c.tq] ?? new Int32Array(64).fill(1)
    const w = c.perLine * scale
    const plane = new Uint8ClampedArray(w * c.perColumn * scale)
    const tmp = new Float64Array(64)
    for (let row = 0; row < c.perColumn; row += 1) {
      checkTime()
      for (let col = 0; col < c.perLine; col += 1) {
        const off = (row * c.perLine + col) * 64
        if (isEighth) {
          plane[row * w + col] = c.coefs[off]! * q[0]! / 8 + 128
          continue
        }
        let isFlat = true
        for (let k = 1; k < 64 && isFlat; k += 1) if (c.coefs[off + k] !== 0) isFlat = false
        if (isFlat) {
          const value = c.coefs[off]! * q[0]! / 8 + 128
          for (let y = 0; y < 8; y += 1) plane.fill(value, (row * 8 + y) * w + col * 8, (row * 8 + y) * w + col * 8 + 8)
          continue
        }
        // Rows, then columns.
        for (let v = 0; v < 8; v += 1)
          for (let x = 0; x < 8; x += 1) {
            let sum = 0
            for (let u = 0; u < 8; u += 1) sum += IDCT_COS[x * 8 + u]! * c.coefs[off + v * 8 + u]! * q[v * 8 + u]!
            tmp[v * 8 + x] = sum
          }
        for (let x = 0; x < 8; x += 1)
          for (let y = 0; y < 8; y += 1) {
            let sum = 0
            for (let v = 0; v < 8; v += 1) sum += IDCT_COS[y * 8 + v]! * tmp[v * 8 + x]!
            plane[(row * 8 + y) * w + col * 8 + x] = sum + 128
          }
      }
    }
    return { plane, w, h: c.h, v: c.v }
  })
  const outW = isEighth ? Math.ceil(width / 8) : width
  const outH = isEighth ? Math.ceil(height / 8) : height
  const shrink = new Shrink(outW, outH)
  const line = new Uint8Array(outW * 4)
  const transform = adobe !== null ? adobe : comps.length === 3 && comps[0]!.id === 0x52 && comps[1]!.id === 0x47 ? 0 : comps.length === 3 ? 1 : 0
  const sample = (k: number, x: number, y: number) => {
    const p = planes[k]!
    return p.plane[Math.floor((y * p.v) / vmax) * p.w + Math.floor((x * p.h) / hmax)]!
  }
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let r: number, g: number, b: number
      if (comps.length === 1) r = g = b = sample(0, x, y)
      else {
        let c0 = sample(0, x, y)
        let c1 = sample(1, x, y)
        let c2 = sample(2, x, y)
        if (transform) {
          const yy = c0
          c0 = yy + 1.402 * (c2 - 128)
          c1 = yy - 0.344136 * (c1 - 128) - 0.714136 * (c2 - 128)
          c2 = yy + 1.772 * (sample(1, x, y) - 128)
        }
        if (comps.length === 4) {
          // CMYK, as Adobe writes it (inverted): each ink times the black.
          const k = sample(3, x, y)
          const isInverted = adobe !== null
          const ink = (c: number) => (isInverted ? c : 255 - c)
          const black = isInverted ? k : 255 - k
          r = (ink(c0) * black) / 255
          g = (ink(c1) * black) / 255
          b = (ink(c2) * black) / 255
        } else {
          r = c0
          g = c1
          b = c2
        }
      }
      line[x * 4] = Math.max(0, Math.min(255, r))
      line[x * 4 + 1] = Math.max(0, Math.min(255, g))
      line[x * 4 + 2] = Math.max(0, Math.min(255, b))
      line[x * 4 + 3] = 255
    }
    shrink.row(y, line)
  }
  const out = shrink.done()
  return { ...out, fullWidth: width, fullHeight: height }
}

// ── Raw samples (PDF images) ──

/**
 * A picture from raw samples, `components` a pixel at `bits` each, rows
 * padded to whole bytes, as PDF stores images; `colour` turns one pixel's
 * samples (each 0–1) into RGB 0–255.
 */
export function samplesToPixels(
  width: number,
  height: number,
  bits: number,
  components: number,
  data: Uint8Array,
  colour: (samples: number[]) => [number, number, number],
  /** How opaque each pixel is, 0–1: a PDF image's soft mask. */
  alpha?: (x: number, y: number) => number,
): Pixels {
  const shrink = new Shrink(width, height)
  const stride = Math.ceil((width * components * bits) / 8)
  const max = 2 ** bits - 1
  const line = new Uint8Array(width * 4)
  const samples = new Array<number>(components).fill(0)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        const index = x * components + c
        let v: number
        if (bits === 8) v = data[row + index] ?? 0
        else if (bits === 16) v = ((data[row + index * 2] ?? 0) << 8) | (data[row + index * 2 + 1] ?? 0)
        else {
          const bit = index * bits
          v = ((data[row + (bit >> 3)] ?? 0) >> (8 - bits - (bit & 7))) & max
        }
        samples[c] = v / max
      }
      const [r, g, b] = colour(samples)
      line[x * 4] = r
      line[x * 4 + 1] = g
      line[x * 4 + 2] = b
      line[x * 4 + 3] = alpha ? Math.round(alpha(x, y) * 255) : 255
    }
    shrink.row(y, line)
  }
  return shrink.done()
}

// ── Drawing ──

/** The cells a picture takes, at most `maxCols` × `maxRows`, keeping its shape (a cell is about twice as tall as it is wide). */
export function fitCells(px: { width: number; height: number }, maxCols: number, maxRows: number): { columns: number; rows: number } {
  let columns = Math.max(1, Math.min(maxCols, px.width))
  let tall = Math.round((columns * px.height) / px.width)
  if (tall > maxRows * 2) {
    tall = maxRows * 2
    columns = Math.max(1, Math.round((tall * px.width) / px.height))
  }
  return { columns, rows: Math.max(1, Math.ceil(tall / 2)) }
}

/** The picture as an Image source: its pixels, opaque, 4 bytes each. */
export function toRgba(px: Pixels): { rgba: string; width: number; height: number } {
  const out = new Uint8Array(px.width * px.height * 4)
  for (let k = 0, j = 0; k < px.width * px.height; k += 1, j += 3) {
    out[k * 4] = px.rgb[j]!
    out[k * 4 + 1] = px.rgb[j + 1]!
    out[k * 4 + 2] = px.rgb[j + 2]!
    out[k * 4 + 3] = 255
  }
  return { rgba: toBase64(out), width: px.width, height: px.height }
}

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let k = 0; k < bytes.length; k += 0x8000) out += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return btoa(out)
}
