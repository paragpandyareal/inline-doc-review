import { expect, test } from 'claude-code/testing'

import { PANE, begin, start } from './setup'

const NOTES = ['# Plan', '', 'We ship in May.', 'Budget is 40k.', 'Risks: none.'].join('\n')


test('a highlighted range becomes a comment that names it, and lands in the prompt box', async ($, on) => {
  let filled = ''
  begin(on)
  on('fs.read', () => ({ value: NOTES }))
  on('prompt.fill', ($, e) => {
    filled = e.text
    return { isFilled: true }
  })

  await start($)
  const opened = await $.command.run({ command: 'panda', args: '/work/plan.txt' })
  expect(opened.text).toBe('Review pane opened.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /We ship in May/, in: 'viewer' })).toBeDefined()

    // Drag across two lines (rows are 0-based): lines 3–4 here, lines 1–2 on the desktop.
    const [y1, y2, label] = surface === 'terminal' ? [2, 3, /Lines 3–4/] : [0, 1, /Lines 1–2/]
    await ui.pointer({ type: 'down', x: 6, y: y1, button: 'left', in: 'viewer' })
    await ui.pointer({ type: 'move', x: 6, y: y2, button: 'left', in: 'viewer' })
    await ui.pointer({ type: 'up', x: 6, y: y2, button: 'left', in: 'viewer' })
    expect(await ui.find({ type: 'Text', text: label })).toBeDefined()

    await ui.input({ key: surface === 'terminal' ? 'comment-0' : 'comment-1', text: 'Say which May.' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Comments · 2/ })).toBeDefined()
  await ui.press({ key: 'fill' })
  expect(filled).toContain('File: `/work/plan.txt`\n   Location: lines 3–4')
  expect(filled).toContain('<file-excerpt>\n   > We ship in May.\n   > Budget is 40k.\n   </file-excerpt>')
  expect(filled).toContain('Feedback: Say which May.')
  expect(await ui.find({ key: 'send' })).toBeUndefined()
})

test('auto-open is off until asked for, and the setting sticks', async ($, on) => {
  begin(on)
  await start($)
  const before = await $.command.run({ command: 'panda', args: 'auto' })
  expect(before.text).toContain('Auto-open is off')
  await $.command.run({ command: 'panda', args: 'auto on' })
  const after = await $.command.run({ command: 'panda', args: 'auto' })
  expect(after.text).toContain('Auto-open is on')
})

const BUDGET = {"kind": "grid", "sheets": [{"name": "Budget", "cols": ["A", "B", "C", "D", "E"], "rows": [[{"v": "Line item"}, {"v": "Jan"}, {"v": "Feb"}, {"v": "Mar"}, {"v": "Total"}], [{"v": "Facebook ads"}, {"v": "700", "x": 700}, {"v": "8,000", "x": 8000}, {"v": "8,000", "x": 8000}, {"v": "16,700", "f": "=SUM(B2:D2)", "x": 16700}], [{"v": "Letterbox print"}, {"v": "9,600", "x": 9600}, {"v": "4,800", "x": 4800}, {"v": "0", "x": 0}, {"v": "14,400", "f": "=SUM(B3:D3)", "x": 14400}], [{"v": "Info nights"}, {"v": "3,200", "x": 3200}, {"v": "3,200", "x": 3200}, {"v": "3,200", "x": 3200}, {"v": "9,600", "f": "=SUM(B4:D4)", "x": 9600}], [{"v": "Installer bonus"}, {"v": "0", "x": 0}, {"v": "5,000", "x": 5000}, {"v": "5,000", "x": 5000}, {"v": "10,000", "f": "=SUM(B5:D5)", "x": 10000}], [{"v": "Total"}, {"v": "13,500", "f": "=SUM(B2:B5)", "x": 13500}, {"v": "21,000", "f": "=SUM(C2:C5)", "x": 21000}, {"v": "16,200", "f": "=SUM(D2:D5)", "x": 16200}, {"v": "50,700", "f": "=SUM(E2:E5)", "x": 50700}]], "isCut": false}, {"name": "Sign-ups", "cols": ["A", "B", "C"], "rows": [[{"v": "Suburb"}, {"v": "Target"}, {"v": "Signed"}], [{"v": "Penrith"}, {"v": "200", "x": 200}, {"v": "64", "x": 64}], [{"v": "Blacktown"}, {"v": "180", "x": 180}, {"v": "51", "x": 51}], [{"v": "Mount Druitt"}, {"v": "120", "x": 120}, {"v": "22", "x": 22}]], "isCut": false}]}

test('a spreadsheet shows values, marks formulas, and shows the formula of the clicked cell', async ($, on) => {
  begin(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(BUDGET), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })

  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /50,700/, in: 'viewer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /=SUM/, in: 'viewer' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ ƒ$/, in: 'viewer' })).toBeDefined()

  // Click E2 (Facebook ads total): column E starts after 4 columns of the grid.
  await ui.post({ type: 'select', a: [1, 4], b: [1, 4] }, { in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /=SUM\(B2:D2\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '16,700' })).toBeDefined()

  // Shift+left twice selects C2:E2 and the bar sums it.
  await ui.key({ key: 'left', shift: true, in: 'viewer' })
  await ui.key({ key: 'left', shift: true, in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /32,700/ })).toBeDefined()

  await ui.input({ key: 'comment-0', text: 'Check these add up' })
  expect(await ui.find({ key: 'send' })).toBeDefined()
})

test('arrow keys in every direction, past every edge, never break the pane', async ($, on) => {
  begin(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(BUDGET), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  // No selection yet: the first arrow starts the cursor.
  for (const key of ['up', 'up', 'left', 'left', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'right', 'right', 'right', 'right', 'right', 'right', 'pageup', 'pagedown', 'home', 'end', '[', ']', ']', 'backspace', 'up']) {
    await ui.key({ key, in: 'viewer' })
    await ui.key({ key, shift: true, in: 'viewer' })
  }
  expect(await ui.drawn()).toBeDefined()
  // With nothing selected, the first arrow puts the cursor on the first row in view.
  await ui.key({ key: '[', in: 'viewer' })
  await ui.key({ key: 'down', in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /^ A2/ })).toBeDefined()
  await ui.key({ key: 'down', in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /^ A3/ })).toBeDefined()
})

test('arrow keys on the file tabs move between files', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: NOTES }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(BUDGET), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/work/plan.txt' })
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /50,700/, in: 'viewer' })).toBeDefined()
  await ui.key({ key: 'right', in: 'file-tabs' })
  expect(await ui.find({ type: 'Text', text: /We ship in May/, in: 'viewer' })).toBeDefined()
  for (const key of ['left', 'left', 'right', 'right', 'right']) await ui.key({ key, in: 'file-tabs' })
  expect(await ui.drawn()).toBeDefined()
})

test('comment on C3, C4 and C6, then go back and edit one before sending', async ($, on) => {
  let filled = ''
  begin(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(BUDGET), stderr: '' } }))
  on('prompt.fill', ($, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })

  // C3: click it, comment. Then the down arrow moves on to C4 from there.
  await ui.post({ type: 'select', a: [2, 2], b: [2, 2] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Print is too high' })
  await ui.key({ key: 'down', in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /^ C4/ })).toBeDefined()
  await ui.input({ key: 'comment-1', text: 'Too many info nights' })
  await ui.post({ type: 'select', a: [5, 2], b: [5, 2] }, { in: 'viewer' })
  await ui.input({ key: 'comment-2', text: 'Recheck the Feb total' })
  expect(await ui.find({ type: 'Text', text: /Comments · 3/ })).toBeDefined()

  // Back to the first comment from the list: the box now edits it.
  const first = (await ui.findAll({ type: 'Button' })).find(b => /^ 1  C3/.test(b.text ?? ''))
  expect(first).toBeDefined()
  await ui.press({ key: first?.key ?? '' })
  const editKey = (await ui.findAll({ type: 'Input' })).map(one => one.key ?? '').find(key => key.startsWith('edit-')) ?? ''
  expect(editKey).not.toBe('')
  await ui.input({ key: editKey, text: 'Cut print to 6,000' })

  // Selecting C4 again edits its comment rather than adding a second one.
  await ui.post({ type: 'select', a: [3, 2], b: [3, 2] }, { in: 'viewer' })
  expect((await ui.findAll({ type: 'Input' })).some(one => (one.key ?? '').startsWith('edit-'))).toBe(true)

  await ui.press({ key: 'fill' })
  expect(filled).toContain('Budget!C3')
  expect(filled).toContain('Feedback: Cut print to 6,000')
  expect(filled).not.toContain('Print is too high')
  expect(filled).toContain('Budget!C4')
  expect(filled).toContain('Budget!C6')
})

test('after sending, a spinner shows; when Claude changes the file, the changed cells glow and fade', async ($, on) => {
  begin(on)
  let budget: typeof BUDGET = BUDGET
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(budget), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })

  await ui.post({ type: 'select', a: [1, 1], b: [1, 1] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Make this 900' })
  await ui.press({ key: 'send' })
  expect(await ui.find({ type: 'Text', text: /C/, in: 'spinner' })).toBeDefined()

  // Claude edits B2: the reload finds the change and B2 glows with a tick.
  const edited = JSON.parse(JSON.stringify(BUDGET)) as typeof BUDGET
  const b2 = edited.sheets[0]?.rows[1]?.[1]
  if (b2) Object.assign(b2, { v: '900', x: 900 })
  budget = edited
  await ui.post({ type: 'aside', id: 'reload' }, { in: 'file-tabs' })
  await ui.advance(100)
  expect(await ui.find({ type: 'Text', text: '✓', in: 'viewer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /900/, in: 'viewer' })).toBeDefined()
  // Claude may edit again before it is done: the spinner stays until its turn ends.
  expect(await ui.find({ key: 'spinner' })).toBeDefined()
  await ui.advance(3000)
  expect(await ui.find({ type: 'Text', text: '✓', in: 'viewer' })).toBeUndefined()
})

test('opening files keeps the tab order, so → walks through them all', async ($, on) => {
  begin(on)
  on('fs.read', ($, e) => ({ value: `# ${String((e as { path?: string }).path ?? '')}` }))
  await start($)
  for (const name of ['a.md', 'b.md', 'c.md']) await $.command.run({ command: 'panda', args: `/w/${name}` })
  await $.command.run({ command: 'panda', args: '/w/a.md' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  for (const expected of ['b.md', 'c.md', 'a.md']) {
    await ui.key({ key: 'right', in: 'file-tabs' })
    expect(await ui.find({ type: 'Text', text: new RegExp(`/w/${expected.replace('.', '\\.')}`), in: 'viewer' })).toBeDefined()
  }
})

test('open_files with replace makes exactly those tabs, in order, and clears old comments', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: '# Hello' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/old.md' })
  const ran = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_files', input: { paths: ['/w/one.md', '/w/two.md', '/w/nope.exe'], replace: true } })
  expect(ran.text).toContain('Opened 2 files')
  expect(ran.text).toContain('/w/nope.exe.')
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  // Closed, the bar shows only the open file; ↓ drops down the list of all of them.
  expect(JSON.stringify(await ui.drawn({ in: 'file-tabs' }))).not.toContain('two.md')
  await ui.key({ key: 'down', in: 'file-tabs' })
  const tabs = JSON.stringify(await ui.drawn({ in: 'file-tabs' }))
  expect(tabs).toContain('one.md')
  expect(tabs).toContain('two.md')
  expect(tabs).not.toContain('old.md')
})

test('the file bar: one line, a dropdown to jump, and ← → to step', async ($, on) => {
  begin(on)
  on('fs.read', ($, e) => ({ value: `# Title of ${String((e as { path?: string }).path ?? '')}` }))
  await start($)
  await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_files', input: { paths: ['/w/a.md', '/w/b.md', '/w/c.md', '/w/d.md'], replace: true } })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const bar = async () => JSON.stringify(await ui.drawn({ in: 'file-tabs' }))
  expect(await bar()).toContain('a.md')
  expect(await bar()).toContain(' 1/4 ')
  expect(await bar()).not.toContain('c.md')

  // Drop down, move to the third file, open it.
  await ui.key({ key: 'return', in: 'file-tabs' })
  expect(await bar()).toContain('d.md')
  await ui.key({ key: 'down', in: 'file-tabs' })
  await ui.key({ key: 'down', in: 'file-tabs' })
  await ui.key({ key: 'return', in: 'file-tabs' })
  expect(await ui.find({ type: 'Text', text: /Title of \/w\/c\.md/, in: 'viewer' })).toBeDefined()
  expect(await bar()).toContain(' 3/4 ')
  expect(await bar()).not.toContain('a.md')

  // Step with the arrows, wrapping round.
  await ui.key({ key: 'right', in: 'file-tabs' })
  await ui.key({ key: 'right', in: 'file-tabs' })
  expect(await bar()).toContain(' 1/4 ')
  await ui.key({ key: 'left', in: 'file-tabs' })
  expect(await ui.find({ type: 'Text', text: /Title of \/w\/d\.md/, in: 'viewer' })).toBeDefined()

  // A click on a listed file jumps straight to it.
  await ui.pointer({ type: 'down', x: 8, y: 0, button: 'left', in: 'file-tabs' })
  await ui.pointer({ type: 'down', x: 6, y: 2, button: 'left', in: 'file-tabs' })
  expect(await bar()).toContain(' 2/4 ')
})

test('an edit made by a command refreshes the open file at once; the spinner clears when Claude finishes its turn', async ($, on) => {
  let budget: typeof BUDGET = BUDGET
  let mtime = 1000
  begin(on, { mtime: () => mtime })
  on('fs.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(budget), stderr: '' } }))
  // What Claude's command does: rewrite the workbook on disk.
  on('tool.call', { tool: 'Bash' }, () => {
    const edited = JSON.parse(JSON.stringify(BUDGET)) as typeof BUDGET
    const b2 = edited.sheets[0]?.rows[1]?.[1]
    if (b2) Object.assign(b2, { v: '810', x: 810 })
    budget = edited
    mtime = 2000
    return { result: 'ok', text: 'ok' }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await ui.post({ type: 'select', a: [1, 1], b: [1, 1] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Make this 810' })
  await ui.press({ key: 'send' })
  expect(await ui.find({ key: 'spinner' })).toBeDefined()

  await $.tool.call({ tool: 'Bash', input: { command: 'python3 edit.py' } })
  expect(await ui.find({ type: 'Text', text: /810/, in: 'viewer' })).toBeDefined()
  expect(await ui.find({ key: 'spinner' })).toBeDefined()
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(await ui.find({ key: 'spinner' })).toBeUndefined()
})

test('when Claude finishes without changing the file, sent comments stop showing as in progress', async ($, on) => {
  begin(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(BUDGET), stderr: '' } }))
  on('turn.complete', () => ({ text: 'done' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/work/pilot-budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await ui.post({ type: 'select', a: [1, 1], b: [1, 1] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Is this right?' })
  await ui.press({ key: 'send' })
  expect(await ui.find({ key: 'spinner' })).toBeDefined()
  await $.turn.complete({ answer: 'It is right.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  expect(await ui.find({ key: 'spinner' })).toBeUndefined()
})

test('an empty pane shows the napping panda', async ($, on) => {
  begin(on)
  await start($)
  await $.command.run({ command: 'panda', args: '' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /The panda is napping/ })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('▀')
  expect(drawn).toContain('#19191C')
})
