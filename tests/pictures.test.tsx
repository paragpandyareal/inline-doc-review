// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { EMF, base64, docx, pdf, png } from './office'
import { PANE, begin, start } from './setup'

/** A picture worth seeing: red on the left half, blue on the right. */
const halves = (x: number) => (x < 20 ? 0xdd2222 : 0x2244dd)
const CHART = png(40, 24, halves)

const open = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], name: string, bytes: Uint8Array, env = terminal({ isSharp: true })) => {
  begin(on, { env })
  on('fs.read', () => ({ value: { base64: base64(bytes) } }))
  await start($)
  await $.command.run({ command: 'panda', args: `/w/${name}` })
  return $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
}

/** A terminal that draws real pictures (kitty) or not, on the person's own computer with a desktop, or over SSH. */
const terminal = (how: { isSharp?: boolean; isLocal?: boolean }) => ({
  TERM: how.isSharp ? 'xterm-kitty' : 'xterm-256color',
  TERM_PROGRAM: undefined,
  SSH_CONNECTION: how.isLocal ? undefined : '1.2.3.4 22',
  SSH_TTY: undefined,
  DISPLAY: ':0',
})

/** The colours an Image's pixels hold. */
const coloursOf = (rgba: string) => {
  const bytes = Uint8Array.from(atob(rgba), ch => ch.charCodeAt(0))
  const out = new Set<number>()
  for (let k = 0; k < bytes.length; k += 4) out.add((bytes[k]! << 16) | (bytes[k + 1]! << 8) | bytes[k + 2]!)
  return out
}
type ImageNode = { props: { source: { rgba: string }; columns: number; rows: number } }

test('a picture in a Word document has a row of its own; selecting it draws it sharp where the terminal can', async ($, on) => {
  let filled = ''
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  const ui = await open($, on, 'report.docx', docx([{ picture: CHART, alt: 'Network map' }, { p: 'The map shows the new feeders.' }]))
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('▣ Picture 1: Network map')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  const image = await ui.find({ type: 'Image', key: 'picture' })
  expect(image).toBeDefined()
  // Red and blue, as in the picture.
  expect(coloursOf((image as unknown as ImageNode).props.source.rgba)).toEqual(new Set([0xdd2222, 0x2244dd]))
  expect(await ui.find({ type: 'Text', text: /Picture 1: Network map · 40 × 24 px/ })).toBeDefined()
  await ui.input({ key: 'comment-0', text: 'Make the labels bigger' })
  await ui.press({ key: 'fill' })
  expect(filled).toContain('paragraph 1, picture 1')
  expect(filled).toContain('Picture 1: Network map')
})

test('in other terminals a picture is a card, never a blur; over SSH it says where to see it', async ($, on) => {
  const ui = await open($, on, 'report.docx', docx([{ picture: CHART, alt: 'Network map' }]), terminal({ isSharp: false }))
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /isn’t drawn here: this terminal can’t show pictures sharply \(kitty and Ghostty can\)\. Open the file in Word on your computer to see it\./ })).toBeDefined()
  expect(await ui.find({ key: 'open-outside' })).toBeUndefined()
})

test('on the person’s own computer, the card opens the file in its usual app', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...(e as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  const ui = await open($, on, 'report.docx', docx([{ picture: CHART }]), terminal({ isSharp: false, isLocal: true }))
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  await ui.press({ key: 'open-outside' })
  // The test kit says every file exists, so this machine looks like a Mac: \`open\`, as Finder would.
  expect(runs).toEqual([['open', '/w/report.docx']])
})

test('a picture the pane cannot draw says so plainly, with what it is and where to see it', async ($, on) => {
  const ui = await open($, on, 'diagram.docx', docx([{ picture: EMF, ext: 'emf' }]))
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Picture 1 can’t be shown: it is an EMF drawing, which the pane can’t draw\. Open the file in Word on your computer to see it\./ })).toBeDefined()
})

test('a picture in a PDF is a row where it is drawn, and selecting it draws it', async ($, on) => {
  const ui = await open($, on, 'notice.pdf', pdf([['Your new meter']], { width: 40, height: 24, rgb: halves }))
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('▣ Picture 1')
  // Page 1, its line, then the picture.
  await ui.post({ type: 'select', a: [2, 0], b: [2, 0] }, { in: 'viewer' })
  const image = await ui.find({ type: 'Image', key: 'picture' })
  expect(image).toBeDefined()
  expect(coloursOf((image as unknown as ImageNode).props.source.rgba)).toEqual(new Set([0xdd2222, 0x2244dd]))
})

test('a document with pictures says how to see them', async ($, on) => {
  const ui = await open($, on, 'report.docx', docx([{ p: 'Intro' }, { picture: CHART }]))
  expect(await ui.find({ type: 'Text', text: /click to see a picture/ })).toBeDefined()
})

test('on the desktop app, a selected picture is a card', async ($, on) => {
  begin(on, { env: terminal({ isSharp: true }) })
  on('fs.read', () => ({ value: { base64: base64(docx([{ picture: CHART }])) } }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/report.docx' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'desktop', ...PANE })
  await ui.post({ type: 'select', a: [0, 0], b: [0, 0] }, { in: 'viewer' })
  expect(await ui.find({ type: 'Text', text: /isn’t drawn here/ })).toBeDefined()
})

test('Markdown: a picture beside the file is shown; one on the web is not downloaded, and says so', async ($, on) => {
  const md = '# Plan\n\nThe rollout map:\n\n![Rollout map](maps/rollout.png)\n\n![Logo](https://example.com/logo.png)\n'
  const reads: string[] = []
  begin(on, { env: terminal({ isSharp: true }) })
  on('fs.read', (_, e) => {
    const path = (e as { path: string }).path
    reads.push(path)
    return { value: path.endsWith('.png') ? { base64: base64(CHART) } : md }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/plan.md' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await ui.drawn({ in: 'viewer' }))
  expect(drawn).toContain('▣ Picture 1: Rollout map')
  expect(drawn).toContain('▣ Picture 2: Logo')
  const rowOf = async (text: string) => {
    for (let r = 0; r < 12; r += 1) {
      await ui.post({ type: 'select', a: [r, 0], b: [r, 0] }, { in: 'viewer' })
      if (await ui.find({ type: 'Text', text: new RegExp(text) })) return r
    }
    return -1
  }
  expect(await rowOf('Picture 1')).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Image', key: 'picture' })).toBeDefined()
  expect(reads).toContain('/w/maps/rollout.png')
  expect(await rowOf('Picture 2')).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /it is on the web, and the pane never downloads anything/ })).toBeDefined()
  expect(reads.some(path => path.includes('example.com'))).toBe(false)
})

test('HTML: a picture written into the page (data:) is shown', async ($, on) => {
  const html = `<html><body><h1>Pricing</h1><p>Our plans <img alt="Plan chart" src="data:image/png;base64,${base64(CHART)}"></p></body></html>`
  begin(on, { env: terminal({ isSharp: true }) })
  on('fs.read', () => ({ value: html }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/pricing.html' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await ui.drawn({ in: 'viewer' }))).toContain('▣ Picture 1: Plan chart')
  for (let r = 0; r < 8 && !(await ui.find({ type: 'Image' })); r += 1) await ui.post({ type: 'select', a: [r, 0], b: [r, 0] }, { in: 'viewer' })
  expect(await ui.find({ type: 'Image', key: 'picture' })).toBeDefined()
})
