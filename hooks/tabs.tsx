import type { ClientModule } from 'claude-code'

/**
 * Rows of tabs with a heavy underline under the active one: the top bar
 * (a coloured file-type badge, the file tabs, and switches on the right of
 * the first row) and the sheet tabs under a spreadsheet. Tabs that do not
 * fit wrap onto another row rather than being squeezed. A click posts the
 * tab's index or the switch's id; the hooks module acts on it. Once
 * clicked, ← → move between tabs.
 *
 * When the active tab changes within a row, the underline slides to it.
 */

export type TabsProps = {
  group: 'files' | 'sheets'
  labels: string[]
  active: number
  colors: { accent: string; text: string; subtle: string; dim: string }
  /** A small coloured square before each tab: its file type. */
  dots?: string[]
  badge?: { label: string; bg: string; fg: string }
  asides?: { id: string; label: string; color: string; isBold?: boolean }[]
}

export type TabsPost = { type: 'tab'; group: 'files' | 'sheets'; index: number } | { type: 'aside'; id: string }

type Local = { shownActive: number; slideFrom?: number; frame?: number; stop?: () => void }

const GAP = 4
const SLIDE_FRAMES = 6

type Placed = { index: number; x: number; width: number }

const Tabs: ClientModule<TabsProps, Local> = (input, surface) => {
  const { Box, Text } = surface.elements
  // A main module from an older version may not send everything: fall back to safe values.
  const given: Partial<TabsProps['colors']> = input.colors ?? {}
  const props: TabsProps = {
    ...input,
    labels: input.labels ?? [],
    colors: { accent: given.accent ?? 'claude', text: given.text ?? 'text', subtle: given.subtle ?? 'subtle', dim: given.dim ?? 'inactive' },
  }
  const width = Math.max(30, surface.columns || 100)
  const asides = props.asides ?? []
  const asideWidth = asides.reduce((n, a) => n + a.label.length, 0) + Math.max(0, asides.length - 1) * 3
  const badgeWidth = props.badge ? props.badge.label.length + 2 + 2 : 0
  const dot = (i: number) => (props.dots?.[i] ? 2 : 0)

  // Lay the tabs out in rows: the first row shares its line with the badge and the switches.
  const rows: Placed[][] = [[]]
  let x = badgeWidth
  let room = width - badgeWidth - (asideWidth > 0 ? asideWidth + 2 : 0)
  props.labels.forEach((label, i) => {
    const w = dot(i) + Math.min(label.length, width - 8)
    const row = rows[rows.length - 1] as Placed[]
    if (row.length > 0 && x + w > room) {
      rows.push([])
      x = 0
      room = width
    }
    ;(rows[rows.length - 1] as Placed[]).push({ index: i, x, width: w })
    x += w + GAP
  })
  const rowOf = (index: number) => rows.findIndex(row => row.some(tab => tab.index === index))
  const placed = (index: number) => rows.flat().find(tab => tab.index === index)

  // Slide the underline when the active tab changes within a row.
  const state = surface.state
  if (state === undefined) {
    surface.setState({ shownActive: props.active })
  } else if (state.shownActive !== props.active && state.frame === undefined) {
    if (rowOf(state.shownActive) === rowOf(props.active)) {
      const from = placed(state.shownActive)?.x ?? 0
      const to = props.active
      const stop = surface.every(30, () => {
        const now = surface.state
        const frame = (now?.frame ?? 0) + 1
        if (frame >= SLIDE_FRAMES) {
          now?.stop?.()
          surface.setState({ shownActive: to })
        } else if (now) {
          surface.setState({ ...now, frame })
        }
      })
      surface.setState({ shownActive: state.shownActive, slideFrom: from, frame: 0, stop })
    } else {
      surface.setState({ shownActive: props.active })
    }
  }

  const asideAt = width - asideWidth
  surface.onPointer(event => {
    if (event.type !== 'down') return
    const r = Math.floor(event.y / 2)
    if (r === 0 && asides.length > 0 && event.x >= asideAt) {
      let ax = asideAt
      for (const aside of asides) {
        if (event.x < ax + aside.label.length + 3) {
          surface.post({ type: 'aside', id: aside.id })
          return
        }
        ax += aside.label.length + 3
      }
      return
    }
    const hit = rows[r]?.find(tab => event.x >= tab.x && event.x < tab.x + tab.width + GAP - 1)
    if (hit) surface.post({ type: 'tab', group: props.group, index: hit.index })
  })

  surface.onKey(event => {
    const step = event.key === 'left' ? -1 : event.key === 'right' ? 1 : 0
    if (step === 0 || props.labels.length < 2) return
    const index = (props.active + step + props.labels.length) % props.labels.length
    surface.post({ type: 'tab', group: props.group, index })
  })

  // Where the underline sits this frame: eased from the old tab to the new one.
  const target = placed(props.active)
  let lineAt = target?.x ?? 0
  if (state?.frame !== undefined && state.slideFrom !== undefined && target) {
    const t = 1 - (1 - state.frame / SLIDE_FRAMES) ** 3
    lineAt = Math.round(state.slideFrom + (target.x - state.slideFrom) * t)
  }
  const activeRow = rowOf(props.active)

  return (
    <Box flexDirection="column">
      {rows.map((row, r) => {
        let used = r === 0 ? badgeWidth : 0
        return (
          <Box key={`row${r}`} flexDirection="column">
            <Box flexDirection="row">
              {r === 0 && props.badge && (
                <Text>
                  <Text backgroundColor={props.badge.bg} color={props.badge.fg} bold>
                    {` ${props.badge.label} `}
                  </Text>
                  <Text>{'  '}</Text>
                </Text>
              )}
              {row.map(tab => {
                const label = props.labels[tab.index] ?? ''
                const isActive = tab.index === props.active
                const shown = label.length > tab.width - dot(tab.index) ? `${label.slice(0, tab.width - dot(tab.index) - 1)}…` : label
                used = tab.x + tab.width + GAP
                return (
                  <Text key={`t${tab.index}`}>
                    {props.dots?.[tab.index] ? <Text color={props.dots[tab.index]}>▪ </Text> : null}
                    <Text bold={isActive} color={isActive ? props.colors.text : props.colors.subtle}>
                      {shown}
                    </Text>
                    <Text>{' '.repeat(GAP)}</Text>
                  </Text>
                )
              })}
              {r === 0 && asides.length > 0 && <Text>{' '.repeat(Math.max(1, asideAt - used))}</Text>}
              {r === 0 &&
                asides.map((aside, i) => (
                  <Text key={`a${i}`} color={aside.color} bold={aside.isBold}>
                    {aside.label}
                    {i < asides.length - 1 ? '   ' : ''}
                  </Text>
                ))}
            </Box>
            <Text color={props.colors.accent}>
              {r === activeRow && target ? `${' '.repeat(Math.max(0, lineAt))}${'━'.repeat(target.width)}` : ' '}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Tabs
