// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * Builds real Office files in code for the tests: a zip writer (parts
 * stored, or compressed with fixed-Huffman DEFLATE so the pane's own
 * decompressor is exercised), and workbooks from rows of cells.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Literal-only DEFLATE with the fixed Huffman code: valid, if not small. */
export function deflateFixed(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let bit = 0
  let bits = 0
  const put = (value: number, n: number) => {
    bit |= value << bits
    bits += n
    while (bits >= 8) {
      out.push(bit & 0xff)
      bit >>>= 8
      bits -= 8
    }
  }
  // Huffman codes go most significant bit first.
  const code = (value: number, n: number) => {
    let reversed = 0
    for (let k = 0; k < n; k += 1) reversed |= ((value >> k) & 1) << (n - 1 - k)
    put(reversed, n)
  }
  put(1, 1)
  put(1, 2)
  for (const b of data) {
    if (b < 144) code(0x30 + b, 8)
    else code(0x190 + b - 144, 9)
  }
  code(0, 7)
  if (bits > 0) out.push(bit & 0xff)
  return new Uint8Array(out)
}

export function zip(files: Record<string, string | Uint8Array>, compress = true): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const header = (size: number) => {
    const b = new Uint8Array(size)
    return { b, v: new DataView(b.buffer) }
  }
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = typeof text === 'string' ? encoder.encode(text) : text
    const packed = compress ? deflateFixed(data) : data
    const crc = crc32(data)
    const local = header(30 + nameBytes.length)
    local.v.setUint32(0, 0x04034b50, true)
    local.v.setUint16(4, 20, true)
    local.v.setUint16(8, compress ? 8 : 0, true)
    local.v.setUint32(14, crc, true)
    local.v.setUint32(18, packed.length, true)
    local.v.setUint32(22, data.length, true)
    local.v.setUint16(26, nameBytes.length, true)
    local.b.set(nameBytes, 30)
    const entry = header(46 + nameBytes.length)
    entry.v.setUint32(0, 0x02014b50, true)
    entry.v.setUint16(4, 20, true)
    entry.v.setUint16(6, 20, true)
    entry.v.setUint16(10, compress ? 8 : 0, true)
    entry.v.setUint32(16, crc, true)
    entry.v.setUint32(20, packed.length, true)
    entry.v.setUint32(24, data.length, true)
    entry.v.setUint16(28, nameBytes.length, true)
    entry.v.setUint32(42, offset, true)
    entry.b.set(nameBytes, 46)
    chunks.push(local.b, packed)
    central.push(entry.b)
    offset += local.b.length + packed.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = header(22)
  end.v.setUint32(0, 0x06054b50, true)
  end.v.setUint16(8, central.length, true)
  end.v.setUint16(10, central.length, true)
  end.v.setUint32(12, size, true)
  end.v.setUint32(16, offset, true)
  const all = [...chunks, ...central, end.b]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  return btoa(binary)
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const letters = (n: number) => {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A cell as the tests describe it: text, a number (with a format), a formula (with or without a saved result). */
export type TestCell = string | number | null | { f: string; v?: string | number; fmt?: string } | { n: number; fmt: string }

const FORMATS = ['General', '#,##0', '#,##0.00', '0%', '0.0%', '"$"#,##0', 'yyyy-mm-dd']
const fmtId = (fmt: string) => FORMATS.indexOf(fmt)

/** An .xlsx file: sheets of rows of cells. */
export function xlsx(sheets: { name: string; rows: TestCell[][]; isHidden?: boolean }[], compress = true): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts>${FORMATS.map((f, k) => `<numFmt numFmtId="${164 + k}" formatCode="${esc(f)}"/>`).join('')}</numFmts><cellXfs>${FORMATS.map((_, k) => `<xf numFmtId="${164 + k}"/>`).join('')}</cellXfs></styleSheet>`,
  }
  const rels = sheets.map(
    (_, k) =>
      `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`,
  )
  rels.push(`<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`)
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
  files['xl/workbook.xml'] =
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets.map((s, k) => `<sheet name="${esc(s.name)}" sheetId="${k + 1}" r:id="rId${k + 1}"${s.isHidden ? ' state="hidden"' : ''}/>`).join('') +
    '</sheets></workbook>'
  sheets.forEach((sheet, k) => {
    const rows = sheet.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        const ref = `${letters(c + 1)}${r + 1}`
        if (cell === null) return ''
        if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
        if (typeof cell === 'string') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`
        if ('n' in cell) return `<c r="${ref}" s="${fmtId(cell.fmt)}"><v>${cell.n}</v></c>`
        const s = cell.fmt ? ` s="${fmtId(cell.fmt)}"` : ''
        const saved = cell.v === undefined ? '' : typeof cell.v === 'number' ? `<v>${cell.v}</v>` : `<v>${esc(cell.v)}</v>`
        return `<c r="${ref}"${s}${typeof cell.v === 'string' ? ' t="str"' : ''}><f>${esc(cell.f.replace(/^=/, ''))}</f>${saved}</c>`
      })
      return `<row r="${r + 1}">${cells.join('')}</row>`
    })
    files[`xl/worksheets/sheet${k + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  })
  return zip(files, compress)
}

type GridLike = { sheets: { name: string; rows: { v: string; f?: string; x?: number }[][]; isHidden?: boolean }[] }

/** The number format that shows `x` as the test's `v`. */
function formatFor(v: string, x: number): string {
  if (v.endsWith('%')) return v.includes('.') ? '0.0%' : '0%'
  if (v.includes('$')) return '"$"#,##0'
  if (/^-?[\d,]+\.\d\d$/.test(v)) return '#,##0.00'
  if (v.includes(',') || Math.abs(x) >= 1000) return '#,##0'
  return 'General'
}

/** A workbook holding the cells a test describes the way the pane shows them: text, numbers, formulas and their results. */
export function workbookOf(doc: GridLike | string): Uint8Array {
  const grid: GridLike = typeof doc === 'string' ? JSON.parse(doc) : doc
  return xlsx(
    grid.sheets.map(sheet => ({
      name: sheet.name,
      ...(sheet.isHidden ? { isHidden: true } : {}),
      rows: sheet.rows.map(row =>
        row.map((cell): TestCell => {
          const fmt = cell.x !== undefined ? formatFor(cell.v, cell.x) : undefined
          if (cell.f !== undefined) return { f: cell.f, ...(cell.x !== undefined ? { v: cell.x } : cell.v !== '' ? { v: cell.v } : {}), ...(fmt ? { fmt } : {}) }
          if (cell.x !== undefined) return { n: cell.x, fmt: fmt ?? 'General' }
          return cell.v === '' ? null : cell.v
        }),
      ),
    })),
  )
}

type On = Parameters<Parameters<typeof import('claude-code/testing').test>[1]>[1]

/** Serves the workbook (or what `doc()` gives at each read) for every .xlsx the pane reads, and `text` (or nothing) for any other file. */
export function serveWorkbook(on: On, doc: GridLike | string | (() => GridLike | string), text: (path: string) => string = () => '') {
  on('fs.read', (_, e) => {
    const path = (e as { path: string }).path
    return { value: path.endsWith('.xlsx') ? { base64: base64(workbookOf(typeof doc === 'function' ? doc() : doc)) } : text(path) }
  })
}

/** A PNG of `width` × `height` pixels, each `colour(x, y)` as 0xRRGGBB, stored without compression. */
export function png(width: number, height: number, colour: (x: number, y: number) => number): Uint8Array {
  const raw: number[] = []
  for (let y = 0; y < height; y += 1) {
    raw.push(0)
    for (let x = 0; x < width; x += 1) {
      const c = colour(x, y)
      raw.push((c >> 16) & 255, (c >> 8) & 255, c & 255)
    }
  }
  // zlib with stored DEFLATE blocks of up to 65,535 bytes.
  const z: number[] = [0x78, 0x01]
  for (let at = 0; at < raw.length || at === 0; at += 65_535) {
    const part = raw.slice(at, at + 65_535)
    const isLast = at + 65_535 >= raw.length
    z.push(isLast ? 1 : 0, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255, ...part)
    if (isLast) break
  }
  z.push(0, 0, 0, 0)
  const chunk = (type: string, data: number[]) => {
    const body = Uint8Array.from([...type].map(ch => ch.charCodeAt(0)).concat(data))
    const n = data.length
    const c = crc32(body)
    return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...body, (c >>> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255]
  }
  const word = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...word(width), ...word(height), 8, 2, 0, 0, 0]), ...chunk('IDAT', z), ...chunk('IEND', [])])
}

/** The first bytes of an EMF drawing: enough for the pane to know what it is. */
export const EMF = Uint8Array.from([1, 0, 0, 0, ...new Array(36).fill(0), 0x20, 0x45, 0x4d, 0x46, ...new Array(20).fill(0)])

/** A Word document: paragraphs (with a style: Title, Heading1, ListBullet, Quote), tables, and pictures (bytes, with alt text). */
export function docx(blocks: ({ p: string; style?: string; bold?: boolean } | { table: string[][] } | { picture: Uint8Array; alt?: string; ext?: string })[]): Uint8Array {
  const para = (text: string, style?: string, bold?: boolean) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  const media: Record<string, Uint8Array> = {}
  const rels: string[] = []
  const drawing = (bytes: Uint8Array, alt: string, ext: string) => {
    const id = `rIdPic${rels.length + 1}`
    const name = `media/image${rels.length + 1}.${ext}`
    media[`word/${name}`] = bytes
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${name}"/>`)
    return `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${rels.length}" name="Picture ${rels.length}" descr="${esc(alt)}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  }
  const body = blocks
    .map(b =>
      'table' in b
        ? `<w:tbl>${b.table.map(row => `<w:tr>${row.map(cell => `<w:tc>${para(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
        : 'picture' in b
          ? drawing(b.picture, b.alt ?? '', b.ext ?? 'png')
          : para(b.p, b.style, b.bold),
    )
    .join('')
  const style = (id: string, name: string) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    ...media,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title', 'Title')}${style('Heading1', 'heading 1')}${style('Heading2', 'heading 2')}${style('ListBullet', 'List Bullet')}${style('ListNumber', 'List Number')}${style('Quote', 'Quote')}</w:styles>`,
  })
}

/** A PDF of text pages, one line per string, in Helvetica (WinAnsi). The simplest kind of PDF a script writes. `picture`: an RGB image drawn 200 points wide on the first page, after its text. */
export function pdf(pages: string[][], picture?: { width: number; height: number; rgb: (x: number, y: number) => number }): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // object number = index + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // the page tree, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  if (picture) {
    // Raw samples as hex, so the file stays text.
    let hex = ''
    for (let y = 0; y < picture.height; y += 1) for (let x = 0; x < picture.width; x += 1) hex += picture.rgb(x, y).toString(16).padStart(6, '0')
    add(`<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`)
  }
  const kids: number[] = []
  for (const [p, lines] of pages.entries()) {
    let ops = lines.map((line, k) => `BT /F1 12 Tf 72 ${750 - k * 18} Td (${line.replace(/[\\()]/g, ch => `\\${ch}`)}) Tj ET`).join('\n')
    if (picture && p === 0) ops += `\nq 200 0 0 ${Math.round((200 * picture.height) / picture.width)} 72 300 cm /Im1 Do Q`
    add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`)
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${picture ? ' /XObject << /Im1 4 0 R >>' : ''} >> /Contents ${objects.length} 0 R >>`)
    kids.push(objects.length)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, k) => {
    offsets.push(out.length)
    out += `${k + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // WinAnsi: one byte per character (the tests use Latin-1 text).
  return Uint8Array.from(out, ch => ch.charCodeAt(0) & 0xff)
}
