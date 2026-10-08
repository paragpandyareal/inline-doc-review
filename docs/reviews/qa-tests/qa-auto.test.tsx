// QA: auto-open, unsupported files via the command, and what Claude's edits do to the view.
import { expect, mock, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'review', props: { title: 'Review', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
const NL = String.fromCharCode(10)

test('auto-open: when Claude edits the file the user is reviewing, the source view and selection survive', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  let text = '# Doc\n\nfirst\n\nsecond'
  let mtime = 1
  on('fs.exists', () => ({ value: true }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: text }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: mtime, isLink: false } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok', text: 'ok' }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.command.run({ command: 'inline-review', args: 'auto on' })
  await $.command.run({ command: 'inline-review', args: '/w/doc.md' })
  const ui = await $.ui.mount({ plugin: 'inline-doc-review', surface: 'terminal', ...PANE })
  await ui.post({ type: 'aside', id: 'source' }, { in: 'file-tabs' })
  await ui.post({ type: 'select', a: [4, 0], b: [4, 0] }, { in: 'viewer' })
  const before = (await ui.drawn()) && JSON.stringify(await ui.drawn())
  expect(before).toContain('Formatted')
  text = '# Doc\n\nfirst\n\nsecond edited'
  mtime = 2
  await $.tool.call({ tool: 'Bash', input: { command: 'sed -i ...' } })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'end_turn' } as never)
  const after = JSON.stringify(await ui.drawn())
  console.log('still in source view:', after.includes('Formatted'), ' selection kept:', /Line 5/.test(after))
  expect(after).toContain('Formatted')
})

test('the command refuses a file type the pane does not support (as open_file does)', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: 'MZ\u0090\u0000binary' }))
  const ran = await $.command.run({ command: 'inline-review', args: '/w/tool.exe' })
  console.log('command result:', ran.text)
  expect(ran.exitCode).toBe(1)
})

test('a quoted path (as people paste them) opens', async ($, on) => {
  mock.store(on)
  let asked = ''
  on('fs.exists', ($, e) => {
    asked = String((e as { path?: string }).path)
    return { value: asked === '/w/my file.md' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: '# Hi' }))
  const ran = await $.command.run({ command: 'inline-review', args: '"/w/my file.md"' })
  console.log('quoted path ->', asked, '|', ran.text)
  expect(ran.text).toBe('Review pane opened.')
})
