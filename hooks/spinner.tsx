import type { ClientModule } from 'claude-code'

/**
 * "Claude is editing…": a braille spinner and a highlight that sweeps
 * across the words, shown from the moment comments are sent until the file
 * changes on disk.
 */

export type SpinnerProps = { text: string; color: string; glow: string }

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const Spinner: ClientModule<SpinnerProps, { tick: number }> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(100, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  const sweep = tick % (props.text.length + 8)
  return (
    <Text>
      <Text color={props.color} bold>
        {FRAMES[tick % FRAMES.length]}{' '}
      </Text>
      {[...props.text].map((ch, i) => (
        <Text key={`c${i}`} color={Math.abs(i - sweep) <= 1 ? props.glow : props.color} bold={Math.abs(i - sweep) <= 1}>
          {ch}
        </Text>
      ))}
    </Text>
  )
}

export default Spinner
