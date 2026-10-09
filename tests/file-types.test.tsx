import { expect, test } from 'claude-code/testing'

import { begin, start } from './setup'

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
const DOCS: Record<string, unknown> = {
  "energy-proposal.docx": {
    "kind": "lines",
    "rows": [
      {
        "text": "Q1 Retail Energy Proposal",
        "anchor": "paragraph 1",
        "unit": "paragraph",
        "spans": [
          {
            "t": "Q1 Retail Energy Proposal"
          }
        ],
        "style": "h1"
      },
      {
        "text": "",
        "anchor": "paragraph 1",
        "style": "rule",
        "unit": "paragraph"
      },
      {
        "text": "",
        "anchor": "paragraph 1",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "Summary",
        "anchor": "paragraph 2",
        "unit": "paragraph",
        "spans": [
          {
            "t": "Summary"
          }
        ],
        "style": "h2"
      },
      {
        "text": "",
        "anchor": "paragraph 2",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "We propose a three-month pilot of the Green Saver Plan for 500 households in Western Sydney, funded by the state solar rebate.",
        "anchor": "paragraph 3 (under \"Summary\")",
        "unit": "paragraph",
        "spans": [
          {
            "t": "We propose a three-month pilot of the Green Saver Plan for 500 households in Western Sydney, funded by the state solar rebate."
          }
        ],
        "style": "p"
      },
      {
        "text": "",
        "anchor": "paragraph 3 (under \"Summary\")",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "Pricing",
        "anchor": "paragraph 4",
        "unit": "paragraph",
        "spans": [
          {
            "t": "Pricing"
          }
        ],
        "style": "h2"
      },
      {
        "text": "",
        "anchor": "paragraph 4",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "The plan charges 29.4c per kWh with a 98c daily supply charge. Customers with solar receive a 6c feed-in tariff.",
        "anchor": "paragraph 5 (under \"Pricing\")",
        "unit": "paragraph",
        "spans": [
          {
            "t": "The plan charges 29.4c per kWh with a 98c daily supply charge. Customers with solar receive a 6c feed-in tariff."
          }
        ],
        "style": "p"
      },
      {
        "text": "",
        "anchor": "paragraph 5 (under \"Pricing\")",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "A 5% pay-on-time discount applies to usage charges only.",
        "anchor": "paragraph 6 (under \"Pricing\")",
        "unit": "paragraph",
        "spans": [
          {
            "t": "A 5% pay-on-time discount applies to usage charges only."
          }
        ],
        "style": "p"
      },
      {
        "text": "",
        "anchor": "paragraph 6 (under \"Pricing\")",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "Item | Rate | Unit",
        "cells": [
          "Item",
          "Rate",
          "Unit"
        ],
        "isHeader": true,
        "anchor": "table 1, row 1",
        "unit": "table row"
      },
      {
        "text": "Usage | 29.4 | c/kWh",
        "cells": [
          "Usage",
          "29.4",
          "c/kWh"
        ],
        "isHeader": false,
        "anchor": "table 1, row 2",
        "unit": "table row"
      },
      {
        "text": "Supply | 98 | c/day",
        "cells": [
          "Supply",
          "98",
          "c/day"
        ],
        "isHeader": false,
        "anchor": "table 1, row 3",
        "unit": "table row"
      },
      {
        "text": "",
        "anchor": "table 1, row 3",
        "style": "space",
        "unit": "table row"
      },
      {
        "text": "Timeline",
        "anchor": "paragraph 7",
        "unit": "paragraph",
        "spans": [
          {
            "t": "Timeline"
          }
        ],
        "style": "h2"
      },
      {
        "text": "",
        "anchor": "paragraph 7",
        "style": "space",
        "unit": "paragraph"
      },
      {
        "text": "Recruitment runs in January, installs in February and the first bills go out in March.",
        "anchor": "paragraph 8 (under \"Timeline\")",
        "unit": "paragraph",
        "spans": [
          {
            "t": "Recruitment runs in January, installs in February and the first bills go out in March."
          }
        ],
        "style": "p"
      }
    ],
    "isFormatted": true
  },
  "customer-letter.pdf": {
    "kind": "lines",
    "rows": [
      {
        "text": "── Page 1 ──",
        "anchor": "page 1",
        "style": "heading",
        "unit": "page"
      },
      {
        "text": "8 October 2026",
        "anchor": "page 1, line 1",
        "style": null,
        "unit": "line"
      },
      {
        "text": "Dear Ms Nguyen,",
        "anchor": "page 1, line 2",
        "style": null,
        "unit": "line"
      },
      {
        "text": "Thank you for joining the Green Saver Plan. Your switch will complete on your next meter read,",
        "anchor": "page 1, line 3",
        "style": null,
        "unit": "line"
      },
      {
        "text": "usually within 10 business days.",
        "anchor": "page 1, line 4",
        "style": null,
        "unit": "line"
      },
      {
        "text": "Your new rate is 29.4c per kWh with a daily supply charge of 98c. Because you have solar",
        "anchor": "page 1, line 5",
        "style": null,
        "unit": "line"
      },
      {
        "text": "panels, you will also receive 6c per kWh for energy you export to the grid.",
        "anchor": "page 1, line 6",
        "style": null,
        "unit": "line"
      },
      {
        "text": "If you pay on time, a further 5% discount applies to your usage charges.",
        "anchor": "page 1, line 7",
        "style": null,
        "unit": "line"
      },
      {
        "text": "Kind regards,",
        "anchor": "page 1, line 8",
        "style": null,
        "unit": "line"
      },
      {
        "text": "The Customer Team",
        "anchor": "page 1, line 9",
        "style": null,
        "unit": "line"
      }
    ]
  }
}
/** The smallest PNG the pane will take: signature, an 800 × 560 header, and the end. The pane reads only the size. */
const PNG = btoa(
  String.fromCharCode(
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // signature
    ...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], // IHDR, 13 bytes
    ...[0, 0, 0x03, 0x20, 0, 0, 0x02, 0x30, 8, 2, 0, 0, 0], // 800 × 560, 8-bit RGB
    ...[0xf1, 0xb3, 0x98, 0x10], // its CRC
    ...[0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], // IEND
  ),
)

const PANE = { component: 'Pane', requestId: 'review', props: { title: 'Review', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

/** Which visual row to click in each file, and what the comment must then name. */
const CASES: [string, number, RegExp, RegExp][] = [
  ['launch-plan.md', 3, /line 3/, /Goal: sign up 500 households/],
  ['project-update.adf', 3, /content\[1\]/, /Owner: @Priya Shah/],
  ['pricing-page.html', 3, /<p> at line \d+/, /100% renewable electricity/],
  ['energy-proposal.docx', 5, /paragraph 3 \(under "Summary"\)/, /three-month pilot/],
  ['customer-letter.pdf', 2, /page 1, line 2/, /Dear Ms Nguyen/],
]

for (const [name, row, label, quote] of CASES) {
  test(`${name}: open, select, comment, send`, async ($, on) => {
    let filled = ''
    begin(on)
    on('fs.read', () => ({ value: TEXTS[name] ?? '' }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(DOCS[name] ?? {}), stderr: '' } }))
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
    expect(filled).toContain(`/w/${name}`)
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
  expect(await ui.find({ type: 'Image', key: 'png' })).toBeDefined()
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
