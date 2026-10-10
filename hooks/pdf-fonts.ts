// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * What a PDF font's codes mean as text: the standard encodings, glyph names,
 * ToUnicode character maps, and the widths of the standard 14 fonts, which
 * PDFs may use without listing widths. Widths matter only for spacing:
 * where a word ends, so a gap after it can be told from a space.
 */

const ascii = Array.from({ length: 128 }, (_, k) => (k >= 32 && k < 127 ? String.fromCharCode(k) : ''))
const latin1 = Array.from({ length: 96 }, (_, k) => String.fromCharCode(0xa0 + k))

const CP1252 = [0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178]
export const WIN_ANSI: string[] = [...ascii, ...CP1252.map(c => (c ? String.fromCharCode(c) : '')), ...latin1]
WIN_ANSI[0xa0] = ' '
WIN_ANSI[0xad] = '-'

const MAC_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'
export const MAC_ROMAN: string[] = [...ascii, ...Array.from(MAC_HIGH)]

export const STANDARD: string[] = [...ascii, ...Array.from({ length: 128 }, () => '')]
STANDARD[0x27] = '’'
STANDARD[0x60] = '‘'
const STANDARD_HIGH: Record<number, string> = {
  0xa1: '¡', 0xa2: '¢', 0xa3: '£', 0xa4: '⁄', 0xa5: '¥', 0xa6: 'ƒ', 0xa7: '§', 0xa8: '¤', 0xa9: "'", 0xaa: '“', 0xab: '«', 0xac: '‹', 0xad: '›', 0xae: 'ﬁ', 0xaf: 'ﬂ',
  0xb1: '–', 0xb2: '†', 0xb3: '‡', 0xb4: '·', 0xb6: '¶', 0xb7: '•', 0xb8: '‚', 0xb9: '„', 0xba: '”', 0xbb: '»', 0xbc: '…', 0xbd: '‰', 0xbf: '¿',
  0xc1: '`', 0xc2: '´', 0xc3: 'ˆ', 0xc4: '˜', 0xc5: '¯', 0xc6: '˘', 0xc7: '˙', 0xc8: '¨', 0xca: '˚', 0xcb: '¸', 0xcd: '˝', 0xce: '˛', 0xcf: 'ˇ', 0xd0: '—',
  0xe1: 'Æ', 0xe3: 'ª', 0xe8: 'Ł', 0xe9: 'Ø', 0xea: 'Œ', 0xeb: 'º', 0xf1: 'æ', 0xf5: 'ı', 0xf8: 'ł', 0xf9: 'ø', 0xfa: 'œ', 0xfb: 'ß',
}
for (const [code, text] of Object.entries(STANDARD_HIGH)) STANDARD[Number(code)] = text

/** The Symbol font's built-in encoding, for its letters: Greek in place of Latin (q is θ). */
export const SYMBOL: string[] = [...ascii, ...Array.from({ length: 128 }, () => '')]
'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'.split('').forEach((ch, k) => (SYMBOL[65 + k] = ch))
'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'.split('').forEach((ch, k) => (SYMBOL[97 + k] = ch))
Object.assign(SYMBOL, { 0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x5c: '∴', 0x5e: '⊥', 0x60: '', 0x7e: '∼', 0xb0: '°', 0xb1: '±', 0xb4: '×', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xa3: '≤', 0xb3: '≥', 0xa5: '∞', 0xae: '→', 0xac: '←', 0xd6: '√', 0xe5: '∑', 0xf2: '∫' })

// ── Glyph names (the common part of the Adobe Glyph List) ──

const NAMED: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', parenleft: '(',
  parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=',
  greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', quoteleft: '‘',
  braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', exclamdown: '¡', cent: '¢', sterling: '£', fraction: '⁄', yen: '¥', florin: 'ƒ', section: '§',
  currency: '¤', quotedblleft: '“', guillemotleft: '«', guilsinglleft: '‹', guilsinglright: '›', fi: 'ﬁ', fl: 'ﬂ', ff: 'ff', ffi: 'ffi', ffl: 'ffl',
  endash: '–', emdash: '—', dagger: '†', daggerdbl: '‡', periodcentered: '·', paragraph: '¶', bullet: '•', quotesinglbase: '‚', quotedblbase: '„',
  quotedblright: '”', guillemotright: '»', ellipsis: '…', perthousand: '‰', questiondown: '¿', acute: '´', circumflex: 'ˆ', tilde: '˜', macron: '¯',
  breve: '˘', dotaccent: '˙', dieresis: '¨', ring: '˚', cedilla: '¸', hungarumlaut: '˝', ogonek: '˛', caron: 'ˇ', AE: 'Æ', ordfeminine: 'ª', Lslash: 'Ł',
  Oslash: 'Ø', OE: 'Œ', ordmasculine: 'º', ae: 'æ', dotlessi: 'ı', lslash: 'ł', oslash: 'ø', oe: 'œ', germandbls: 'ß', trademark: '™', copyright: '©',
  registered: '®', degree: '°', plusminus: '±', multiply: '×', divide: '÷', mu: 'µ', logicalnot: '¬', brokenbar: '¦', onehalf: '½', onequarter: '¼',
  threequarters: '¾', onesuperior: '¹', twosuperior: '²', threesuperior: '³', Euro: '€', euro: '€', nbspace: ' ', nonbreakingspace: ' ', sfthyphen: '-',
  softhyphen: '-', Eth: 'Ð', eth: 'ð', Thorn: 'Þ', thorn: 'þ', checkmark: '✓', arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}
const ACCENTS: Record<string, string> = { acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', tilde: '̃', ring: '̊', cedilla: '̧', caron: '̌', macron: '̄', breve: '̆', ogonek: '̨', dotaccent: '̇', hungarumlaut: '̋' }

/** The text a glyph name stands for: `eacute` → é, `uni00E9` → é, `f_i` → fi; '' when unknown. */
export function glyphText(name: string): string {
  const base = name.split('.')[0] ?? ''
  if (base.includes('_')) return base.split('_').map(glyphText).join('')
  if (base.length === 1) return base
  const named = NAMED[base]
  if (named !== undefined) return named
  let m = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base)
  if (m) return m[1]!.match(/.{4}/g)!.map(h => String.fromCharCode(Number.parseInt(h, 16))).join('')
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base)
  if (m) {
    const code = Number.parseInt(m[1]!, 16)
    return code <= 0x10ffff ? String.fromCodePoint(code) : ''
  }
  for (const [accent, mark] of Object.entries(ACCENTS)) {
    if (base.length === accent.length + 1 && base.endsWith(accent)) return (base[0]! + mark).normalize('NFC')
  }
  return ''
}

// ── ToUnicode character maps ──

export type CMap = {
  /** Byte lengths codes may have, from the codespace ranges: [length, low, high]. */
  ranges: [number, number, number][]
  unicode: Map<number, string>
  /** Code → CID, for an embedded encoding CMap. */
  cids?: Map<number, number>
}

const hexBytes = (hex: string) => {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '')
  return (clean.length % 2 ? `${clean}0` : clean).match(/../g)?.map(h => Number.parseInt(h, 16)) ?? []
}
const hexNumber = (hex: string) => hexBytes(hex).reduce((n, b) => n * 256 + b, 0)
const utf16 = (bytes: number[]) => {
  // A one-byte target (<41>, not <0041>) is out of spec but common: it is the character's code.
  if (bytes.length === 1) return String.fromCharCode(bytes[0]!)
  let out = ''
  for (let k = 0; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes[k]! << 8) | bytes[k + 1]!)
  return out
}

/** Reads a CMap: codespace ranges, bfchar/bfrange (to Unicode) and cidchar/cidrange (to CIDs). */
/** Entries one CMap may define: far more than any font has glyphs. */
const MAX_CMAP_ENTRIES = 200_000

export function parseCMap(text: string): CMap {
  const cmap: CMap = { ranges: [], unicode: new Map() }
  let left = MAX_CMAP_ENTRIES
  const sections = /begin(codespacerange|bfchar|bfrange|cidchar|cidrange)([\s\S]*?)end\1/g
  for (let m = sections.exec(text); m; m = sections.exec(text)) {
    const kind = m[1]
    const body = m[2] ?? ''
    const tokens = body.match(/<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\/[^\s/<>[\]()]+|-?\d+/g) ?? []
    if (kind === 'codespacerange') {
      for (let k = 0; k + 1 < tokens.length; k += 2) cmap.ranges.push([hexBytes(tokens[k]!).length, hexNumber(tokens[k]!), hexNumber(tokens[k + 1]!)])
    } else if (kind === 'bfchar') {
      for (let k = 0; k + 1 < tokens.length; k += 2) {
        const dest = tokens[k + 1]!
        cmap.unicode.set(hexNumber(tokens[k]!), dest.startsWith('/') ? glyphText(dest.slice(1)) : utf16(hexBytes(dest)))
      }
    } else if (kind === 'bfrange') {
      for (let k = 0; k + 2 < tokens.length; k += 3) {
        const lo = hexNumber(tokens[k]!)
        const hi = hexNumber(tokens[k + 1]!)
        const dest = tokens[k + 2]!
        if (hi - lo > 65_535 || hi < lo || (left -= hi - lo + 1) < 0) continue
        if (dest.startsWith('[')) {
          const items = dest.match(/<[0-9A-Fa-f\s]*>/g) ?? []
          items.forEach((item, i) => cmap.unicode.set(lo + i, utf16(hexBytes(item))))
        } else {
          const bytes = hexBytes(dest)
          for (let code = lo; code <= hi; code += 1) {
            const out = [...bytes]
            // The last byte counts up, carrying into the one before it.
            let add = code - lo
            for (let i = out.length - 1; i >= 0 && add > 0; i -= 1) {
              const sum = out[i]! + add
              out[i] = sum & 0xff
              add = sum >> 8
            }
            cmap.unicode.set(code, utf16(out))
          }
        }
      }
    } else if (kind === 'cidchar') {
      cmap.cids ??= new Map()
      for (let k = 0; k + 1 < tokens.length; k += 2) cmap.cids.set(hexNumber(tokens[k]!), Number(tokens[k + 1]))
    } else if (kind === 'cidrange') {
      cmap.cids ??= new Map()
      for (let k = 0; k + 2 < tokens.length; k += 3) {
        const lo = hexNumber(tokens[k]!)
        const hi = hexNumber(tokens[k + 1]!)
        if (hi - lo > 65_535 || hi < lo || (left -= hi - lo + 1) < 0) continue
        for (let code = lo; code <= hi; code += 1) cmap.cids.set(code, Number(tokens[k + 2]) + code - lo)
      }
    }
  }
  return cmap
}

// ── An embedded TrueType font's own character table ──

/**
 * Glyph id → text, from a TrueType font's 'cmap' table (the Windows Unicode
 * subtable, formats 4 and 12). For CID fonts that give no ToUnicode map: the
 * codes there are glyph ids, and this is how they become text.
 */
export function trueTypeGlyphText(font: Uint8Array): Map<number, string> {
  const out = new Map<number, string>()
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const u16 = (at: number) => (at + 2 <= font.length ? v.getUint16(at) : 0)
  const u32 = (at: number) => (at + 4 <= font.length ? v.getUint32(at) : 0)
  const tables = u16(4)
  let cmap = -1
  for (let k = 0; k < tables && k < 64; k += 1) {
    const at = 12 + k * 16
    if (String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!) === 'cmap') cmap = u32(at + 8)
  }
  if (cmap < 0 || cmap >= font.length) return out
  // The best subtable: full Unicode (3,10), then BMP (3,1), then any Unicode platform (0,*).
  let best = -1
  let rank = 0
  for (let k = 0; k < u16(cmap + 2) && k < 64; k += 1) {
    const at = cmap + 4 + k * 8
    const platform = u16(at)
    const encoding = u16(at + 2)
    const r = platform === 3 && encoding === 10 ? 3 : platform === 3 && encoding === 1 ? 2 : platform === 0 ? 1 : 0
    if (r > rank) {
      rank = r
      best = cmap + u32(at + 4)
    }
  }
  if (best < 0) return out
  const format = u16(best)
  const add = (code: number, glyph: number) => {
    if (glyph !== 0 && !out.has(glyph) && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) out.set(glyph, String.fromCodePoint(code))
  }
  if (format === 4) {
    const segments = u16(best + 6) / 2
    const ends = best + 14
    const starts = ends + segments * 2 + 2
    const deltas = starts + segments * 2
    const ranges = deltas + segments * 2
    let budget = 300_000
    for (let s = 0; s < segments && s < 8192 && budget > 0; s += 1) {
      const end = u16(ends + s * 2)
      const start = u16(starts + s * 2)
      const delta = u16(deltas + s * 2)
      const rangeOffset = u16(ranges + s * 2)
      for (let c = start; c <= end && c !== 0xffff && budget > 0; c += 1, budget -= 1) {
        const glyph = rangeOffset === 0 ? (c + delta) & 0xffff : u16(ranges + s * 2 + rangeOffset + (c - start) * 2)
        add(c, rangeOffset !== 0 && glyph !== 0 ? (glyph + delta) & 0xffff : glyph)
      }
    }
  } else if (format === 12) {
    const groups = u32(best + 12)
    let budget = 300_000
    for (let g = 0; g < groups && g < 100_000; g += 1) {
      const at = best + 16 + g * 12
      const start = u32(at)
      const end = u32(at + 4)
      const glyph = u32(at + 8)
      for (let c = start; c <= end && budget-- > 0; c += 1) add(c, glyph + c - start)
    }
  }
  return out
}

// ── Widths of the standard 14 fonts, ASCII 32–126, in thousandths of the font size ──

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584,
  556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278,
  278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
]
const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564,
  444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333,
  469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200,
  480, 541,
]

/** A standard font's width for a character code, when the PDF gives none: Helvetica, Times or Courier, roughly. */
export function standardWidth(baseFont: string, code: number): number {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '').toLowerCase()
  if (name.includes('courier') || name.includes('mono')) return 600
  const table = name.includes('times') || name.includes('serif') ? TIMES : HELVETICA
  return code >= 32 && code <= 126 ? table[code - 32]! : table === TIMES ? 500 : 556
}
