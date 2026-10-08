// QA: Markdown / HTML / ADF readers on malformed and edge-case input.
// Each test asserts the EXPECTED behaviour; a failing test marks a bug.
import { expect, test } from 'claude-code/testing'
import { adfRows } from '../hooks/adf'
import { htmlRows } from '../hooks/html'
import { markdownRows } from '../hooks/md'

const show = (label: string, rows: { text: string; anchor: string; style?: unknown }[]) =>
  console.log(`---- ${label}\n` + rows.map(r => `  [${String(r.style)}] ${JSON.stringify(r.text)}  @ ${r.anchor}`).join('\n'))

// ---------- HTML ----------
test('HTML: two paragraphs on one (minified) line get distinct anchors', () => {
  const rows = htmlRows('<html><body><h1>T</h1><p>First para</p><p>Second para</p><ul><li>a</li><li>b</li></ul></body></html>')
  show('minified html', rows)
  const p = rows.filter(r => r.style === 'p' || r.style === 'li')
  expect(new Set(p.map(r => r.anchor)).size).toBe(p.length)
})

test('HTML: an out-of-range numeric entity does not make the whole page fail', () => {
  let ok = true
  try {
    htmlRows('<p>Bad &#x110000; and &#99999999; entity</p><p>next</p>')
  } catch (e) {
    console.log('threw:', String(e))
    ok = false
  }
  expect(ok).toBe(true)
})

test('HTML: common named entities decode (&euro; &times; &rarr; &trade;)', () => {
  const rows = htmlRows('<p>5&euro; &times; 2 &rarr; 10&trade;</p>')
  show('entities', rows)
  expect(rows[0]?.text).toBe('5€ × 2 → 10™')
})

test('HTML: a table without <th> after one with <th> is not given a header row', () => {
  const rows = htmlRows('<table><tr><th>H</th></tr><tr><td>1</td></tr></table>\n<table><tr><td>plain1</td></tr><tr><td>plain2</td></tr></table>')
  show('two tables', rows)
  const plain1 = rows.find(r => r.text.includes('plain1'))
  expect(plain1?.style).toBe('td')
})

test('HTML: scripts, styles and comments are hidden; text after them survives', () => {
  const rows = htmlRows('<body><style>p{color:red}</style><script>var a="<p>x</p>"</script><!-- <p>hidden</p> --><p>Visible</p></body>')
  show('script/style/comment', rows)
  expect(rows.map(r => r.text)).toEqual(['Visible'])
})

test('HTML: an attribute containing ">" does not leak into the text', () => {
  const rows = htmlRows('<p><a title="a>b" href="#">link</a> text</p>')
  show('attr with >', rows)
  expect(rows[0]?.text).toBe('link text')
})

test('HTML: a page with an unclosed <head> and no <body> still shows its content', () => {
  const rows = htmlRows('<html><head><title>T</title>\n<h1>Hello</h1><p>World</p>')
  show('unclosed head', rows)
  expect(rows.some(r => r.text === 'World')).toBe(true)
})

test('HTML: performance on a 1 MB page (one tag per line)', () => {
  const parts: string[] = ['<body>']
  for (let i = 0; i < 20000; i += 1) parts.push(`<p>Paragraph number ${i} with some words.</p>`)
  const src = parts.join('\n')
  const t0 = Date.now()
  const rows = htmlRows(src)
  const ms = Date.now() - t0
  console.log(`html ${src.length} chars -> ${rows.length} rows in ${ms} ms`)
  expect(ms).toBeLessThan(2000)
})

// ---------- Markdown ----------
test('Markdown: snake_case identifiers are not turned into italics', () => {
  const rows = markdownRows('Set my_var_name and other_value here.')
  show('snake_case', rows)
  expect(rows[0]?.text).toBe('Set my_var_name and other_value here.')
})

test('Markdown: "# C#" heading keeps its trailing #', () => {
  const rows = markdownRows('# Learn C#\n\ntext')
  show('C#', rows)
  expect(rows[0]?.text).toBe('Learn C#')
})

test('Markdown: a table whose delimiter uses single dashes (|:-|-:|) is not shown as a data row', () => {
  const rows = markdownRows('| a | b |\n|:-|-:|\n| 1 | 2 |')
  show('single-dash delimiter', rows)
  expect(rows.some(r => r.text.includes(':-'))).toBe(false)
})

test('Markdown: a pipe table without leading pipes is a table', () => {
  const rows = markdownRows('a | b\n--|--\n1 | 2')
  show('no leading pipe', rows)
  expect(rows.some(r => r.style === 'th' || r.style === 'td')).toBe(true)
})

test('Markdown: uneven table columns are padded, anchors point at the right source lines', () => {
  const rows = markdownRows('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |')
  show('uneven table', rows)
  const tds = rows.filter(r => r.style === 'td')
  expect(tds[0]?.anchor).toBe('line 3')
  expect(tds[1]?.anchor).toBe('line 4')
})

test('Markdown: an unclosed code fence shows the rest as code without crashing', () => {
  const rows = markdownRows('Intro\n\n```js\nconst a = 1\n# not a heading')
  show('unclosed fence', rows)
  expect(rows.filter(r => r.style === 'code').length).toBe(2)
})

test('Markdown: a ```lang line inside a fence does not close it', () => {
  const rows = markdownRows('````md\n```js\ninner\n```\n````\nafter')
  show('nested fence', rows)
  expect(rows.find(r => r.text === 'after')?.style).toBe('p')
  expect(rows.filter(r => r.style === 'code').map(r => r.text)).toEqual(['```js', 'inner', '```'])
})

test('Markdown: 4-space nested lists nest one level, not two', () => {
  const rows = markdownRows('- top\n    - child\n        - grandchild')
  show('4-space nesting', rows)
  expect(rows.map(r => r.indent)).toEqual([0, 1, 2])
})

test('Markdown: setext heading is a heading', () => {
  const rows = markdownRows('Title\n=====\n\nBody')
  show('setext', rows)
  expect(rows[0]?.style).toBe('h1')
})

test('Markdown: escaped asterisks stay literal', () => {
  const rows = markdownRows('Price is 5\\*3\\* units')
  show('escapes', rows)
  expect(rows[0]?.text).toBe('Price is 5*3* units')
})

test('Markdown: empty document gives no rows, CRLF handled', () => {
  expect(markdownRows('')).toEqual([])
  const rows = markdownRows('# A\r\n\r\ntext\r\n')
  expect(rows.filter(r => r.style !== 'rule' && r.style !== 'space').map(r => r.text)).toEqual(['A', 'text'])
})

test('Markdown: performance on 50k lines', () => {
  const src = Array.from({ length: 50000 }, (_, i) => (i % 10 === 0 ? `## H${i}` : `Line ${i} with **bold** and \`code\`.`)).join('\n')
  const t0 = Date.now()
  const rows = markdownRows(src)
  console.log(`md 50k lines -> ${rows.length} rows in ${Date.now() - t0} ms`)
  expect(Date.now() - t0).toBeLessThan(3000)
})

// ---------- ADF ----------
test('ADF: a null node in content does not fail the whole page', () => {
  let ok = true
  try {
    adfRows({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }, null as never] })
  } catch (e) {
    console.log('threw:', String(e))
    ok = false
  }
  expect(ok).toBe(true)
})

test('ADF: unknown block and inline node types keep their text', () => {
  const rows = adfRows({
    type: 'doc',
    content: [
      { type: 'futureBlock', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside future' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'inlineExtension', attrs: { text: 'X' } }, { type: 'text', text: ' b' }] },
      { type: 'weirdTextHolder', content: [{ type: 'text', text: 'loose text' }] },
    ],
  })
  show('adf unknown', rows)
  expect(rows.some(r => r.text === 'inside future')).toBe(true)
  expect(rows.some(r => r.text.includes('loose text'))).toBe(true)
})

test('ADF: nested task lists keep their items', () => {
  const rows = adfRows({
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'parent' }] },
          { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'child' }] }] },
        ],
      },
    ],
  })
  show('adf nested tasks', rows)
  expect(rows.some(r => r.text === 'child')).toBe(true)
})

test('ADF: empty doc and nested bullet lists', () => {
  expect(adfRows({ type: 'doc', content: [] })).toEqual([])
  const li = (t: string, extra: unknown[] = []) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }, ...extra] })
  const rows = adfRows({ type: 'doc', content: [{ type: 'bulletList', content: [li('one', [{ type: 'bulletList', content: [li('two')] }])] }] } as never)
  show('adf nested bullets', rows)
  expect(rows.map(r => r.indent)).toEqual([0, 1])
})

test('Markdown: a table row whose first cell is "--" keeps the anchors of later rows right', () => {
  const rows = markdownRows('| a | b |\n|---|---|\n| -- | n/a |\n| x | y |')
  show('dash cell', rows)
  expect(rows.find(r => r.text.startsWith('x'))?.anchor).toBe('line 4')
  expect(rows.find(r => r.text.startsWith('--'))?.anchor).toBe('line 3')
})

test('HTML: colspan keeps later cells under their headers', () => {
  const rows = htmlRows('<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td colspan="2">wide</td><td>c</td></tr></table>')
  show('colspan', rows)
  const body = rows.find(r => r.text.includes('wide'))
  expect(body?.text.split(' | ').length).toBe(3)
})
