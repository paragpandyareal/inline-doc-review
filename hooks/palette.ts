// Copyright (c) 2026 Parag Pandya. MIT License, see LICENSE.
// Lazy Panda Panel: https://github.com/paragpandyareal/lazy-panda-panel

/**
 * The pane's colours: Claude Code's own theme keys, so the pane follows the
 * person's theme (dark, light, ANSI or colour-blind) without reading their
 * settings. The theme has no neutral background, so headings and selected
 * lines use inverse video, and only what changed takes a background: the
 * theme's diff green.
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

export const PALETTE: Palette = {
  text: 'text',
  subtle: 'subtle',
  dim: 'inactive',
  accent: 'suggestion',
  formula: 'permission',
  comment: 'warning',
  selection: '',
  h2: 'suggestion',
  h3: 'permission',
  link: 'suggestion',
  code: 'claude',
  band: '',
  zebra: '',
  flash: 'diffAdded',
  claude: 'claude',
  info: 'suggestion',
  note: 'subtle',
  warning: 'warning',
  success: 'success',
  error: 'error',
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
