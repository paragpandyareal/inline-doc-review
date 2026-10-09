// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * The pane's colours: a calm slate-and-blue scheme (GitHub-style dark and
 * light), blue for focus, teal for formulas, amber for comments, green for
 * what changed; nothing pastel-on-white or neon-on-black. Under an ANSI or
 * colour-blind theme the theme's own keys stand in, so the person's choice
 * wins.
 */

export type Palette = {
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
  claude: string
  info: string
  note: string
  warning: string
  success: string
  error: string
}

const DARK: Palette = {
  text: '#C9D1D9',
  subtle: '#9AA4B2',
  dim: '#5C6773',
  accent: '#58A6FF',
  formula: '#39C5CF',
  comment: '#E3B341',
  selection: '#1F3A5F',
  h2: '#58A6FF',
  h3: '#39C5CF',
  link: '#58A6FF',
  code: '#F0883E',
  band: '#21262D',
  zebra: '#161B22',
  flash: '#1B4721',
  claude: '#D97757',
  info: '#58A6FF',
  note: '#9AA4B2',
  warning: '#E3B341',
  success: '#3FB950',
  error: '#F85149',
}

const LIGHT: Palette = {
  text: '#24292F',
  subtle: '#57606A',
  dim: '#8C959F',
  accent: '#0969DA',
  formula: '#0E7490',
  comment: '#BC4C00',
  selection: '#DDF4FF',
  h2: '#0969DA',
  h3: '#0E7490',
  link: '#0969DA',
  code: '#953800',
  band: '#F0F3F6',
  zebra: '#F6F8FA',
  flash: '#DAFBE1',
  claude: '#D97757',
  info: '#0969DA',
  note: '#57606A',
  warning: '#9A6700',
  success: '#1A7F37',
  error: '#CF222E',
}

/** The theme's own keys, for ANSI and colour-blind themes. Backgrounds fall back to none. */
const THEMED: Palette = {
  text: 'text',
  subtle: 'subtle',
  dim: 'inactive',
  accent: 'claude',
  formula: 'suggestion',
  comment: 'warning',
  selection: '',
  h2: 'suggestion',
  h3: 'suggestion',
  link: 'suggestion',
  code: 'permission',
  band: '',
  zebra: '',
  flash: '',
  claude: 'claude',
  info: 'suggestion',
  note: 'permission',
  warning: 'warning',
  success: 'success',
  error: 'error',
}

export function paletteFor(theme: string | undefined): Palette {
  const name = (theme ?? 'dark').toLowerCase()
  if (name.includes('ansi') || name.includes('daltonized')) return THEMED
  return name.includes('light') ? LIGHT : DARK
}

/** A coloured chip per file type: the same in both themes. */
export const BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  xlsx: { label: 'XLSX', bg: '#21A366', fg: '#FFFFFF' },
  csv: { label: 'CSV', bg: '#21A366', fg: '#FFFFFF' },
  docx: { label: 'WORD', bg: '#2F7BEA', fg: '#FFFFFF' },
  pdf: { label: 'PDF', bg: '#E5484D', fg: '#FFFFFF' },
  html: { label: 'HTML', bg: '#F06529', fg: '#FFFFFF' },
  htm: { label: 'HTML', bg: '#F06529', fg: '#FFFFFF' },
  png: { label: 'PNG', bg: '#EC4899', fg: '#FFFFFF' },
  md: { label: 'MD', bg: '#EAB308', fg: '#11111B' },
  markdown: { label: 'MD', bg: '#EAB308', fg: '#11111B' },
  adf: { label: 'CONFLUENCE', bg: '#00B8D9', fg: '#11111B' },
  json: { label: 'JSON', bg: '#7C7F93', fg: '#FFFFFF' },
  txt: { label: 'TEXT', bg: '#7C7F93', fg: '#FFFFFF' },
}
