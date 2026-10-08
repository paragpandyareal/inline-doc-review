import { mock, test } from 'claude-code/testing'

const FILES: Record<string, string> = {"launch-plan.md": "# Solar Rebate Launch Plan\n\n**Goal:** sign up *500 households* to the solar rebate pilot by the end of Q1.\n\n> [!NOTE]\n> This plan is reviewed by the steering group every second Monday.\n\n## Audience\n\nHomeowners in Western Sydney with south-facing roofs and quarterly bills over $600.\n\n## Channels\n\n- Letterbox drop to 12,000 homes in Penrith and Blacktown\n- Facebook ads targeting 30\u201365 year-old homeowners\n  - Lookalike audience from current customers\n- Two community info nights at local libraries\n\n## Budget\n\n| Channel | Share | Amount |\n|---|---|---|\n| Ads | 50% | $24,000 |\n| Print | 30% | $14,400 |\n| Events | 20% | $9,600 |\n\n## Next steps\n\n1. Lock in library dates\n2. Brief the print vendor\n3. Launch ads on **3 February**\n\n> [!WARNING]\n> Installer capacity may cap sign-ups at around 350 if demand comes in early.\n", "project-update.adf": "{\"version\":1,\"type\":\"doc\",\"content\":[\n{\"type\":\"heading\",\"attrs\":{\"level\":1},\"content\":[{\"type\":\"text\",\"text\":\"Solar Rebate Pilot \u2013 Project Update\"}]},\n{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Owner: \"},{\"type\":\"mention\",\"attrs\":{\"id\":\"1\",\"text\":\"@Priya Shah\"}},{\"type\":\"text\",\"text\":\" \u00b7 Status: \"},{\"type\":\"status\",\"attrs\":{\"text\":\"On track\",\"color\":\"green\"}},{\"type\":\"text\",\"text\":\" \u00b7 Updated \"},{\"type\":\"date\",\"attrs\":{\"timestamp\":\"1791504000000\"}}]},\n{\"type\":\"panel\",\"attrs\":{\"panelType\":\"info\"},\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"This page is published to Confluence from the \"},{\"type\":\"text\",\"text\":\"pilot-budget.xlsx\",\"marks\":[{\"type\":\"code\"}]},{\"type\":\"text\",\"text\":\" workbook every Friday.\"}]}]},\n{\"type\":\"heading\",\"attrs\":{\"level\":2},\"content\":[{\"type\":\"text\",\"text\":\"Highlights\"}]},\n{\"type\":\"bulletList\",\"content\":[\n {\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"137 households signed\",\"marks\":[{\"type\":\"strong\"}]},{\"type\":\"text\",\"text\":\" in the first three weeks (target 500).\"}]}]},\n {\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Penrith is converting best at 32%.\"}]},{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Letterbox drop drove most enquiries.\"}]}]}]}]},\n {\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Read the \"},{\"type\":\"text\",\"text\":\"installer agreement\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com/agreement\"}}]},{\"type\":\"text\",\"text\":\" before the next steering meeting.\"}]}]}]},\n{\"type\":\"heading\",\"attrs\":{\"level\":2},\"content\":[{\"type\":\"text\",\"text\":\"Sign-ups by suburb\"}]},\n{\"type\":\"table\",\"content\":[\n {\"type\":\"tableRow\",\"content\":[{\"type\":\"tableHeader\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Suburb\"}]}]},{\"type\":\"tableHeader\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Target\"}]}]},{\"type\":\"tableHeader\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Signed\"}]}]}]},\n {\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Penrith\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"200\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"64\"}]}]}]},\n {\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Blacktown\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"180\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"51\"}]}]}]},\n {\"type\":\"tableRow\",\"content\":[{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Mount Druitt\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"120\"}]}]},{\"type\":\"tableCell\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"22\"}]}]}]}]},\n{\"type\":\"panel\",\"attrs\":{\"panelType\":\"warning\"},\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Installer capacity may cap sign-ups at around \"},{\"type\":\"text\",\"text\":\"350\",\"marks\":[{\"type\":\"strong\"}]},{\"type\":\"text\",\"text\":\" if demand stays this high.\"}]}]},\n{\"type\":\"heading\",\"attrs\":{\"level\":2},\"content\":[{\"type\":\"text\",\"text\":\"Next steps\"}]},\n{\"type\":\"taskList\",\"attrs\":{\"localId\":\"t1\"},\"content\":[\n {\"type\":\"taskItem\",\"attrs\":{\"localId\":\"a\",\"state\":\"DONE\"},\"content\":[{\"type\":\"text\",\"text\":\"Confirm the Blacktown info night venue\"}]},\n {\"type\":\"taskItem\",\"attrs\":{\"localId\":\"b\",\"state\":\"TODO\"},\"content\":[{\"type\":\"text\",\"text\":\"Approve the extra $5,000 installer bonus\"}]},\n {\"type\":\"taskItem\",\"attrs\":{\"localId\":\"c\",\"state\":\"TODO\"},\"content\":[{\"type\":\"text\",\"text\":\"Send the March newsletter\"}]}]}\n]}\n", "pricing-page.html": "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>Green Saver Plan</title>\n  <style>\n    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; color: #1d2b36; }\n    h1 { color: #0b6e4f; }\n    .price { font-size: 2.5rem; font-weight: 700; }\n    .cta { background: #0b6e4f; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; }\n  </style>\n</head>\n<body>\n  <h1>Green Saver Plan</h1>\n  <p>100% renewable electricity with no lock-in contract.</p>\n  <p class=\"price\">29.4c / kWh</p>\n  <ul>\n    <li>Daily supply charge: 98c</li>\n    <li>Solar feed-in: 6c / kWh</li>\n    <li>Pay-on-time discount: 5%</li>\n  </ul>\n  <a class=\"cta\" href=\"#signup\">Switch in 5 minutes</a>\n</body>\n</html>\n"}

const PANE = { component: 'Pane', requestId: 'review', props: { title: 'Review', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const

type Node = { type?: string; children?: unknown; props?: { flexDirection?: string } }
function lines(node: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown): string => {
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (!n || typeof n !== 'object') return ''
    const e = n as Node
    const kids = e.children ?? []
    const list = Array.isArray(kids) ? kids : [kids]
    if (e.type === 'Box' && e.props?.flexDirection === 'column') {
      for (const k of list) {
        const t = walk(k)
        if (t !== '') out.push(t)
      }
      return ''
    }
    return list.map(walk).join('')
  }
  walk(node)
  return out
}

for (const name of Object.keys(FILES)) {
  test(`dump ${name}`, async ($, on) => {
    mock.store(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: FILES[name] ?? '' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.command.run({ command: 'inline-review', args: `/w/${name}` })
    const ui = await $.ui.mount({ plugin: 'inline-doc-review', surface: 'terminal', ...PANE })
    const NL = String.fromCharCode(10)
    console.log(['==== ' + name, ...lines(await ui.drawn({ in: 'viewer' }))].join(NL))
  })
}
