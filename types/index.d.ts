/** A run of text inside a row with its emphasis: bold, italic, code, link, strike, dim. */
export type Span = { t: string; b?: 1; i?: 1; c?: 1; l?: 1; s?: 1; d?: 1 }

/**
 * How a row is drawn. Formatted documents (Markdown, ADF, HTML, Word) use
 * h1–h3, p, li, quote, code, th/td, panel, rule and space; plain files draw
 * every row as a numbered line.
 */
export type RowStyle =
  | 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'code' | 'th' | 'td' | 'panel' | 'rule' | 'space'
  | 'heading' | 'table' | null

export type Tone = 'info' | 'note' | 'warning' | 'error' | 'success' | 'tip'

/** One row of a document: a line, a paragraph, a heading, a list item, a table row. */
export type DocRow = {
  /** The row's plain text: what a comment quotes. */
  text: string
  /** Where the row is, in words Claude can find it by: "line 12", "paragraph 4 (under "Pricing")". */
  anchor: string
  style?: RowStyle
  /** What one row is called, for a range's label: "line", "paragraph", "block". */
  unit?: string
  /** Gutter number when it is not in the anchor. */
  num?: string
  /** The text with emphasis, when the row has any. */
  spans?: Span[]
  /** List depth (0 for a top-level item) and the item's bullet or number. */
  indent?: number
  marker?: string
  /** A panel's or callout's kind. */
  tone?: Tone
}

/** A cell: the value as shown, its formula when it has one, its number when it is one. */
export type GridCell = { v: string; f?: string; x?: number }

export type GridSheet = {
  name: string
  cols: string[]
  rows: GridCell[][]
  isCut?: boolean
}

export type Doc =
  | {
      kind: 'lines'
      path: string
      rows: DocRow[]
      note?: string
      /** Drawn as a formatted document (no line numbers), and whether a source view exists. */
      isFormatted?: boolean
      hasSource?: boolean
    }
  | { kind: 'grid'; path: string; sheets: GridSheet[]; note?: string }
  | { kind: 'image'; path: string; png: string; width: number; height: number }
  | { kind: 'error'; path: string; message: string }

/** What the person highlighted, as the comment will name it. */
export type ReviewSelection = {
  path: string
  label: string
  quote: string
  /** Rows (or grid rows) the highlight covers, to draw it: first and last. */
  from: number
  to: number
  /** Grid only: first and last column. */
  colFrom?: number
  colTo?: number
}

export type ReviewComment = {
  id: string
  path: string
  label: string
  quote: string
  text: string
  status: 'draft' | 'sent'
  from: number
  to: number
  colFrom?: number
  colTo?: number
}

/** What Claude's last edit changed in the open file: rows of a document, cells of a sheet ("sheet:row:col"). */
export type Changed = { path: string; key: number; rows: number[]; cells: string[] }

export type View = {
  /** First visual line (or grid row) in view. */
  top: number
  /** Grid only: first column in view. */
  left: number
  sheet: number
  /** Showing a formatted file's raw source instead. */
  raw?: boolean
  /** The keyboard cursor and where its selection started: [row, column]. */
  cur?: [number, number]
  anc?: [number, number]
}

declare module 'claude-code' {
  interface PluginState {
    'review-pane': {
      files: string[]
      current: string | null
      doc: Doc | null
      view: View
      selection: ReviewSelection | null
      comments: ReviewComment[]
      autoOpen: boolean
      changed: Changed | null
    }
  }
}
