import { mock } from 'claude-code/testing'
import type { test } from 'claude-code/testing'

type Body = Parameters<typeof test>[1]
type Engine = Parameters<Body>[0]
type On = Parameters<Body>[1]

/** The review pane as a dock 80 columns wide and 30 rows tall. */
export const PANE = {
  component: 'Pane',
  requestId: 'review',
  props: {
    title: 'Review',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/**
 * What the pane needs from the engine: a store, a clock, and a disk where
 * every file exists, is 100 bytes, and has the modification time
 * `mtime(path)` gives (1000 unless a test changes it). A test registers its
 * own mocks after this, then calls start().
 */
export function begin(
  on: On,
  options: { mtime?: (path: string) => number; size?: number; exists?: (path: string) => boolean; isGone?: () => boolean; box?: string; realPath?: (path: string) => string } = {},
) {
  mock.store(on)
  mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/u' }))
  on('config.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: options.box ?? '', cursor: 0 } }))
  on('fs.exists', (_, e) => ({ value: options.exists?.((e as { path: string }).path) ?? true }))
  on('fs.stat', (_, e) => {
    const path = (e as { path: string }).path
    if (options.isGone?.()) throw new Error(`ENOENT: ${path}`)
    return { value: { kind: 'file', size: options.size ?? 100, mtimeMs: options.mtime?.(path) ?? 1000, isLink: false, realPath: options.realPath?.(path) ?? path } }
  })
}

/** Starts the session in `/w`, the working folder. */
export async function start($: Engine) {
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
}
