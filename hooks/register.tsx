// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderNode, RenderSurface } from 'claude-code'

import type { Doc, DocRow, ReviewComment, ReviewSelection, View } from '../types'
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
import { BADGES, paletteFor } from './palette'
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
/** Comments listed under the document before the rest are counted. */
const MAX_LISTED = 12
const MAX_FILES = 30
/** Text files: formatted up to 2 MB, plain lines up to 10 MB, refused beyond; at most 20,000 rows. */
const FORMAT_MAX_BYTES = 2_000_000
const TEXT_MAX_BYTES = 10_000_000
const MAX_ROWS = 20_000
const IMAGE_MAX_BYTES = 2_000_000
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
const baseName = (path: string) => path.split('/').pop() ?? path
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
  python: null as 'python3' | 'py' | 'python' | null,
  theme: 'dark',
  /** Supported files written this turn, for auto-open; and this session, which the tools may open wherever they are. */
  turnFiles: new Set<string>(),
  claudeWrote: new Set<string>(),
  /** The main agent's running turn, and comment sends waiting for a turn to finish (`skipTurn`: not that one, it was already running). */
  turn: null as string | null,
  batches: [] as { id: string; skipTurn?: string }[],
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

/** What a surface last drew, for scrolling maths. */
type Drawn = { total: number; firstVisual: number[]; height: number; shownCols: number }
const drawnBy = new Map<RenderSurface, Drawn>()
const drawnOn = (surface: RenderSurface): Drawn => drawnBy.get(surface) ?? { total: 0, firstVisual: [], height: 10, shownCols: 1 }

// ── Reading files ──

type Ran = Awaited<ReturnType<EngineInterface['process']['run']>>

/** What to say when no command here runs Python 3. */
const NO_PYTHON =
  'Word, Excel and PDF files need Python 3, and none was found. Install it from python.org (on Windows, tick “Add python.exe to PATH”), restart Claude Code, then run /panda setup.'

/**
 * Runs the bundled helper, `scripts/extract.py`, in the plugin's folder, with
 * `input` on standard input: what to do on the first line, then its path.
 * Each command is fixed text. Windows has `py` and `python` rather than
 * `python3`, which there may be only the Microsoft Store's placeholder, so
 * each is tried in turn until one is Python 3. Null when none is.
 */
async function runHelper($: EngineInterface, input: string, timeoutMs: number): Promise<Ran | null> {
  const attempt = async (python: 'python3' | 'py' | 'python'): Promise<Ran | null> => {
    let ran: Ran
    try {
      if (python === 'python3') ran = await $.process.run(['python3', './scripts/extract.py'], { cwd: $.plugin.root, stdin: input, timeoutMs })
      else if (python === 'py') ran = await $.process.run(['py', '-3', './scripts/extract.py'], { cwd: $.plugin.root, stdin: input, timeoutMs })
      else ran = await $.process.run(['python', './scripts/extract.py'], { cwd: $.plugin.root, stdin: input, timeoutMs })
    } catch {
      return null
    }
    // The helper always prints something, or fails with a Python traceback; anything else is not Python 3 (9009 is the Store placeholder).
    const isPython3 = ran.exitCode !== 9009 && (ran.exitCode === 0 || ran.stdout.trim() !== '' || ran.stderr.includes('Traceback'))
    if (isPython3) session.python = python
    return isPython3 ? ran : null
  }
  if (session.python) return attempt(session.python)
  return (await attempt('python3')) ?? (await attempt('py')) ?? (await attempt('python'))
}

async function loadDoc($: EngineInterface, path: string, isRaw = false): Promise<Doc> {
  const ext = extOf(path)
  let size: number
  try {
    size = (await $.fs.stat(path)).size
  } catch {
    return { kind: 'error', path, message: 'This file was deleted or moved.' }
  }
  try {
    if (ext === 'png') {
      if (size > IMAGE_MAX_BYTES) return { kind: 'error', path, message: 'This image is over 2 MB, too large to preview here.' }
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      // The PNG header: width and height are the big-endian words at bytes 16 and 20.
      const head = atob(base64.slice(0, 32))
      const word = (at: number) => [0, 1, 2, 3].reduce((n, k) => n * 256 + (head.charCodeAt(at + k) || 0), 0)
      return { kind: 'image', path, png: base64, width: word(16) || 1, height: word(20) || 1 }
    }
    if (DOC_KINDS.includes(ext)) {
      const ran = await runHelper($, `${ext}\n${path}`, 60_000)
      if (!ran) return { kind: 'error', path, message: NO_PYTHON }
      if (ran.exitCode !== 0) return { kind: 'error', path, message: sanitizeLine((ran.stderr || ran.stdout).trim().split('\n').slice(-3).join(' '), 600) }
      const parsed = JSON.parse(ran.stdout) as Doc
      // The helper cleans what it reads; this pass makes sure, since a cell or row can hold anything.
      if (parsed.kind === 'lines') {
        const rows = parsed.rows.map(row => ({ ...row, text: stripControls(row.text), ...(row.spans ? { spans: row.spans.map(sp => ({ ...sp, t: stripControls(sp.t) })) } : {}) }))
        return { ...parsed, rows: layoutTables(rows), path }
      }
      if (parsed.kind === 'grid') {
        const cell = (text: string) => stripControls(text).replace(/\n/g, '⏎').replace(/\t/g, ' ')
        const sheets = parsed.sheets.map(sheet => ({
          ...sheet,
          name: sanitizeLine(sheet.name, 100),
          rows: sheet.rows.map(row => row.map(c => ({ ...c, v: cell(c.v), ...(c.f !== undefined ? { f: cell(c.f) } : {}) }))),
        }))
        return { ...parsed, sheets, path }
      }
      return { ...parsed, path }
    }
    if (size > TEXT_MAX_BYTES) return { kind: 'error', path, message: `This file is ${Math.round(size / 1e6)} MB; the pane shows text files up to 10 MB.` }
    const text = stripControls(await $.fs.read(path))
    const isBig = size > FORMAT_MAX_BYTES
    if (!isRaw && !isBig) {
      if (ext === 'md' || ext === 'markdown') return capRows({ kind: 'lines', path, rows: markdownRows(text), isFormatted: true, hasSource: true })
      if (ext === 'html' || ext === 'htm') return capRows({ kind: 'lines', path, rows: htmlRows(text), isFormatted: true, hasSource: true })
      // Confluence/Jira pages as ADF: .adf files, or .json files holding a doc node.
      if (ext === 'adf' || ext === 'json') {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = undefined
        }
        if (isAdf(parsed)) return capRows({ kind: 'lines', path, rows: adfRows(parsed), isFormatted: true, hasSource: true })
        if (ext === 'adf') return { kind: 'error', path, message: 'This .adf file is not an ADF document (expected {"type": "doc", "content": [...]}).' }
      }
    }
    const rows: DocRow[] = text.split('\n').map((line, i) => ({ text: line.replace(/\t/g, '  '), anchor: `line ${i + 1}`, unit: 'line' }))
    if (rows.length > 1 && rows[rows.length - 1]?.text === '') rows.pop()
    const hasSource = !isBig && SOURCE_KINDS.includes(ext) && (ext !== 'json' || isRaw)
    const doc: LinesDoc = { kind: 'lines', path, rows, ...(hasSource ? { hasSource } : {}) }
    if (isBig) doc.note = 'This file is over 2 MB, so it is shown as plain text.'
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

/** Puts a file in the list; the shown file is never the one dropped. */
async function addFile($: EngineInterface, path: string) {
  const shown = (await read($, open)).path
  await update($, files, list => {
    if (list.includes(path)) return list
    const next = [...list, path]
    while (next.length > MAX_FILES) {
      const drop = next.findIndex(one => one !== shown && one !== path)
      next.splice(drop < 0 ? 0 : drop, 1)
    }
    return next
  })
}

/** Rereads a file that changed: when it is the one shown, marks what changed. */
async function track($: EngineInterface, path: string) {
  await addFile($, path)
  seen.set(path, await mtimeOf($, path))
  if ((await read($, open)).path !== path) {
    docs.delete(path)
    return
  }
  const before = docs.get(path)
  const isRaw = (await read($, view)).raw === true
  const fresh = await loadDoc($, path, isRaw)
  if ((await read($, open)).path !== path) return
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

async function show($: EngineInterface, path: string) {
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
  return $.ui.open({ id: PANE, title: TITLE })
}

// ── Paths and watching ──

/** A root (`/`, `C:/`) or a home folder (/home/<name>, /Users/<name>, /root, C:/Users/<name>): too broad to scan. */
const isHomeOrRoot = (dir: string) => /^(?:[A-Z]:)?\/?$|^(?:[A-Z]:)?\/(?:home|Users)\/[^/]+\/?$|^\/root\/?$/i.test(dir)

const resolvePath = (path: string) => normalizePath(isAbsolutePath(path) ? path : `${session.folder}/${path}`)

/** Windows paths compare without case, as Windows does. */
const sameCase = (path: string) => (/^[A-Z]:\//.test(path) ? path.toLowerCase() : path)

/** What a person types after /panda: surrounding quotes stripped. */
function typedPath(text: string): string {
  const bare = text.trim().replace(/^(['"])(.*)\1$/, '$2')
  return resolvePath(bare)
}

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
    real = sameCase(normalizePath((await $.fs.stat(path, { resolve: true })).realPath ?? path))
  } catch {
    return false
  }
  if (!real.startsWith(`${root}/`)) return false
  return !real.slice(root.length + 1).split('/').some(part => part.startsWith('.'))
}

async function noteFile($: EngineInterface, path: string | undefined) {
  if (!path || !isSupported(path)) return
  const absolute = resolvePath(path)
  session.turnFiles.add(absolute)
  session.claudeWrote.add(absolute)
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
      await track($, path)
      reread.push(path)
    }
  }
  return reread
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
  const text = feedbackPrompt(pending)
  const count = plural(pending.length, 'comment')
  const ids = new Set(pending.map(c => c.id))
  if (how === 'fill') {
    // Whatever the person already typed stays; the comments go after it.
    const box = await $.prompt.read()
    const filled = await $.prompt.fill(box.text.trim() === '' ? { text, mode: 'replace' } : { text: `\n\n${text}`, mode: 'append' })
    if (!filled.isFilled) {
      $.ui.toast('Couldn’t reach the prompt box. Try “Send to Claude” instead.')
      return
    }
    await update($, comments, old => old.map(c => (ids.has(c.id) ? { ...c, status: 'queued' as const } : c)))
    $.ui.toast(`Your ${count} ${pending.length === 1 ? 'is' : 'are'} in the prompt box. Edit, then press Enter.`)
    return
  }
  const batch = crypto.randomUUID()
  // Sent while Claude is busy, the prompt waits for that turn to end: that turn's end is not this batch's.
  session.batches.push(session.turn ? { id: batch, skipTurn: session.turn } : { id: batch })
  await update($, comments, old => old.map(c => (ids.has(c.id) ? { ...c, status: 'sent' as const, batch } : c)))
  void $.prompt.submit({ text })
  $.ui.toast(`✓ Sent ${count}. Claude is updating the file.`)
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
    if (described) await update($, selection, () => ({ path: d.path, ...(moved?.raw ? { raw: true as const } : {}), ...described }))
  }
}

/** After Claude writes or edits a file: note it, and reread it if it is open. Returns the tool's own result. */
async function afterEdit<R extends { deny?: unknown; isError?: unknown }>($: EngineInterface, e: object, ran: R): Promise<R> {
  if (ran.deny === undefined && !ran.isError) {
    const input = ((e as { input?: unknown }).input ?? e) as { file_path?: unknown; notebook_path?: unknown }
    const path = input.file_path ?? input.notebook_path
    if (typeof path === 'string') await noteFile($, path)
  }
  return ran
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    session.folder = normalizePath(e.cwd)
    session.realFolder = normalizePath(
      await $.fs
        .stat(e.cwd, { resolve: true })
        .then(st => st.realPath ?? e.cwd)
        .catch(() => e.cwd),
    )
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
    // Only the theme row is kept; the other rows (other plugins' settings among them) are dropped here.
    const theme = (await $.config.list().catch(() => [])).find(row => row.key === 'theme')
    session.theme = typeof theme?.value === 'string' ? theme.value : 'dark'
    // Watch the listed files: whatever changes one, the pane rereads it within a couple of seconds.
    for (const path of await read($, files)) seen.set(path, await mtimeOf($, path))
    $.clock.every(2000, () => void refreshChanged($).catch(() => undefined))
    const stored = await $.store.get('autoOpen')
    await update($, autoOpen, () => stored === true)
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
        "Open a file in the user's review pane inside Claude Code, where they can read it, highlight parts and leave comments for you. " +
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
        "Open several files in the user's review pane at once, as tabs in the order given; the first is shown. " +
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
    if (args === 'auto on' || args === 'auto off') {
      const isOn = args === 'auto on'
      await setAutoOpen($, isOn)
      return {
        text: isOn
          ? `Auto-open is on: when a turn finishes with 1–${AUTO_MAX_FILES} new Word, PDF, PNG, HTML or Markdown files, the Lazy Panda Panel opens on them.`
          : 'Auto-open is off. New files are listed in the pane; open it with /panda.',
      }
    }
    if (args === 'auto') return { text: `Auto-open is ${(await read($, autoOpen)) ? 'on' : 'off'}. Change it with /panda auto on|off.` }
    if (args === 'examples' || args.startsWith('examples ')) {
      // The bundled script writes the samples: it copies the text ones and generates the Excel and Word ones.
      const folder = typedPath(args.slice('examples'.length).trim() || 'lazy-panda-panel-examples')
      const ran = await runHelper($, `examples\n${folder}`, 120_000)
      if (!ran) return { text: `Could not write the samples. ${NO_PYTHON}`, exitCode: 1 }
      const written = ran.stdout
        .split(/\r?\n/)
        .filter(isAbsolutePath)
        .map(normalizePath)
      if (written.length === 0) return { text: `Could not write the samples: ${sanitizeLine(ran.stderr.trim().slice(-400))}`, exitCode: 1 }
      await update($, files, () => written)
      await update($, comments, old => old.filter(c => c.status === 'sent'))
      if (written[0]) await show($, written[0])
      await openPane($)
      return {
        text:
          `Wrote ${written.length} sample files to ${folder} and opened them in the Lazy Panda Panel.` +
          (ran.exitCode === 0 ? '' : ' The Excel and Word samples need /panda setup first.'),
      }
    }
    if (args === 'setup') {
      const ran = await runHelper($, 'setup', 600_000)
      if (!ran) return { text: NO_PYTHON, exitCode: 1 }
      return ran.exitCode === 0
        ? { text: 'Installed python-docx, openpyxl and pypdf (pinned versions, hash-checked) in .cache/lazy-panda-panel/venv in your home folder. Word, Excel and PDF files can be shown now.' }
        : { text: `Setup failed:\n${ran.stderr.trim().slice(-1500)}`, exitCode: 1 }
    }
    if (args) {
      const path = typedPath(args)
      if (!(await $.fs.exists(path))) return { text: `No file at ${path}.`, exitCode: 1 }
      if (!isSupported(path)) return { text: `The pane does not show .${extOf(path) || '(no extension)'} files. It shows ${[...TEXT_KINDS, ...DOC_KINDS, 'png'].join(', ')}.`, exitCode: 1 }
      await show($, path)
    } else if ((await read($, open)).path === null) {
      const first = (await read($, files))[0]
      if (first) await show($, first)
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Review pane opened.' : 'Review pane is waiting for room: widen the terminal.' }
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
    if (!isSupported(path)) return reply(`The review pane does not show .${extOf(path)} files.`, true)
    if (!(await isAllowed($, path))) return reply(`${path} is outside the working folder. Ask the user to open it with /panda ${path}`, true)
    await show($, path)
    const opened = await openPane($)
    return reply(opened.isPlaced ? `Opened ${path} in the Lazy Panda Panel.` : `Loaded ${path}; the pane will show once the terminal is wider (or the user runs /panda).`)
  })

  on('tool.call', { tool: 'mcp__lazy-panda-panel__open_files' }, async ($, e) => {
    const input = ((e as { input?: unknown }).input ?? e) as { paths?: unknown; replace?: unknown }
    const asked = Array.isArray(input.paths)
      ? [...new Set(input.paths.filter((p): p is string => typeof p === 'string').slice(0, MAX_FILES).map(resolvePath))]
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
  })

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
      const listed = new Set(await read($, files))
      const found: string[] = []
      await scan($, session.folder, since, 3, found, { left: 4000 })
      for (const path of found.filter(one => !listed.has(one)).slice(0, 20)) await noteFile($, path)
    }
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, e, await next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, e, await next(e))).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => afterEdit($, e, await next(e))).catch(($, e, next) => next(e))

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
      if (!opened.isPlaced) $.ui.toast(`Review: ${baseName(first)} is ready. Run /panda to see it (the terminal is too narrow to open it by itself).`)
    } else {
      $.ui.status(`review: ${plural(made.length, 'file')} updated · /panda to open`)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    // Input is on the terminal and desktop, Image on the terminal alone.
    const { Input, Image } = els as Partial<Elements['terminal']>
    const hasViews = e.surface === 'terminal' || e.surface === 'desktop'
    const { path, version } = await read($, open)
    const ctx: Ctx = {
      els,
      Input: hasViews ? Input : undefined,
      Image: e.surface === 'terminal' ? Image : undefined,
      surface: e.surface,
      columns: Math.max(40, e.props.bodyColumns),
      bodyRows: e.props.scroll.bodyRows,
      pal: paletteFor(session.theme),
      list: await read($, files),
      path,
      version,
      d: path === null ? undefined : docs.get(path),
      v: await read($, view),
      sel: await read($, selection),
      notes: await read($, comments),
      change: await read($, changed),
      isAuto: await read($, autoOpen),
    }
    const { Box, Text } = els
    const drafts = ctx.notes.filter(c => c.status === 'draft')
    const section =
      ctx.list.length === 0
        ? emptySection(ctx)
        : !ctx.d
          ? { bar: <Text color={ctx.pal.dim}>Loading…</Text>, body: <Text> </Text> }
          : ctx.d.kind === 'error'
            ? { bar: <Text color={ctx.pal.error} bold>Couldn’t show {baseName(ctx.d.path)}</Text>, body: <Text color={ctx.pal.subtle}>{ctx.d.message}</Text> }
            : ctx.d.kind === 'image'
              ? imageSection(ctx, ctx.d)
              : ctx.d.kind === 'lines'
                ? linesSection(ctx, ctx.d, Math.min(drafts.length, MAX_LISTED))
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
        {section.footnote ? <Text color={ctx.pal.warning} wrap="truncate-end">{section.footnote}</Text> : null}
        <Box marginTop={1}>{commentRow($, ctx)}</Box>
        <Box marginTop={1}>{commentList($, ctx)}</Box>
        {actions && <Box marginTop={1}>{actions}</Box>}
        {spinner}
        {keyLine && (
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
}
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
const docHeight = (ctx: Ctx, extra: number, listed: number) => clamp(ctx.bodyRows - (13 + extra + listed) + 1, 5, 60)

function fileBarProps(ctx: Ctx): FileBarProps {
  const { pal, path, d, v, list } = ctx
  const asides: NonNullable<FileBarProps['asides']> = []
  if (d?.kind === 'lines' && d.hasSource) asides.push({ id: 'source', label: v.raw ? '◧ Formatted' : '‹› Source', short: v.raw ? '◧' : '‹›', color: pal.subtle })
  if (path) asides.push({ id: 'reload', label: '⟳ Reload', short: '⟳', color: pal.subtle })
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
  const panda = pandaRows()
  return {
    bar: <Text> </Text>,
    body: (
      <Box flexDirection="row" columnGap={3} paddingY={1}>
        <Box flexDirection="column">
          {panda.map((runs, y) => (
            <Text key={`panda-${y}`}>
              {runs.map((run, x) => (
                <Text key={`p${x}`} {...(run.color ? { color: run.color } : {})} {...(run.background ? { backgroundColor: run.background } : {})}>
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text color={ctx.pal.subtle}>      z</Text>
          <Text color={ctx.pal.subtle}>    Z</Text>
          <Text color={ctx.pal.subtle}>  z</Text>
          <Text> </Text>
          <Text bold color={ctx.pal.accent}>Nothing to review yet. The panda is napping.</Text>
          <Text color={ctx.pal.subtle}>Files Claude creates will open here.</Text>
          <Text color={ctx.pal.subtle}>Or run /panda and a file path, or ask Claude to "open" a file.</Text>
        </Box>
      </Box>
    ),
  }
}

function imageSection(ctx: Ctx, d: Extract<Doc, { kind: 'image' }>): Section {
  const { Text } = ctx.els
  const { pal, Image } = ctx
  const height = docHeight(ctx, 0, 0)
  const roomCols = Math.min(ctx.columns, 120)
  const rowsTall = clamp(Math.round((roomCols * d.height) / d.width / 2), 3, height)
  const cols = clamp(Math.round((rowsTall * 2 * d.width) / d.height), 3, roomCols)
  return {
    bar: (
      <Text wrap="truncate-end">
        <Text bold color={pal.text}>{baseName(d.path)}</Text>
        <Text color={pal.subtle}>  {d.width} × {d.height} px · comments apply to the whole image</Text>
      </Text>
    ),
    body: Image ? (
      <Image key="png" source={{ png: d.png }} columns={cols} rows={rowsTall} alt={`${baseName(d.path)} (pictures show in kitty or Ghostty)`} />
    ) : (
      <Text color={pal.subtle}>Pictures show in the terminal only.</Text>
    ),
  }
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

function linesSection(ctx: Ctx, d: LinesDoc, listed: number): Section {
  const { Box, Text } = ctx.els
  const { pal, v, sel, notes, columns } = ctx
  const height = docHeight(ctx, d.note ? 1 : 0, listed)
  const { lines, firstVisual, stripe, gutter, textWidth } = layoutOf(d, ctx.version, columns, v.raw === true)
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
    ...(rows.length > 0 ? { viewer: { props: { mode: 'lines', pal, rows, gutter, width: textWidth, flashKey: freshKey }, height: rows.length } } : {}),
    ...(d.note ? { footnote: d.note } : {}),
    keys: [
      ['click', unit === 'lines' ? 'a line' : 'a paragraph'],
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
  const height = docHeight(ctx, 2 + (footnote ? 1 : 0), listed)
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
    return (
      <Text>
        <Text color={pal.dim}>✎ </Text>
        <Text color={pal.dim} italic>Select {d.kind === 'grid' ? 'a cell' : 'some text'} to comment on it</Text>
      </Text>
    )
  }
  if (!Input) return <Text color={pal.subtle}>Comments can be added from the terminal.</Text>
  // A selection that already carries a waiting comment edits that comment.
  const editing = ctx.notes.find(c => c.status === 'draft' && isAt(c, sel))
  const short = sel.sheet !== undefined ? sel.label.slice(sel.label.lastIndexOf('!') + 1) : sel.label
  return (
    <Box flexDirection="row">
      <Text color={pal.comment} bold>✎ </Text>
      <Input
        key={editing ? `edit-${editing.id}-${editing.text.length}` : `comment-${ctx.notes.length}`}
        label={`${editing ? 'Edit comment on' : 'Comment on'} ${cutTo(sanitizeLine(short), 80)}`}
        placeholder={editing ? 'Clear the text and press Enter to delete' : 'What should change here?'}
        submitLabel={editing ? 'Save' : 'Add'}
        {...(editing ? { value: editing.text } : {})}
        autoFocus
        onSubmit={value => void saveComment($, value, d?.kind === 'grid')}
      />
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
    if (!d || d.kind === 'error') return null
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
