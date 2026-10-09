// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * The panda, as pixel art drawn with half blocks the way Claude Code draws
 * its own mascot: each character is two pixels stacked, the top one in the
 * text colour and the bottom one in the background colour, so it shows in
 * any terminal without image support.
 */

/** B ears, W face, K eye patches and nose, O a soft outline that keeps the face apart from a light background. */
const ART = [
  '...BBBB........BBBB...',
  '..BBBBBBOOOOOOBBBBBB..',
  '..BBBBBWWWWWWWWBBBBB..',
  '...BBBWWWWWWWWWWBBB...',
  '...OWWWWWWWWWWWWWWO...',
  '..OWWWWWWWWWWWWWWWWO..',
  '.OWWWWKKKWWWWKKKWWWWO.',
  '.OWWWKKKKKWWKKKKKWWWO.',
  '.OWWKKKWWKWWKWWKKKWWO.',
  '.OWWKKKKKKWWKKKKKKWWO.',
  '.OWWWKKKKWWWWKKKKWWWO.',
  '.OWWWWWWWWKKWWWWWWWWO.',
  '.OWWWWWWWWKKWWWWWWWWO.',
  '..OWWWWWWKWWKWWWWWWO..',
  '...OWWWWWWWWWWWWWWO...',
  '....OOWWWWWWWWWWOO....',
  '......OOOOOOOOOO......',
  '......................',
]

const COLORS: Record<string, string> = { B: '#3C3C42', W: '#F3F3EF', K: '#19191C', O: '#8C8C94' }

/** One run of characters drawn alike. */
export type PandaRun = { text: string; color?: string; background?: string }

/** The panda as rows of runs, ready to draw as Text. */
export function pandaRows(): PandaRun[][] {
  const rows: PandaRun[][] = []
  for (let y = 0; y < ART.length; y += 2) {
    const top = ART[y] ?? ''
    const bottom = ART[y + 1] ?? ''
    const runs: PandaRun[] = []
    for (let x = 0; x < top.length; x += 1) {
      const up = COLORS[top[x] ?? '.']
      const down = COLORS[bottom[x] ?? '.']
      const cell: PandaRun = up && down ? { text: '▀', color: up, background: down } : up ? { text: '▀', color: up } : down ? { text: '▄', color: down } : { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.background === cell.background && last.text[0] === cell.text) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }
  return rows
}
