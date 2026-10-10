// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * One time limit for reading a file, shared by every reader. Each reader has
 * its own caps too; this is the guard behind them, so a loop a hostile file
 * drives too long ends in a note ("only part of it is shown") or a plain
 * message, never in a hook that runs out of time and leaves the pane blank.
 */

export class TooSlow extends Error {
  override message = 'it takes too long to read here'
}

let until = Infinity
let calls = 0
let late = false

/** Starts the clock for one read: `ms` from now. */
export function startReading(ms: number) {
  until = Date.now() + ms
  calls = 0
  late = false
}

export function stopReading() {
  until = Infinity
  late = false
}

/** Whether the time is up; cheap enough for a hot loop (it looks at the clock once in 512 calls, and stays up once it is). */
export function isLate(): boolean {
  if (late) return true
  calls += 1
  if ((calls & 511) === 0 && Date.now() > until) late = true
  return late
}

/** Throws TooSlow once the time is up. */
export function checkTime() {
  if (isLate()) throw new TooSlow()
}
