// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { isAbsolutePath, normalizePath } from '../hooks/model'
import { PANE, begin } from './setup'

type Engine = Parameters<Parameters<typeof test>[1]>[0]


/**
 * Windows answers paths with backslashes, as its file system does. (The test
 * kit runs on any system and may put its own folder before a `C:` path; that
 * is cut off, as Windows would not add it.)
 */
const windows = { realPath: (path: string) => path.replace(/^.*?(?=[A-Za-z]:[\\/])/, '').replace(/\//g, '\\') }

async function startIn($: Engine, cwd: string) {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
}

test('Windows paths are normalized: drive kept, forward slashes, dots resolved', async () => {
  expect(normalizePath('C:\\Users\\rocks\\proj\\..\\docs\\.\\plan.md')).toBe('C:/Users/rocks/docs/plan.md')
  expect(normalizePath('c:/Users/rocks/')).toBe('C:/Users/rocks')
  expect(normalizePath('C:\\')).toBe('C:/')
  expect(normalizePath('\\\\host\\share\\plan.md')).toBe('//host/share/plan.md')
  expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  expect(isAbsolutePath('C:\\x')).toBe(true)
  expect(isAbsolutePath('C:/x')).toBe(true)
  expect(isAbsolutePath('docs\\plan.md')).toBe(false)
})

test("on Windows, Claude's tools open files in the working folder only", async ($, on) => {
  begin(on, windows)
  on('fs.read', () => ({ value: '# Hi' }))
  await startIn($, 'C:\\Users\\rocks\\proj')
  const inside = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: 'notes\\plan.md' } })

  expect(inside.isError).toBeUndefined()
  expect(inside.text).toContain('Opened C:/Users/rocks/proj/notes/plan.md')
  const otherCase = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: 'c:\\users\\Rocks\\PROJ\\b.md' } })
  expect(otherCase.isError).toBeUndefined()
  const outside = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: 'C:\\Windows\\notes.md' } })
  expect(outside.isError).toBe(true)
  const climbing = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: '..\\other\\notes.md' } })
  expect(climbing.isError).toBe(true)
  const hidden = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: '.config\\settings.json' } })
  expect(hidden.isError).toBe(true)
  const typed = await $.command.run({ command: 'panda', args: '"C:\\Windows\\notes.md"' })
  expect(typed.exitCode).toBeUndefined()
})

test('on Windows, a file Claude wrote is the same file whichever slashes name it', async ($, on) => {
  begin(on, windows)
  on('fs.read', () => ({ value: '# Report' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok', text: 'ok' }))
  await startIn($, 'C:\\Users\\rocks\\proj')
  await $.tool.call({ tool: 'Write', input: { file_path: 'D:\\out\\report.md', content: '# Report' } })
  const ran = await $.tool.call({ tool: 'mcp__lazy-panda-panel__open_file', input: { path: 'D:/out/report.md' } })
  expect(ran.isError).toBeUndefined()
})

test('on Windows, the scan for new files is skipped at a drive root and in the home folder', async ($, on) => {
  let listed = 0
  begin(on, windows)
  on('fs.list', () => {
    listed += 1
    return { value: [] }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok', text: 'ok' }))
  for (const [cwd, scans] of [['C:\\Users\\rocks\\proj', 1], ['C:\\Users\\rocks', 0], ['C:\\', 0]] as const) {
    listed = 0
    await startIn($, cwd)
    await $.tool.call({ tool: 'Bash', input: { command: 'dir' } })
    expect(listed).toBe(scans)
  }
})

test('when /panda itself fails, it answers with what went wrong', async ($, on) => {
  begin(on, {
    exists: () => {
      throw new Error('disk on fire')
    },
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'panda', args: '/w/a.md' })
  expect(ran.exitCode).toBe(1)
  expect(ran.text).toContain('/panda /w/a.md failed')
})

test('typed paths: ~ is the home folder, and a path dragged in from a Mac terminal (My\\ Notes.md) opens', async ($, on) => {
  const asked: string[] = []
  begin(on, {
    exists: path => {
      asked.push(path)
      return path === '/home/u/notes.md' || path === '/home/u/proj/My Notes.md'
    },
  })
  on('fs.read', () => ({ value: '# Hi' }))
  await $.session.start({ cwd: '/home/u/proj', surface: 'terminal', isInteractive: true } as never)
  expect((await $.command.run({ command: 'panda', args: '~/notes.md' })).text).toBe('Lazy Panda Panel opened.')
  expect((await $.command.run({ command: 'panda', args: 'My\\ Notes.md' })).text).toBe('Lazy Panda Panel opened.')
})

test('on Windows, the same file written with different letter case is one tab', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: '# Report' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: 'ok', text: 'ok' }))
  await $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Write', input: { file_path: 'C:\\proj\\Report.md', content: '# Report' } })
  await $.tool.call({ tool: 'Write', input: { file_path: 'c:\\PROJ\\report.md', content: '# Report' } })
  await $.command.run({ command: 'panda', args: '' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const tabs = JSON.stringify(await ui.drawn({ in: 'file-tabs' }))
  expect(tabs.match(/report\.md/gi)?.length).toBe(1)
})
