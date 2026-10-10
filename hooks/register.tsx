// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderNode, RenderSurface } from 'claude-code'

import type { Doc, DocRow, Pixels, ReviewComment, ReviewSelection, View } from '../types'
import { adfRows, isAdf } from './adf'
import type { FileBarProps } from './filebar'
import { htmlRows } from './html'
import { markdownRows } from './md'
import {
  PROMPT_HEADER,
  capitalise,
  cutTo,
  describeGrid,
  describeLines,
  diffDocs,
  feedbackPrompt,
  formatNumber,
  hasHeader,
  isAbsolutePath,
  layoutTables,
  normalizePath,
  noteLabel,
  padRight,
  reanchor,
  sanitizeLine,
  stripControls,
  strWidth,
  wrapRows,
} from './model'
import { pandaRows } from './panda'
import { decodePicture, fitCells, toRgba } from './picture'
import { TooSlow, startReading, stopReading } from './deadline'
import { readDocx } from './docx'
import { readPdf } from './pdf'
import { readXlsx } from './xlsx'
import { BADGES, PALETTE } from './palette'
import type { Palette } from './palette'
import type { SpinnerProps } from './spinner'
import type { GridRow, LineRow, ViewerPost, ViewerProps } from './viewer'

const PANE = 'review'
const TITLE = 'Lazy Panda Panel'

/** Files the pane can show, by extension. */
const TEXT_KINDS = ['md', 'markdown', 'txt', 'html', 'htm', 'csv', 'json', 'yaml', 'yml', 'adf']
const DOC_KINDS = ['docx', 'pdf', 'xlsx']
const SOURCE_KINDS = ['md', 'markdown', 'html', 'htm', 'adf', 'json']
/** What auto-open considers a finished output worth opening. */
const AUTO_KINDS = ['docx', 'pdf', 'png', 'html', 'htm', 'md', 'markdown', 'adf']
const AUTO_MAX_FILES = 5
/** The text samples the plugin ships, written by /panda examples. */
const EXAMPLE_TEXTS = ['launch-plan.md', 'project-update.adf', 'pricing-page.html', 'meter-readings.csv']
/** Comments listed under the document before the rest are counted. */
const MAX_LISTED = 12
const MAX_FILES = 30
/** Text files: formatted up to 2 MB, plain lines up to 4 MB (all Claude Code reads for a mod), refused beyond; at most 20,000 rows. */
const FORMAT_MAX_BYTES = 2_000_000
const TEXT_MAX_BYTES = 4 * 1024 * 1024
const MAX_ROWS = 20_000
const MAX_LINE = 20_000
/** Word, Excel and PDF files larger than this are refused. */
const OFFICE_MAX_BYTES = 50 * 1024 * 1024

/** A reader's rows made safe to draw, with Word tables laid out. */
function cleanLines<T extends { rows: (DocRow & { cells?: string[]; isHeader?: boolean })[] }>(doc: T): T {
  const rows = doc.rows.map(row => ({ ...row, text: stripControls(row.text), ...(row.spans ? { spans: row.spans.map(sp => ({ ...sp, t: stripControls(sp.t) })) } : {}) }))
  return { ...doc, rows: layoutTables(rows) }
}

/**
 * Rows made safe once more after a reader: HTML entities and ADF's JSON
 * escapes are decoded after the file was cleaned, and can bring controls back.
 */
const cleanRows = (rows: DocRow[]): DocRow[] =>
  rows.map(row => ({ ...row, text: stripControls(row.text), ...(row.spans ? { spans: row.spans.map(sp => ({ ...sp, t: stripControls(sp.t) })) } : {}) }))

/** A file's bytes from the base64 $.fs.read gives. */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let k = 0; k < binary.length; k += 1) bytes[k] = binary.charCodeAt(k)
  return bytes
}
const SCAN_SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', '.cache'])

const files = atom({ plugin: 'lazy-panda-panel', key: 'files' } as const, [])
const open = atom({ plugin: 'lazy-panda-panel', key: 'open' } as const, { path: null, version: 0 })
const view = atom({ plugin: 'lazy-panda-panel', key: 'view' } as const, { top: 0, left: 0, sheet: 0 })
const selection = atom({ plugin: 'lazy-panda-panel', key: 'selection' } as const, null)
const comments = atom({ plugin: 'lazy-panda-panel', key: 'comments' } as const, [])
const autoOpen = atom({ plugin: 'lazy-panda-panel', key: 'autoOpen' } as const, false)
const changed = atom({ plugin: 'lazy-panda-panel', key: 'changed' } as const, null)

const extOf = (path: string) => (path.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase()
const isSupported = (path: string) => [...TEXT_KINDS, ...DOC_KINDS, 'png'].includes(extOf(path))
const baseName = (path: string) => sanitizeLine(path.split('/').pop() ?? path, 120)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
/** A tool's answer: a live session takes the text, the test kit the result. */
const reply = (text: string, isError = false) => (isError ? { result: text, text, isError: true as const } : { result: text, text })

type LinesDoc = Extract<Doc, { kind: 'lines' }>
type GridDoc = Extract<Doc, { kind: 'grid' }>

/** What this session's hooks share; set again on each load by session.start. */
const session = {
  /** The working folder, as normalizePath writes it. */
  folder: '',
  /** The working folder with links resolved: the model's tools open files under it. */
  realFolder: '',
  /** The command that runs the Python helper here, once one has worked (Windows has `py` and `python`, not `python3`). */
  python: null as 'python3' | 'py' | 'python' | 'none' | null,
  /** Supported files written this turn, for auto-open; and this session, which the tools may open wherever they are. */
  turnFiles: new Set<string>(),
  claudeWrote: new Set<string>(),
  /** The main agent's running turn, and comment sends waiting for a turn to finish (`skipTurn`: not that one, it was already running). */
  turn: null as string | null,
  batches: [] as { id: string; skipTurn?: string }[],
  isRefreshing: false,
  /** The terminal draws real pictures (kitty, Ghostty); elsewhere a picture is a card, never a blur of coloured blocks. */
  isSharp: false,
  /** How many times the pane has switched to another file: part of the comment box's key. */
  switches: 0,
  /** Files changed on disk that the pane couldn't reread yet: their Reload is lit until it does. */
  stale: new Set<string>(),
  /** How to open a file in the computer's own app; null over SSH or with no desktop. */
  opener: null as 'open' | 'xdg-open' | 'explorer' | null,
}

/**
 * Parsed documents, by path, as last read. They stay in the hooks module, not
 * in $.state: a workbook can be far larger than a state value may be.
 */
const docs = new Map<string, Doc>()
/** The file a show() is loading: a slower load that finishes after a newer one started is dropped. */
let intended: string | null = null
/** Each open file's modification time when the pane last read it. */
const seen = new Map<string, number>()

/** Pictures decoded for the preview, by file, version and picture: a few are kept. */
const pictureCache = new Map<string, Pixels | string>()

/** The picture a selection is exactly on, decoded (or why it can't be): null when the selection isn't one picture. */
async function selectedPicture($: EngineInterface, d: Doc | undefined, sel: ReviewSelection | null, version: number, isRaw: boolean): Promise<Shown | null> {
  if (!d || !sel || sel.path !== d.path) return null
  let key: string
  let label = ''
  let index = 0
  let load: () => Promise<Pixels | string> | Pixels | string
  if (d.kind === 'image') {
    key = `${d.path}|${version}|file`
    load = () => decodePicture(bytesOf(d.png))
  } else if (d.kind === 'lines' && !isRaw && sel.from === sel.to && (sel.raw === true) === isRaw) {
    const row = d.rows[sel.from]
    const pic = row?.pic
    if (pic === undefined || !row) return null
    key = `${d.path}|${version}|${pic}`
    index = pic
    if (row.src !== undefined) {
      const src = row.src
      load = () => linkedPicture($, d.path, src)
    } else {
      const picture = d.pictures?.[pic]
      if (!picture) return null
      label = picture.label
      load = picture.load
    }
  } else return null
  if (!session.isSharp) return { index, label, result: null }
  let result = pictureCache.get(key)
  if (result === undefined) {
    // Remembered before decoding: if this draw runs out of time, the next one doesn't start again.
    pictureCache.set(key, 'it takes too long to draw here')
    startReading(3000)
    try {
      result = await load()
    } catch (error) {
      result = error instanceof TooSlow ? 'it takes too long to draw here' : error instanceof Error ? sanitizeLine(error.message, 200) : 'the picture is damaged'
    } finally {
      stopReading()
    }
    pictureCache.set(key, result)
    for (const old of pictureCache.keys()) if (pictureCache.size > 12 && old !== key) pictureCache.delete(old)
  }
  return { index, label, result }
}

/**
 * A picture a Markdown or HTML file shows: a file beside it (read, never
 * sent anywhere) or a data: address. Nothing is ever downloaded.
 */
async function linkedPicture($: EngineInterface, docPath: string, src: string): Promise<Pixels | string> {
  const data = /^data:image\/[\w.+-]+;base64,(.*)$/is.exec(src.trim())
  if (data) {
    try {
      return decodePicture(bytesOf((data[1] ?? '').replace(/\s+/g, '')))
    } catch {
      return 'the picture written into the file is damaged'
    }
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return 'it is on the web, and the pane never downloads anything'
  let name = src.replace(/[?#].*$/, '')
  try {
    name = decodeURIComponent(name)
  } catch {
    /* kept as written */
  }
  if (!/\.(png|jpe?g|gif)$/i.test(name)) return `it is ${/\.svg$/i.test(name) ? 'an SVG drawing' : 'in a format'}, which the pane can’t draw`
  const folder = docPath.slice(0, docPath.lastIndexOf('/'))
  const path = normalizePath(isAbsolutePath(name) ? name : `${folder}/${name}`)
  let st
  try {
    st = await $.fs.stat(path, { resolve: true })
  } catch {
    return `there is no picture file at ${sanitizeLine(path, 200)}`
  }
  // Only an ordinary file, really (links followed) in the document's folder or the working folder, and not in a hidden folder.
  const real = st.realPath === undefined ? undefined : sameCase(normalizePath(st.realPath))
  const roots = [folder, session.realFolder].map(root => sameCase(normalizePath(root))).filter(root => !/^(?:[a-z]:)?\/?$/.test(root))
  const inside = real !== undefined && roots.some(root => real.startsWith(`${root}/`) && !real.slice(root.length + 1).split('/').some(part => part.startsWith('.')))
  if (st.kind !== 'file' || !inside) return 'the picture file is outside the document’s folder, so the pane doesn’t open it'
  if (st.size > READ_MAX_BYTES) return 'the picture file is over 4 MB, too large to preview here'
  try {
    return decodePicture(bytesOf((await $.fs.read(path, { as: 'bytes' })).base64))
  } catch {
    return `the picture file at ${sanitizeLine(path, 200)} can’t be read`
  }
}

/** What a surface last drew, for scrolling maths. */
type Drawn = { total: number; firstVisual: number[]; height: number; shownCols: number }
const drawnBy = new Map<RenderSurface, Drawn>()
const drawnOn = (surface: RenderSurface): Drawn => drawnBy.get(surface) ?? { total: 0, firstVisual: [], height: 10, shownCols: 1 }

// ── Reading files ──

/** Claude Code reads files of up to 4 MiB for a mod; larger Word, Excel and PDF files come through Python. */
const READ_MAX_BYTES = 4 * 1024 * 1024

type Python = 'python3' | 'py' | 'python'

const kindName = (ext: string) => (ext === 'xlsx' ? 'workbook' : ext === 'docx' ? 'Word document' : 'PDF')
const appName = (ext: string) => (ext === 'xlsx' ? 'Excel' : ext === 'docx' ? 'Word' : 'your PDF reader')
const megabytes = (size: number) => `${(size / (1024 * 1024)).toFixed(1)} MB`

/** What the pane says about a document over 4 MB when there is no Python here. */
const bigFileNote = (size: number, ext: string) =>
  `This ${kindName(ext)} is ${megabytes(size)}. The pane opens Word, Excel and PDF files up to 4 MB by itself; ` +
  'larger ones need Python 3 on this computer (nothing else to install). Run /panda setup to check, and Claude can help you install it. ' +
  `You can also ask Claude about the file, or open it in ${appName(ext)}.`

/**
 * The request /panda setup puts in the prompt box when there's no Python.
 * The mod installs nothing: the person reads this, and only if they press
 * Enter does Claude help, asking before it installs anything.
 */
const INSTALL_PYTHON_REQUEST = [
  'Please help me install Python 3, so the Lazy Panda Panel can open Word, Excel and PDF files over 4 MB. I’m not technical, so go one step at a time, in plain language.',
  '',
  '- First check which computer this is (Windows, Mac or Linux) and whether Python 3 is already installed but not found (on Windows, try “py --version”). If it is, help me with that instead of installing a second copy.',
  '- Before installing anything, tell me what you’d install, where it comes from and roughly how big it is, and wait for my yes. If I say no, stop.',
  '- Use only official sources. Windows: winget (with --accept-package-agreements --accept-source-agreements) or the python.org installer; there, “python3” may only be a link to the Microsoft Store, so don’t rely on it. Mac: the installer from python.org, opened so I can click through it (Homebrew only if I already have it). Linux: the system’s python3 package.',
  '- If a step needs my password (sudo or an administrator prompt), don’t run it yourself: give me the exact command and tell me to paste it into a separate terminal window.',
  '- Don’t install any Python packages and don’t change anything else on my computer: the panel needs Python 3 only.',
  '- When it’s done, check that it works, then tell me how to restart. On Windows: close this terminal window completely, open a new one, and start Claude Code again. On a Mac or Linux: type /exit and start Claude Code again. Then I run /panda setup to check.',
].join('\n')

/** Puts a request in the prompt box, after anything already typed. It is never sent: the person decides. */
async function offerRequest($: EngineInterface, text: string): Promise<boolean> {
  const box = await $.prompt.read()
  const filled = await $.prompt.fill(box.text.trim() === '' ? { text, mode: 'replace' } : { text: `\n\n${text}`, mode: 'append' })
  return filled.isFilled
}

/**
 * Starts one of the two bundled scripts with one of the Python commands, in
 * the plugin's folder, with `input` on standard input. Every command is
 * written out as fixed text; nothing from a document or a path is ever part of one.
 */
function startScript($: EngineInterface, python: Python, script: 'read' | 'examples', input: string) {
  if (script === 'read') {
    if (python === 'python3') return $.process.spawn({ argv: ['python3', '-I', './scripts/read_file.py'], cwd: $.plugin.root, input })
    if (python === 'py') return $.process.spawn({ argv: ['py', '-3', '-I', './scripts/read_file.py'], cwd: $.plugin.root, input })
    return $.process.spawn({ argv: ['python', '-I', './scripts/read_file.py'], cwd: $.plugin.root, input })
  }
  if (python === 'python3') return $.process.spawn({ argv: ['python3', '-I', './scripts/make_examples.py'], cwd: $.plugin.root, input })
  if (python === 'py') return $.process.spawn({ argv: ['py', '-3', '-I', './scripts/make_examples.py'], cwd: $.plugin.root, input })
  return $.process.spawn({ argv: ['python', '-I', './scripts/make_examples.py'], cwd: $.plugin.root, input })
}

/** A script's standard output, or 'timeout', or null when it could not start or wrote too much. */
async function collect($: EngineInterface, stream: ReturnType<typeof startScript>, timeoutMs: number): Promise<string | null | 'timeout'> {
  const parts: string[] = []
  let size = 0
  const iterator = stream[Symbol.asyncIterator]()
  const stop = new AbortController()
  const timer = $.clock.sleep(timeoutMs, { signal: stop.signal }).then(
    () => 'timeout' as const,
    () => 'stopped' as const,
  )
  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), timer])
      if (step === 'timeout') {
        await iterator.return?.(undefined as never)
        return 'timeout'
      }
      if (step === 'stopped' || step.done) break
      if (step.value.stream !== 'stdout') continue
      size += step.value.text.length
      // 50 MB as base64, and a little over.
      if (size > 70 * 1024 * 1024) {
        await iterator.return?.(undefined as never)
        return null
      }
      parts.push(step.value.text)
    }
  } catch {
    return null
  } finally {
    stop.abort()
  }
  return parts.join('')
}

/**
 * Runs a bundled script with Python 3: python3, then py -3 (the Windows
 * launcher), then python, until one answers (Windows' own python3 may be only
 * a Microsoft Store link). The one that worked is remembered for the session;
 * so is finding none, so a Mac without Python is not asked again (/panda
 * setup asks again).
 */
async function runPython($: EngineInterface, script: 'read' | 'examples', input: string, timeoutMs: number): Promise<string | 'none' | 'timeout'> {
  if (session.python === 'none') return 'none'
  // On a Mac without Python, running python3 pops up Apple's offer to install its developer tools: it is run only when a real Python is there.
  if (session.python === null && (await isMacWithoutPython($))) {
    session.python = 'none'
    return 'none'
  }
  const order: Python[] = session.python ? [session.python] : ['python3', 'py', 'python']
  for (const python of order) {
    const out = await collect($, startScript($, python, script, input), timeoutMs)
    if (out === 'timeout') return 'timeout'
    if (out !== null && out.startsWith('LPP1')) {
      session.python = python
      return out
    }
  }
  session.python = 'none'
  return 'none'
}

/** Where a Mac keeps a real Python 3: Apple's developer tools or Xcode, python.org's installer, Homebrew, MacPorts. */
const MAC_PYTHONS = [
  '/Library/Developer/CommandLineTools/usr/bin/python3',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/usr/local/bin/python3',
  '/opt/homebrew/bin/python3',
  '/opt/local/bin/python3',
]

/** A Mac where /usr/bin/python3 can only be Apple's stub: none of the usual Pythons is installed. */
async function isMacWithoutPython($: EngineInterface): Promise<boolean> {
  if (!(await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist'))) return false
  const home = homeOf(session.folder)
  const own = home ? [`${home}/.pyenv/shims/python3`, `${home}/miniconda3/bin/python3`, `${home}/anaconda3/bin/python3`, `${home}/.local/bin/python3`] : []
  for (const path of [...MAC_PYTHONS, '/opt/anaconda3/bin/python3', '/opt/miniconda3/bin/python3', ...own]) if (await $.fs.exists(path)) return false
  return true
}

/** The command that opens a file in its usual app here: none over SSH (it would open on the server) or on a Linux without a desktop. */
async function openerHere($: EngineInterface): Promise<typeof session.opener> {
  if ((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY'))) return null
  if (/^[a-z]:\//i.test(session.folder) || session.folder.startsWith('//')) return 'explorer'
  if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) return 'open'
  return (await $.env.get('DISPLAY')) || (await $.env.get('WAYLAND_DISPLAY')) ? 'xdg-open' : null
}

/** Opens a file in the computer's own app (Preview, Photos, Word…), as double-clicking it would. */
async function openOutside($: EngineInterface, path: string) {
  $.ui.toast(`Opening ${baseName(path)}…`)
  try {
    if (session.opener === 'open') await $.process.run(['open', path], { timeoutMs: 10_000 })
    else if (session.opener === 'xdg-open') await $.process.run(['xdg-open', path], { timeoutMs: 10_000 })
    else if (session.opener === 'explorer') await $.process.run(['explorer.exe', path.replace(/\//g, '\\')], { timeoutMs: 10_000 })
  } catch {
    $.ui.toast(`Couldn’t open ${baseName(path)}. Open it from your files instead.`)
  }
}

/** A Word, Excel or PDF file's bytes: read directly up to 4 MB, through Python beyond. */
async function officeBytes($: EngineInterface, path: string, size: number, ext: string): Promise<Uint8Array | Extract<Doc, { kind: 'error' }>> {
  if (size <= READ_MAX_BYTES) return bytesOf((await $.fs.read(path, { as: 'bytes' })).base64)
  const out = await runPython($, 'read', path, 30_000)
  if (out === 'none') return { kind: 'error', path, message: bigFileNote(size, ext), isNotice: true }
  if (out === 'timeout') return { kind: 'error', path, message: `Reading this ${megabytes(size)} file took too long. Try again, or open it in ${appName(ext)}.` }
  const newline = out.indexOf('\n')
  const head = newline < 0 ? out : out.slice(0, newline)
  if (head.startsWith('LPP1 error')) return { kind: 'error', path, message: sanitizeLine(head.slice(11), 300) }
  return bytesOf(out.slice(newline + 1).replace(/\s+/g, ''))
}

async function loadDoc($: EngineInterface, path: string, isRaw = false): Promise<Doc> {
  const ext = extOf(path)
  let size: number
  try {
    const st = await $.fs.stat(path)
    // A device or a pipe named like a document is never read: reading one could wait forever.
    if (st.kind !== 'file') return { kind: 'error', path, message: 'This isn’t an ordinary file, so the pane doesn’t open it.' }
    size = st.size
  } catch {
    return { kind: 'error', path, message: 'This file was deleted or moved.' }
  }
  try {
    if (ext === 'png') {
      if (size > READ_MAX_BYTES) return { kind: 'error', path, message: `This picture is ${megabytes(size)}, more than the 4 MB Claude Code lets a mod read. Open it in an image viewer to see it.` }
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      // The PNG header: width and height are the big-endian words at bytes 16 and 20.
      const head = atob(base64.slice(0, 32))
      const word = (at: number) => [0, 1, 2, 3].reduce((n, k) => n * 256 + (head.charCodeAt(at + k) || 0), 0)
      return { kind: 'image', path, png: base64, width: word(16) || 1, height: word(20) || 1 }
    }
    if (DOC_KINDS.includes(ext)) {
      if (size > OFFICE_MAX_BYTES) return { kind: 'error', path, message: `This ${kindName(ext)} is ${megabytes(size)}; the pane shows files up to 50 MB. Open it in ${appName(ext)}.` }
      const bytes = await officeBytes($, path, size, ext)
      if (!(bytes instanceof Uint8Array)) return bytes
      // Reading has a time limit well inside a hook's own: a file that would take longer shows what was read, or says so.
      startReading(4000)
      try {
        if (ext === 'xlsx') return { ...readXlsx(bytes), path }
        if (ext === 'docx') return { ...cleanLines(readDocx(bytes)), path }
        const pdf = await readPdf(bytes)
        return pdf.kind === 'error' ? { ...pdf, path } : { ...cleanLines(pdf), path }
      } catch (error) {
        if (error instanceof TooSlow) return { kind: 'error', path, message: `This ${kindName(ext)} takes too long to read here. Open it in ${appName(ext)}, or ask Claude about it.` }
        return { kind: 'error', path, message: `Could not read the file: ${sanitizeLine(error instanceof Error ? error.message : String(error), 300)}.` }
      } finally {
        stopReading()
      }
    }
    if (size > TEXT_MAX_BYTES) return { kind: 'error', path, message: `This file is ${megabytes(size)}; the pane shows text files up to 4 MB.` }
    const text = stripControls(await $.fs.read(path))
    const isBig = size > FORMAT_MAX_BYTES
    if (!isRaw && !isBig) {
      if (ext === 'md' || ext === 'markdown') return capRows({ kind: 'lines', path, rows: cleanRows(markdownRows(text)), isFormatted: true, hasSource: true })
      if (ext === 'html' || ext === 'htm') return capRows({ kind: 'lines', path, rows: cleanRows(htmlRows(text)), isFormatted: true, hasSource: true })
      // Confluence/Jira pages as ADF: .adf files, or .json files holding a doc node.
      if (ext === 'adf' || ext === 'json') {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        if (isAdf(parsed)) return capRows({ kind: 'lines', path, rows: cleanRows(adfRows(parsed)), isFormatted: true, hasSource: true })
        if (ext === 'adf') return { kind: 'error', path, message: 'This .adf file is not an ADF document (expected {"type": "doc", "content": [...]}).' }
      }
    }
    // A line longer than anyone reads in a pane (minified JSON, one huge CSV row) is cut, and the note says so.
    let isLong = false
    const rows: DocRow[] = text.split('\n').map((line, i) => {
      const flat = line.replace(/\t/g, '  ')
      if (flat.length <= MAX_LINE) return { text: flat, anchor: `line ${i + 1}`, unit: 'line' }
      isLong = true
      return { text: `${flat.slice(0, MAX_LINE)}…`, anchor: `line ${i + 1}`, unit: 'line' }
    })
    if (rows.length > 1 && rows[rows.length - 1]?.text === '') rows.pop()
    const hasSource = !isBig && SOURCE_KINDS.includes(ext) && (ext !== 'json' || isRaw)
    const doc: LinesDoc = { kind: 'lines', path, rows, ...(hasSource ? { hasSource } : {}) }
    if (isBig) doc.note = 'This file is over 2 MB, so it is shown as plain text.'
    if (isLong) doc.note = `${doc.note ? `${doc.note} ` : ''}Lines over ${MAX_LINE.toLocaleString('en')} characters are cut short.`
    return capRows(doc)
  } catch (error) {
    return { kind: 'error', path, message: `Could not open the file: ${sanitizeLine(String(error), 600)}` }
  }
}

function capRows(d: LinesDoc): LinesDoc {
  if (d.rows.length <= MAX_ROWS) return d
  const cut = `Only the first ${MAX_ROWS.toLocaleString('en')} of ${d.rows.length.toLocaleString('en')} rows are shown.`
  return { ...d, rows: d.rows.slice(0, MAX_ROWS), note: d.note ? `${d.note} ${cut}` : cut }
}

/**
 * Holds a fresh read of a file and finds its comments again in it, by the
 * text they quote: drafts and comments in the prompt box follow the text
 * they are about, or are marked stale when it is gone.
 */
async function hold($: EngineInterface, path: string, d: Doc, isRaw: boolean) {
  docs.set(path, d)
  // Keep a few documents; the open one is always read again when missing.
  for (const key of docs.keys()) if (docs.size > 8 && key !== path) docs.delete(key)
  if (d.kind !== 'lines' && d.kind !== 'grid') return
  const moves = (c: ReviewComment) => c.path === path && c.status !== 'sent' && (c.raw === true) === isRaw
  if ((await read($, comments)).some(moves)) await update($, comments, old => old.map(c => (moves(c) ? reanchor(c, d) : c)))
  const sel = await read($, selection)
  if (sel && sel.path === path && (sel.raw === true) === isRaw) {
    const found = reanchor({ ...sel, id: '', text: '', status: 'draft' }, d)
    const { id, text, status, isStale, ...place } = found
    void [id, text, status]
    await update($, selection, () => (isStale ? null : place))
  }
}

/** The spelling of `path` already in the list, if Windows would call them the same file (case aside). */
async function listed($: EngineInterface, path: string): Promise<string> {
  const key = sameCase(path)
  return (await read($, files)).find(one => sameCase(one) === key) ?? path
}

/** Puts a file in the list; the shown file is never the one dropped. */
async function addFile($: EngineInterface, path: string) {
  const shown = (await read($, open)).path
  await update($, files, list => {
    if (list.some(one => sameCase(one) === sameCase(path))) return list
    const next = [...list, path]
    while (next.length > MAX_FILES) {
      const drop = next.findIndex(one => one !== shown && one !== path)
      next.splice(drop < 0 ? 0 : drop, 1)
    }
    return next
  })
}

/** Rereads a file that changed: when it is the one shown, marks what changed. */
async function track($: EngineInterface, path: string, isAuto = false) {
  await addFile($, path)
  const mtime = await mtimeOf($, path)
  seen.set(path, mtime)
  if ((await read($, open)).path !== path) {
    docs.delete(path)
    return
  }
  const before = docs.get(path)
  const isRaw = (await read($, view)).raw === true
  const fresh = await loadDoc($, path, isRaw)
  if ((await read($, open)).path !== path) return
  // A file (still there) read halfway through a save looks broken: by itself, the pane keeps what it showed and lights Reload; Reload shows what is there.
  if (isAuto && mtime > 0 && fresh.kind === 'error' && before && before.kind !== 'error') {
    await markStale($, path, true)
    return
  }
  if (session.stale.delete(path)) await update($, open, old => ({ ...old, version: old.version + 1 }))
  await hold($, path, fresh, isRaw)
  await update($, open, old => ({ ...old, version: old.version + 1 }))
  const diff = diffDocs(before, fresh)
  // A counter, not a time: each edit gets a key the view has not seen.
  if (diff.rows.length + diff.cells.length > 0) await update($, changed, old => ({ path, key: (old?.key ?? 0) + 1, ...diff }))
}

async function resetView($: EngineInterface, sel: ReviewSelection | null, raw = false) {
  await update($, view, () => (raw ? { top: 0, left: 0, sheet: 0, raw } : { top: 0, left: 0, sheet: 0 }))
  await update($, selection, () => sel)
}

async function show($: EngineInterface, wanted: string) {
  const path = await listed($, wanted)
  const shownBefore = (await read($, open)).path
  if (shownBefore !== null && shownBefore !== path) session.switches += 1
  intended = path
  await addFile($, path)
  const loaded = await loadDoc($, path)
  if (intended !== path) return
  seen.set(path, await mtimeOf($, path))
  await hold($, path, loaded, false)
  await update($, open, old => ({ path, version: old.version + 1 }))
  // A picture is commented on as a whole, so it starts selected.
  await resetView($, loaded.kind === 'image' ? { path, label: 'the whole image', quote: '', from: 0, to: 0 } : null)
}

/** Switches a Markdown, HTML or ADF file between its formatted view and its source. */
async function toggleSource($: EngineInterface) {
  const path = (await read($, open)).path
  if (path === null) return
  const isRaw = (await read($, view)).raw !== true
  const loaded = await loadDoc($, path, isRaw)
  if ((await read($, open)).path !== path) return
  await hold($, path, loaded, isRaw)
  await update($, open, old => ({ ...old, version: old.version + 1 }))
  await resetView($, null, isRaw)
}

async function openPane($: EngineInterface) {
  // Tall enough for a page of the document and the comment box together; the person's own size wins.
  return $.ui.open({ id: PANE, title: TITLE, rows: 30 })
}

// ── Paths and watching ──

/**
 * A root (`/`, `C:/`, a network share), a home folder or the folder of them
 * (/home/<name>, /Users/<name>, /var/home/<name>, WSL's /mnt/c/Users/<name>,
 * /root, /var/root, C:/Users/<name>): too broad to scan.
 */
const isHomeOrRoot = (dir: string) =>
  /^(?:[A-Z]:)?\/?$|^\/\/[^/]+(?:\/[^/]+)?\/?$|^(?:[A-Z]:|\/mnt\/[a-z]|\/var)?\/(?:home|Users)(?:\/[^/]+)?\/?$|^\/(?:var\/)?root\/?$/i.test(dir)

const resolvePath = (path: string) => normalizePath(isAbsolutePath(path) ? path : `${session.folder}/${path}`)

/** Windows paths compare without case, as Windows does. */
const sameCase = (path: string) => (/^[A-Z]:\//.test(path) ? path.toLowerCase() : path)

/** The home folder, when the working folder is inside one (/home/<name>, /Users/<name>, C:/Users/<name>): for ~ in a typed path. */
const homeOf = (folder: string) => /^(?:[A-Z]:)?\/(?:home|Users)\/[^/]+|^\/root/i.exec(folder)?.[0]

/** What a person types after /panda: surrounding quotes stripped, ~ as their home folder. */
function typedPath(text: string): string {
  let bare = text.trim().replace(/^(['"])(.*)\1$/, '$2')
  const home = homeOf(session.folder)
  if (home && /^~(?:[\\/]|$)/.test(bare)) bare = home + bare.slice(1)
  return resolvePath(bare)
}

/** A path as a Mac terminal writes it when a file is dragged in (`My\ Notes.md`), its backslashes undone; null when there are none. */
const unescaped = (text: string) => (/\\[ ()[\]'"&;!$#,]/.test(text) && !/^\s*(?:[A-Za-z]:|\\\\)/.test(text) ? text.replace(/\\(.)/g, '$1') : null)

/**
 * Whether the model's tools may open a path: a file under the working folder
 * (links resolved, no hidden folders), a file Claude wrote this session, or
 * one already open. Anything else the person opens with /panda.
 */
async function isAllowed($: EngineInterface, path: string): Promise<boolean> {
  if (session.claudeWrote.has(path) || (await read($, files)).includes(path)) return true
  const root = sameCase(session.realFolder)
  if (/^(?:[a-z]:)?\/?$/.test(root)) return false
  let real: string
  try {
    // Where the path really leads, links followed; unknown, it is refused.
    const resolved = (await $.fs.stat(path, { resolve: true })).realPath
    if (resolved === undefined) return false
    real = sameCase(normalizePath(resolved))
  } catch {
    return false
  }
  if (!real.startsWith(`${root}/`)) return false
  return !real.slice(root.length + 1).split('/').some(part => part.startsWith('.'))
}

/**
 * Notes a file Claude made this turn, for auto-open, and rereads it if open.
 * `isWritten`: Claude's own Write or Edit named it, so its tools may open it
 * wherever it is; a file a scan found after a command must pass the usual check.
 */
async function noteFile($: EngineInterface, path: string | undefined, isWritten: boolean) {
  if (!path || !isSupported(path)) return
  const absolute = await listed($, resolvePath(path))
  session.turnFiles.add(absolute)
  if (isWritten) session.claudeWrote.add(absolute)
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
    // Links and hidden files and folders are left alone: the scan stays in the working folder.
    if (entry.isLink || entry.name.startsWith('.')) continue
    if (entry.kind === 'dir' && !SCAN_SKIP.has(entry.name)) {
      await scan($, path, since, depth - 1, found, budget)
    } else if (entry.kind === 'file' && entry.mtimeMs >= since && isSupported(entry.name)) {
      found.push(path)
    }
  }
}

async function mtimeOf($: EngineInterface, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Rereads every listed file that changed on disk since the pane last read it,
 * however it changed: a Write or Edit, a script, another app. One stat per
 * listed file. Returns the paths it reread.
 */
async function refreshChanged($: EngineInterface): Promise<string[]> {
  const reread: string[] = []
  for (const path of await read($, files)) {
    const now = await mtimeOf($, path)
    const before = seen.get(path)
    if (before === undefined) seen.set(path, now)
    else if (now !== before) {
      try {
        await track($, path, true)
        reread.push(path)
      } catch {
        // Read halfway through a save, or too slow this time: tried again on the next check, and Reload is lit meanwhile.
        seen.set(path, before)
        await markStale($, path, true)
      }
    }
  }
  return reread
}

/** Lights or clears a file's Reload: a redraw follows. */
async function markStale($: EngineInterface, path: string, isStale: boolean) {
  if (session.stale.has(path) === isStale) return
  if (isStale) session.stale.add(path)
  else session.stale.delete(path)
  await update($, open, old => ({ ...old, version: old.version + 1 }))
}

// ── Comments ──

/** Whether a comment is on exactly this selection: same file, sheet, range and view. */
const isAt = (c: ReviewComment, s: ReviewSelection) =>
  c.path === s.path &&
  (c.sheet ?? '') === (s.sheet ?? '') &&
  (c.raw === true) === (s.raw === true) &&
  c.from === s.from &&
  c.to === s.to &&
  (c.colFrom ?? 0) === (s.colFrom ?? 0) &&
  (c.colTo ?? 0) === (s.colTo ?? 0)

const placeOf = (c: ReviewComment): ReviewSelection => {
  const { id, text, status, batch, isStale, ...place } = c
  void [id, text, status, batch, isStale]
  return place
}

async function saveComment($: EngineInterface, typed: string, isGrid: boolean) {
  const trimmed = typed.trim()
  const target = await read($, selection)
  if (!target) return
  const existing = (await read($, comments)).find(c => c.status === 'draft' && isAt(c, target))
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
async function jumpTo($: EngineInterface, id: string, surface: RenderSurface) {
  const find = async () => (await read($, comments)).find(one => one.id === id)
  let c = await find()
  if (!c) return
  if (c.path !== (await read($, open)).path) await show($, c.path)
  const shown = docs.get(c.path)
  if (shown?.kind === 'lines' && shown.hasSource && (c.raw === true) !== ((await read($, view)).raw === true)) await toggleSource($)
  c = (await find()) ?? c
  const sheetIndex = shown?.kind === 'grid' ? Math.max(0, shown.sheets.findIndex(one => one.name === c?.sheet)) : 0
  const bodyStart = shown?.kind === 'grid' && hasHeader(shown.sheets[sheetIndex]) ? 1 : 0
  const at = shown?.kind === 'lines' ? (drawnOn(surface).firstVisual[c.from] ?? c.from) : c.from - bodyStart
  const anc: [number, number] = [c.from, c.colFrom ?? 0]
  const cur: [number, number] = [c.to, c.colTo ?? 0]
  await update($, selection, () => placeOf(c as ReviewComment))
  await update($, view, old => ({ ...old, sheet: sheetIndex, top: Math.max(0, at - 3), left: Math.max(0, (c?.colFrom ?? 0) - 1), anc, cur }))
}

/** Sends the drafts: straight to Claude, or into the prompt box to edit first. */
async function deliver($: EngineInterface, how: 'fill' | 'submit') {
  const pending = (await read($, comments)).filter(c => c.status === 'draft')
  if (pending.length === 0) return
  const text = feedbackPrompt(pending, session.folder)
  const count = plural(pending.length, 'comment')
  const ids = new Set(pending.map(c => c.id))
  if (how === 'fill') {
    // Whatever the person already typed stays; the comments go after it.
    if (!(await offerRequest($, text))) {
      $.ui.toast('Couldn’t reach the prompt box. Try “Send to Claude” instead.')
      return
    }
    await update($, comments, old => old.map(c => (ids.has(c.id) ? { ...c, status: 'queued' as const } : c)))
    $.ui.toast(`Your ${count} ${pending.length === 1 ? 'is' : 'are'} in the prompt box. Edit, then press Enter.`)
    await releaseKeys($)
    return
  }
  const batch = crypto.randomUUID()
  // Sent while Claude is busy, the prompt waits for that turn to end: that turn's end is not this batch's.
  session.batches.push(session.turn ? { id: batch, skipTurn: session.turn } : { id: batch })
  await update($, comments, old => old.map(c => (ids.has(c.id) ? { ...c, status: 'sent' as const, batch } : c)))
  void $.prompt.submit({ text })
  $.ui.toast(`✓ Sent ${count}. Claude is updating the file.`)
  await releaseKeys($)
}

/**
 * Hands the keyboard back to Claude's prompt once comments are sent, so what
 * the person types next goes to Claude, not into another comment. There is no
 * call for that: the pane is closed and opened again without asking for the
 * keys, and the selection let go so no comment box takes them.
 */
async function releaseKeys($: EngineInterface) {
  await update($, selection, () => null)
  await update($, view, old => ({ top: old.top, left: old.left, sheet: old.sheet, ...(old.raw ? { raw: old.raw } : {}) }))
  try {
    await $.ui.close({ id: PANE })
    await openPane($)
  } catch {
    /* the pane stays as it is; Esc still hands the keys back */
  }
}

async function backToDrafts($: EngineInterface) {
  await update($, comments, old => old.map(c => (c.status === 'queued' ? { ...c, status: 'draft' as const } : c)))
}

async function setSheet($: EngineInterface, sheet: number) {
  await update($, view, old => ({ top: 0, left: 0, sheet, ...(old.raw ? { raw: old.raw } : {}) }))
  await update($, selection, () => null)
}

async function setAutoOpen($: EngineInterface, isOn: boolean) {
  await update($, autoOpen, () => isOn)
  await $.store.set('autoOpen', isOn)
}

// ── Keys and pointer from the viewer ──

async function onViewerPost($: EngineInterface, post: ViewerPost, surface: RenderSurface) {
  const path = (await read($, open)).path
  const d = path === null ? undefined : docs.get(path)
  const drawn = drawnOn(surface)
  if (post.type === 'sheet') {
    if (d?.kind === 'grid') await setSheet($, clamp((await read($, view)).sheet + post.delta, 0, d.sheets.length - 1))
  } else if (post.type === 'clear') {
    await update($, view, old => ({ top: old.top, left: old.left, sheet: old.sheet, ...(old.raw ? { raw: old.raw } : {}) }))
    await update($, selection, () => null)
  } else if (post.type === 'scroll') {
    const v = await read($, view)
    const total = d?.kind === 'grid' ? (d.sheets[v.sheet]?.rows.length ?? 0) : drawn.total
    await update($, view, old => ({ ...old, top: clamp(old.top + post.rows, 0, Math.max(0, total - drawn.height)) }))
  } else if ((post.type === 'select' || post.type === 'move') && d && (d.kind === 'lines' || d.kind === 'grid')) {
    const sel = await read($, selection)
    // Left and right mean nothing in a document.
    if (post.type === 'move' && d.kind === 'lines' && post.rows === 0) return
    let moved: View | undefined
    // Worked out from the view as it stands when the update runs, so quick keys never undo each other.
    await update($, view, v => {
      const sheet = d.kind === 'grid' ? d.sheets[v.sheet] : undefined
      const rowCount = d.kind === 'grid' ? (sheet?.rows.length ?? 1) : d.rows.length
      const colCount = d.kind === 'grid' ? (sheet?.cols.length ?? 1) : 1
      const fit = (p: [number, number]): [number, number] => [clamp(p[0], 0, rowCount - 1), clamp(p[1], 0, colCount - 1)]
      let anc: [number, number]
      let cur: [number, number]
      if (post.type === 'select') {
        anc = fit(post.a)
        cur = fit(post.b)
      } else if (!v.cur && !sel) {
        // The first key puts the cursor on the first row in view, where the person is looking.
        const first = d.kind === 'lines' ? Math.max(0, drawn.firstVisual.findIndex(at => at >= v.top)) : v.top + (hasHeader(sheet) ? 1 : 0)
        cur = fit([first, v.left])
        anc = cur
      } else {
        const was = v.cur ?? (sel ? [sel.from, sel.colFrom ?? 0] : [0, 0])
        cur = fit([was[0] + post.rows, was[1] + (d.kind === 'grid' ? post.cols : 0)])
        anc = post.extend ? (v.anc ?? was) : cur
      }
      // Keep the cursor in view.
      let { top, left } = v
      if (d.kind === 'lines') {
        const at = drawn.firstVisual[cur[0]] ?? 0
        if (at < top) top = at
        else if (at >= top + drawn.height) top = at - drawn.height + 1
      } else {
        const bodyStart = hasHeader(sheet) ? 1 : 0
        if (cur[0] >= bodyStart) {
          if (cur[0] < top + bodyStart) top = cur[0] - bodyStart
          else if (cur[0] >= top + bodyStart + drawn.height) top = cur[0] - bodyStart - drawn.height + 1
        }
        if (cur[1] < left) left = cur[1]
        else if (cur[1] >= left + drawn.shownCols) left = cur[1] - drawn.shownCols + 1
      }
      moved = { ...v, top: Math.max(0, top), left: Math.max(0, left), cur, anc }
      return moved
    })
    if (!moved?.cur || !moved.anc) return
    const [anc, cur] = [moved.anc, moved.cur]
    const [r1, r2] = [Math.min(anc[0], cur[0]), Math.max(anc[0], cur[0])]
    const [c1, c2] = [Math.min(anc[1], cur[1]), Math.max(anc[1], cur[1])]
    const described = d.kind === 'lines' ? describeLines(d, r1, r2) : describeGrid(d, moved.sheet, r1, r2, c1, c2)
    if (!described) return
    const chosen: ReviewSelection = { path: d.path, ...(moved?.raw ? { raw: true as const } : {}), ...described }
    await update($, selection, () => chosen)
    // A click or drag puts the keys in the comment box, so the person just types; arrow keys stay with the document.
    if (post.type === 'select') {
      // A click doesn't give the pane the keyboard: ask for it (granted while the prompt box is empty), and the comment box's autoFocus takes it.
      const key = commentKey(await read($, comments), chosen)
      const moved = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'failed' }))
      if (moved.deny) {
        await $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined)
        await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
      }
    }
  }
}

/** The comment box's key for a selection: one already commented on edits that comment. */
function commentKey(notes: ReviewComment[], sel: ReviewSelection) {
  const editing = notes.find(c => c.status === 'draft' && isAt(c, sel))
  // A new key on each file switch: text typed but not added stays with its own file, never another's box.
  return editing ? `edit-${editing.id}-${editing.text.length}` : `comment-${notes.length}${session.switches > 0 ? `-f${session.switches}` : ''}`
}

/** After Claude writes or edits a file: note it, and reread it if it is open. Returns the tool's own result. */
async function afterEdit<R extends { deny?: unknown; isError?: unknown }>($: EngineInterface, e: object, ran: R): Promise<R> {
  if (ran.deny === undefined && !ran.isError) {
    const input = ((e as { input?: unknown }).input ?? e) as { file_path?: unknown }
    const path = input.file_path
    if (typeof path === 'string') await noteFile($, path, true)
  }
  return ran
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    session.switches = 0
    session.stale.clear()
    session.folder = normalizePath(e.cwd)
    session.realFolder = normalizePath(
      await $.fs
        .stat(e.cwd, { resolve: true })
        .then(st => st.realPath ?? e.cwd)
        .catch(() => e.cwd),
    )
    session.isSharp = /kitty|ghostty/i.test(`${(await $.env.get('TERM')) ?? ''} ${(await $.env.get('TERM_PROGRAM')) ?? ''}`)
    session.opener = await openerHere($)
    const started = await next(e)
    // A reload starts this module afresh: read the open file again, and let
    // go of sends whose turn this module can no longer follow.
    const shown = (await read($, open)).path
    if (shown !== null) {
      const isRaw = (await read($, view)).raw === true
      await hold($, shown, await loadDoc($, shown, isRaw), isRaw)
      await update($, open, old => ({ ...old, version: old.version + 1 }))
    }
    await update($, comments, old => old.filter(c => c.status !== 'sent'))
    // Watch the listed files: whatever changes one, the pane rereads it within a couple of seconds.
    for (const path of await read($, files)) seen.set(path, await mtimeOf($, path))
    // One refresh at a time: a slow reread is never started again on top of itself.
    $.clock.every(2000, () => {
      if (session.isRefreshing) return
      session.isRefreshing = true
      void refreshChanged($)
        .catch(() => undefined)
        .finally(() => {
          session.isRefreshing = false
        })
    })
    const stored = await $.store.get('autoOpen')
    await update($, autoOpen, () => stored === true)
    // Once, after install: proof it worked, and the first thing to try.
    if ((await $.store.get('welcomed')) !== true) {
      await $.store.set('welcomed', true)
      $.ui.toast('🐼 Lazy Panda Panel is ready. Type /panda examples to try it. Everything opens without installing anything; only Word, Excel and PDF files over 4 MB need Python.')
    }
    await $.command.register({
      name: 'panda',
      description: 'Open the Lazy Panda Panel, or a file in it: /panda [file] · /panda examples · /panda auto on|off · /panda setup',
      argumentHint: '[file | examples | auto on|off | setup]',
    })
    const where =
      'It opens files inside the working folder (not hidden folders), files you wrote this session, and files already open in the pane; ' +
      'for anything else, ask the user to run /panda <path>.'
    await $.tool.register({
      name: 'open_file',
      description:
        "Open a file in the user's Lazy Panda Panel, a review pane inside Claude Code, where they can read it, highlight parts and leave comments for you. " +
        'Call this when the user asks to open, show or view a file (md, html, txt, csv, json, yaml, adf, docx, xlsx, pdf, png). ' +
        `The path may be relative to the working directory. ${where} Nothing from the file is returned to you.`,
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
        "Open several files in the user's Lazy Panda Panel (a review pane) at once, as tabs in the order given; the first is shown. " +
        'With replace: true the pane starts fresh: these become the only tabs and the comments not yet sent are deleted (use for a clean review or a demo). ' +
        where,
      inputSchema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'The files to open, in tab order' },
          replace: { type: 'boolean', description: 'Make these the only tabs and delete unsent comments' },
        },
        required: ['paths'],
      },
      isDeferred: false,
    })
    return started
  })

  on('command.run', { command: 'panda' }, async ($, e) => {
    const args = e.args.trim()
    // Keywords in any case and spacing: "/panda Auto  On" is "auto on".
    const word = args.toLowerCase().replace(/\s+/g, ' ')
    // Only the person changes settings, writes samples or opens files outside the working folder; anything else running /panda can't.
    // The person at the terminal (or on Remote Control): not another plugin, a peer session, a channel or a scheduled task.
    const isPerson = ['composer', 'bridge', undefined].includes(e.origin?.kind as string | undefined)
    if (word === 'auto on' || word === 'auto off') {
      if (!isPerson) return { text: 'Only you can change auto-open: type /panda auto on|off.', exitCode: 1 }
      const isOn = word === 'auto on'
      await setAutoOpen($, isOn)
      return {
        text: isOn
          ? `Auto-open is on: when a turn finishes with 1–${AUTO_MAX_FILES} new Word, PDF, PNG, HTML, Markdown or Confluence files, the Lazy Panda Panel opens on them.`
          : 'Auto-open is off. New files are listed in the pane; open it with /panda.',
      }
    }
    if (word === 'auto') return { text: `Auto-open is ${(await read($, autoOpen)) ? 'on' : 'off'}. Change it with /panda auto on|off.` }
    if (word === 'examples' || word.startsWith('examples ')) {
      if (!isPerson) return { text: 'Only you can write the samples: type /panda examples.', exitCode: 1 }
      // Always a new folder, so nothing is ever written over, nor through a link someone left there.
      const base = typedPath(args.slice('examples'.length).trim() || 'lazy-panda-panel-examples')
      let folder = base
      for (let k = 2; await $.fs.exists(folder); k += 1) {
        if (k > 99) return { text: `There are already 99 sample folders next to ${base}. Delete some, or name another: /panda examples <folder>.`, exitCode: 1 }
        folder = `${base}-${k}`
      }
      const texts: string[] = []
      for (const name of EXAMPLE_TEXTS) {
        const target = `${folder}/${name}`
        await $.fs.write(target, await $.fs.read(`${$.plugin.root}/examples/${name}`))
        texts.push(target)
      }
      // The Excel and Word samples and the picture are binary files, which only Python can write here.
      const made = await runPython($, 'examples', folder, 30_000)
      const binaries =
        typeof made === 'string' && made !== 'none' && made !== 'timeout'
          ? made
              .split(/\r?\n/)
              .filter(line => line.startsWith('LPP1 wrote '))
              .map(line => normalizePath(line.slice('LPP1 wrote '.length).trim()))
          : []
      const written = [...binaries, ...texts]
      await update($, files, old => [...written, ...old.filter(path => !written.includes(path))].slice(0, MAX_FILES))
      if (written[0]) await show($, written[0])
      await openPane($)
      return {
        text:
          `Wrote ${written.length} sample files to ${folder} and opened them in the Lazy Panda Panel.` +
          (binaries.length > 0 ? '' : ' The Excel, Word and picture samples need Python 3 on this computer (optional; /panda setup checks). You can also ask Claude to make you a sample spreadsheet.'),
      }
    }
    if (word === 'setup') {
      // Setup installs nothing: it looks for Python 3, which only Word, Excel and PDF files over 4 MB need.
      session.python = null
      const found = await runPython($, 'read', '--check', 15_000)
      if (found !== 'none' && found !== 'timeout') {
        const version = /LPP1 ok (\S+)/.exec(found)?.[1] ?? '3'
        return { text: `Python ${version} is ready. There’s nothing to install: Word, Excel and PDF files over 4 MB will open too.` }
      }
      const intro = 'Everything up to 4 MB already opens without Python. Python 3 is only needed for Word, Excel and PDF files over 4 MB, and it isn’t on this computer (or Claude Code can’t see it yet). Nothing has been installed.'
      const isOffered = isPerson && (await offerRequest($, INSTALL_PYTHON_REQUEST))
      return {
        text: isOffered
          ? `${intro}\nIf you’d like Claude to help you install it, press Enter: the request is in your prompt box, and Claude will ask before installing anything. If not, delete the text in the prompt box.`
          : `${intro}\nIf you’d like it, ask Claude: “Please help me install Python 3 for the Lazy Panda Panel.”`,
      }
    }
    if (args) {
      let path = typedPath(args)
      const plain = unescaped(args)
      if (!(await $.fs.exists(path)) && plain !== null && (await $.fs.exists(typedPath(plain)))) path = typedPath(plain)
      if (!(await $.fs.exists(path))) return { text: `No file at ${path}.${/^~/.test(args.trim()) && !homeOf(session.folder) ? ' Type the full path: ~ can’t be worked out here.' : ''}`, exitCode: 1 }
      if ((await $.fs.stat(path)).kind === 'dir') return { text: `${path} is a folder. Name a file in it: /panda ${path}/<file>.`, exitCode: 1 }
      if (!isSupported(path)) return { text: `The pane does not show .${extOf(path) || '(no extension)'} files. It shows ${[...TEXT_KINDS, ...DOC_KINDS, 'png'].join(', ')}.`, exitCode: 1 }
      if (!isPerson && !(await isAllowed($, path))) return { text: `${path} is outside the working folder; only you can open it, with /panda ${path}.`, exitCode: 1 }
      await show($, path)
    } else if ((await read($, open)).path === null) {
      const first = (await read($, files))[0]
      if (first) await show($, first)
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Lazy Panda Panel opened.' : 'The Lazy Panda Panel needs a wider terminal: make the window wider, or run /panda again.' }
  }).catch(($, e, next) => ({
    // Whatever went wrong, /panda answers with it, rather than Claude Code's note that no hook answered.
    text: `/panda ${e.args.trim()} failed: ${sanitizeLine(String((next.error as { message?: unknown } | undefined)?.message ?? next.error ?? 'unknown error'), 400)}`,
    exitCode: 1,
  }))

  on('tool.call', { tool: 'mcp__lazy-panda-panel__open_file' }, async ($, e) => {
    // A live session puts the arguments on the event; the test kit under `input`.
    const input = ((e as { input?: unknown }).input ?? e) as { path?: unknown }
    const path = typeof input.path === 'string' ? resolvePath(input.path) : ''
    if (!path || !(await $.fs.exists(path))) return reply(`No file at ${path || '(no path given)'}.`, true)
    if (!isSupported(path)) return reply(`The Lazy Panda Panel does not show .${extOf(path)} files.`, true)
    if (!(await isAllowed($, path))) return reply(`${path} is outside the working folder. Ask the user to open it with /panda ${path}`, true)
    await show($, path)
    const opened = await openPane($)
    return reply(opened.isPlaced ? `Opened ${path} in the Lazy Panda Panel.` : `Loaded ${path}; the pane will show once the terminal is wider (or the user runs /panda).`)
  }).catch(() => reply('The Lazy Panda Panel couldn’t open that file just now. Ask the user to open it with /panda <path>.', true))

  on('tool.call', { tool: 'mcp__lazy-panda-panel__open_files' }, async ($, e) => {
    const input = ((e as { input?: unknown }).input ?? e) as { paths?: unknown; replace?: unknown }
    const asked = Array.isArray(input.paths)
      ? [...new Map(input.paths.filter((p): p is string => typeof p === 'string').slice(0, MAX_FILES).map(p => [sameCase(resolvePath(p)), resolvePath(p)] as const)).values()]
      : []
    const usable: string[] = []
    const skipped: string[] = []
    for (const path of asked) {
      if (isSupported(path) && (await $.fs.exists(path)) && (await isAllowed($, path))) usable.push(path)
      else skipped.push(path)
    }
    const first = usable[0]
    if (!first) return reply(`None of those files can be opened (missing, unsupported or outside the working folder): ${skipped.join(', ') || '(no paths given)'}.`, true)
    if (input.replace === true) {
      await update($, files, () => usable)
      await update($, comments, old => old.filter(c => c.status === 'sent'))
      await update($, changed, () => null)
    } else {
      for (const path of usable) await addFile($, path)
    }
    await show($, first)
    const opened = await openPane($)
    return reply(
      `Opened ${plural(usable.length, 'file')} in the Lazy Panda Panel${opened.isPlaced ? '' : ' (it shows once the terminal is wider, or the user runs /panda)'}.` +
        (skipped.length ? ` Skipped (missing, unsupported or outside the working folder): ${skipped.join(', ')}.` : ''),
    )
  }).catch(() => reply('The Lazy Panda Panel couldn’t open those files just now. Ask the user to open them with /panda <path>.', true))

  on('prompt.submit', async ($, e, next) => {
    session.turnFiles = new Set()
    // Comments put in the prompt box go out when the person sends it.
    if (e.text.includes(PROMPT_HEADER) && (await read($, comments)).some(c => c.status === 'queued')) {
      const batch = crypto.randomUUID()
      const skipTurn = e.turnId ?? session.turn
      session.batches.push(skipTurn ? { id: batch, skipTurn } : { id: batch })
      await update($, comments, old => old.map(c => (c.status === 'queued' ? { ...c, status: 'sent' as const, batch } : c)))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    session.turn ??= e.turnId
    return next(e)
  }).catch(($, e, next) => next(e))

  // Only the tools that change files are watched; each is passed on unchanged, and what it returns is returned.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const since = (await $.clock.now()) - 1000
    const ran = await next(e)
    // Listed files first: a direct check, so an edit made by a script shows at once.
    for (const path of await refreshChanged($)) session.turnFiles.add(path)
    // Then new files in the working folder; never a home folder or the root, nor for a subagent.
    if (e.agentId === undefined && !isHomeOrRoot(session.folder)) {
      const inList = new Set(await read($, files))
      const found: string[] = []
      await scan($, session.folder, since, 3, found, { left: 4000 })
      for (const path of found.filter(one => !inList.has(one)).slice(0, 20)) await noteFile($, path, false)
    }
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, e, await next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, e, await next(e))).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    session.turn = null
    // Claude has finished: pick up any edit not seen yet, then close the sends this turn answered.
    await refreshChanged($)
    const finished = new Set(session.batches.filter(b => b.skipTurn !== e.turnId).map(b => b.id))
    session.batches = session.batches.filter(b => b.skipTurn === e.turnId).map(b => ({ id: b.id }))
    const answered = (await read($, comments)).filter(c => c.status === 'sent' && c.batch !== undefined && finished.has(c.batch))
    if (answered.length > 0) {
      await update($, comments, old => old.filter(c => !(c.status === 'sent' && c.batch !== undefined && finished.has(c.batch))))
      $.ui.toast(`✓ Claude finished with ${plural(answered.length, 'comment')}`)
    }
    if (session.turnFiles.size === 0) return done
    const made = [...session.turnFiles]
    session.turnFiles = new Set()
    const outputs = made.filter(path => AUTO_KINDS.includes(extOf(path)))
    const first = outputs[0]
    if ((await read($, autoOpen)) && first && outputs.length <= AUTO_MAX_FILES) {
      if ((await read($, open)).path !== first) await show($, first)
      const opened = await openPane($)
      if (!opened.isPlaced) $.ui.toast(`🐼 ${baseName(first)} is ready. Type /panda to see it (the terminal is too narrow to open it by itself).`)
    } else {
      // The file on show was reread already; only others need /panda.
      const shown = (await read($, open)).path
      const others = made.filter(path => path !== shown)
      $.ui.status(others.length > 0 ? `🐼 ${plural(others.length, 'file')} updated · /panda to open` : `🐼 ${baseName(made[0] ?? '')} updated in the panel`)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const post = e.data as ViewerPost | { type: 'tab'; index: number } | { type: 'aside'; id: string }
    if (post.type === 'tab') {
      const target = (await read($, files))[post.index]
      if (target) await show($, target)
    } else if (post.type === 'aside') {
      const path = (await read($, open)).path
      if (post.id === 'reload' && path) await track($, path)
      else if (post.id === 'source') await toggleSource($)
      else if (post.id === 'auto') {
        const isOn = !(await read($, autoOpen))
        await setAutoOpen($, isOn)
        $.ui.toast(isOn ? '✓ Auto-open on: new files from Claude open here when it finishes' : 'Auto-open off')
      }
    } else {
      await onViewerPost($, post, e.surface)
    }
    return next(e)
  })

  // The mouse wheel scrolls the document, three rows a tick, as the page keys do: the pane draws its own window over it.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || !e.pointer) return next(e)
    await onViewerPost($, { type: 'scroll', rows: e.by * 3 }, 'terminal')
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    // Input is on the terminal and desktop, Image on the terminal alone.
    const { Input, Image } = els as Partial<Elements['terminal']>
    const hasViews = e.surface === 'terminal' || e.surface === 'desktop'
    const { path, version } = await read($, open)
    const ctx: Ctx = {
      els,
      Input: hasViews ? Input : undefined,
      Image: e.surface === 'terminal' && session.isSharp ? Image : undefined,
      surface: e.surface,
      columns: Math.max(40, e.props.bodyColumns),
      bodyRows: e.props.scroll.bodyRows,
      pal: PALETTE,
      list: await read($, files),
      path,
      version,
      d: path === null ? undefined : docs.get(path),
      v: await read($, view),
      sel: await read($, selection),
      notes: await read($, comments),
      change: await read($, changed),
      isAuto: await read($, autoOpen),
      picture: null,
    }
    ctx.picture = await selectedPicture($, ctx.d, ctx.sel, version, ctx.v.raw === true)
    const { Box, Text } = els
    const drafts = ctx.notes.filter(c => c.status === 'draft')
    const section =
      ctx.list.length === 0
        ? emptySection(ctx)
        : !ctx.d
          ? { bar: <Text color={ctx.pal.dim}>Loading…</Text>, body: <Text> </Text> }
          : ctx.d.kind === 'error'
            ? ctx.d.isNotice
              ? { bar: <Text color={ctx.pal.warning} bold>ⓘ {baseName(ctx.d.path)} is over 4 MB, so it needs Python to open</Text>, body: <Text color={ctx.pal.text}>{ctx.d.message}</Text> }
              : { bar: <Text color={ctx.pal.error} bold>Couldn’t show {baseName(ctx.d.path)}</Text>, body: <Text color={ctx.pal.subtle}>{ctx.d.message}</Text> }
            : ctx.d.kind === 'image'
              ? imageSection($, ctx, ctx.d)
              : ctx.d.kind === 'lines'
                ? linesSection($, ctx, ctx.d, Math.min(drafts.length, MAX_LISTED))
                : gridSection($, ctx, ctx.d, Math.min(drafts.length, MAX_LISTED))
    const rule = <Text color={ctx.pal.dim}>{'─'.repeat(ctx.columns)}</Text>
    const actions = actionsRow($, ctx)
    const keyLine = keysRow(ctx, section.keys ?? [])
    const sent = ctx.notes.filter(c => c.status === 'sent').length
    // The three drawing modules, each named by a fixed path, on the surfaces that draw them; elsewhere, plain text.
    let fileBar: RenderNode | null | undefined = <Text bold>{baseName(path ?? 'Lazy Panda Panel')}</Text>
    let document: RenderNode | null | undefined = section.body
    let spinner: RenderNode | null | undefined = null
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      // Each view is the call its JSX compiles to, with the element taken from the table right there and a fixed module path.
      fileBar = h($.ui.resolve(e).Client, { module: './filebar.tsx', key: 'file-tabs', props: fileBarProps(ctx) })
      if (section.viewer) {
        document = h($.ui.resolve(e).Client, { module: './viewer.tsx', key: 'viewer', props: section.viewer.props, height: section.viewer.height })
      }
      if (sent > 0) {
        const spinnerProps: SpinnerProps = { text: `Claude is working on ${plural(sent, 'comment')}…`, color: ctx.pal.claude, glow: ctx.pal.warning }
        spinner = h($.ui.resolve(e).Client, { module: './spinner.tsx', key: 'spinner', props: spinnerProps })
      }
    }
    return (
      <Box flexDirection="column" width={ctx.columns}>
        {fileBar}
        {section.bar}
        {rule}
        {document}
        {section.after ?? null}
        {section.footnote ? <Text color={ctx.pal.warning} wrap="wrap">{section.footnote}</Text> : null}
        <Box marginTop={isCompact(ctx) ? 0 : 1}>{commentRow($, ctx)}</Box>
        <Box marginTop={isCompact(ctx) ? 0 : 1}>{commentList($, ctx)}</Box>
        {actions && <Box marginTop={isCompact(ctx) ? 0 : 1}>{actions}</Box>}
        {spinner}
        {keyLine && !isCompact(ctx) && (
          <Box marginTop={1} flexDirection="column">
            {rule}
            {keyLine}
          </Box>
        )}
      </Box>
    )
  })
}

// ── Drawing the pane, a section at a time ──

type Els = ReturnType<EngineInterface['ui']['resolve']>
type Ctx = {
  els: Els
  Input: Elements['terminal']['Input'] | undefined
  /** Present only where the terminal draws real pictures. */
  Image: Elements['terminal']['Image'] | undefined
  surface: RenderSurface
  columns: number
  bodyRows: number
  pal: Palette
  list: string[]
  path: string | null
  version: number
  d: Doc | undefined
  v: View
  sel: ReviewSelection | null
  notes: ReviewComment[]
  change: { path: string; key: number; rows: number[]; cells: string[] } | null
  isAuto: boolean
  /** The picture the selection is on, for the preview. */
  picture: Shown | null
}
/** `result` null: not decoded, because this terminal shows a card instead. */
type Shown = { index: number; label: string; result: Pixels | string | null }
/** A section's parts; `viewer` is what the document view draws, where the surface has one (`body` is drawn otherwise). */
type Section = {
  bar: JSX.Element
  body: JSX.Element
  viewer?: { props: ViewerProps; height: number }
  after?: JSX.Element | null
  footnote?: string
  keys?: [string, string][]
}

/**
 * Rows the document may use: what the pane has, less the bars, the comment
 * box and list, the actions and the keys around it.
 */
const docHeight = (ctx: Ctx, extra: number, listed: number) =>
  isCompact(ctx)
    ? clamp(ctx.bodyRows - (3 + extra + (listed > 0 ? listed + 2 : 0) + (ctx.sel && ctx.Input ? 3 : 1)), 1, 60)
    : clamp(ctx.bodyRows - (15 + extra + listed + (ctx.sel && ctx.Input ? 2 : 0)) + 1, 5, 60)

/** A short pane (a small terminal, or one the person dragged smaller): no spacing, box borders or key hints, so the comment box always shows. */
const isCompact = (ctx: Ctx) => ctx.bodyRows < 26

/** The rows a note under the document takes, wrapped at the pane's width. */
const noteRows = (ctx: Ctx, note: string | undefined) => (note ? Math.ceil(strWidth(note) / ctx.columns) : 0)

function fileBarProps(ctx: Ctx): FileBarProps {
  const { pal, path, d, v, list } = ctx
  const asides: NonNullable<FileBarProps['asides']> = []
  if (d?.kind === 'lines' && d.hasSource) asides.push({ id: 'source', label: v.raw ? '◧ Formatted' : '‹› Source', short: v.raw ? '◧' : '‹›', color: pal.subtle })
  // Lit when the file changed and the pane couldn't reread it by itself.
  if (path && session.stale.has(path)) asides.push({ id: 'reload', label: '⟳ Changed · Reload', short: '⟳!', color: pal.warning, isBold: true })
  else if (path) asides.push({ id: 'reload', label: '⟳ Reload', short: '⟳', color: pal.subtle })
  asides.push({ id: 'auto', label: ctx.isAuto ? '● Auto-open' : '○ Auto-open', short: ctx.isAuto ? '●' : '○', color: ctx.isAuto ? pal.success : pal.dim, isBold: ctx.isAuto })
  const badge = path ? BADGES[extOf(path)] : undefined
  return {
    files: list.map(one => ({ name: baseName(one), color: BADGES[extOf(one)]?.bg ?? pal.dim })),
    active: Math.max(0, list.indexOf(path ?? '')),
    width: ctx.columns,
    colors: { accent: pal.accent, text: pal.text, subtle: pal.subtle, dim: pal.dim, band: pal.band },
    ...(badge ? { badge } : {}),
    asides,
  }
}

function emptySection(ctx: Ctx): Section {
  const { Box, Text } = ctx.els
  // The panda only when it fits whole beside the text; a cut-off panda looks broken, so a small pane gets the text alone.
  const panda = ctx.bodyRows >= 20 && ctx.columns >= 70 ? pandaRows() : []
  return {
    bar: <Text> </Text>,
    body: (
      <Box flexDirection="row" columnGap={3} paddingTop={1}>
        {panda.length > 0 && <Box flexDirection="column" flexShrink={0}>
          {panda.map((runs, y) => (
            <Text key={`panda-${y}`}>
              {runs.map((run, x) => (
                <Text key={`p${x}`} {...(run.color ? { color: run.color } : {})} {...(run.background ? { backgroundColor: run.background } : {})}>
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>}
        <Box flexDirection="column">
          <Text color={ctx.pal.subtle}>      z</Text>
          <Text color={ctx.pal.subtle}>    Z</Text>
          <Text color={ctx.pal.subtle}>  z</Text>
          <Text> </Text>
          <Text bold color={ctx.pal.accent}>Nothing to review yet. The panda is napping.</Text>
          <Text>
            <Text color={ctx.pal.subtle}>Try it now:   </Text>
            <Text color={ctx.pal.accent}>/panda examples</Text>
          </Text>
          <Text>
            <Text color={ctx.pal.subtle}>Open a file:  </Text>
            <Text color={ctx.pal.accent}>/panda report.docx</Text>
            <Text color={ctx.pal.subtle}>, or ask Claude to “open the report”</Text>
          </Text>
          <Text color={ctx.pal.subtle}>
            {ctx.isAuto ? 'Auto-open is on: new files from Claude open here when it finishes.' : 'Turn on ○ Auto-open (top right) and new files from Claude open here by themselves.'}
          </Text>
        </Box>
      </Box>
    ),
  }
}

function imageSection($: EngineInterface, ctx: Ctx, d: Extract<Doc, { kind: 'image' }>): Section {
  const { Text } = ctx.els
  const { pal } = ctx
  return {
    bar: (
      <Text wrap="truncate-end">
        <Text bold color={pal.text}>{baseName(d.path)}</Text>
        <Text color={pal.subtle}>  {d.width} × {d.height} px · comments apply to the whole image</Text>
      </Text>
    ),
    body: picturePreview($, ctx, Math.min(ctx.columns, 120), docHeight(ctx, 1, 0)) ?? <Text> </Text>,
  }
}

/** Where to see a picture properly, by the file it is in. */
const viewerFor = (path: string) => ({ docx: 'Word', pdf: 'your PDF reader', png: 'an image viewer', html: 'a browser', htm: 'a browser' })[extOf(path)] ?? 'an image viewer'

/** The cells a picture's preview takes, at most `maxCols` × `maxRows`; none when there is nothing to draw. */
function previewSize(ctx: Ctx, maxCols: number, maxRows: number) {
  const result = ctx.picture?.result
  return result && typeof result !== 'string' && ctx.Image ? fitCells(result, maxCols, maxRows) : null
}

/**
 * The selected picture: drawn for real where the terminal can (kitty,
 * Ghostty); elsewhere a card that says what it is and opens it in the
 * computer's own app, since coloured blocks can't show a picture legibly.
 */
function picturePreview($: EngineInterface, ctx: Ctx, maxCols: number, maxRows: number): JSX.Element | null {
  const { Box, Text, Button } = ctx.els
  const { pal, picture, Image, path, d } = ctx
  if (!picture || !path) return null
  const isFile = d?.kind === 'image'
  const name = isFile ? baseName(path) : `Picture ${picture.index + 1}${picture.label ? `: ${sanitizeLine(picture.label, 80)}` : ''}`
  const px = picture.result
  const size = previewSize(ctx, maxCols, maxRows)
  if (px && typeof px !== 'string' && Image && size) {
    return (
      <Box flexDirection="column">
        <Image key="picture" source={toRgba(px)} columns={size.columns} rows={size.rows} alt={name} />
        <Text color={pal.subtle} wrap="truncate-end">
          ▣ {name} · {px.fullWidth} × {px.fullHeight} px
        </Text>
      </Box>
    )
  }
  // Only what the computer has an app for: the picture file, or the Word, PDF or web page it sits in.
  const canOpen = session.opener !== null && /\.(png|jpe?g|gif|docx|pdf|html?)$/i.test(path)
  const where = viewerFor(path)
  const why = typeof px === 'string' ? `can’t be shown: ${px}` : 'isn’t drawn here: this terminal can’t show pictures sharply (kitty and Ghostty can)'
  return (
    <Box flexDirection="column">
      <Text color={pal.text} wrap="wrap">
        <Text bold>▣ {isFile ? 'This picture' : name}</Text>
        <Text color={pal.subtle}> {why}.{canOpen ? '' : ` Open ${isFile ? 'it' : 'the file'} in ${where} on your computer to see it.`}</Text>
      </Text>
      {canOpen && <Button key="open-outside" label={`Open in ${where}`} plain onPress={() => void openOutside($, path)} />}
    </Box>
  )
}

/** A document laid out at one width: kept until the file, its version or the width changes. */
type Layout = { key: string; lines: LineRow[]; firstVisual: number[]; stripe: Set<number>; gutter: number; textWidth: number }
let layoutCache: Layout | null = null

function layoutOf(d: LinesDoc, version: number, columns: number, isRaw: boolean): Layout {
  const key = `${d.path}|${version}|${columns}|${isRaw}`
  if (layoutCache?.key === key) return layoutCache
  const isFormatted = d.isFormatted === true
  const numberOf = (row: DocRow) => row.anchor.match(/^(?:line|paragraph) (\d+)/)?.[1] ?? row.anchor.match(/, line (\d+)$/)?.[1] ?? ''
  const gutter = isFormatted ? 0 : Math.max(2, ...d.rows.slice(-50).map(row => numberOf(row).length))
  const textWidth = Math.max(10, columns - (gutter > 0 ? gutter + 1 : 0) - 4)
  const lines = wrapRows(d.rows, textWidth, isFormatted)
  const firstVisual: number[] = []
  lines.forEach((line, i) => {
    if (firstVisual[line.src] === undefined) firstVisual[line.src] = i
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
  layoutCache = { key, lines, firstVisual, stripe, gutter, textWidth }
  return layoutCache
}

function linesSection($: EngineInterface, ctx: Ctx, d: LinesDoc, listed: number): Section {
  const { Box, Text } = ctx.els
  const { pal, v, sel, notes, columns } = ctx
  // A selected picture is drawn under the document, which gives up the rows it takes.
  const previewRows = clamp(Math.floor(ctx.bodyRows * 0.45), 6, 24)
  const size = previewSize(ctx, Math.min(columns, 120), previewRows)
  const preview = ctx.picture ? picturePreview($, ctx, Math.min(columns, 120), previewRows) : null
  const previewHeight = preview ? (size ? size.rows + 1 : 3) + 1 : 0
  const room = docHeight(ctx, noteRows(ctx, d.note) + previewHeight, listed)
  const { lines, firstVisual, stripe, gutter, textWidth } = layoutOf(d, ctx.version, columns, v.raw === true)
  // A longer document gives one row to saying how much is below.
  const height = lines.length > room ? Math.max(1, room - 1) : room
  drawnBy.set(ctx.surface, { total: lines.length, firstVisual, height, shownCols: 1 })
  const freshKey = ctx.change && ctx.change.path === d.path ? ctx.change.key : 0
  const changedRows = new Set(freshKey ? ctx.change?.rows : [])
  const top = clamp(v.top, 0, Math.max(0, lines.length - height))
  const here = notes.filter(c => c.path === d.path && (c.raw === true) === (v.raw === true))
  const markOf = (src: number): 2 | 3 | undefined => {
    const hit = here.filter(c => src >= c.from && src <= c.to)
    return hit.length === 0 ? undefined : hit.some(c => c.status !== 'sent') ? 2 : 3
  }
  const inSel = sel !== null && sel.path === d.path && (sel.raw === true) === (v.raw === true)
  const rows: LineRow[] = lines.slice(top, top + height).map(line => {
    const isSel = inSel && line.src >= sel.from && line.src <= sel.to
    const mark = markOf(line.src)
    let out: LineRow = isSel ? (mark ? { ...line, hl: 1, mark } : { ...line, hl: 1 }) : mark ? { ...line, hl: mark } : line
    if (stripe.has(line.src)) out = { ...out, z: 1 }
    if (changedRows.has(line.src)) out = { ...out, fl: 1 }
    return out
  })
  const unitOf = (u: string) => d.rows.some(row => row.unit === u)
  const unit = unitOf('node') ? 'blocks' : unitOf('paragraph') ? 'paragraphs' : unitOf('page') ? 'pages' : d.isFormatted ? 'blocks' : 'lines'
  const count =
    unit === 'pages'
      ? d.rows.filter(row => row.unit === 'page').length
      : d.rows.filter(row => row.style !== 'space' && row.style !== 'rule' && row.unit !== 'table row').length
  const percent = lines.length <= height ? 100 : Math.round(((top + height) / lines.length) * 100)
  const bar =
    inSel && sel ? (
      <Text wrap="truncate-end">
        <Text color={pal.accent} bold>▌ </Text>
        <Text bold color={pal.text}>{capitalise(sanitizeLine(sel.label))}</Text>
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
  const body = rows.length === 0 ? <Text color={pal.dim}>This file is empty.</Text> : <Text>{rows.map(row => row.t).join('\n')}</Text>
  return {
    bar,
    body,
    ...(rows.length > 0
      ? (() => {
          const moreBelow = Math.max(0, lines.length - (top + rows.length))
          const scroll = { top, shown: rows.length, total: lines.length }
          return { viewer: { props: { mode: 'lines' as const, pal, rows, gutter, width: textWidth, flashKey: freshKey, moreBelow, scroll }, height: rows.length + (moreBelow > 0 ? 1 : 0) } }
        })()
      : {}),
    ...(preview ? { after: <Box marginTop={1}>{preview}</Box> } : {}),
    ...(d.note ? { footnote: d.note } : {}),
    keys: [
      ...(d.rows.some(row => row.pic !== undefined) ? ([['▣', 'click to see a picture']] as [string, string][]) : []),
      ['click', unit === 'lines' || unit === 'pages' ? 'a line' : 'a paragraph'],
      ['drag', 'a range'],
      ['↑↓', 'move'],
      ['⇧↑↓', 'extend'],
      ['PgUp/PgDn', 'scroll'],
    ],
  }
}

function gridSection($: EngineInterface, ctx: Ctx, d: GridDoc, listed: number): Section {
  const { Box, Text, Button } = ctx.els
  const { pal, v, sel, notes, columns } = ctx
  const sheetIndex = clamp(v.sheet, 0, Math.max(0, d.sheets.length - 1))
  const sheet = d.sheets[sheetIndex]
  if (!sheet) return { bar: <Text color={pal.dim}>This workbook has no sheets.</Text>, body: <Text> </Text> }
  const footnote = [d.note, sheet.isCut ? 'Only the first 500 rows × 40 columns of this sheet are shown.' : ''].filter(Boolean).join(' ')
  const height = docHeight(ctx, 2 + noteRows(ctx, footnote), listed)
  const isHeader = hasHeader(sheet)
  const bodyStart = isHeader ? 1 : 0
  const widths = sheet.cols.map((_, c) => clamp(Math.max(1, ...sheet.rows.slice(0, 300).map(r => strWidth(r[c]?.v ?? ''))), 3, 16))
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
  drawnBy.set(ctx.surface, { total: 0, firstVisual: [], height: bodyHeight, shownCols })
  const bodyTotal = Math.max(0, sheet.rows.length - bodyStart)
  const top = clamp(v.top, 0, Math.max(0, bodyTotal - bodyHeight))
  const inSel = sel !== null && sel.path === d.path && sel.sheet === sheet.name
  const here = notes.filter(c => c.path === d.path && c.sheet === sheet.name)
  const freshKey = ctx.change && ctx.change.path === d.path ? ctx.change.key : 0
  const changedCells = new Set(freshKey ? ctx.change?.cells : [])
  const inView = Array.from({ length: shownCols }, (_, j) => j)
  const gridRow = (r: number): GridRow => {
    const cells = sheet.rows[r] ?? []
    const marks: Record<string, 2 | 3> = {}
    for (const c of here) {
      if (r < c.from || r > c.to) continue
      for (const j of inView) {
        const col = left + j
        if (col >= (c.colFrom ?? 0) && col <= (c.colTo ?? 0)) marks[String(j)] = c.status !== 'sent' || marks[String(j)] === 2 ? 2 : 3
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
  const props: ViewerProps = {
    mode: 'grid',
    pal,
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
  }

  // The formula bar: the cell's formula and value, or a range's count, sum and average.
  let bar: JSX.Element
  if (inSel) {
    const ref = sel.label.slice(sel.label.lastIndexOf('!') + 1)
    const nameBox = <Text backgroundColor={pal.band || undefined} color={pal.accent} bold>{` ${padRight(ref, 5)} `}</Text>
    if (sel.from === sel.to && sel.colFrom === sel.colTo) {
      const cell = sheet.rows[sel.from]?.[sel.colFrom ?? 0]
      bar = cell?.f ? (
        <Box flexDirection="row" justifyContent="space-between" width={columns}>
          <Text wrap="truncate-end">
            {nameBox}
            <Text color={pal.formula} bold> ƒx  </Text>
            <Text color={pal.text}>{cell.f}</Text>
          </Text>
          <Text>
            <Text color={pal.subtle}>= </Text>
            <Text color={pal.formula} bold>{cutTo(cell.v, 30)}</Text>
          </Text>
        </Box>
      ) : (
        <Text wrap="truncate-end">
          {nameBox}
          <Text> </Text>
          {cell?.v ? <Text color={pal.text}>{cell.v}</Text> : <Text color={pal.dim}>Empty cell</Text>}
        </Text>
      )
    } else {
      let sum = 0
      let numbers = 0
      let filled = 0
      for (let r = sel.from; r <= sel.to; r += 1)
        for (let c = sel.colFrom ?? 0; c <= (sel.colTo ?? 0); c += 1) {
          const cell = sheet.rows[r]?.[c]
          if (cell?.v) filled += 1
          if (cell?.x !== undefined) {
            sum += cell.x
            numbers += 1
          }
        }
      bar = (
        <Text wrap="truncate-end">
          {nameBox}
          <Text color={pal.subtle}> {plural(filled, 'cell')}</Text>
          {numbers > 0 && (
            <Text>
              <Text color={pal.subtle}>  ·  Σ </Text>
              <Text color={pal.text} bold>{formatNumber(sum)}</Text>
              <Text color={pal.subtle}>  ·  avg </Text>
              <Text color={pal.text} bold>{formatNumber(sum / numbers)}</Text>
            </Text>
          )}
        </Text>
      )
    }
  } else {
    bar = (
      <Box flexDirection="row" justifyContent="space-between" width={columns}>
        <Text color={pal.dim}>Click a cell to see its value or formula</Text>
        <Text color={pal.dim}>
          {bodyTotal} rows × {sheet.cols.length} columns
        </Text>
      </Box>
    )
  }
  const isEmpty = rows.length === 0 && !isHeader
  const body = isEmpty ? <Text color={pal.dim}>This sheet is empty.</Text> : <Text>{rows.map(row => row.cells.join('  ')).join('\n')}</Text>
  const after = (
    <Box key="sheets" flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      <Text color={pal.dim}>Sheets:</Text>
      {d.sheets.map((one, i) =>
        i === sheetIndex ? (
          <Text key={`sheet-${i}`} color={pal.formula} bold underline>
            {cutTo(sanitizeLine(one.name), 30)}
            {one.isHidden ? ' (hidden)' : ''}
          </Text>
        ) : (
          <Button key={`sheet-${i}`} label={`${cutTo(sanitizeLine(one.name), 30)}${one.isHidden ? ' (hidden)' : ''}`} plain onPress={() => setSheet($, i)} />
        ),
      )}
    </Box>
  )
  return {
    bar,
    body,
    ...(isEmpty ? {} : { viewer: { props, height: 1 + (isHeader ? 2 : 0) + rows.length + (props.moreBelow > 0 ? 1 : 0) } }),
    after,
    ...(footnote ? { footnote } : {}),
    keys: [
      ['click', 'a cell'],
      ['drag', 'a range'],
      ['←↑↓→', 'move'],
      ['⇧+arrows', 'extend'],
      ...(d.sheets.length > 1 ? ([['[ ]', 'sheet']] as [string, string][]) : []),
    ],
  }
}

function commentRow($: EngineInterface, ctx: Ctx) {
  const { Box, Text } = ctx.els
  const { pal, sel, d, Input } = ctx
  if (!sel) {
    if (!d || d.kind === 'error') return null
    // A box that looks like where comments go, saying how to start one.
    return (
      <Box {...(isCompact(ctx) ? {} : { borderStyle: 'round', borderColor: pal.dim, paddingX: 1 })}>
        <Text wrap="truncate-end">
          <Text color={pal.comment} bold>✎ Comment </Text>
          <Text color={pal.subtle}>· {d.kind === 'image' ? 'click the picture' : `click or drag over ${d.kind === 'grid' ? 'cells' : 'lines'}`} above, then type here</Text>
        </Text>
      </Box>
    )
  }
  if (!Input) return <Text color={pal.subtle}>Comments can be added from the terminal.</Text>
  // A selection that already carries a waiting comment edits that comment.
  const editing = ctx.notes.find(c => c.status === 'draft' && isAt(c, sel))
  const key = commentKey(ctx.notes, sel)
  const short = sel.sheet !== undefined ? sel.label.slice(sel.label.lastIndexOf('!') + 1) : sel.label
  // Exactly what the comment will quote to Claude, on one or two lines: text the view cuts off (a long cell, a wide code line) is seen here.
  const flat = sel.quote.replace(/\n/g, ' ⏎ ').replace(/ {4,}/g, run => ` ·${run.length} spaces· `)
  const lead = `Quoted for Claude (${plural(sel.quote.length, 'character')}): `
  const room = Math.max(10, (ctx.columns - 4) * 2 - lead.length - 16)
  const shown = flat.length > room ? `“${flat.slice(0, room)}” … and ${flat.length - room} more characters, also sent (Edit before sending shows them all)` : `“${flat}”`
  return (
    <Box flexDirection="column" {...(isCompact(ctx) ? {} : { borderStyle: 'round', borderColor: pal.comment, paddingX: 1 })}>
      <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text color={pal.comment} bold>✎ </Text>
      </Box>
      <Input
        key={key}
        label={`${editing ? 'Edit comment on' : 'Comment on'} ${cutTo(sanitizeLine(short), clamp(Math.floor(ctx.columns * 0.25), 12, 80))}`}
        placeholder={editing ? 'Clear it and press Enter to delete · Esc: back to Claude' : 'What should change? · Esc: back to Claude'}
        submitLabel={editing ? 'Save' : 'Add'}
        {...(editing ? { value: editing.text } : {})}
        autoFocus
        onSubmit={value => void saveComment($, value, d?.kind === 'grid')}
      />
      </Box>
      {sel.quote ? (
        <Text color={pal.dim} wrap="wrap">
          {lead}
          {shown}
        </Text>
      ) : null}
    </Box>
  )
}

function sectionHeader(ctx: Ctx, title: string, detail: string) {
  const { Text } = ctx.els
  const head = ` ${title} `
  const tail = detail ? ` ${detail} ` : ''
  return (
    <Text wrap="truncate-end">
      <Text color={ctx.pal.dim}>──</Text>
      <Text color={ctx.pal.comment} bold>{head}</Text>
      <Text color={ctx.pal.subtle}>{tail}</Text>
      <Text color={ctx.pal.dim}>{'─'.repeat(Math.max(2, ctx.columns - 2 - head.length - tail.length))}</Text>
    </Text>
  )
}

function commentList($: EngineInterface, ctx: Ctx) {
  const { Box, Text, Button } = ctx.els
  const { pal, sel, d, path, columns } = ctx
  const drafts = ctx.notes.filter(c => c.status === 'draft')
  if (drafts.length === 0) {
    if (!d || d.kind === 'error' || isCompact(ctx)) return null
    return (
      <Box flexDirection="column">
        {sectionHeader(ctx, 'Comments', '')}
        <Text color={pal.dim}>  No comments yet. Select something and say what to change.</Text>
      </Box>
    )
  }
  const listed = drafts.slice(0, MAX_LISTED)
  const editing = sel ? drafts.find(c => isAt(c, sel)) : undefined
  const labelWidth = clamp(Math.max(...listed.map(c => strWidth(noteLabel(c, path)))), 6, 24)
  return (
    <Box flexDirection="column">
      {sectionHeader(ctx, `Comments · ${drafts.length}`, 'click one to review or edit it')}
      {listed.map((c, i) => {
        const isOpen = editing?.id === c.id
        return (
          <Box key={`note-${c.id}`} flexDirection="row" justifyContent="space-between" width={columns}>
            <Box flexDirection="row">
              <Text color={c.isStale ? pal.warning : isOpen ? pal.accent : pal.comment} bold>{c.isStale ? '⚠ ' : isOpen ? '▸ ' : '● '}</Text>
              <Button
                key={`open-${c.id}`}
                label={`${String(i + 1).padStart(2)}  ${padRight(sanitizeLine(noteLabel(c, path)), labelWidth)}`}
                plain
                onPress={press => void jumpTo($, c.id, press.surface)}
              />
              <Text bold={isOpen} color={pal.text} wrap="truncate-end">
                {' '}
                {c.isStale ? <Text color={pal.warning}>(text changed) </Text> : null}
                {c.text}
              </Text>
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
}

function actionsRow($: EngineInterface, ctx: Ctx) {
  const { Box, Text, Button } = ctx.els
  const { pal } = ctx
  const drafts = ctx.notes.filter(c => c.status === 'draft').length
  const queued = ctx.notes.filter(c => c.status === 'queued').length
  const parts: JSX.Element[] = []
  if (drafts > 0) {
    parts.push(
      <Box key="send-row" flexDirection="row" columnGap={2}>
        <Button key="send" label={`➤ Send ${plural(drafts, 'comment')} to Claude`} variant="primary" onPress={() => void deliver($, 'submit')} />
        <Button key="fill" label="Edit before sending" plain onPress={() => void deliver($, 'fill')} />
      </Box>,
    )
  }
  if (queued > 0) {
    parts.push(
      <Box key="queued-row" flexDirection="row" columnGap={2}>
        <Text color={pal.subtle}>✎ {plural(queued, 'comment')} in the prompt box: press Enter there to send</Text>
        <Button key="unqueue" label="↩ back to drafts" plain onPress={() => void backToDrafts($)} />
      </Box>,
    )
  }
  return parts.length === 0 ? null : <Box flexDirection="column">{parts}</Box>
}

function keysRow(ctx: Ctx, keys: [string, string][]) {
  const { Text } = ctx.els
  const { pal } = ctx
  if (keys.length === 0) return null
  // Key hints as chips: the key on a band, what it does after it.
  return (
    <Text wrap="truncate-end">
      {keys.map(([key, what], i) => (
        <Text key={`k${i}`}>
          <Text backgroundColor={pal.band || undefined} color={pal.text} bold inverse={!pal.band}>{` ${key} `}</Text>
          <Text color={pal.subtle}> {what}{i < keys.length - 1 ? '   ' : ''}</Text>
        </Text>
      ))}
    </Text>
  )
}
