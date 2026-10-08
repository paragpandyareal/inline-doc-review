/**
 * The pane's colours: Catppuccin Mocha on dark terminals, Latte on light
 * ones, so nothing is pastel-on-white or neon-on-black. Under an ANSI or
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
  text: '#CDD6F4',
  subtle: '#A6ADC8',
  dim: '#6C7086',
  accent: '#CBA6F7',
  formula: '#94E2D5',
  comment: '#FAB387',
  selection: '#45475A',
  h2: '#89B4FA',
  h3: '#74C7EC',
  link: '#89B4FA',
  code: '#F5C2E7',
  band: '#313244',
  zebra: '#24273A',
  flash: '#2E5E3A',
  claude: '#D97757',
  info: '#89B4FA',
  note: '#CBA6F7',
  warning: '#F9E2AF',
  success: '#A6E3A1',
  error: '#F38BA8',
}

const LIGHT: Palette = {
  text: '#4C4F69',
  subtle: '#6C6F85',
  dim: '#9CA0B0',
  accent: '#8839EF',
  formula: '#179299',
  comment: '#FE640B',
  selection: '#CCD0DA',
  h2: '#1E66F5',
  h3: '#209FB5',
  link: '#1E66F5',
  code: '#EA76CB',
  band: '#E6E9EF',
  zebra: '#F2F3F7',
  flash: '#C8F0C8',
  claude: '#D97757',
  info: '#1E66F5',
  note: '#8839EF',
  warning: '#DF8E1D',
  success: '#40A02B',
  error: '#D20F39',
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
