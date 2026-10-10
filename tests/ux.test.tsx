// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { base64, docx } from './office'
import { PANE, begin, start } from './setup'

const LONG = ['# Notes', '', ...Array.from({ length: 80 }, (_, i) => `Point ${i + 1}.`)].join('\n')

test('a document longer than the pane says how much is below, with a scrollbar beside it', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: LONG }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/notes.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /\d+ more lines below · scroll or PgDn/, in: 'viewer' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('┃')
})

test('a short document has no "more below" line and no scrollbar', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: 'One.\nTwo.' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/short.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await ui.drawn({ in: 'viewer' }))
  expect(drawn).not.toContain('more lines below')
  expect(drawn).not.toContain('┃')
})

test('a click on the document puts the keys in the comment box: the pane asks for the keyboard when it lacks it', async ($, on) => {
  const opens: { focus?: true }[] = []
  begin(on, { onOpen: args => opens.push(args) })
  on('fs.read', () => ({ value: 'One.\nTwo.' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/short.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const before = opens.length
  await ui.post({ type: 'select', a: [1, 0], b: [1, 0] }, { in: 'viewer' })
  expect(opens.slice(before)).toEqual([expect.objectContaining({ focus: true })])
  expect(await ui.find({ type: 'Input', key: 'comment-0' })).toBeDefined()
  // Arrow keys move through the document and leave the keys there.
  await ui.post({ type: 'move', rows: -1, cols: 0, extend: false }, { in: 'viewer' })
  expect(opens.length).toBe(before + 1)
})

test('the comment box says how to start, with lines or cells in the plural, and how to get back to Claude', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: 'One.\nTwo.' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/short.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /click or drag over lines above, then type here/ })).toBeDefined()
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const input = (await ui.find({ type: 'Input', key: 'comment-0' })) as unknown as { props: { placeholder: string } }
  expect(input.props.placeholder).toContain('Esc: back to Claude')
})

test('a change the pane can’t reread lights Reload, and a reread that works puts it out', async ($, on) => {
  let mtime = 1000
  let isBroken = false
  begin(on, { mtime: () => mtime })
  on('fs.list', () => ({ value: [] }))
  // Halfway through a save, a Word file is a broken zip.
  const whole = docx([{ p: 'One.' }])
  on('fs.read', () => ({ value: { base64: base64(isBroken ? whole.subarray(0, 60) : whole) } }))
  on('tool.call', { tool: 'Bash' }, () => {
    mtime = 2000
    isBroken = true
    return { result: 'ok', text: 'ok' }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/report.docx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await $.tool.call({ tool: 'Bash', input: { command: 'python3 edit.py' } })
  expect(JSON.stringify(await ui.drawn())).toContain('⟳ Changed · Reload')
  // What it showed stays, rather than an error.
  expect(await ui.find({ type: 'Text', text: /One\./, in: 'viewer' })).toBeDefined()
  isBroken = false
  await ui.post({ type: 'aside', id: 'reload' }, { in: 'file-tabs' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('Changed · Reload')
  expect(drawn).toContain('⟳ Reload')
})

test('in a short pane the comment box still shows: no spacing, borders or key hints', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: LONG }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/notes.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { ...PANE.props.scroll, bodyRows: 12 } } } as never)
  expect(await ui.find({ type: 'Text', text: /✎ Comment/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('PgUp/PgDn')
})

test('after Send, the keys go back to Claude: the selection is let go and the pane opens again without asking for them', async ($, on) => {
  const opens: { focus?: true }[] = []
  const closes: string[] = []
  begin(on, { onOpen: args => opens.push(args) })
  on('fs.read', () => ({ value: 'One.\nTwo.' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.close', (_, e) => {
    closes.push((e as { id: string }).id)
    return { value: undefined }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/short.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  await ui.input({ key: 'comment-0', text: 'Shorter' })
  const before = opens.length
  await ui.press({ key: 'send' })
  expect(closes).toEqual(['review'])
  const reopened = opens.slice(before)
  expect(reopened.length).toBe(1)
  expect(reopened[0]?.focus).toBeUndefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
})

test('text typed but not added stays with its file: another file gets a fresh comment box', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: 'One.\nTwo.' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/a.txt' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const first = (await ui.find({ type: 'Input' })) as unknown as { key: string }
  await $.command.run({ command: 'panda', args: '/w/b.txt' })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const second = (await ui.find({ type: 'Input' })) as unknown as { key: string }
  expect(second.key).not.toBe(first.key)
})
