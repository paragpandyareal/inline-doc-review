// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel
import { expect, test } from 'claude-code/testing'

import { begin, start } from './setup'
import { base64, docx, pdf, png } from './office'

/** Every file type: it opens, a part of it is selected, a comment names that part, and it reaches Claude. */

const TEXTS: Record<string, string> = {
  'launch-plan.md': `# Solar Rebate Launch Plan

**Goal:** sign up *500 households* to the solar rebate pilot by the end of Q1.

> [!NOTE]
> This plan is reviewed by the steering group every second Monday.

## Audience

Homeowners in Western Sydney with south-facing roofs and quarterly bills over $600.

## Channels

- Letterbox drop to 12,000 homes in Penrith and Blacktown
- Facebook ads targeting 30–65 year-old homeowners
  - Lookalike audience from current customers
- Two community info nights at local libraries

## Budget

| Channel | Share | Amount |
|---|---|---|
| Ads | 50% | $24,000 |
| Print | 30% | $14,400 |
| Events | 20% | $9,600 |

## Next steps

1. Lock in library dates
2. Brief the print vendor
3. Launch ads on **3 February**

> [!WARNING]
> Installer capacity may cap sign-ups at around 350 if demand comes in early.
`,
  'project-update.adf': `{"version":1,"type":"doc","content":[
{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Solar Rebate Pilot – Project Update"}]},
{"type":"paragraph","content":[{"type":"text","text":"Owner: "},{"type":"mention","attrs":{"id":"1","text":"@Priya Shah"}},{"type":"text","text":" · Status: "},{"type":"status","attrs":{"text":"On track","color":"green"}},{"type":"text","text":" · Updated "},{"type":"date","attrs":{"timestamp":"1791504000000"}}]},
{"type":"panel","attrs":{"panelType":"info"},"content":[{"type":"paragraph","content":[{"type":"text","text":"This page is published to Confluence from the "},{"type":"text","text":"pilot-budget.xlsx","marks":[{"type":"code"}]},{"type":"text","text":" workbook every Friday."}]}]},
{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Highlights"}]},
{"type":"bulletList","content":[
 {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"137 households signed","marks":[{"type":"strong"}]},{"type":"text","text":" in the first three weeks (target 500)."}]}]},
 {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Penrith is converting best at 32%."}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Letterbox drop drove most enquiries."}]}]}]}]},
 {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Read the "},{"type":"text","text":"installer agreement","marks":[{"type":"link","attrs":{"href":"https://example.com/agreement"}}]},{"type":"text","text":" before the next steering meeting."}]}]}]},
{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Sign-ups by suburb"}]},
{"type":"table","content":[
 {"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Suburb"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Target"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Signed"}]}]}]},
 {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Penrith"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"200"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"64"}]}]}]},
 {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Blacktown"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"180"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"51"}]}]}]},
 {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Mount Druitt"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"120"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"22"}]}]}]}]},
{"type":"panel","attrs":{"panelType":"warning"},"content":[{"type":"paragraph","content":[{"type":"text","text":"Installer capacity may cap sign-ups at around "},{"type":"text","text":"350","marks":[{"type":"strong"}]},{"type":"text","text":" if demand stays this high."}]}]},
{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Next steps"}]},
{"type":"taskList","attrs":{"localId":"t1"},"content":[
 {"type":"taskItem","attrs":{"localId":"a","state":"DONE"},"content":[{"type":"text","text":"Confirm the Blacktown info night venue"}]},
 {"type":"taskItem","attrs":{"localId":"b","state":"TODO"},"content":[{"type":"text","text":"Approve the extra $5,000 installer bonus"}]},
 {"type":"taskItem","attrs":{"localId":"c","state":"TODO"},"content":[{"type":"text","text":"Send the March newsletter"}]}]}
]}
`,
  'pricing-page.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Green Saver Plan</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; color: #1d2b36; }
    h1 { color: #0b6e4f; }
    .price { font-size: 2.5rem; font-weight: 700; }
    .cta { background: #0b6e4f; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Green Saver Plan</h1>
  <p>100% renewable electricity with no lock-in contract.</p>
  <p class="price">29.4c / kWh</p>
  <ul>
    <li>Daily supply charge: 98c</li>
    <li>Solar feed-in: 6c / kWh</li>
    <li>Pay-on-time discount: 5%</li>
  </ul>
  <a class="cta" href="#signup">Switch in 5 minutes</a>
</body>
</html>
`,
}
/** The Word and PDF samples, built as real files. */
const BINARIES: Record<string, string> = {
  'energy-proposal.docx': base64(
    docx([
      { p: 'Q1 Retail Energy Proposal', style: 'Title' },
      { p: 'Summary', style: 'Heading1' },
      { p: 'We propose a three-month pilot of the Green Saver Plan for 500 households in Western Sydney, funded by the state solar rebate.' },
      { p: 'Pricing', style: 'Heading1' },
      { p: 'The plan charges 29.4c per kWh with a 98c daily supply charge.' },
      { table: [['Item', 'Rate', 'Unit'], ['Usage', '29.4', 'c/kWh'], ['Supply', '98', 'c/day']] },
      { p: 'Timeline', style: 'Heading1' },
      { p: 'Recruitment in January', style: 'ListBullet' },
      { p: 'Installs in February', style: 'ListBullet' },
    ]),
  ),
  'customer-letter.pdf': base64(
    pdf([
      ['8 October 2026', 'Dear Ms Nguyen,', 'Thank you for joining the Green Saver Plan.', 'Your switch will complete on your next meter read.'],
      ['Your new rate is 29.4c per kWh.', 'Kind regards, the Green Saver team'],
    ]),
  ),
}

/** A small 800 × 560 picture. */
const PNG = base64(png(800, 560, x => (x < 400 ? 0x1188ee : 0xffcc00)))

const PANE = { component: 'Pane', requestId: 'review', props: { title: 'Review', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

/** Which visual row to click in each file, and what the comment must then name. */
const CASES: [string, number, RegExp, RegExp][] = [
  ['launch-plan.md', 3, /line 3/, /Goal: sign up 500 households/],
  ['project-update.adf', 3, /content\[1\]/, /Owner: ＠Priya Shah/],
  ['pricing-page.html', 3, /<p> at line \d+/, /100% renewable electricity/],
  ['energy-proposal.docx', 5, /paragraph 3 \(under "Summary"\)/, /three-month pilot/],
  ['customer-letter.pdf', 2, /page 1, line 2/, /Dear Ms Nguyen/],
]

for (const [name, row, label, quote] of CASES) {
  test(`${name}: open, select, comment, send`, async ($, on) => {
    let filled = ''
    begin(on)
    on('fs.read', () => ({ value: BINARIES[name] ? { base64: BINARIES[name] } : (TEXTS[name] ?? '') }))
    on('prompt.fill', (_, e) => {
      filled = e.text
      return { isFilled: true }
    })
    await start($)
    await $.command.run({ command: 'panda', args: `/w/${name}` })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface, ...PANE })
      expect(await ui.drawn({ in: 'viewer' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
    await ui.pointer({ type: 'down', x: 6, y: row, button: 'left', in: 'viewer' })
    await ui.pointer({ type: 'up', x: 6, y: row, button: 'left', in: 'viewer' })
    await ui.input({ key: 'comment-0', text: 'Please reword this' })
    await ui.press({ key: 'fill' })
    expect(filled).toContain(`> ${name}: `)
    expect(filled).toMatch(label)
    expect(filled).toMatch(quote)
    expect(filled).toContain('Feedback: Please reword this')
  })
}

test('a PNG: shows the picture, and a comment applies to the whole image', async ($, on) => {
  let filled = ''
  begin(on)
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await start($)
  await $.command.run({ command: 'panda', args: '/w/picture.png' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  // A card in a terminal that can't draw pictures sharply, never a blur of blocks.
  expect(await ui.find({ type: 'Text', text: /isn’t drawn here/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /800 × 560 px/ })).toBeDefined()
  await ui.input({ key: 'comment-0', text: 'Make the button bigger' })
  await ui.press({ key: 'fill' })
  expect(filled).toContain('the whole image')
  expect(filled).toContain('Feedback: Make the button bigger')
})

test('Markdown, HTML and ADF switch to their source and back', async ($, on) => {
  begin(on)
  on('fs.read', () => ({ value: TEXTS['launch-plan.md'] ?? '' }))
  await start($)
  await $.command.run({ command: 'panda', args: '/w/launch-plan.md' })
  const ui = await $.ui.mount({ plugin: 'lazy-panda-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /## Audience/, in: 'viewer' })).toBeUndefined()
  await ui.post({ type: 'aside', id: 'source' }, { in: 'file-tabs' })
  expect(await ui.find({ type: 'Text', text: /## Audience/, in: 'viewer' })).toBeDefined()
  await ui.post({ type: 'aside', id: 'source' }, { in: 'file-tabs' })
  expect(await ui.find({ type: 'Text', text: /## Audience/, in: 'viewer' })).toBeUndefined()
})
