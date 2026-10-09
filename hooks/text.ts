// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Inline Doc Review: https://github.com/paragpandyareal/inline-doc-review

/**
 * Text as the terminal draws it: escapes and control characters removed,
 * widths counted in cells (CJK and emoji take two). Shared by the hooks
 * module, the readers and the drawing modules.
 */

// ── Text safety ──

/** ANSI escapes, C0/C1 controls (but tab and newline) and bidi overrides: never drawn, never sent. */
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Document text as read from disk, made safe to draw: no escapes, no controls, CRLF as LF. */
export const stripControls = (text: string) => text.replace(/\r\n?/g, '\n').replace(ANSI, '').replace(CONTROLS, '')

/** One line for a label, path or sheet name: controls and newlines become spaces, capped. */
export function sanitizeLine(text: string, most = 200): string {
  const one = text.replace(ANSI, '').replace(/[\n\u2028\u2029]/g, ' ').replace(CONTROLS, ' ')
  return one.length > most ? `${one.slice(0, most - 1)}…` : one
}

// ── Widths: CJK and emoji take two terminal cells ──

const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1f64f}\u{1f900}-\u{1faff}\u{20000}-\u{3fffd}]/u
const ZERO = /[\u0300-\u036f\u200b-\u200d\ufe0f]/

export function strWidth(text: string): number {
  if (/^[\x20-\x7e]*$/.test(text)) return text.length
  let width = 0
  for (const ch of text) width += ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1
  return width
}

/** The longest start of `text` that fits `width` cells. */
export function fitStart(text: string, width: number): string {
  if (strWidth(text) <= width) return text
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = strWidth(ch)
    if (used + w > width) break
    out += ch
    used += w
  }
  return out
}

/** Cuts text to `width` cells, ending with an ellipsis when something is left out. */
export const cutTo = (text: string, width: number) =>
  strWidth(text) <= width ? text : `${fitStart(text, Math.max(0, width - 1))}…`

export const padRight = (text: string, width: number) => {
  const cut = cutTo(text, width)
  return cut + ' '.repeat(Math.max(0, width - strWidth(cut)))
}
