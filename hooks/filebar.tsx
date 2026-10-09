// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

import type { ClientModule } from 'claude-code'

import { cutTo, strWidth } from './text'

/**
 * The top bar: a coloured file-type badge, the open file's name, a ▾ that
 * drops down the list of every open file, a ‹ n/N › stepper, and switches
 * on the right. One line until the list is open.
 *
 * Click ▾ (or press ↓ / Enter on the bar) to open the list; click a file or
 * use ↑ ↓ and Enter to jump to it. ← → step through the files in order.
 */

export type FileBarProps = {
  files: { name: string; color: string }[]
  active: number
  colors: { accent: string; text: string; subtle: string; dim: string; band: string }
  badge?: { label: string; bg: string; fg: string }
  /** The pane's width in columns. */
  width: number
  /** Switches at the right; `short` is shown when the pane is too narrow for `label`. */
  asides?: { id: string; label: string; short: string; color: string; isBold?: boolean }[]
}

type Local = { isOpen: boolean; hover: number }

const FileBar: ClientModule<FileBarProps, Local> = (input, surface) => {
  const { Box, Text } = surface.elements
  const files = input.files
  const active = Math.min(Math.max(0, input.active), Math.max(0, files.length - 1))
  const c = input.colors
  const width = Math.max(30, input.width)
  const counter = files.length > 1 ? `‹ ${active + 1}/${files.length} ›` : ''
  const badgeText = input.badge ? ` ${input.badge.label} ` : ''
  // On a narrow pane the switches shrink to their icons before the name gives way.
  const full = input.asides ?? []
  const roomy = strWidth(badgeText) + 2 + 16 + 4 + counter.length + 2 + strWidth(full.map(a => a.label).join('   ')) <= width
  const asides = full.map(a => ({ ...a, label: roomy ? a.label : a.short }))
  const local = surface.state ?? { isOpen: false, hover: active }

  const go = (index: number) => {
    surface.setState({ isOpen: false, hover: index })
    if (index !== active) surface.post({ type: 'tab', group: 'files', index })
  }
  const step = (delta: number) => {
    if (files.length < 2) return
    go((active + delta + files.length) % files.length)
  }

  // Layout of the bar line, for clicks: badge, name, ▾, ‹ n/N ›, then switches at the right.
  const asideText = asides.map(a => a.label).join('   ')
  // The name gives way to the switches on a narrow pane.
  const name = cutTo(files[active]?.name ?? '', Math.max(6, width - strWidth(badgeText) - 2 - 4 - counter.length - 2 - strWidth(asideText) - 2))
  const nameAt = badgeText.length + (badgeText ? 2 : 0)
  const caretAt = nameAt + strWidth(name) + 2
  const counterAt = caretAt + 3
  const asideAt = Math.max(counterAt + counter.length + 2, width - strWidth(asideText))

  surface.onPointer(event => {
    if (event.type !== 'down') return
    if (event.y === 0) {
      if (event.x >= asideAt && asides.length > 0) {
        let ax = asideAt
        for (const aside of asides) {
          if (event.x < ax + strWidth(aside.label) + 3) {
            surface.post({ type: 'aside', id: aside.id })
            return
          }
          ax += strWidth(aside.label) + 3
        }
        return
      }
      if (counter && event.x >= counterAt && event.x < counterAt + 2) return step(-1)
      if (counter && event.x >= counterAt + counter.length - 2 && event.x < counterAt + counter.length) return step(1)
      if (files.length > 1 && event.x >= nameAt && event.x < counterAt) {
        surface.setState({ isOpen: !local.isOpen, hover: active })
      }
      return
    }
    // A click on the open list picks that file.
    const index = event.y - 1
    if (local.isOpen && index >= 0 && index < files.length) go(index)
  })

  surface.onKey(event => {
    const k = event.key
    if (k === 'left') return step(-1)
    if (k === 'right') return step(1)
    if (!local.isOpen) {
      if ((k === 'down' || k === 'return') && files.length > 1) surface.setState({ isOpen: true, hover: active })
      return
    }
    if (k === 'up') surface.setState({ ...local, hover: (local.hover - 1 + files.length) % files.length })
    else if (k === 'down') surface.setState({ ...local, hover: (local.hover + 1) % files.length })
    else if (k === 'return') go(local.hover)
    else if (k === 'backspace' || k === 'delete') surface.setState({ ...local, isOpen: false })
  })

  const used = counterAt + counter.length
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {input.badge && (
          <Text>
            <Text backgroundColor={input.badge.bg} color={input.badge.fg} bold>
              {badgeText}
            </Text>
            <Text>{'  '}</Text>
          </Text>
        )}
        <Text bold color={c.text}>
          {name}
        </Text>
        <Text color={files.length > 1 ? c.accent : c.dim} bold>
          {files.length > 1 ? (local.isOpen ? '  ▴' : '  ▾') : '   '}
        </Text>
        <Text>{' '}</Text>
        {counter !== '' && (
          <Text>
            <Text color={c.accent} bold>‹</Text>
            <Text color={c.subtle}>{` ${active + 1}/${files.length} `}</Text>
            <Text color={c.accent} bold>›</Text>
          </Text>
        )}
        {asides.length > 0 && <Text>{' '.repeat(Math.max(2, asideAt - used))}</Text>}
        {asides.map((aside, i) => (
          <Text key={`a${i}`} color={aside.color} bold={aside.isBold}>
            {aside.label}
            {i < asides.length - 1 ? '   ' : ''}
          </Text>
        ))}
      </Box>
      {local.isOpen &&
        files.map((file, i) => {
          const isHover = i === local.hover
          const isActive = i === active
          const shown = cutTo(file.name, Math.min(width, 60) - 14)
          return (
            <Box key={`f${i}`} flexDirection="row">
              <Text backgroundColor={isHover ? c.band || undefined : undefined} inverse={isHover && !c.band}>
                <Text color={c.accent} bold>{isHover ? ' ▸ ' : '   '}</Text>
                <Text color={file.color}>▪ </Text>
                <Text color={isActive ? c.text : c.subtle} bold={isActive}>
                  {shown}
                </Text>
                <Text color={c.dim}>{isActive ? '  (open)' : ''}</Text>
                <Text>{' '.repeat(Math.max(1, Math.min(width, 60) - strWidth(shown) - 13))}</Text>
                <Text color={c.dim}>{String(i + 1).padStart(2)}</Text>
                <Text>{' '}</Text>
              </Text>
            </Box>
          )
        })}
      {local.isOpen && (
        <Text color={c.dim}>   ↑↓ choose · Enter open · ← → previous / next · click ▴ to close</Text>
      )}
    </Box>
  )
}

export default FileBar
