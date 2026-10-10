// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { base64, docx, xlsx } from './office'
import { PANE, begin } from './setup'

type On = Parameters<Parameters<typeof test>[1]>[1]

const MB = 1024 * 1024

/** Python as the scripts answer: `answer(argv, input)` gives standard output, or null when that command doesn't exist here. */
function python(on: On, answer: (argv: readonly string[], input: string) => string | null, calls: string[][] = []) {
  on('process.spawn', async function* (_, e) {
    const request = e as { argv: readonly string[]; input?: string }
    calls.push([...request.argv])
    const out = answer(request.argv, request.input ?? '')
    // A command that doesn't exist here can't start: the call is refused.
    if (out === null) return { deny: `ENOENT: ${request.argv[0]}` } as never
    // In pieces, as a real child writes.
    for (let k = 0; k < out.length; k += 65_536) yield { stream: 'stdout' as const, text: out.slice(k, k + 65_536) }
    return { value: { code: 0, signal: null } } as never
  })
}

const start = async (e: { session: { start: (x: never) => Promise<unknown> } }) =>
  e.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)

test('a workbook up to 4 MB opens without Python: no program is ever started', async ($, on) => {
  const calls: string[][] = []
  begin(on, { size: 3 * MB })
  on('fs.read', () => ({ value: { base64: base64(xlsx([{ name: 'Budget', rows: [['Item', 'Cost'], ['Ads', 8000]] }])) } }))
  python(on, () => null, calls)
  on('process.run', () => {
    throw new Error('process.run must not be used')
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/budget.xlsx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('8,000')
  expect(calls).toEqual([])
})

test('a document over 4 MB comes through Python, by fixed commands, and reads as any other', async ($, on) => {
  const calls: string[][] = []
  const inputs: string[] = []
  const file = base64(docx([{ p: 'Big Report', style: 'Title' }, { p: 'The long body of a large document.' }]))
  begin(on, { size: 9 * MB })
  on('fs.read', () => {
    throw new Error('over 4 MiB: Claude Code refuses this read')
  })
  python(
    on,
    (argv, input) => {
      inputs.push(input)
      // No python3 here (as on Windows); the py launcher works.
      if (argv[0] === 'python3') return null
      return `LPP1 ${file.length}\n${file}`
    },
    calls,
  )
  await start($)
  await $.command.run({ command: 'panda', args: '/w/report.docx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('The long body of a large document.')
  expect(calls).toEqual([
    ['python3', '-I', './scripts/read_file.py'],
    ['py', '-3', '-I', './scripts/read_file.py'],
  ])
  // The path goes on standard input, never into a command.
  expect(inputs.at(-1)).toBe('/w/report.docx')
  // The command that worked is remembered.
  await $.command.run({ command: 'panda', args: '/w/report2.docx' })
  expect(calls.at(-1)).toEqual(['py', '-3', '-I', './scripts/read_file.py'])
})

test('a document over 4 MB without Python says so plainly, with what to do, and is not an error', async ($, on) => {
  begin(on, { size: 12.4 * MB })
  python(on, () => null)
  await start($)
  const ran = await $.command.run({ command: 'panda', args: '/w/annual-report.pdf' })
  expect(ran.exitCode).toBeUndefined()
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('12.4 MB')
  expect(drawn).toContain('up to 4 MB')
  expect(drawn).toContain('/panda setup')
  expect(drawn).not.toMatch(/Couldn.t show/)
})

test('/panda setup installs nothing: with Python it says so; without, it offers a request in the prompt box and sends nothing', async ($, on) => {
  let has = true
  let filled = ''
  let submitted = 0
  begin(on)
  python(on, () => (has ? 'LPP1 ok 3.12\n' : null))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  on('prompt.submit', () => {
    submitted += 1
    return { value: undefined }
  })
  await start($)
  const ready = await $.command.run({ command: 'panda', args: 'setup' })
  expect(ready.text).toContain('Python 3.12 is ready')
  expect(filled).toBe('')
  has = false
  const missing = await $.command.run({ command: 'panda', args: 'SETUP' })
  expect(missing.text).toContain('Nothing has been installed')
  expect(missing.text).toContain('up to 4 MB already opens without Python')
  expect(filled).toContain('install Python 3')
  expect(filled).toContain('wait for my yes')
  expect(filled).toContain('Don’t install any Python packages')
  expect(submitted).toBe(0)
})

test('/panda examples always writes to a new folder: text samples by the mod, the rest by Python when there is one', async ($, on) => {
  const writes: string[] = []
  const existing = new Set(['/w/lazy-panda-panel-examples'])
  begin(on, { exists: path => existing.has(path) || path.startsWith('/w/lazy-panda-panel-examples-2/') })
  on('fs.read', (_, e) => ({ value: `sample of ${(e as { path: string }).path}` }))
  on('fs.write', (_, e) => {
    writes.push((e as { path: string }).path)
    return { value: undefined }
  })
  python(on, (_, folder) => `LPP1 wrote ${folder}/pilot-budget.xlsx\nLPP1 wrote ${folder}/energy-proposal.docx\n`)
  await start($)
  const ran = await $.command.run({ command: 'panda', args: 'examples' })
  // The existing folder is left alone.
  expect(writes.every(path => path.startsWith('/w/lazy-panda-panel-examples-2/'))).toBe(true)
  expect(writes.length).toBe(4)
  expect(ran.text).toContain('Wrote 6 sample files to /w/lazy-panda-panel-examples-2')
})

test('/panda examples without Python writes the text samples and says what the others need', async ($, on) => {
  begin(on, { exists: () => false })
  on('fs.read', () => ({ value: '# sample' }))
  on('fs.write', () => ({ value: undefined }))
  python(on, () => null)
  await start($)
  const ran = await $.command.run({ command: 'panda', args: 'examples' })
  expect(ran.text).toContain('Wrote 4 sample files')
  expect(ran.text).toContain('need Python 3')
})

test('another plugin running /panda cannot change settings, write samples or open files outside the working folder', async ($, on) => {
  begin(on)
  await start($)
  const origin = { kind: 'plugin', name: 'other' }
  const auto = await $.command.run({ command: 'panda', args: 'auto on', origin } as never)
  expect(auto.exitCode).toBe(1)
  const examples = await $.command.run({ command: 'panda', args: 'examples', origin } as never)
  expect(examples.exitCode).toBe(1)
  const outside = await $.command.run({ command: 'panda', args: '/etc/notes.md', origin } as never)
  expect(outside.exitCode).toBe(1)
})
