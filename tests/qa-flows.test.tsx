// QA: pane flows (comments, labels, open_files, file changes, grids, surfaces).
// Each test asserts the EXPECTED behaviour; a failing test marks a bug.
import { expect, test } from 'claude-code/testing'

import { begin, start } from './setup'

const PANE = (cols = 80, rows = 30) =>
  ({
    component: 'Pane',
    requestId: 'review',
    props: { title: 'Review', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
  }) as const
const NL = String.fromCharCode(10)

type Node = { type?: string; children?: unknown; props?: { flexDirection?: string } }
function lines(node: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown): string => {
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (!n || typeof n !== 'object') return ''
    const e = n as Node
    const kids = e.children ?? []
    const list = Array.isArray(kids) ? kids : [kids]
    if (e.type === 'Box' && e.props?.flexDirection === 'column') {
      for (const k of list) {
        const t = walk(k)
        if (t !== '') out.push(t)
      }
      return ''
    }
    return list.map(walk).join('')
  }
  walk(node)
  return out
}
/** Terminal cells a string takes: CJK/emoji count 2. */
const cellsOf = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1), 0)

const grid = (sheets: { name: string; rows: { v: string; f?: string; x?: number }[][] }[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'grid',
    sheets: sheets.map(s => ({ name: s.name, cols: 'ABCDEFGH'.slice(0, Math.max(...s.rows.map(r => r.length))).split(''), rows: s.rows, isCut: false })),
    ...extra,
  })


test('HTML on one line: a comment on the 2nd paragraph is a new comment, not an edit of the 1st', async ($, on) => {
  begin(on)
  let filled = ''
  on('fs.read', () => ({ value: '<html><body><h1>T</h1><p>First para</p><p>Second para</p></body></html>' }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/min.html' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.post({ type: 'select', a: [3, 0], b: [3, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Fix first' })
  await ui.post({ type: 'select', a: [5, 0], b: [5, 0] }, { in: 'viewer' })
  const inputs = (await ui.findAll({ type: 'Input' })).map(i => i.key ?? '')
  console.log('input keys after selecting 2nd paragraph:', inputs)
  await ui.input({ key: inputs[0] ?? '', text: 'Fix second' })
  await ui.press({ key: 'fill' })
  console.log(filled)
  expect(filled).toContain('Fix first')
  expect(filled).toContain('Fix second')
})

test('open_files: duplicate and equivalent paths open one tab each', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: '# Hi' }))
  await start($)
  const ran = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_files', input: { paths: ['/w/a.md', '/w/a.md', '/w/./b.md', '/w/x/../b.md'], replace: true } })
  console.log(ran.text)
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  const bar = JSON.stringify(await ui.drawn({ in: 'file-tabs' }))
  console.log('bar:', bar.match(/ \d+\/\d+ /)?.[0])
  expect(bar).toContain(' 1/2 ')
})

test('open_files: all paths missing gives a clear error and leaves the pane alone', async ($, on) => {
  let exists = true
  begin(on, { exists: () => exists })
  on('fs.read', () => ({ value: '# Old' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/old.md' })
  exists = false
  const ran = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_files', input: { paths: ['/w/gone.md'], replace: true } })
  console.log(ran.text)
  expect(ran.isError).toBe(true)
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  expect(await ui.find({ type: 'Text', text: /Old/, in: 'viewer' })).toBeDefined()
})

test("sheet names: an apostrophe is doubled in the label ('Bob''s Q1'!A2), as Excel and openpyxl need", async ($, on) => {
  begin(on)
  let filled = ''
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: grid([{ name: "Bob's Q1", rows: [[{ v: 'Item' }], [{ v: 'x' }]] }]), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/b.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.post({ type: 'select', a: [1, 0], b: [1, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'c' })
  await ui.press({ key: 'fill' })
  console.log(filled.split(NL).slice(-3).join(NL))
  expect(filled).toContain("'Bob''s Q1'!A2")
})

test("sheet names: a comment on sheet 'Q1!Data' jumps back to that sheet from the list", async ($, on) => {
  begin(on)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: grid([
        { name: 'Summary', rows: [[{ v: 'Head' }], [{ v: 'SUMMARY-CELL' }]] },
        { name: 'Q1!Data', rows: [[{ v: 'Head' }], [{ v: 'DATA-CELL' }]] },
      ]),
      stderr: '',
    },
  }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/q.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.key({ key: ']', in: 'viewer' })
  await ui.post({ type: 'select', a: [1, 0], b: [1, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'note on data' })
  await ui.key({ key: '[', in: 'viewer' })
  const btn = (await ui.findAll({ type: 'Button' })).find(b => /^ 1 /.test(b.text ?? ''))
  console.log('comment button label:', btn?.text)
  await ui.press({ key: btn?.key ?? '' })
  console.log(lines(await ui.drawn()).slice(0, 8).join(NL))
  expect(await ui.find({ type: 'Text', text: /DATA-CELL/, in: 'viewer' })).toBeDefined()
})

test('grid: a cell holding a newline keeps the row on one line', async ($, on) => {
  begin(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: grid([{ name: 'S', rows: [[{ v: 'H1' }, { v: 'H2' }], [{ v: 'Line1\nLine2' }, { v: 'z' }], [{ v: 'a' }, { v: 'b' }]] }]), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/nl.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  const drawn = lines(await ui.drawn({ in: 'viewer' }))
  console.log(drawn.join(NL))
  expect(drawn.some(l => l.includes('\n'))).toBe(false)
})

test('grid: CJK and emoji cells keep the columns aligned', async ($, on) => {
  begin(on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: grid([{ name: 'S', rows: [[{ v: '名前' }, { v: 'Amt' }], [{ v: '東京都庁舎' }, { v: '1', x: 1 }], [{ v: 'Tokyo' }, { v: '2', x: 2 }], [{ v: '🙂🙂' }, { v: '3', x: 3 }]] }]), stderr: '' },
  }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/cjk.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  const drawn = lines(await ui.drawn({ in: 'viewer' })).filter(l => l.includes('┃'))
  console.log(drawn.join(NL))
  const widths = drawn.map(l => cellsOf(l.trimEnd()))
  console.log('display widths per row:', widths)
  expect(new Set(widths.slice(1)).size).toBe(1)
})

test('grid: the workbook note (formulas not calculated) is shown', async ($, on) => {
  begin(on)
  on('process.run', () => ({
    value: { exitCode: 0, stdout: grid([{ name: 'S', rows: [[{ v: 'H' }], [{ v: '', f: '=1+1' }]] }], { note: 'Formula results could not be calculated here; run /panda setup.' }), stderr: '' },
  }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/n.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  expect(await ui.find({ type: 'Text', text: /could not be calculated/ })).toBeDefined()
})

test('grid: a sheet cut to 500 rows says so even while a cell is selected / scrolled to the end', async ($, on) => {
  begin(on)
  const rows = [[{ v: 'n' }], ...Array.from({ length: 499 }, (_, i) => [{ v: String(i), x: i }])]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ kind: 'grid', sheets: [{ name: 'Tall', cols: ['A'], rows, isCut: true }] }), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/t.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.key({ key: 'end', in: 'viewer' })
  const idle = lines(await ui.drawn())
  console.log(idle.slice(0, 3).join(NL), NL, idle.filter(l => /more row|first 500/.test(l)).join(NL))
  await ui.post({ type: 'select', a: [499, 0], b: [499, 0] }, { in: 'viewer' })
  const all = lines(await ui.drawn()).join(NL)
  expect(all).toMatch(/first 500|more rows in the file|cut/)
})

test('lines: a draft comment follows its text when Claude inserts a line above it (or is flagged as stale)', async ($, on) => {
  let text = 'alpha\nbeta\ngamma'
  let mtime = 1
  begin(on, { mtime: () => mtime })
  on('fs.read', () => ({ value: text }))
  on('fs.list', () => ({ value: [] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok', text: 'ok' }))
  let filled = ''
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/n.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.post({ type: 'select', a: [2, 0], b: [2, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'change gamma' })
  text = 'NEW\nalpha\nbeta\ngamma'
  mtime = 2
  await $.tool.call({ tool: 'Bash', input: { command: 'edit' } })
  const drawn = lines(await ui.drawn({ in: 'viewer' }))
  console.log(drawn.join(NL))
  await ui.press({ key: 'fill' })
  console.log(filled.split(NL).slice(-3).join(NL))
  const marked = drawn.find(l => l.startsWith('●'))
  expect(marked ?? '').toContain('gamma')
})

test('lines: clicking a comment in the list scrolls a wrapped document to it', async ($, on) => {
  begin(on)
  const long = 'word '.repeat(60).trim()
  const md = Array.from({ length: 12 }, (_, i) => `Para ${i} ${long}`).join('\n\n') + '\n\nTARGET paragraph at the end.'
  on('fs.read', () => ({ value: md }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/long.md' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE(60, 30) })
  const rows = 12 * 2 // 12 paragraphs + spacers before the target
  await ui.post({ type: 'select', a: [rows, 0], b: [rows, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'x' })
  await ui.key({ key: 'home', in: 'viewer' })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const btn = (await ui.findAll({ type: 'Button' })).find(b => /^ 1 /.test(b.text ?? ''))
  await ui.press({ key: btn?.key ?? '' })
  const drawn = lines(await ui.drawn({ in: 'viewer' }))
  console.log(drawn.slice(0, 3).join(NL), '...')
  expect(drawn.join(NL)).toContain('TARGET')
})

test('lines: pressing ← with nothing selected does not select line 1 or jump to the top', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n') }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/l.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.key({ key: 'pagedown', in: 'viewer' })
  await ui.key({ key: 'left', in: 'viewer' })
  const drawn = lines(await ui.drawn())
  console.log(drawn.slice(0, 4).join(NL))
  expect(drawn.join(NL)).not.toMatch(/▌ Line 1\b/)
})

test('a file deleted while open is reported (not silently kept as if current)', async ($, on) => {
  let gone = false
  begin(on, { isGone: () => gone, mtime: () => (gone ? 0 : 1) })
  on('fs.read', () => {
    if (gone) throw new Error('ENOENT: no such file')
    return { value: 'hello' }
  })
  on('fs.list', () => ({ value: [] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok', text: 'ok' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/d.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  gone = true
  await $.tool.call({ tool: 'Bash', input: { command: 'rm d.txt' } })
  const all = lines(await ui.drawn()).join(NL)
  console.log(all.split(NL).slice(0, 4).join(NL))
  expect(all).toMatch(/deleted|no longer|not found|Couldn't show/i)
})

test('a binary file with a .txt name is refused, not drawn as control characters', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: 'PK\u0003\u0004\u0000\u0000\u0008\u0000\u001b[2J��' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/bin.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  const all = lines(await ui.drawn()).join(NL)
  console.log(JSON.stringify(all.slice(0, 200)))
  expect(/[\u0000-\u0008\u001b]/.test(all)).toBe(false)
})

test('narrow pane (40 columns): the file bar fits in the pane', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: '# A heading that is fairly long indeed\n\n| col one | col two | col three |\n|---|---|---|\n| 1 | 2 | 3 |\n\n- item with a long long long long text\n\n```\nconst veryLongCodeLine = "abcdefghijklmnopqrstuvwxyz0123456789"\n```' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/a-file-with-a-long-name.md' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE(40, 30) })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const drawn = lines(await ui.drawn({ in: 'file-tabs' }))
  console.log(drawn.map(l => `${String(cellsOf(l)).padStart(3)}|${l}`).join(NL))
  const over = drawn.filter(l => cellsOf(l) > 40)
  expect(over).toEqual([])
})

test('comment edit: clearing the text deletes the comment; Send marks drafts sent', async ($, on) => {
  begin(on)
  let submitted = ''
  on('fs.read', () => ({ value: 'a\nb\nc' }))
  on('prompt.submit', (_, e) => {
    submitted = e.text
    return { text: e.text }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/e.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE() })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'one' })
  await ui.post({ type: 'select', a: [1, 0], b: [1, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-1', text: 'two' })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const edit = (await ui.findAll({ type: 'Input' })).map(i => i.key ?? '').find(k => k.startsWith('edit-')) ?? ''
  await ui.input({ key: edit, text: '   ' })
  expect(await ui.find({ type: 'Text', text: /Comments · 1/ })).toBeDefined()
  await ui.press({ key: 'send' })
  expect(submitted).toContain('line 2')
  expect(submitted).not.toContain('line 1\n')
})

test('surfaces: every surface draws a document without throwing', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: '# T\n\nhello' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: grid([{ name: 'S', rows: [[{ v: 'H' }], [{ v: '1', x: 1 }]] }]), stderr: '' } }))
  for (const file of ['/w/s.md', '/w/s.xlsx']) {
    await start($)
    await $.command.run({ command: 'panda', args: file })
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      let out = ''
      try {
        const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface, ...PANE() })
        out = lines(await ui.drawn()).slice(0, 6).join(' / ')
        await ui.unmount()
      } catch (e) {
        out = `THREW ${String(e)}`
      }
      console.log(`${file} on ${surface}: ${out.slice(0, 220)}`)
      expect(out.startsWith('THREW')).toBe(false)
    }
  }
})
