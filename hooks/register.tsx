import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Doc, DocRow, GridCell, ReviewComment, ReviewSelection, Span, View } from '../types'
import { adfRows, isAdf } from './adf'
import { BADGES, paletteFor } from './palette'
import type { SpinnerProps } from './spinner'
import { plain, tableRows, tidy } from './format'
import { htmlRows } from './html'
import { markdownRows } from './md'
import type { TabsPost, TabsProps } from './tabs'
import type { GridRow, LineRow, ViewerPost, ViewerProps, ViewPal } from './viewer'

const PLUGIN = 'review-pane'
const PANE = 'review'
const TITLE = 'Review'
const TOOL = 'open_file'

/** Files the pane can show, by extension. */
const TEXT_KINDS = ['md', 'markdown', 'txt', 'html', 'htm', 'csv', 'json', 'yaml', 'yml', 'adf']
const DOC_KINDS = ['docx', 'pdf', 'xlsx']
const IMAGE_KINDS = ['png']
/** What auto-open considers a finished output worth opening. */
const AUTO_KINDS = ['docx', 'pdf', 'png', 'html', 'htm', 'md', 'markdown', 'adf']
const AUTO_MAX_FILES = 5
/** Comments listed under the document before the rest are counted. */
const MAX_LISTED = 12
const SCAN_SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', '.cache'])

const files = atom({ plugin: 'review-pane', key: 'files' } as const, [])
const current = atom({ plugin: 'review-pane', key: 'current' } as const, null)
const doc = atom({ plugin: 'review-pane', key: 'doc' } as const, null)
const view = atom({ plugin: 'review-pane', key: 'view' } as const, { top: 0, left: 0, sheet: 0 })
const selection = atom({ plugin: 'review-pane', key: 'selection' } as const, null)
const comments = atom({ plugin: 'review-pane', key: 'comments' } as const, [])
const autoOpen = atom({ plugin: 'review-pane', key: 'autoOpen' } as const, false)
const changed = atom({ plugin: 'review-pane', key: 'changed' } as const, null)

const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase()
const isSupported = (path: string) => [...TEXT_KINDS, ...DOC_KINDS, ...IMAGE_KINDS].includes(extOf(path))
const baseName = (path: string) => path.split('/').pop() ?? path
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeHead(base64: string, count: number): number[] {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of base64) {
    const n = B64.indexOf(ch)
    if (n < 0) continue
    value = (value << 6) | n
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
      if (out.length >= count) break
    }
  }
  return out
}

async function loadDoc($: EngineInterface, path: string, isRaw = false): Promise<Doc> {
  const ext = extOf(path)
  try {
    if (IMAGE_KINDS.includes(ext)) {
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      if (base64.length > 2_700_000) return { kind: 'error', path, message: 'This image is over 2 MB, too large to preview here.' }
      const head = decodeHead(base64.slice(0, 40), 24)
      const word = (at: number) => (((head[at] ?? 0) << 24) | ((head[at + 1] ?? 0) << 16) | ((head[at + 2] ?? 0) << 8) | (head[at + 3] ?? 0)) >>> 0
      return { kind: 'image', path, png: base64, width: word(16) || 1, height: word(20) || 1 }
    }
    if (DOC_KINDS.includes(ext)) {
      const ran = await $.process.run(['python3', `${$.plugin.root}/scripts/extract.py`, ext, path], { timeoutMs: 60_000 })
      if (ran.exitCode !== 0) return { kind: 'error', path, message: (ran.stderr || ran.stdout).trim().split('\n').slice(-3).join(' ') }
      const parsed = JSON.parse(ran.stdout) as Record<string, unknown>
      if (parsed.kind === 'lines' && Array.isArray(parsed.rows)) parsed.rows = layoutTables(parsed.rows as DocRow[])
      return { ...parsed, path } as Doc
    }
    const text = await $.fs.read(path)
    if (!isRaw) {
      if (ext === 'md' || ext === 'markdown') return { kind: 'lines', path, rows: markdownRows(text), isFormatted: true, hasSource: true }
      if (ext === 'html' || ext === 'htm') return { kind: 'lines', path, rows: htmlRows(text), isFormatted: true, hasSource: true }
      // Confluence/Jira pages as ADF: .adf files, or .json files holding a doc node.
      if (ext === 'adf' || ext === 'json') {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        if (isAdf(parsed)) return { kind: 'lines', path, rows: adfRows(parsed), isFormatted: true, hasSource: true }
        if (ext === 'adf') return { kind: 'error', path, message: 'This .adf file is not an ADF document (expected {"type": "doc", "content": [...]}).' }
      }
    }
    const rows: DocRow[] = text.replace(/\r\n/g, '\n').split('\n').map((line, i) => ({
      text: line.replace(/\t/g, '  '),
      anchor: `line ${i + 1}`,
      unit: 'line',
    }))
    if (rows.length > 1 && rows[rows.length - 1]?.text === '') rows.pop()
    const hasSource = ['md', 'markdown', 'html', 'htm', 'adf'].includes(ext) || (ext === 'json' && isRaw)
    return hasSource ? { kind: 'lines', path, rows, hasSource } : { kind: 'lines', path, rows }
  } catch (error) {
    return { kind: 'error', path, message: `Could not open the file: ${String(error)}` }
  }
}

/** Word tables come as rows of cells: lay each run of them out as one aligned table. */
function layoutTables(rows: (DocRow & { cells?: string[]; isHeader?: boolean })[]): DocRow[] {
  const out: DocRow[] = []
  for (let i = 0; i < rows.length; ) {
    const row = rows[i]
    if (!row?.cells) {
      if (row) out.push(row)
      i += 1
      continue
    }
    const run: typeof rows = []
    while (rows[i]?.cells) run.push(rows[i++] as (typeof rows)[number])
    const header = run[0]?.isHeader ? 1 : 0
    out.push(...tableRows(run.map(r => (r.cells ?? []).map(cell => [{ t: cell }])), header, r => run[r]?.anchor ?? '', 'table row'))
  }
  return out
}

/** What differs between two reads of a file: rows whose text changed or are new, cells whose value or formula changed. */
function diffDocs(before: Doc | null, after: Doc): { rows: number[]; cells: string[] } {
  if (!before || before.kind !== after.kind) return { rows: [], cells: [] }
  if (before.kind === 'lines' && after.kind === 'lines') {
    const seen = new Map<string, number>()
    for (const row of before.rows) seen.set(row.text, (seen.get(row.text) ?? 0) + 1)
    const rows: number[] = []
    after.rows.forEach((row, i) => {
      const left = seen.get(row.text) ?? 0
      if (left > 0) seen.set(row.text, left - 1)
      else if (row.text.trim() !== '') rows.push(i)
    })
    return { rows, cells: [] }
  }
  if (before.kind === 'grid' && after.kind === 'grid') {
    const cells: string[] = []
    after.sheets.forEach((sheet, s) => {
      const old = before.sheets.find(one => one.name === sheet.name)
      sheet.rows.forEach((row, r) =>
        row.forEach((cell, c) => {
          const was = old?.rows[r]?.[c]
          if (!was || was.v !== cell.v || was.f !== cell.f) if (cell.v !== '' || was?.v) cells.push(`${s}:${r}:${c}`)
        }),
      )
    })
    return { rows: [], cells: cells.slice(0, 2000) }
  }
  return { rows: [], cells: [] }
}

/** Puts a file in the list and, when it is the one shown, reads it again. */
async function track($: EngineInterface, path: string) {
  await update($, files, list => (list.includes(path) ? list : [...list, path].slice(-30)))
  if ((await read($, current)) === path) {
    const before = await read($, doc)
    const fresh = await loadDoc($, path, (await read($, view)).raw === true)
    await update($, doc, () => fresh)
    const diff = diffDocs(before, fresh)
    if (diff.rows.length + diff.cells.length > 0) {
      // A counter, not a time: each edit gets a key the view has not seen.
      await update($, changed, old => ({ path, key: (old?.key ?? 0) + 1, ...diff }))
    }
    const done = (await read($, comments)).filter(c => c.path === path && c.status === 'sent')
    if (done.length > 0) {
      await update($, comments, old => old.filter(c => !(c.path === path && c.status === 'sent')))
      $.ui.toast(`✓ ${baseName(path)} updated`)
    }
  }
}

async function show($: EngineInterface, path: string) {
  await update($, files, list => (list.includes(path) ? list : [...list, path].slice(-30)))
  const loaded = await loadDoc($, path)
  await update($, current, () => path)
  await update($, doc, () => loaded)
  await update($, view, () => ({ top: 0, left: 0, sheet: 0 }))
  // A picture is commented on as a whole, so it starts selected.
  await update($, selection, () =>
    loaded.kind === 'image' ? { path, label: 'the whole image', quote: '', from: 0, to: 0 } : null,
  )
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

/**
 * Wraps document rows to the width the viewer has, keeping each run's
 * emphasis. A formatted row also gets its prefix: a list marker (then
 * blank under it), a quote or panel bar; tables and code never wrap.
 */
function wrapRows(rows: DocRow[], width: number, isFormatted: boolean): { line: LineRow; src: number }[] {
  const out: { line: LineRow; src: number }[] = []
  rows.forEach((row, src) => {
    const style = row.style ?? null
    const number = isFormatted
      ? ''
      : (row.num ?? row.anchor.match(/^(?:line|paragraph) (\d+)/)?.[1] ?? row.anchor.match(/, line (\d+)$/)?.[1] ?? '')
    const base: Omit<LineRow, 't' | 'sp' | 'pre' | 'n'> = { src, ...(style ? { st: style } : {}), ...(row.tone ? { tone: row.tone } : {}) }
    if (style === 'space' || style === 'rule') {
      out.push({ src, line: { ...base, n: '', t: '' } })
      return
    }
    const spans: Span[] = row.spans ?? [{ t: row.text }]
    const indent = '   '.repeat(row.indent ?? 0)
    const firstPrefix = style === 'li' ? `${indent}${row.marker ?? '•'} ` : style === 'quote' ? '│ ' : style === 'panel' ? '┃ ' : style === 'code' ? '  ' : ''
    const nextPrefix = style === 'li' ? ' '.repeat(firstPrefix.length) : firstPrefix
    const room = Math.max(8, width - firstPrefix.length)
    if (style === 'th' || style === 'td' || style === 'code' || style === 'table') {
      out.push({ src, line: { ...base, n: number, t: plain(spans), sp: clip(spans, room), pre: firstPrefix } })
      return
    }
    // Greedy word wrap over the spans.
    const lines: Span[][] = [[]]
    let used = 0
    for (const span of spans) {
      for (const word of span.t.split(/(\s+)/)) {
        if (word === '') continue
        const isSpace = /^\s+$/.test(word)
        if (used + word.length > room && used > 0) {
          if (isSpace) continue
          lines.push([])
          used = 0
        }
        if (isSpace && used === 0) continue
        let rest = word
        while (rest.length > room) {
          ;(lines[lines.length - 1] as Span[]).push({ ...span, t: rest.slice(0, room - used) })
          rest = rest.slice(room - used)
          lines.push([])
          used = 0
        }
        ;(lines[lines.length - 1] as Span[]).push({ ...span, t: rest })
        used += rest.length
      }
    }
    lines.forEach((line, k) => {
      const sp = tidy(line)
      out.push({ src, line: { ...base, n: k === 0 ? number : '', t: plain(sp), sp, pre: k === 0 ? firstPrefix : nextPrefix } })
    })
  })
  return out
}

/** Cuts spans to a width, ending with an ellipsis when something is left out. */
function clip(spans: Span[], width: number): Span[] {
  const out: Span[] = []
  let used = 0
  for (const span of spans) {
    if (used + span.t.length <= width) {
      out.push(span)
      used += span.t.length
      continue
    }
    out.push({ ...span, t: `${span.t.slice(0, Math.max(0, width - used - 1))}…` })
    break
  }
  return out
}

function describeLines(d: Extract<Doc, { kind: 'lines' }>, from: number, to: number): Omit<ReviewSelection, 'path'> {
  // Blank spacer rows and rules are skipped at either end.
  const isContent = (row: DocRow | undefined) => row !== undefined && row.style !== 'space' && row.style !== 'rule'
  let a = from
  let b = to
  while (a < b && !isContent(d.rows[a])) a += 1
  while (b > a && !isContent(d.rows[b])) b -= 1
  // A click on a blank gap or a rule selects the content just above it (or below, at the top).
  if (a === b && !isContent(d.rows[a])) {
    let k = a
    while (k > 0 && !isContent(d.rows[k])) k -= 1
    if (!isContent(d.rows[k])) {
      k = a
      while (k < d.rows.length - 1 && !isContent(d.rows[k])) k += 1
    }
    a = k
    b = k
  }
  const first = d.rows[a]
  const last = d.rows[b]
  const quote = d.rows
    .slice(a, b + 1)
    .filter(isContent)
    .map(row => (row.style === 'li' ? `${'  '.repeat(row.indent ?? 0)}${row.marker ?? '•'} ${row.text}` : row.text))
    .join('\n')
  const split = (anchor: string) => {
    const at = anchor.indexOf(' (under "')
    return at < 0 ? [anchor, ''] : [anchor.slice(0, at), anchor.slice(at)]
  }
  const [firstCore = '', suffix = ''] = split(first?.anchor ?? `row ${from + 1}`)
  const [lastCore = ''] = split(last?.anchor ?? '')
  let label = first?.anchor ?? `row ${from + 1}`
  if (last && firstCore !== lastCore) {
    const la = firstCore.match(/^lines? (\d+)(?:–(\d+))?$/)
    const lb = lastCore.match(/^lines? (\d+)(?:–(\d+))?$/)
    const pa = firstCore.match(/^paragraph (\d+)$/)
    const pb = lastCore.match(/^paragraph (\d+)$/)
    if (la && lb) label = `lines ${la[1]}–${lb[2] ?? lb[1]}${suffix}`
    else if (pa && pb) label = `paragraphs ${pa[1]}–${pb[1]}${suffix}`
    else label = `${firstCore} to ${lastCore}${suffix}`
  }
  return { label, quote, from: a, to: b }
}

function describeGrid(d: Extract<Doc, { kind: 'grid' }>, sheetIndex: number, from: number, to: number, colFrom: number, colTo: number) {
  const sheet = d.sheets[sheetIndex]
  if (!sheet) return null
  const ref = (r: number, c: number) => `${sheet.cols[c] ?? '?'}${r + 1}`
  const range = from === to && colFrom === colTo ? ref(from, colFrom) : `${ref(from, colFrom)}:${ref(to, colTo)}`
  const name = /^[A-Za-z0-9_]+$/.test(sheet.name) ? sheet.name : `'${sheet.name}'`
  const cells: string[] = []
  for (let r = from; r <= to; r += 1) {
    for (let c = colFrom; c <= colTo; c += 1) {
      const cell: GridCell | undefined = sheet.rows[r]?.[c]
      if (!cell || !cell.v) continue
      cells.push(cell.f ? `${ref(r, c)}: ${cell.v}  (formula ${cell.f})` : `${ref(r, c)}: ${cell.v}`)
    }
  }
  const quote = cells.length > 60 ? [...cells.slice(0, 60), `… and ${cells.length - 60} more cells`].join('\n') : cells.join('\n') || '(empty cells)'
  return { label: `${name}!${range}`, quote, from, to, colFrom, colTo }
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most)}…` : text)

function feedbackPrompt(list: ReviewComment[]): string {
  const items = list.map((c, i) => {
    const quote = c.quote ? `\n   > ${cut(c.quote, 1200).replace(/\n/g, '\n   > ')}` : ''
    return `${i + 1}. \`${c.path}\`, ${c.label}${quote}\n   Feedback: ${c.text}`
  })
  return [
    'Review feedback from the review pane. Apply each item by editing the file directly.',
    'The quoted text shows exactly which part each comment is about. Keep the file\'s existing formatting:',
    'for .docx and .xlsx edit with python-docx / openpyxl rather than rebuilding the file; for a .pdf, edit',
    'whatever it was generated from and regenerate it; for a .png, regenerate it. For an ADF (Confluence) file,',
    'edit the JSON node at the path given (content[...]) and keep every other node, mark and attr (such as localId) as it is.',
    '',
    ...items,
  ].join('\n')
}

/** What this session's hooks share; set again on each load by session.start. */
const session = { cwd: '', turnFiles: new Set<string>(), theme: 'dark' }
/** What the viewer last drew, for scrolling maths. */
const drawn = {
  /** Lines view: visual lines in all, and the first visual line of each document row. */
  total: 0,
  firstVisual: [] as number[],
  /** Rows (or grid body rows) in view, grid columns in view. */
  height: 10,
  shownCols: 1,
}

const resolvePath = (path: string) =>
  path.startsWith('/') ? path : `${session.cwd.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`

async function noteFile($: EngineInterface, path: string | undefined) {
  if (!path || !isSupported(path)) return
  const absolute = resolvePath(path)
  session.turnFiles.add(absolute)
  await track($, absolute)
}

async function scan($: EngineInterface, dir: string, since: number, depth: number, found: string[], budget: { left: number }) {
  if (depth < 0 || budget.left <= 0) return
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  budget.left -= entries.length
  for (const entry of entries) {
    const path = `${dir.replace(/\/$/, '')}/${entry.name}`
    if (entry.kind === 'dir' && !entry.name.startsWith('.') && !SCAN_SKIP.has(entry.name)) {
      await scan($, path, since, depth - 1, found, budget)
    } else if (entry.kind === 'file' && entry.mtimeMs >= since && isSupported(entry.name)) {
      found.push(path)
    }
  }
}

/** Switches a Markdown, HTML or ADF file between its formatted view and its source. */
async function toggleSource($: EngineInterface) {
  const path = await read($, current)
  if (path === null) return
  const isRaw = !((await read($, view)).raw === true)
  const loaded = await loadDoc($, path, isRaw)
  await update($, doc, () => loaded)
  await update($, view, old => ({ ...old, raw: isRaw, top: 0, cur: undefined, anc: undefined }))
  await update($, selection, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    session.cwd = e.cwd
    const started = await next(e)
    // A reload (or an update of this mod) may have changed how a document is
    // held, so the open one is read again rather than trusted.
    const open = await read($, current)
    if (open !== null) {
      const fresh = await loadDoc($, open, (await read($, view)).raw === true)
      await update($, doc, () => fresh)
      await update($, view, old => ({ ...old, cur: undefined, anc: undefined }))
    }
    const theme = (await $.config.list().catch(() => [])).find(row => row.key === 'theme')
    session.theme = typeof theme?.value === 'string' ? theme.value : 'dark'
    const stored = await $.store.get('autoOpen')
    await update($, autoOpen, () => stored === true)
    await $.command.register({
      name: 'review-pane',
      description: 'Open the review pane, or a file in it: /review-pane [file] · /review-pane auto on|off · /review-pane setup',
      argumentHint: '[file | auto on|off | setup]',
    })
    await $.tool.register({
      name: TOOL,
      description:
        "Open a file in the user's review pane inside Claude Code, where they can read it, highlight parts and leave comments for you. " +
        'Call this when the user asks to open, show or view a file (md, html, txt, csv, docx, xlsx, pdf, png). The path may be relative to the working directory.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The file to open' } },
        required: ['path'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'open_files',
      description:
        "Open several files in the user's review pane at once, as tabs in the order given; the first is shown. " +
        'With replace: true the pane starts fresh: these become the only tabs and earlier comments are cleared (use for a clean review or a demo).',
      inputSchema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'The files to open, in tab order' },
          replace: { type: 'boolean', description: 'Make these the only tabs and clear earlier comments' },
        },
        required: ['paths'],
      },
      isDeferred: false,
    })
    return started
  })

  on('command.run', { command: 'review-pane' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'auto on' || args === 'auto off') {
      const isOn = args === 'auto on'
      await update($, autoOpen, () => isOn)
      await $.store.set('autoOpen', isOn)
      return {
        text: isOn
          ? `Auto-open is on: when a turn finishes with 1–${AUTO_MAX_FILES} new Word, PDF, PNG, HTML or Markdown files, the review pane opens on them.`
          : 'Auto-open is off. New files are listed in the pane; open it with /review-pane.',
      }
    }
    if (args === 'auto') {
      return { text: `Auto-open is ${(await read($, autoOpen)) ? 'on' : 'off'}. Change it with /review-pane auto on|off.` }
    }
    if (args === 'setup') {
      const ran = await $.process.run(['python3', `${$.plugin.root}/scripts/extract.py`, 'setup'], { timeoutMs: 600_000 })
      return ran.exitCode === 0
        ? { text: 'Installed python-docx, openpyxl, pypdf and pycel in ~/.cache/review-pane/venv. Word, Excel and PDF files can be shown now.' }
        : { text: `Setup failed:\n${ran.stderr.trim().slice(-1500)}`, exitCode: 1 }
    }
    if (args) {
      const path = resolvePath(args)
      if (!(await $.fs.exists(path))) return { text: `No file at ${path}.`, exitCode: 1 }
      await show($, path)
    } else if ((await read($, current)) === null) {
      const first = (await read($, files))[0]
      if (first) await show($, first)
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Review pane opened.' : 'Review pane is waiting for room: widen the terminal.' }
  })

  on('tool.call', { tool: 'mcp__review-pane__open_file' }, async ($, e) => {
    // A live session puts the arguments on the event; the test kit under `input`.
    const input = ((e as { input?: unknown }).input ?? e) as { path?: unknown }
    const path = typeof input.path === 'string' ? resolvePath(input.path) : ''
    if (!path || !(await $.fs.exists(path))) {
      return { result: `No file at ${path || '(no path given)'}.`, text: `No file at ${path || '(no path given)'}.`, isError: true }
    }
    if (!isSupported(path)) {
      return { result: `The review pane does not show .${extOf(path)} files.`, text: `The review pane does not show .${extOf(path)} files.`, isError: true }
    }
    await show($, path)
    const opened = await openPane($)
    const text = opened.isPlaced ? `Opened ${path} in the review pane.` : `Loaded ${path}; the pane will show once the terminal is wider (or the user runs /review-pane).`
    // A live session takes a tool's result as text.
    return { result: text, text }
  })

  on('tool.call', { tool: 'mcp__review-pane__open_files' }, async ($, e) => {
    const input = ((e as { input?: unknown }).input ?? e) as { paths?: unknown; replace?: unknown }
    const asked = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string').map(resolvePath) : []
    const usable: string[] = []
    const skipped: string[] = []
    for (const path of asked) {
      if (isSupported(path) && (await $.fs.exists(path))) usable.push(path)
      else skipped.push(path)
    }
    const first = usable[0]
    if (!first) return { result: `None of those files can be opened: ${skipped.join(', ') || '(no paths given)'}.`, text: `None of those files can be opened: ${skipped.join(', ') || '(no paths given)'}.`, isError: true }
    if (input.replace === true) {
      await update($, files, () => usable)
      await update($, comments, () => [])
      await update($, changed, () => null)
      await update($, view, () => ({ top: 0, left: 0, sheet: 0 }))
    } else {
      await update($, files, list => [...list, ...usable.filter(p => !list.includes(p))].slice(-30))
    }
    await show($, first)
    const opened = await openPane($)
    const text = `Opened ${usable.length} file${usable.length === 1 ? '' : 's'} in the review pane${opened.isPlaced ? '' : ' (it shows once the terminal is wider, or the user runs /review-pane)'}.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}`
    return { result: text, text }
  })

  on('prompt.submit', async ($, e, next) => {
    session.turnFiles = new Set()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'Bash') {
      const since = (await $.clock.now()) - 1000
      const ran = await next(e)
      const found: string[] = []
      await scan($, session.cwd, since, 3, found, { left: 4000 })
      for (const path of found.slice(0, 20)) await noteFile($, path)
      return ran
    }
    const ran = await next(e)
    if ((tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') && ran.deny === undefined && !ran.isError) {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      await noteFile($, input.file_path ?? input.notebook_path)
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || session.turnFiles.size === 0) return done
    const made = [...session.turnFiles]
    session.turnFiles = new Set()
    const outputs = made.filter(path => AUTO_KINDS.includes(extOf(path)))
    if ((await read($, autoOpen)) && outputs.length >= 1 && outputs.length <= AUTO_MAX_FILES && outputs[0]) {
      await show($, outputs[0])
      const opened = await openPane($)
      if (!opened.isPlaced) $.ui.toast(`Review: ${baseName(outputs[0])} is ready. Run /review-pane to see it (the terminal is too narrow to open it by itself).`)
    } else {
      $.ui.status(`review: ${made.length} file${made.length === 1 ? '' : 's'} updated · /review-pane to open`)
    }
    return done
  })


  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const post = e.data as ViewerPost | TabsPost
    const d = await read($, doc)
    const v = await read($, view)

    if (post.type === 'tab') {
      if (post.group === 'files') {
        const target = (await read($, files))[post.index]
        if (target) await show($, target)
      } else {
        await update($, view, () => ({ top: 0, left: 0, sheet: post.index }))
        await update($, selection, () => null)
      }
    } else if (post.type === 'aside') {
      const path = await read($, current)
      if (post.id === 'reload' && path) await track($, path)
      else if (post.id === 'source') await toggleSource($)
      else if (post.id === 'auto') {
        const isOn = !(await read($, autoOpen))
        await update($, autoOpen, () => isOn)
        await $.store.set('autoOpen', isOn)
        $.ui.toast(isOn ? '✓ Auto-open on: new files from Claude open here when it finishes' : 'Auto-open off')
      }
    } else if (post.type === 'sheet' && d?.kind === 'grid') {
      const sheet = clamp(v.sheet + post.delta, 0, d.sheets.length - 1)
      await update($, view, () => ({ top: 0, left: 0, sheet }))
      await update($, selection, () => null)
    } else if (post.type === 'clear') {
      await update($, view, old => ({ ...old, cur: undefined, anc: undefined }))
      await update($, selection, () => null)
    } else if (post.type === 'scroll') {
      const most = Math.max(0, (d?.kind === 'grid' ? (d.sheets[v.sheet]?.rows.length ?? 0) : drawn.total) - drawn.height)
      await update($, view, old => ({ ...old, top: clamp(old.top + post.rows, 0, most) }))
    } else if ((post.type === 'select' || post.type === 'move') && d && (d.kind === 'lines' || d.kind === 'grid')) {
      const rowCount = d.kind === 'grid' ? (d.sheets[v.sheet]?.rows.length ?? 1) : d.rows.length
      const colCount = d.kind === 'grid' ? (d.sheets[v.sheet]?.cols.length ?? 1) : 1
      const fit = (p: [number, number]): [number, number] => [clamp(p[0], 0, rowCount - 1), clamp(p[1], 0, colCount - 1)]
      let anc: [number, number]
      let cur: [number, number]
      if (post.type === 'select') {
        anc = fit(post.a)
        cur = fit(post.b)
      } else {
        const sel = await read($, selection)
        const was = v.cur ?? (sel ? [sel.from, sel.colFrom ?? 0] : [d.kind === 'grid' && hasHeader(d.sheets[v.sheet]) ? 1 : 0, 0])
        cur = fit([was[0] + post.rows, was[1] + post.cols])
        anc = post.extend ? (v.anc ?? was) : cur
      }
      const [r1, r2] = [Math.min(anc[0], cur[0]), Math.max(anc[0], cur[0])]
      const [c1, c2] = [Math.min(anc[1], cur[1]), Math.max(anc[1], cur[1])]
      const described = d.kind === 'lines' ? describeLines(d, r1, r2) : describeGrid(d, v.sheet, r1, r2, c1, c2)
      if (described) await update($, selection, () => ({ path: d.path, ...described }))
      // Keep the cursor in view.
      let { top, left } = v
      if (d.kind === 'lines') {
        const at = drawn.firstVisual[cur[0]] ?? 0
        if (at < top) top = at
        else if (at >= top + drawn.height) top = at - drawn.height + 1
      } else {
        const bodyStart = hasHeader(d.sheets[v.sheet]) ? 1 : 0
        if (cur[0] >= bodyStart) {
          if (cur[0] < top + bodyStart) top = cur[0] - bodyStart
          else if (cur[0] >= top + bodyStart + drawn.height) top = cur[0] - bodyStart - drawn.height + 1
        }
        if (cur[1] < left) left = cur[1]
        else if (cur[1] >= left + drawn.shownCols) left = cur[1] - drawn.shownCols + 1
      }
      await update($, view, old => ({ ...old, top: Math.max(0, top), left: Math.max(0, left), cur, anc }))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Client and Input are on the terminal and desktop, Image on the terminal alone.
    const { Client, Input, Image } = els as Partial<Elements['terminal']>
    const list = await read($, files)
    const path = await read($, current)
    const d = await read($, doc)
    const v = await read($, view)
    const sel = await read($, selection)
    const notes = await read($, comments)
    const isAuto = await read($, autoOpen)
    const change = await read($, changed)
    const pal = paletteFor(session.theme)
    const vpal: ViewPal = pal
    const columns = Math.max(40, e.props.bodyColumns)
    const drafts = notes.filter(c => c.status === 'draft')
    const sent = notes.filter(c => c.status === 'sent')
    const isGrid = d?.kind === 'grid'
    const listed = drafts.slice(0, MAX_LISTED)
    // Rows around the document: top bar 2, bar 1, rule 1, [sheet tabs 2, more-rows 1], gap 1, comment 1,
    // gap 1, comments header 1 + list, gap 1, actions 1, rule 1, keys 1.
    const chrome = 13 + (isGrid ? 3 : 0) + (drafts.length > 0 ? listed.length : 0)
    const height = clamp(e.props.scroll.bodyRows - chrome, 5, 60)
    const rule = (color: string) => <Text color={color}>{'─'.repeat(columns)}</Text>
    const freshKey = change && change.path === path ? change.key : 0
    const newest = drafts[drafts.length - 1]

    // ── Top bar: file-type badge, file tabs, switches ──
    const labels = list.slice(0, 8).map(baseName)
    const activeFile = Math.max(0, list.indexOf(path ?? ''))
    const asides: NonNullable<TabsProps['asides']> = []
    if (d?.kind === 'lines' && d.hasSource) asides.push({ id: 'source', label: v.raw ? '◧ Formatted' : '‹› Source', color: pal.subtle })
    if (path) asides.push({ id: 'reload', label: '⟳ Reload', color: pal.subtle })
    asides.push({ id: 'auto', label: isAuto ? '● Auto-open' : '○ Auto-open', color: isAuto ? pal.success : pal.dim, isBold: isAuto })
    const badge = path ? BADGES[extOf(path)] : undefined
    const room = columns - asides.reduce((n, a) => n + a.label.length + 3, 0) - (badge ? badge.label.length + 4 : 0)
    const fitted = labels.map((label, i) => {
      const most = i === activeFile ? Math.min(label.length, Math.max(12, room - 10)) : Math.max(6, Math.floor(room / Math.max(1, labels.length)) - 3)
      return label.length > most ? `${label.slice(0, most - 1)}…` : label
    })
    const colors = { accent: pal.accent, text: pal.text, subtle: pal.subtle, dim: pal.dim }
    const topBar = Client ? (
      <Client
        key="file-tabs"
        module="./tabs.tsx"
        props={{ group: 'files', labels: fitted, active: activeFile, colors, ...(badge ? { badge } : {}), asides } satisfies TabsProps}
      />
    ) : (
      <Text bold>{baseName(path ?? 'Review')}</Text>
    )

    // ── The document ──
    let bar = <Text color={pal.dim}>Click a cell to see its value or formula</Text>
    let body = <Text color={pal.dim}>Pick a file above.</Text>
    let sheetTabs = null
    let keys: [string, string][] = []

    if (list.length === 0) {
      body = (
        <Box flexDirection="column" paddingY={1}>
          <Text bold color={pal.accent}>✦ Nothing to review yet</Text>
          <Text color={pal.subtle}>Files Claude creates will open here. You can also run /review-pane and a file path,</Text>
          <Text color={pal.subtle}>or ask Claude to "open" a file.</Text>
        </Box>
      )
      bar = <Text> </Text>
    } else if (d?.kind === 'error') {
      bar = <Text color={pal.error} bold>Couldn't show {baseName(d.path)}</Text>
      body = <Text color={pal.subtle}>{d.message}</Text>
    } else if (d?.kind === 'image') {
      bar = (
        <Text>
          <Text bold color={pal.text}>{baseName(d.path)}</Text>
          <Text color={pal.subtle}>  {d.width} × {d.height} px · comments apply to the whole image</Text>
        </Text>
      )
      const roomCols = Math.min(columns, 120)
      const rowsTall = clamp(Math.round((roomCols * d.height) / d.width / 2), 3, height)
      const cols = clamp(Math.round((rowsTall * 2 * d.width) / d.height), 3, roomCols)
      body = Image ? (
        <Image key="png" source={{ png: d.png }} columns={cols} rows={rowsTall} alt={`${baseName(d.path)} (pictures show in kitty or Ghostty)`} />
      ) : (
        <Text color={pal.subtle}>Pictures show in the terminal only.</Text>
      )
    } else if (d?.kind === 'lines') {
      const isFormatted = d.isFormatted === true
      const gutter = isFormatted ? 0 : Math.max(2, ...d.rows.slice(-50).map(row => (row.num ?? row.anchor.match(/\d+/)?.[0] ?? '').length))
      const textWidth = Math.max(10, columns - (gutter > 0 ? gutter + 1 : 0) - 4)
      const visual = wrapRows(d.rows, textWidth, isFormatted)
      drawn.total = visual.length
      drawn.height = height
      drawn.firstVisual = []
      visual.forEach((one, i) => {
        if (drawn.firstVisual[one.src] === undefined) drawn.firstVisual[one.src] = i
      })
      // Stripe every other row of each table.
      const stripe = new Set<number>()
      let parity = 0
      d.rows.forEach((row, i) => {
        if (row.style === 'td') {
          if (parity % 2 === 1) stripe.add(i)
          parity += 1
        } else if (row.style !== 'th') parity = 0
      })
      const changedRows = new Set(freshKey ? (change?.rows ?? []) : [])
      const top = clamp(v.top, 0, Math.max(0, visual.length - height))
      const markOf = (src: number): 2 | 3 | undefined => {
        const hit = notes.filter(c => c.path === d.path && src >= c.from && src <= c.to)
        return hit.length === 0 ? undefined : hit.some(c => c.status === 'draft') ? 2 : 3
      }
      const rows: LineRow[] = visual.slice(top, top + height).map(({ line }) => {
        const isSel = sel !== null && sel.path === d.path && line.src >= sel.from && line.src <= sel.to
        const mark = markOf(line.src)
        let out: LineRow = isSel ? (mark ? { ...line, hl: 1, mark } : { ...line, hl: 1 }) : mark ? { ...line, hl: mark } : line
        if (stripe.has(line.src)) out = { ...out, z: 1 }
        if (changedRows.has(line.src)) out = { ...out, fl: 1 }
        return out
      })
      const unit = d.rows.some(row => row.unit === 'node')
        ? 'blocks'
        : d.rows.some(row => row.unit === 'paragraph')
          ? 'paragraphs'
          : d.rows.some(row => row.unit === 'page')
            ? 'pages'
            : isFormatted
              ? 'blocks'
              : 'lines'
      const count =
        unit === 'pages'
          ? d.rows.filter(row => row.unit === 'page').length
          : d.rows.filter(row => row.style !== 'space' && row.style !== 'rule' && row.unit !== 'table row').length
      const percent = visual.length <= height ? 100 : Math.round(((top + height) / visual.length) * 100)
      bar = sel ? (
        <Text wrap="truncate-end">
          <Text color={pal.accent} bold>▌ </Text>
          <Text bold color={pal.text}>{capitalise(sel.label)}</Text>
          <Text color={pal.subtle}>{sel.from === sel.to ? '' : `  ·  ${sel.to - sel.from + 1} rows selected`}</Text>
        </Text>
      ) : (
        <Box flexDirection="row" justifyContent="space-between" width={columns}>
          <Text color={pal.subtle}>
            {count} {unit}
            {v.raw ? ' · source view' : ''}
          </Text>
          <Text color={pal.dim}>{percent >= 100 ? 'All shown' : `${percent}% · PgDn for more`}</Text>
        </Box>
      )
      body =
        rows.length === 0 ? (
          <Text color={pal.dim}>This file is empty.</Text>
        ) : Client ? (
          <Client
            key="viewer"
            module="./viewer.tsx"
            props={
              {
                mode: 'lines',
                pal: vpal,
                rows,
                gutter,
                width: textWidth,
                flashKey: freshKey,
                ...(newest && newest.path === d.path ? { pop: { key: newest.id, r: newest.from, c: 0 } } : {}),
              } satisfies ViewerProps
            }
            height={rows.length}
          />
        ) : (
          <Text>{rows.map(row => row.t).join('\n')}</Text>
        )
      keys = [
        ['click', unit === 'lines' ? 'a line' : 'a paragraph'],
        ['drag', 'a range'],
        ['↑↓', 'move'],
        ['⇧↑↓', 'extend'],
        ['PgUp/PgDn', 'scroll'],
      ]
      if (d.note) bar = <Text color={pal.warning}>{d.note}</Text>
    } else if (d?.kind === 'grid' && !isCurrentShape(d)) {
      bar = <Text color={pal.warning}>This file was opened by an older version of the pane.</Text>
      body = <Text color={pal.subtle}>Press ⟳ Reload above, or run /review-pane again.</Text>
    } else if (d?.kind === 'grid') {
      const sheetIndex = clamp(v.sheet, 0, d.sheets.length - 1)
      const sheet = d.sheets[sheetIndex]
      if (sheet) {
        const isHeader = hasHeader(sheet)
        const bodyStart = isHeader ? 1 : 0
        const widths = sheet.cols.map((_, c) => clamp(Math.max(1, ...sheet.rows.slice(0, 300).map(r => r[c]?.v.length ?? 0)), 3, 16))
        const gutter = Math.max(4, String(sheet.rows.length).length + 1)
        const bodyHeight = Math.max(3, height - 1 - (isHeader ? 2 : 0) - 1)
        const left = clamp(v.left, 0, Math.max(0, sheet.cols.length - 1))
        // Columns that fit beside the gutter and scrollbar; when some must hide, room for "N more ▶" too.
        const fit = (room: number) => {
          let n = 0
          while (left + n < sheet.cols.length && room >= (widths[left + n] ?? 3) + 5) {
            room -= (widths[left + n] ?? 3) + 5
            n += 1
          }
          return n
        }
        const roomCols = columns - gutter - 3
        let shownCols = fit(roomCols)
        if (left + shownCols < sheet.cols.length || left > 0) shownCols = fit(roomCols - 11)
        shownCols = Math.max(1, shownCols)
        drawn.height = bodyHeight
        drawn.shownCols = shownCols
        const bodyTotal = Math.max(0, sheet.rows.length - bodyStart)
        const top = clamp(v.top, 0, Math.max(0, bodyTotal - bodyHeight))
        const sheetName = /^[A-Za-z0-9_]+$/.test(sheet.name) ? sheet.name : `'${sheet.name}'`
        const onSheet = (label: string) => label.startsWith(`${sheetName}!`)
        const inSel = sel !== null && sel.path === d.path && onSheet(sel.label)
        const changedCells = new Set(freshKey ? (change?.cells ?? []) : [])
        const gridRow = (r: number): GridRow => {
          const cells = sheet.rows[r] ?? []
          const inView = Array.from({ length: shownCols }, (_, j) => j)
          const marks: Record<string, 2 | 3> = {}
          for (const c of notes) {
            if (c.path !== d.path || !onSheet(c.label) || r < c.from || r > c.to) continue
            for (const j of inView) {
              const col = left + j
              if (col >= (c.colFrom ?? 0) && col <= (c.colTo ?? 0)) marks[String(j)] = c.status === 'draft' || marks[String(j)] === 2 ? 2 : 3
            }
          }
          const hl: number[] = []
          if (inSel && r >= sel.from && r <= sel.to) for (let c = sel.colFrom ?? 0; c <= (sel.colTo ?? 0); c += 1) hl.push(c)
          return {
            r,
            n: String(r + 1),
            cells: inView.map(j => cells[left + j]?.v ?? ''),
            hl,
            fx: inView.filter(j => cells[left + j]?.f !== undefined),
            num: inView.filter(j => cells[left + j]?.x !== undefined),
            neg: inView.filter(j => (cells[left + j]?.x ?? 0) < 0),
            err: inView.filter(j => (cells[left + j]?.v ?? '').startsWith('#')),
            fl: inView.filter(j => changedCells.has(`${sheetIndex}:${r}:${left + j}`)),
            marks,
          }
        }
        const rows = Array.from({ length: Math.min(bodyHeight, bodyTotal - top) }, (_, i) => gridRow(bodyStart + top + i))
        const newestHere = newest && newest.path === d.path && onSheet(newest.label) ? newest : undefined
        const props: ViewerProps = {
          mode: 'grid',
          pal: vpal,
          letters: sheet.cols.slice(left, left + shownCols),
          widths: widths.slice(left, left + shownCols),
          gutter,
          left,
          ...(isHeader ? { header: gridRow(0) } : {}),
          rows,
          moreLeft: left,
          moreRight: Math.max(0, sheet.cols.length - left - shownCols),
          moreBelow: Math.max(0, bodyTotal - top - rows.length),
          scroll: { top, shown: rows.length, total: bodyTotal },
          isZebra: bodyTotal > 6,
          flashKey: freshKey,
          ...(newestHere ? { pop: { key: newestHere.id, r: newestHere.from, c: newestHere.colFrom ?? 0 } } : {}),
        }

        // The formula bar: the cell's formula and value, or a range's sum with a sparkline.
        if (inSel) {
          const ref = sel.label.slice(sel.label.indexOf('!') + 1)
          const isOne = sel.from === sel.to && sel.colFrom === sel.colTo
          const nameBox = <Text backgroundColor={pal.band || undefined} color={pal.accent} bold>{` ${padRight(ref, 5)}`}</Text>
          if (isOne) {
            const cell = sheet.rows[sel.from]?.[sel.colFrom ?? 0]
            bar = cell?.f ? (
              <Box flexDirection="row" justifyContent="space-between" width={columns}>
                <Text wrap="truncate-end">
                  {nameBox}
                  <Text color={pal.formula} bold>  ƒx  </Text>
                  <Text color={pal.text}>{cell.f}</Text>
                </Text>
                <Text>
                  <Text color={pal.subtle}>= </Text>
                  <Text color={pal.formula} bold>{cell.v}</Text>
                </Text>
              </Box>
            ) : (
              <Text wrap="truncate-end">
                {nameBox}
                <Text>{'  '}</Text>
                {cell?.v ? <Text color={pal.text}>{cell.v}</Text> : <Text color={pal.dim}>Empty cell</Text>}
              </Text>
            )
          } else {
            const numbers: number[] = []
            let filled = 0
            for (let r = sel.from; r <= sel.to; r += 1)
              for (let c = sel.colFrom ?? 0; c <= (sel.colTo ?? 0); c += 1) {
                const cell = sheet.rows[r]?.[c]
                if (cell?.v) filled += 1
                if (cell?.x !== undefined) numbers.push(cell.x)
              }
            const sum = numbers.reduce((a, b) => a + b, 0)
            bar = (
              <Box flexDirection="row" justifyContent="space-between" width={columns}>
                <Text wrap="truncate-end">
                  {nameBox}
                  <Text color={pal.subtle}>  {filled} cell{filled === 1 ? '' : 's'}</Text>
                  {numbers.length > 0 && (
                    <Text>
                      <Text color={pal.subtle}>  ·  Σ </Text>
                      <Text color={pal.text} bold>{formatNumber(sum)}</Text>
                      <Text color={pal.subtle}>  ·  avg </Text>
                      <Text color={pal.text} bold>{formatNumber(sum / numbers.length)}</Text>
                    </Text>
                  )}
                </Text>
                {numbers.length > 1 && <Text color={pal.formula}>{sparkline(numbers, 16)}</Text>}
              </Box>
            )
          }
        } else {
          bar = (
            <Box flexDirection="row" justifyContent="space-between" width={columns}>
              <Text color={pal.dim}>Click a cell to see its value or formula</Text>
              <Text color={pal.dim}>
                {bodyTotal} rows × {sheet.cols.length} columns{sheet.isCut ? ' (first 500 × 40)' : ''}
              </Text>
            </Box>
          )
        }
        body =
          rows.length === 0 && !isHeader ? (
            <Text color={pal.dim}>This sheet is empty.</Text>
          ) : Client ? (
            <Client key="viewer" module="./viewer.tsx" props={props} height={1 + (isHeader ? 2 : 0) + rows.length + (props.moreBelow > 0 ? 1 : 0)} />
          ) : (
            <Text>{rows.map(row => row.cells.join('  ')).join('\n')}</Text>
          )
        sheetTabs =
          d.sheets.length > 0 && Client ? (
            <Client
              key="sheet-tabs"
              module="./tabs.tsx"
              props={{ group: 'sheets', labels: d.sheets.map(one => one.name), active: sheetIndex, colors: { ...colors, accent: pal.formula } } satisfies TabsProps}
            />
          ) : null
        keys = [
          ['click', 'a cell'],
          ['drag', 'a range'],
          ['←↑↓→', 'move'],
          ['⇧+arrows', 'extend'],
          ...(d.sheets.length > 1 ? ([['[ ]', 'sheet']] as [string, string][]) : []),
        ]
      }
    }

    // ── Commenting ──
    // A selection that already carries a waiting comment edits that comment.
    const matchOf = (target: ReviewSelection | null) =>
      target === null ? undefined : notes.find(c => c.status === 'draft' && c.path === target.path && c.label === target.label)
    const editing = matchOf(sel)

    const saveComment = async (text: string) => {
      const trimmed = text.trim()
      const target = await read($, selection)
      if (!target) return
      const existing = (await read($, comments)).find(c => c.status === 'draft' && c.path === target.path && c.label === target.label)
      if (existing) {
        if (trimmed === '') {
          await update($, comments, old => old.filter(c => c.id !== existing.id))
          $.ui.toast('Comment deleted')
        } else {
          await update($, comments, old => old.map(c => (c.id === existing.id ? { ...c, text: trimmed } : c)))
          $.ui.toast('✓ Comment updated')
        }
        return
      }
      if (trimmed === '') return
      await update($, comments, old => [...old, { ...target, id: crypto.randomUUID(), text: trimmed, status: 'draft' as const }])
      // The selection and cursor stay put, so the next arrow or click moves on from here.
      $.ui.toast(`✓ Comment added. ${isGrid ? 'Pick the next cell' : 'Select the next part'}, or send when you're done.`)
    }

    /** Jumps to a comment's place, so the comment box edits it. */
    const jumpTo = async (c: ReviewComment) => {
      if (c.path !== (await read($, current))) await show($, c.path)
      const shown = await read($, doc)
      let sheet = (await read($, view)).sheet
      if (shown?.kind === 'grid' && c.label.includes('!')) {
        const name = c.label.slice(0, c.label.indexOf('!')).replace(/^'|'$/g, '')
        sheet = Math.max(0, shown.sheets.findIndex(one => one.name === name))
      }
      const { id, text, status, ...place } = c
      void id
      void text
      void status
      await update($, selection, () => place)
      await update($, view, old => ({
        ...old,
        sheet,
        top: Math.max(0, c.from - 3),
        left: Math.max(0, (c.colFrom ?? 0) - 1),
        anc: [c.from, c.colFrom ?? 0] as [number, number],
        cur: [c.to, c.colTo ?? 0] as [number, number],
      }))
    }

    const deliver = async (how: 'fill' | 'submit') => {
      const pending = (await read($, comments)).filter(c => c.status === 'draft')
      if (pending.length === 0) return
      const text = feedbackPrompt(pending)
      const count = `${pending.length} comment${pending.length === 1 ? '' : 's'}`
      if (how === 'fill') {
        const filled = await $.prompt.fill({ text, mode: 'replace' })
        if (!filled.isFilled) {
          $.ui.toast("Couldn't reach the prompt box. Try “Send to Claude” instead.")
          return
        }
        $.ui.toast(`Your ${count} ${pending.length === 1 ? 'is' : 'are'} in the prompt box. Edit them, then press Enter.`)
      } else {
        void $.prompt.submit({ text })
        $.ui.toast(`✓ Sent ${count}. Claude is updating the file.`)
      }
      const ids = new Set(pending.map(c => c.id))
      await update($, comments, old => old.map(c => (ids.has(c.id) ? { ...c, status: 'sent' as const } : c)))
    }

    const shortLabel = (label: string) => (label.includes('!') ? label.slice(label.indexOf('!') + 1) : label)
    const commentRow = sel ? (
      Input ? (
        <Box flexDirection="row">
          <Text color={pal.comment} bold>✎ </Text>
          <Input
            key={editing ? `edit-${editing.id}-${editing.text.length}` : `comment-${notes.length}`}
            label={`${editing ? 'Edit comment on' : 'Comment on'} ${shortLabel(sel.label)}`}
            placeholder={editing ? 'Clear the text and press Enter to delete' : 'What should change here?'}
            submitLabel={editing ? 'Save' : 'Add'}
            {...(editing ? { value: editing.text } : {})}
            autoFocus
            onSubmit={value => void saveComment(value)}
          />
        </Box>
      ) : (
        <Text color={pal.subtle}>Comments can be added from the terminal.</Text>
      )
    ) : d && d.kind !== 'error' ? (
      <Text>
        <Text color={pal.dim}>✎ </Text>
        <Text color={pal.dim} italic>Select {isGrid ? 'a cell' : 'some text'} to comment on it</Text>
      </Text>
    ) : null

    // The comments section opens with its own header line, so it reads apart from the document and the keys.
    const sectionHeader = (title: string, detail: string) => {
      const head = ` ${title} `
      const tail = detail ? ` ${detail} ` : ''
      return (
        <Text wrap="truncate-end">
          <Text color={pal.dim}>──</Text>
          <Text color={pal.comment} bold>{head}</Text>
          <Text color={pal.subtle}>{tail}</Text>
          <Text color={pal.dim}>{'─'.repeat(Math.max(2, columns - 2 - head.length - tail.length))}</Text>
        </Text>
      )
    }
    const labelWidth = clamp(Math.max(...listed.map(c => noteLabel(c, path).length)), 6, 24)
    const commentList =
      drafts.length === 0 ? (
        d && d.kind !== 'error' ? (
          <Box flexDirection="column">
            {sectionHeader('Comments', '')}
            <Text color={pal.dim}>  No comments yet. Select something and say what to change.</Text>
          </Box>
        ) : null
      ) : (
        <Box flexDirection="column">
          {sectionHeader(`Comments · ${drafts.length}`, 'click one to review or edit it')}
          {listed.map((c, i) => {
            const isOpen = editing?.id === c.id
            return (
              <Box key={`note-${c.id}`} flexDirection="row" justifyContent="space-between" width={columns}>
                <Box flexDirection="row">
                  <Text color={isOpen ? pal.accent : pal.comment} bold>{isOpen ? '▸ ' : '● '}</Text>
                  <Button
                    key={`open-${c.id}`}
                    label={`${String(i + 1).padStart(2)}  ${padRight(noteLabel(c, path), labelWidth)}`}
                    plain
                    onPress={() => jumpTo(c)}
                  />
                  <Text bold={isOpen} color={pal.text} wrap="truncate-end"> {c.text}</Text>
                </Box>
                <Button
                  key={`del-${c.id}`}
                  label="✕"
                  plain
                  dimColor
                  onPress={async () => {
                    await update($, comments, old => old.filter(one => one.id !== c.id))
                    $.ui.toast('Comment deleted')
                  }}
                />
              </Box>
            )
          })}
          {drafts.length > listed.length && <Text color={pal.subtle}>   … and {drafts.length - listed.length} more</Text>}
        </Box>
      )

    const isWaiting = sent.length > 0
    const actions =
      drafts.length > 0 ? (
        <Box flexDirection="row" columnGap={2}>
          <Button
            key="send"
            label={`➤ Send ${drafts.length} comment${drafts.length === 1 ? '' : 's'} to Claude`}
            variant="primary"
            onPress={() => deliver('submit')}
          />
          <Button key="fill" label="Edit before sending" plain onPress={() => deliver('fill')} />
        </Box>
      ) : isWaiting && Client ? (
        <Client
          key="spinner"
          module="./spinner.tsx"
          props={{ text: `Claude is working on ${sent.length} comment${sent.length === 1 ? '' : 's'}…`, color: pal.claude, glow: pal.warning } satisfies SpinnerProps}
        />
      ) : null

    // Key hints as chips: the key on a band, what it does after it.
    const keyLine =
      keys.length === 0 ? null : (
        <Text wrap="truncate-end">
          {keys.map(([key, what], i) => (
            <Text key={`k${i}`}>
              <Text backgroundColor={pal.band || undefined} color={pal.text} bold inverse={!pal.band}>{` ${key} `}</Text>
              <Text color={pal.subtle}> {what}{i < keys.length - 1 ? '   ' : ''}</Text>
            </Text>
          ))}
        </Text>
      )

    return (
      <Box flexDirection="column" width={columns}>
        {topBar}
        {bar}
        {rule(pal.dim)}
        {body}
        {sheetTabs}
        <Box marginTop={1}>{commentRow}</Box>
        <Box marginTop={1}>{commentList}</Box>
        {actions && <Box marginTop={1}>{actions}</Box>}
        {keyLine && <Box marginTop={1} flexDirection="column">{rule(pal.dim)}{keyLine}</Box>}
      </Box>
    )
  })
}

/** Cells are objects since 0.2; an older pane held them as arrays. */
function isCurrentShape(d: { sheets: { rows: unknown[][] }[] }) {
  const cell = d.sheets.find(sheet => sheet.rows.length > 0)?.rows[0]?.[0]
  return cell === undefined || (typeof cell === 'object' && cell !== null && !Array.isArray(cell))
}

/** A sheet's first row reads as a header when it is all text. */
function hasHeader(sheet: { rows: { v: string; x?: number; f?: string }[][] } | undefined) {
  const first = sheet?.rows[0]
  if (!sheet || !first || sheet.rows.length < 2) return false
  const filled = first.filter(cell => cell.v !== '')
  return filled.length > 0 && filled.every(cell => cell.x === undefined && cell.f === undefined)
}

function noteLabel(c: ReviewComment, path: string | null) {
  const label = c.label.includes('!') ? c.label.slice(c.label.indexOf('!') + 1) : c.label
  return c.path === path ? capitalise(label) : `${baseName(c.path)} · ${label}`
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const padRight = (text: string, width: number) => (text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length))

/** A one-row sparkline of numbers: ▁▂▃▄▅▆▇█, at most `most` of them (evenly sampled). */
function sparkline(values: number[], most: number) {
  const bars = '▁▂▃▄▅▆▇█'
  const step = Math.max(1, Math.ceil(values.length / most))
  const picked = values.filter((_, i) => i % step === 0)
  const lo = Math.min(...picked)
  const hi = Math.max(...picked)
  return picked.map(x => bars[hi === lo ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)] ?? '▁').join('')
}

function formatNumber(n: number) {
  const fixed = Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(2).replace(/\.?0+$/, '')
  const [whole = '', part] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}${grouped}${part ? `.${part}` : ''}`
}
