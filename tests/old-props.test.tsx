import { expect, test } from 'claude-code/testing'

import Tabs from '../hooks/tabs'
import Viewer from '../hooks/viewer'

/**
 * The views are read from disk when drawn, while the main module reloads
 * between turns: for a moment a new view can get an older main module's
 * props. They must draw, not throw.
 */

const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
const surface = () => {
  let state: unknown
  return {
    elements: { Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input'), Select: element('Select'), Link: element('Link'), Code: element('Code'), Markdown: element('Markdown') },
    get state() {
      return state
    },
    setState: (next: unknown) => {
      state = next
    },
    columns: 80,
    rows: 20,
    every: () => () => {},
    onPointer: () => () => {},
    onKey: () => () => {},
    post: () => {},
  }
}

test('tabs draw without colours (props from before 0.3)', () => {
  const old = { group: 'files', labels: ['a.md', 'b.md'], active: 0, accent: 'claude' }
  expect(() => (Tabs as unknown as (p: unknown, s: unknown) => unknown)(old, surface())).not.toThrow()
})

test('the viewer draws without a palette (props from before 0.3)', () => {
  const lines = { mode: 'lines', rows: [{ n: '1', t: 'hello', src: 0 }], gutter: 2, width: 40 }
  const grid = { mode: 'grid', letters: ['A'], widths: [5], gutter: 3, left: 0, rows: [{ r: 1, n: '2', cells: ['1'] }] }
  const draw = Viewer as unknown as (p: unknown, s: unknown) => unknown
  expect(() => draw(lines, surface())).not.toThrow()
  expect(() => draw(grid, surface())).not.toThrow()
})
