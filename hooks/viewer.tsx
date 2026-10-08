import type { ClientKeyEvent, ClientModule, ClientPointerEvent } from 'claude-code'

import type { RowStyle, Span, Tone } from '../types'

/**
 * The document view inside the pane. It draws only the rows in view, which
 * the hooks module hands it, and turns a click or drag into a selection: on
 * release it posts both ends back, and the hooks module names the range for
 * the comment. Keys move the cursor or scroll, posted the same way, since
 * the hooks module owns the view.
 *
 * It also runs the pane's motion, on its own frame clock: what Claude just
 * changed glows green and fades, and a new comment's marker pops in.
 */

/** The colours the view paints with (a Palette from palette.ts). */
export type ViewPal = {
  text: string
  subtle: string
  dim: string
  accent: string
  formula: string
  comment: string
  selection: string
  h2: string
  h3: string
  link: string
  code: string
  band: string
  zebra: string
  flash: string
  info: string
  note: string
  warning: string
  success: string
  error: string
}

export type LineRow = {
  /** Number shown in the gutter, blank on a wrapped continuation or in a formatted document. */
  n: string
  t: string
  /** Index of the document row this visual line belongs to. */
  src: number
  /** 1 selected, 2 has a comment waiting, 3 has a comment already sent. */
  hl?: 1 | 2 | 3
  /** Also 2 or 3 while selected, so the comment mark still shows. */
  mark?: 2 | 3
  /** How the row is drawn (RowStyle), its text with emphasis, and what comes before it. */
  st?: RowStyle
  sp?: Span[]
  pre?: string
  tone?: Tone
  /** A striped table row; a row Claude just changed. */
  z?: 1
  fl?: 1
}

export type GridRow = {
  r: number
  n: string
  cells: string[]
  /** Columns (in view) that are selected, hold a formula, a number, a negative number, an error, a change; comments (2 waiting, 3 sent). */
  hl?: number[]
  fx?: number[]
  num?: number[]
  neg?: number[]
  err?: number[]
  fl?: number[]
  marks?: Record<string, 2 | 3>
}

type Motion = {
  /** Bumped by the hooks module when Claude changed the file: the changed rows/cells glow. */
  flashKey?: number
  /** The newest comment's id and place: its marker pops in. */
  pop?: { key: string; r: number; c: number }
}

export type ViewerProps = Motion &
  (
    | { mode: 'lines'; pal: ViewPal; rows: LineRow[]; gutter: number; width: number }
    | {
        mode: 'grid'
        pal: ViewPal
        letters: string[]
        widths: number[]
        gutter: number
        left: number
        /** The sheet's first row, kept on top while the rest scrolls. */
        header?: GridRow
        rows: GridRow[]
        /** Columns hidden to the left and right, rows below; the scrollbar's place. */
        moreLeft: number
        moreRight: number
        moreBelow: number
        scroll: { top: number; shown: number; total: number }
        isZebra: boolean
      }
  )

type Point = [number, number]
type Local = {
  drag?: { a: Point; b: Point }
  flash?: { key: number; frame: number }
  pop?: { key: string; frame: number }
  isMounted?: boolean
  seenFlash?: number
  seenPop?: string
}

export type ViewerPost =
  | { type: 'select'; a: Point; b: Point }
  | { type: 'move'; rows: number; cols: number; extend: boolean }
  | { type: 'scroll'; rows: number }
  | { type: 'sheet'; delta: number }
  | { type: 'clear' }

const GAP = 2
const FLASH_FRAMES = 14
const POP = ['·', '∘', '○', '◉', '●', '●', '◉', '●']

const pad = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text + ' '.repeat(width - text.length)
const padStart = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : ' '.repeat(width - text.length) + text

/** A grid cell is: a 2-cell formula slot, the value, a 1-cell comment slot, a gap. */
const cellWidth = (w: number) => 2 + w + 1 + GAP

/** A comment mark goes on the first visual line of its row only. */
const isFirstOf = (rows: LineRow[], i: number) => i === 0 || rows[i - 1]?.src !== rows[i]?.src

const Viewer: ClientModule<ViewerProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const pal = props.pal
  const local = surface.state ?? {}
  const drag = local.drag

  // ── Motion: start a glow or a pop when the hooks module asks for one. ──
  const start = (kind: 'flash' | 'pop', key: number | string, frames: number, ms: number) => {
    let frame = 0
    const stop = surface.every(ms, () => {
      frame += 1
      const now = surface.state ?? {}
      if (frame >= frames) {
        stop()
        surface.setState(kind === 'flash' ? { ...now, flash: undefined } : { ...now, pop: undefined })
      } else {
        surface.setState(kind === 'flash' ? { ...now, flash: { key: key as number, frame } } : { ...now, pop: { key: key as string, frame } })
      }
    })
  }
  if (!local.isMounted) {
    // The first draw only notes where things stand; later changes animate.
    surface.setState({ ...local, isMounted: true, seenFlash: props.flashKey ?? 0, seenPop: props.pop?.key ?? '' })
  } else if ((props.flashKey ?? 0) !== local.seenFlash) {
    start('flash', props.flashKey ?? 0, FLASH_FRAMES, 90)
    surface.setState({ ...local, seenFlash: props.flashKey ?? 0, flash: { key: props.flashKey ?? 0, frame: 0 } })
  } else if ((props.pop?.key ?? '') !== local.seenPop) {
    if (props.pop) start('pop', props.pop.key, POP.length, 60)
    surface.setState({ ...local, seenPop: props.pop?.key ?? '', ...(props.pop ? { pop: { key: props.pop.key, frame: 0 } } : {}) })
  }
  const isGlowing = local.flash !== undefined
  const glowBg = isGlowing && (local.flash?.frame ?? 0) < FLASH_FRAMES * 0.65 ? pal.flash : undefined
  const glowFg = isGlowing ? pal.success : undefined
  const popGlyph = (r: number, c: number) =>
    local.pop && props.pop && props.pop.r === r && props.pop.c === c ? (POP[local.pop.frame] ?? '●') : undefined

  // ── Input ──
  const gridLines =
    props.mode === 'grid'
      ? [null, ...(props.header ? [props.header, null] : []), ...props.rows]
      : []

  const cellAt = (event: ClientPointerEvent): Point | undefined => {
    if (props.mode === 'lines') {
      const row = props.rows[Math.min(Math.max(event.y, 0), props.rows.length - 1)]
      return row ? [row.src, 0] : undefined
    }
    const line = gridLines[Math.min(Math.max(event.y, 0), gridLines.length - 1)]
    const row = line ?? props.rows[0]
    if (!row) return undefined
    let x = event.x - (props.gutter + 2)
    let col = 0
    while (col < props.widths.length - 1 && x >= cellWidth(props.widths[col] ?? 1)) {
      x -= cellWidth(props.widths[col] ?? 1)
      col += 1
    }
    return [row.r, props.left + col]
  }

  surface.onPointer(event => {
    if (event.button !== undefined && event.button !== 'left') return
    const at = cellAt(event)
    if (!at) return
    const now = surface.state ?? {}
    if (event.type === 'down') {
      surface.setState({ ...now, drag: { a: at, b: at } })
    } else if (event.type === 'move' && now.drag && event.button === 'left') {
      if (at[0] !== now.drag.b[0] || at[1] !== now.drag.b[1]) surface.setState({ ...now, drag: { a: now.drag.a, b: at } })
    } else if (event.type === 'up' && now.drag) {
      surface.setState({ ...now, drag: undefined })
      surface.post({ type: 'select', a: now.drag.a, b: at })
    }
  })

  const page = Math.max(1, props.rows.length - 1)
  surface.onKey((event: ClientKeyEvent) => {
    const k = event.key
    const extend = event.shift === true
    if (k === 'up') surface.post({ type: 'move', rows: -1, cols: 0, extend })
    else if (k === 'down') surface.post({ type: 'move', rows: 1, cols: 0, extend })
    else if (k === 'left') surface.post({ type: 'move', rows: 0, cols: -1, extend })
    else if (k === 'right') surface.post({ type: 'move', rows: 0, cols: 1, extend })
    else if (k === 'pageup') surface.post({ type: 'scroll', rows: -page })
    else if (k === 'pagedown') surface.post({ type: 'scroll', rows: page })
    else if (k === 'home') surface.post({ type: 'scroll', rows: -1e9 })
    else if (k === 'end') surface.post({ type: 'scroll', rows: 1e9 })
    else if (k === '[') surface.post({ type: 'sheet', delta: -1 })
    else if (k === ']') surface.post({ type: 'sheet', delta: 1 })
    else if (k === 'backspace' || k === 'delete') surface.post({ type: 'clear' })
  })

  const selBg = pal.selection || undefined
  const toneColor = (tone: Tone | undefined) => (tone ? pal[tone === 'tip' ? 'success' : tone] : pal.note)
  const TONE_ICON: Record<Tone, string> = { info: 'ℹ', note: '✎', warning: '⚠', error: '✖', success: '✔', tip: '✔' }

  // ── Documents: lines, formatted or numbered ──
  if (props.mode === 'lines') {
    const lo = drag ? Math.min(drag.a[0], drag.b[0]) : -1
    const hi = drag ? Math.max(drag.a[0], drag.b[0]) : -1
    const width = props.width
    return (
      <Box flexDirection="column">
        {props.rows.map((row, i) => {
          const isLit = (drag ? row.src >= lo && row.src <= hi : row.hl === 1) && row.st !== 'space'
          const mark = row.hl === 2 || row.hl === 3 ? row.hl : row.mark
          const popped = popGlyph(row.src, 0)
          const glow = row.fl === 1 && isGlowing
          const markGlyph = popped ?? (glow ? '✓' : mark && isFirstOf(props.rows, i) ? '●' : ' ')
          const gutter = (
            <Text>
              <Text color={glow ? pal.success : mark === 2 || popped ? pal.comment : pal.dim}>{markGlyph}</Text>
              {props.gutter > 0 && <Text color={pal.dim}>{padStart(row.n, props.gutter)} </Text>}
              <Text color={pal.accent}>{isLit ? '▌' : ' '}</Text>
              <Text> </Text>
            </Text>
          )
          if (row.st === 'rule') {
            return (
              <Box key={`r${i}`} flexDirection="row">
                {gutter}
                <Text color={pal.dim}>{'─'.repeat(Math.max(4, width))}</Text>
              </Box>
            )
          }
          const bg = isLit ? selBg : glow ? glowBg : row.st === 'th' ? pal.band || undefined : row.z ? pal.zebra || undefined : undefined
          const spans = row.sp ?? [{ t: row.t }]
          // An H1 is a full-width band; an H2 gets an accent bar.
          if (row.st === 'h1') {
            const text = `◆ ${row.t}`
            return (
              <Box key={`r${i}`} flexDirection="row">
                {gutter}
                <Text backgroundColor={isLit ? selBg : pal.band || undefined} color={pal.accent} bold inverse={!pal.band && !isLit}>
                  {pad(` ${text}`, Math.max(text.length + 2, width))}
                </Text>
              </Box>
            )
          }
          const look =
            row.st === 'h2'
              ? { bold: true, color: pal.h2 }
              : row.st === 'h3' || row.st === 'heading'
                ? { bold: true, color: pal.h3 }
                : row.st === 'quote'
                  ? { italic: true, color: pal.subtle }
                  : row.st === 'code'
                    ? { color: pal.code }
                    : row.st === 'th'
                      ? { bold: true, color: pal.text }
                      : {}
          const isPanelTitle = row.st === 'panel' && spans.length === 1 && spans[0]?.b === 1 && row.pre === '┃ '
          const pre =
            row.st === 'h2' ? '▍ ' : row.st === 'quote' ? '▎ ' : row.st === 'panel' ? (isPanelTitle ? `┃ ${TONE_ICON[row.tone ?? 'note']} ` : '┃ ') : (row.pre ?? '')
          const preColor = row.st === 'panel' ? toneColor(row.tone) : row.st === 'li' || row.st === 'h2' ? pal.accent : row.st === 'quote' ? pal.note : pal.dim
          const used = pre.length + spans.reduce((n, s) => n + s.t.length, 0)
          return (
            <Box key={`r${i}`} flexDirection="row">
              {gutter}
              <Text wrap="truncate-end">
                {pre !== '' && <Text color={preColor} bold={row.st === 'panel' || row.st === 'li'}>{pre}</Text>}
                {spans.map((span, k) => (
                  <Text
                    key={`s${k}`}
                    backgroundColor={bg}
                    bold={look.bold === true || span.b === 1 || isPanelTitle}
                    italic={look.italic === true || span.i === 1}
                    underline={span.l === 1}
                    strikethrough={span.s === 1}
                    color={
                      glow
                        ? glowFg
                        : isPanelTitle
                          ? toneColor(row.tone)
                          : span.l
                            ? pal.link
                            : span.c
                              ? pal.code
                              : span.d
                                ? pal.dim
                                : (look.color ?? pal.text)
                    }
                  >
                    {span.t === '' ? ' ' : span.t}
                  </Text>
                ))}
                {bg && (row.st === 'th' || row.st === 'td' || isLit) && used < width ? <Text backgroundColor={bg}>{' '.repeat(width - used)}</Text> : null}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  }

  // ── Spreadsheets ──
  const r1 = drag ? Math.min(drag.a[0], drag.b[0]) : -1
  const r2 = drag ? Math.max(drag.a[0], drag.b[0]) : -1
  const c1 = drag ? Math.min(drag.a[1], drag.b[1]) : -1
  const c2 = drag ? Math.max(drag.a[1], drag.b[1]) : -1
  const gridWidth = props.widths.reduce((sum, w) => sum + cellWidth(w), 0)
  const band = pal.band || undefined
  const scroll = props.scroll
  // A one-column scrollbar beside the rows, when there are more rows than fit.
  const bodyRows = props.rows.length
  const hasBar = scroll.total > scroll.shown
  const thumbSize = hasBar ? Math.max(1, Math.round((bodyRows * scroll.shown) / scroll.total)) : 0
  const thumbAt = hasBar ? Math.round(((bodyRows - thumbSize) * scroll.top) / Math.max(1, scroll.total - scroll.shown)) : 0

  const drawRow = (row: GridRow, key: string, isHeader: boolean, index: number) => {
    const stripe = !isHeader && props.isZebra && index % 2 === 1 ? pal.zebra || undefined : undefined
    const rowBg = isHeader ? band : stripe
    return (
      <Box key={key} flexDirection="row">
        <Text backgroundColor={band} color={pal.dim}>
          {padStart(row.n, props.gutter)}{' '}
        </Text>
        <Text color={pal.dim}>┃</Text>
        {row.cells.map((cell, j) => {
          const col = props.left + j
          const isLit = drag ? row.r >= r1 && row.r <= r2 && col >= c1 && col <= c2 : (row.hl ?? []).includes(col)
          const isFormula = (row.fx ?? []).includes(j)
          const isError = (row.err ?? []).includes(j)
          const isNeg = (row.neg ?? []).includes(j)
          const glow = isGlowing && (row.fl ?? []).includes(j)
          const popped = popGlyph(row.r, col)
          const mark = row.marks?.[String(j)]
          const width = props.widths[j] ?? 1
          const value = (row.num ?? []).includes(j) ? padStart(cell, width) : pad(cell, width)
          const bg = isLit ? selBg : glow ? glowBg : rowBg
          const color = glow ? glowFg : isError ? pal.error : isNeg ? pal.error : isFormula ? pal.formula : isHeader ? pal.text : pal.text
          return (
            <Text key={`c${j}`}>
              <Text backgroundColor={bg} color={pal.formula} bold>
                {isFormula ? ' ƒ' : '  '}
              </Text>
              <Text backgroundColor={bg} bold={isHeader || isFormula} color={color} inverse={isLit && !selBg}>
                {value}
              </Text>
              <Text backgroundColor={bg} color={glow ? pal.success : popped || mark === 2 ? pal.comment : pal.dim}>
                {popped ?? (glow ? '✓' : mark ? '●' : ' ')}
              </Text>
              <Text backgroundColor={rowBg}>{' '.repeat(GAP)}</Text>
            </Text>
          )
        })}
        {!isHeader && hasBar && (
          <Text color={index >= thumbAt && index < thumbAt + thumbSize ? pal.accent : pal.dim}>
            {index >= thumbAt && index < thumbAt + thumbSize ? '┃' : '│'}
          </Text>
        )}
      </Box>
    )
  }

  const moreLeft = props.moreLeft > 0 ? (props.moreLeft > 99 ? '◀ 99+' : `◀ ${props.moreLeft}`) : ''
  const moreRight = props.moreRight > 0 ? ` ${props.moreRight} more ▶` : ''
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text backgroundColor={band} color={pal.accent} bold>
          {pad(moreLeft, props.gutter + 1)}
        </Text>
        <Text color={pal.dim}>┃</Text>
        {props.letters.map((letter, j) => {
          const col = props.left + j
          const isSelectedCol = props.rows.some(row => (row.hl ?? []).includes(col))
          return (
            <Text key={`l${j}`} backgroundColor={band} color={isSelectedCol ? pal.accent : pal.subtle} bold>
              {'  '}
              {pad(letter, props.widths[j] ?? 1)}
              {' '}
              {' '.repeat(GAP)}
            </Text>
          )
        })}
        {moreRight !== '' && (
          <Text backgroundColor={band} color={pal.accent} bold>
            {moreRight}
          </Text>
        )}
      </Box>
      {props.header && drawRow(props.header, 'head', true, -1)}
      {props.header && (
        <Text color={pal.dim}>
          {'━'.repeat(props.gutter + 1)}╋{'━'.repeat(Math.max(0, gridWidth - GAP))}
        </Text>
      )}
      {props.rows.map((row, i) => drawRow(row, `g${i}`, false, i))}
      {props.moreBelow > 0 && (
        <Text color={pal.subtle}>
          {' '.repeat(props.gutter + 2)}
          <Text color={pal.accent}>▼</Text> {props.moreBelow} more row{props.moreBelow === 1 ? '' : 's'} · PgDn to scroll
        </Text>
      )}
    </Box>
  )
}

export default Viewer
