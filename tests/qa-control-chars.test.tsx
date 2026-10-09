// QA: control characters in documents must not make the viewer refuse its tree.
import { expect, test } from 'claude-code/testing'

import { begin, start } from './setup'

const PANE = { component: 'Pane', requestId: 'review', props: { title: 'Review', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

const CASES: [string, string][] = [
  ['/w/ansi.txt', 'build ok\n\u001b[31mERROR\u001b[0m red text\n'],
  ['/w/ansi.log.txt', 'plain\u001b[2Jclear'],
  ['/w/nul.txt', 'a\u0000b\nnext'],
  ['/w/cr.txt', 'old mac\rline endings\rhere'],
  ['/w/tab.md', '```\n\tindented with tab\n```\n\nText\twith\ttabs'],
  ['/w/tab.html', '<pre>\tcode\twith tabs</pre><p>a\tb</p>'],
  ['/w/bell.csv', 'a,b\n1,\u0007'],
  ['/w/ansi.md', '# Log\n\n\u001b[32mgreen\u001b[0m'],
]

for (const [path, text] of CASES) {
  test(`control characters: ${path} draws`, async ($, on) => {
    begin(on)
    on('fs.read', () => ({ value: text }))
    await start($)
    await $.command.run({ command: 'panda', args: path })
    let error = ''
    try {
      const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
      await ui.drawn()
    } catch (e) {
      error = String(e).slice(0, 160)
    }
    if (error) console.log(`${path}: ${error}`)
    expect(error).toBe('')
  })
}

test('control characters: a grid cell with a tab / CR / ESC draws', async ($, on) => {
  begin(on)
  const doc = { kind: 'grid', sheets: [{ name: 'S', cols: ['A', 'B'], rows: [[{ v: 'H' }, { v: 'I' }], [{ v: 'a\tb' }, { v: 'c\r\nd' }], [{ v: 'x\u001b[1my' }, { v: 'z' }]], isCut: false }] }
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(doc), stderr: '' } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/c.xlsx' })
  let error = ''
  try {
    const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
    await ui.drawn()
  } catch (e) {
    error = String(e).slice(0, 160)
  }
  if (error) console.log(`grid: ${error}`)
  expect(error).toBe('')
})
