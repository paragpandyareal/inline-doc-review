// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { base64, docx, pdf, png, xlsx } from './office'
import { PANE, begin, start } from './setup'

/** Every kind of file, each with two places to comment on: "First" and "Second". */
const ADF = JSON.stringify({
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First point.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second point.' }] },
  ],
})
const FILES: Record<string, string | { base64: string }> = {
  'budget.xlsx': { base64: base64(xlsx([{ name: 'Budget', rows: [['Item', 'Cost'], ['First', 8000], ['Second', 3000]] }])) },
  'proposal.docx': { base64: base64(docx([{ p: 'Plan', style: 'Title' }, { p: 'First point.' }, { p: 'Second point.' }])) },
  'letter.pdf': { base64: base64(pdf([['First point.', 'Second point.']])) },
  'plan.md': '# Plan\n\nFirst point.\n\nSecond point.\n',
  'page.html': '<html><body><h1>Plan</h1><p>First point.</p><p>Second point.</p></body></html>',
  'update.adf': ADF,
  'readings.csv': 'name,amount\nFirst point,10\nSecond point,20\n',
  'notes.txt': 'First point.\nSecond point.\n',
}

type Ui = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>

/** Selects the place whose quote contains `text`: a row of a document, or a cell of a sheet. */
async function selectQuoting(ui: Ui, text: string) {
  for (let r = 0; r < 14; r += 1)
    for (let c = 0; c < 2; c += 1) {
      await ui.post({ type: 'select', a: [r, c], b: [r, c] }, { in: 'viewer' })
      if (await ui.find({ type: 'Text', text: new RegExp(`Quoted for Claude.*${text}`) })) return
    }
  throw new Error(`nothing quotes ${text}`)
}

async function openFile($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], name: string) {
  const sent: { submitted: string[]; filled: string[] } = { submitted: [], filled: [] }
  begin(on)
  on('fs.read', () => ({ value: FILES[name] ?? '' }))
  on('prompt.fill', (_, e) => {
    sent.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    sent.submitted.push(e.text)
    return { text: e.text }
  })
  await start($)
  await $.command.run({ command: 'panda', args: `/w/${name}` })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  return { ui, sent }
}

/** One prompt, both items, each fenced with its own place, each with its own feedback. */
function expectBoth(prompt: string, name: string) {
  expect(prompt.match(/^Lazy Panda Panel feedback:/gm)?.length).toBe(1)
  const named = name.replace(/[.]/g, '\\.')
  expect(prompt).toMatch(new RegExp(`^1\\. <file-excerpt-[0-9a-f]{8}> (?:/w/)?${named}: `, 'm'))
  expect(prompt).toMatch(new RegExp(`^2\\. <file-excerpt-[0-9a-f]{8}> (?:/w/)?${named}: `, 'm'))
  expect(prompt).toMatch(/> [^\n]*First[\s\S]*Feedback: Change the first[\s\S]*> [^\n]*Second[\s\S]*Feedback: Change the second/)
}

for (const name of Object.keys(FILES)) {
  test(`${name}: comment on one place, then another; both go to Claude in one prompt`, async ($, on) => {
    const { ui, sent } = await openFile($, on, name)
    await selectQuoting(ui, 'First')
    await ui.input({ key: 'comment-0', text: 'Change the first' })
    await selectQuoting(ui, 'Second')
    await ui.input({ key: 'comment-1', text: 'Change the second' })
    expect(await ui.find({ type: 'Text', text: /Comments · 2/ })).toBeDefined()
    await ui.press({ key: 'send' })
    expect(sent.submitted.length).toBe(1)
    expectBoth(sent.submitted[0] ?? '', name)
    expect(await ui.find({ key: 'spinner' })).toBeDefined()
  })

  test(`${name}: Edit before sending puts both comments in the prompt box, and they go when the person sends it`, async ($, on) => {
    const { ui, sent } = await openFile($, on, name)
    await selectQuoting(ui, 'First')
    await ui.input({ key: 'comment-0', text: 'Change the first' })
    await selectQuoting(ui, 'Second')
    await ui.input({ key: 'comment-1', text: 'Change the second' })
    await ui.press({ key: 'fill' })
    expect(sent.submitted.length).toBe(0)
    expectBoth(sent.filled[0] ?? '', name)
    expect(await ui.find({ type: 'Text', text: /2 comments in the prompt box/ })).toBeDefined()
    await $.prompt.submit({ text: sent.filled[0] ?? '' })
    expect(await ui.find({ key: 'spinner' })).toBeDefined()
  })
}

test('picture.png: a comment is on the whole picture, and a second one edits it rather than adding another', async ($, on) => {
  const picture = png(30, 20, x => (x < 15 ? 0xff0000 : 0x0000ff))
  let submitted = ''
  begin(on)
  on('fs.read', () => ({ value: { base64: base64(picture) } }))
  on('prompt.submit', (_, e) => {
    submitted = e.text
    return { text: e.text }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/picture.png' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  await ui.input({ key: 'comment-0', text: 'Brighter' })
  expect(await ui.find({ type: 'Text', text: /Comments · 1/ })).toBeDefined()
  await ui.press({ key: 'send' })
  expect(submitted).toMatch(/picture\.png: the whole image/)
  expect(submitted).toContain('Feedback: Brighter')
})

// ── Auto-open ──

const turnDone = (turnId = 't1') => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'end_turn' }) as never

async function autoSession($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], isOn: boolean, listing: string[] = []) {
  const shown = { opened: 0, status: '' }
  begin(on, {
    mtime: () => 5000,
    onOpen: () => {
      shown.opened += 1
    },
    onStatus: text => {
      shown.status = text
    },
  })
  on('fs.read', () => ({ value: '# Report\n\nText.' }))
  on('fs.list', (_, e) => ({ value: (e as { path: string }).path === '/w' ? listing.map(name => ({ name, kind: 'file', size: 10, mtimeMs: 5000, isLink: false })) : [] }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok', text: 'ok' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok', text: 'ok' }))
  on('turn.complete', () => ({ text: 'done' }))
  await start($)
  if (isOn) await $.command.run({ command: 'panda', args: 'auto on' })
  shown.opened = 0
  return shown
}

test('auto-open on: a file Claude writes opens in the pane when its turn finishes', async ($, on) => {
  const shown = await autoSession($, on, true)
  await $.tool.call({ tool: 'Write', input: { file_path: '/w/report.md', content: '# Report' } })
  expect(shown.opened).toBe(0)
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(1)
})

test('auto-open on: a file a command made (found by the scan after Bash) opens too', async ($, on) => {
  const shown = await autoSession($, on, true, ['summary.docx'])
  await $.tool.call({ tool: 'Bash', input: { command: 'python make_summary.py' } })
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(1)
})

test('auto-open off: nothing opens; the status line says what changed', async ($, on) => {
  const shown = await autoSession($, on, false)
  await $.tool.call({ tool: 'Write', input: { file_path: '/w/report.md', content: '# Report' } })
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(0)
  expect(shown.status).toContain('1 file updated · /panda to open')
})

test('auto-open on: more than 5 new files in one turn open nothing (too many to be a review)', async ($, on) => {
  const shown = await autoSession($, on, true)
  for (let k = 1; k <= 6; k += 1) await $.tool.call({ tool: 'Write', input: { file_path: `/w/part-${k}.md`, content: '# Part' } })
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(0)
  expect(shown.status).toContain('6 files updated')
})

test('auto-open on: a subagent finishing opens nothing; the main turn finishing does', async ($, on) => {
  const shown = await autoSession($, on, true)
  await $.tool.call({ tool: 'Write', input: { file_path: '/w/report.md', content: '# Report' } })
  await $.turn.complete({ ...(turnDone('sub') as object), agentId: 'helper' } as never)
  expect(shown.opened).toBe(0)
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(1)
})

test('auto-open: the scan after a subagent’s command finds nothing, so nothing opens', async ($, on) => {
  const shown = await autoSession($, on, true, ['summary.docx'])
  await $.tool.call({ tool: 'Bash', input: { command: 'python make_summary.py' }, agentId: 'helper' } as never)
  await $.turn.complete(turnDone())
  expect(shown.opened).toBe(0)
})
