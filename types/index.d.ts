/** A run of text inside a row with its emphasis: bold, italic, code, link, strike, dim. */
export type Span = { t: string; b?: 1; i?: 1; c?: 1; l?: 1; s?: 1; d?: 1 }

/**
 * How a row is drawn. Formatted documents (Markdown, ADF, HTML, Word) use
 * h1–h3, p, li, quote, code, th/td, panel, rule and space; plain files draw
 * every row as a numbered line.
 */
export type RowStyle =
  | 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'code' | 'th' | 'td' | 'panel' | 'rule' | 'space'
  | null

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
  isHidden?: boolean
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
  /** Grid only: the sheet's name, as stored (the label quotes it Excel's way). */
  sheet?: string
  /** Made in a formatted file's source view. */
  raw?: true
  label: string
  quote: string
  /** Rows (or grid rows) the highlight covers, to draw it: first and last. */
  from: number
  to: number
  /** Grid only: first and last column. */
  colFrom?: number
  colTo?: number
}

/**
 * A comment is tied to its file and the text it quotes, not to row numbers:
 * when the file changes, `from`/`to` are found again by the quote, and a
 * comment whose text is gone is marked stale.
 */
export type ReviewComment = ReviewSelection & {
  id: string
  text: string
  /** draft: waiting here; queued: in the prompt box; sent: Claude is on it. */
  status: 'draft' | 'queued' | 'sent'
  /** The send it went out in. */
  batch?: string
  /** Its quoted text is no longer in the file. */
  isStale?: true
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
    'inline-doc-review': {
      files: string[]
      /** The file shown, and a counter bumped each time it is (re)read; the document itself is held by the hooks module. */
      open: { path: string | null; version: number }
      view: View
      selection: ReviewSelection | null
      comments: ReviewComment[]
      autoOpen: boolean
      changed: Changed | null
    }
  }
}
