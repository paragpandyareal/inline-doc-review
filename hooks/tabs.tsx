import type { ClientModule } from 'claude-code'

/**
 * A row of tabs with a heavy underline under the active one: the top bar
 * (a coloured file-type badge, the file tabs, and switches on the right)
 * and the sheet tabs under a spreadsheet. A click posts the tab's index or
 * the switch's id; the hooks module acts on it. Once clicked, ← → move
 * between tabs.
 *
 * When the active tab changes, the underline slides to it over six frames.
 */

export type TabsProps = {
  group: 'files' | 'sheets'
  labels: string[]
  active: number
  colors: { accent: string; text: string; subtle: string; dim: string }
  badge?: { label: string; bg: string; fg: string }
  asides?: { id: string; label: string; color: string; isBold?: boolean }[]
}

export type TabsPost = { type: 'tab'; group: 'files' | 'sheets'; index: number } | { type: 'aside'; id: string }

type Local = { shownActive: number; slideFrom?: number; frame?: number; stop?: () => void }

const GAP = 3
const SLIDE_FRAMES = 6

const Tabs: ClientModule<TabsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const badgeWidth = props.badge ? props.badge.label.length + 2 + 2 : 0
  const starts: number[] = []
  let x = badgeWidth
  for (const label of props.labels) {
    starts.push(x)
    x += label.length + GAP
  }
  const asides = props.asides ?? []
  const asideText = asides.map(a => a.label).join('   ')
  const asideAt = asides.length > 0 ? Math.max(x, surface.columns - asideText.length) : -1
  const asideStarts: number[] = []
  let ax = asideAt
  for (const aside of asides) {
    asideStarts.push(ax)
    ax += aside.label.length + 3
  }

  // Slide the underline when the active tab changes.
  const state = surface.state
  if (state === undefined) {
    surface.setState({ shownActive: props.active })
  } else if (state.shownActive !== props.active && state.frame === undefined) {
    const from = starts[state.shownActive] ?? 0
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
  }

  surface.onPointer(event => {
    if (event.type !== 'down' || event.y > 1) return
    const asideIndex = asideStarts.findIndex((start, i) => event.x >= start && event.x < start + (asides[i]?.label.length ?? 0))
    if (asideIndex >= 0) {
      surface.post({ type: 'aside', id: asides[asideIndex]?.id ?? '' })
      return
    }
    const index = starts.findIndex((start, i) => event.x >= start && event.x < start + (props.labels[i]?.length ?? 0) + GAP - 1)
    if (index >= 0) surface.post({ type: 'tab', group: props.group, index })
  })

  surface.onKey(event => {
    const step = event.key === 'left' ? -1 : event.key === 'right' ? 1 : 0
    if (step === 0 || props.labels.length < 2) return
    const index = (props.active + step + props.labels.length) % props.labels.length
    surface.post({ type: 'tab', group: props.group, index })
  })

  // Where the underline sits this frame: eased from the old tab to the new one.
  const target = starts[props.active] ?? 0
  const targetWidth = props.labels[props.active]?.length ?? 0
  let lineAt = target
  let lineWidth = targetWidth
  if (state?.frame !== undefined && state.slideFrom !== undefined) {
    const t = 1 - (1 - state.frame / SLIDE_FRAMES) ** 3
    lineAt = Math.round(state.slideFrom + (target - state.slideFrom) * t)
    lineWidth = Math.max(2, targetWidth)
  }
  const filler = asides.length > 0 ? Math.max(1, asideAt - x) : 0

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {props.badge && (
          <Text>
            <Text backgroundColor={props.badge.bg} color={props.badge.fg} bold>
              {` ${props.badge.label} `}
            </Text>
            <Text>{'  '}</Text>
          </Text>
        )}
        {props.labels.map((label, i) => (
          <Text key={`t${i}`} bold={i === props.active} color={i === props.active ? props.colors.text : props.colors.subtle}>
            {label}
            {' '.repeat(GAP)}
          </Text>
        ))}
        {asides.length > 0 && <Text>{' '.repeat(filler)}</Text>}
        {asides.map((aside, i) => (
          <Text key={`a${i}`} color={aside.color} bold={aside.isBold}>
            {aside.label}
            {i < asides.length - 1 ? '   ' : ''}
          </Text>
        ))}
      </Box>
      <Text color={props.colors.accent}>
        {' '.repeat(Math.max(0, lineAt))}
        {'━'.repeat(lineWidth)}
      </Text>
    </Box>
  )
}

export default Tabs
