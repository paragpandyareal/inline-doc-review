# How Lazy Panda Panel works

Lazy Panda Panel is a Claude Code **mod**: a plugin made of *function hooks* (TypeScript that runs inside Claude Code) rather than shell-command hooks. It draws a pane, listens to what Claude does, and hands your comments back to Claude as a prompt.

## The loop

```
 Claude writes or edits a file ──► tool.call hook notes it ──► (auto-open) pane shows it
                                                                   │
           you highlight + comment ◄─────────────────────────────┘
                     │
                     ▼
 "Send" ──► $.prompt.submit(feedback message) ──► Claude edits the real file
                     ▲                                              │
                     └── reload, diff, changed cells glow ◄─────────┘
```

The pane **never edits files itself**. Claude does every edit, with whatever library suits the file. The pane itself reads every format with its own TypeScript readers, so nothing needs installing. This was deliberate: an early version let you edit inside the pane, and Word and Excel edits made that way lost formatting.

## Files

| File | Runs in | What it does |
|---|---|---|
| `.claude-plugin/plugin.json` | — | The manifest, including `"types"`, the state contract |
| `.claude-plugin/marketplace.json` | — | Makes this repository installable with `/plugin install` |
| `hooks/hooks.json` | — | Names the hooks module |
| `hooks/register.tsx` | hooks environment | **The hooks.** File loading and the document cache, watching for changes, the comment lifecycle, the tools and the command. The pane is drawn by one small function per section. |
| `hooks/model.ts` | hooks environment | **Pure logic, no `$`:** laying documents out (`wrapRows`), naming a selection (`describeLines`, `describeGrid`), finding a comment again after an edit (`reanchor`), diffing two reads (`diffDocs`), and the prompt (`feedbackPrompt`) |
| `hooks/text.ts` | both | Strips control characters and escapes; counts widths in terminal cells (CJK and emoji take two) |
| `hooks/viewer.tsx` | drawing thread (a `Client` surface module) | The document and grid view. Turns mouse drags and keys into posts. Runs the changed-cell glow on one timer. |
| `hooks/filebar.tsx` | drawing thread | The top bar: file-type badge, the open file's name, a ▾ dropdown of all open files, a ‹ n/N › stepper (← →), and switches that shrink to icons on a narrow pane |
| `hooks/spinner.tsx` | drawing thread | "Claude is working on N comments…" |
| `hooks/md.ts`, `html.ts`, `adf.ts` | hooks environment | Read Markdown, HTML and ADF into formatted rows (`DocRow`) |
| `hooks/format.ts` | hooks environment | Shared reader helpers: inline Markdown, table layout, gaps |
| `hooks/panda.ts` | hooks environment | The napping panda in the empty pane: pixel art drawn with half blocks (`▀▄`), two pixels per character; shown only where the pane has room for all of it |
| `hooks/palette.ts` | hooks environment | Colours as Claude Code theme keys (so the pane follows any theme without reading settings), and file-type badges |
| `hooks/zip.ts` | hooks environment | Reads zip files (Word and Excel files are zips): DEFLATE with table-driven decoding, checksums, caps against zip bombs, and `textStart` to unpack only the start of a large part |
| `hooks/xml.ts` | hooks environment | A one-pass XML scanner and a small tree builder; DOCTYPEs skipped, entities never expanded |
| `hooks/xlsx.ts`, `hooks/formulas.ts` | hooks environment | Excel: values as Excel shows them, shared formulas, and a small, safe calculator for formulas with no saved result (files written by openpyxl never have one). A large sheet is read from its start only, and the scan stops once the shown rows and the calculator's cells are in. |
| `hooks/docx.ts` | hooks environment | Word: headings, lists, tables, tracked changes accepted, and every picture as a row of its own |
| `hooks/pdf.ts`, `pdf-fonts.ts`, `pdf-crypto.ts` | hooks environment | PDF: cross-reference streams and repair, filters, fonts and ToUnicode, right-to-left text, empty-password encryption (RC4, AES, AES-256, written out here), and images drawn on pages, with a work budget |
| `hooks/picture.ts` | hooks environment | Pictures: PNG, JPEG (baseline and progressive) and GIF decoded and scaled down to at most 720 px as they're read. Drawn sharp as an `Image` only where the terminal can (kitty, Ghostty, from `TERM`/`TERM_PROGRAM`), and only then decoded; elsewhere the pane shows a card with an **Open in …** button (`open` / `xdg-open` / `explorer.exe`, on Linux only with a desktop), because half-block cells can't show a picture legibly. |
| `scripts/read_file.py` | a Python process, only if Python is there | Prints one Word, Excel or PDF file's bytes as base64, for files over 4 MB (all Claude Code reads for a mod). Standard library only. |
| `scripts/make_examples.py` | a Python process, only if Python is there | Writes the Excel and Word samples and the picture for `/panda examples` (a mod can write only text). Standard library only. |
| `types/index.d.ts` | — | The state contract. Every `$.state` value and its type. |
| `tests/*.test.tsx`, `tests/office.ts` | `claude plugin test` | The tests: each file type, two comments sent together and Edit before sending for every type, auto-open, pictures, keys, re-anchoring, the send lifecycle, prompt fencing and injection, tool confinement, size limits, large files with and without Python, Windows paths, reader edge cases. `office.ts` builds real .xlsx, .docx, .pdf and .png files for them. |

## The document model

Every file becomes one of these:

- **`lines`:** a list of `DocRow`s (`text`, `anchor`, `style`, `spans`, `indent`, `marker`, `tone`).
  - `anchor` is the place, in words Claude can act on: `line 12`, `paragraph 5 (under "Pricing")`, `content[4].content[1]`, `<p> at line 15` (`<p> #2 at line 15` for the second on that line), `page 2, line 7`.
  - Formatted documents (Markdown, ADF, HTML, Word) draw without line numbers and use `style` (h1–h3, p, li, quote, code, th/td, panel, rule, space).
- **`grid`:** sheets of cells, `{ v: shown value, f?: formula, x?: number }`, with `isCut` and `isHidden` flags.
- **`image`:** PNG bytes plus their size, read from the header.
- A `lines` document may carry **`pictures`**: each picture's row has `pic`, its index, and the picture is decoded only when that row is selected, and only in a terminal that can draw it (Markdown and HTML rows carry `src` instead, read from beside the file).
- **`error`:** a message the pane shows instead.

**Parsed documents are not kept in `$.state`.** A workbook can be far bigger than a state value may be (about 4 million characters). They live in a small cache in `register.tsx`, keyed by path. `$.state` holds only `open: { path, version }`. Each new read bumps `version`, and that redraws the pane.

**Paths are kept in one form.** `normalizePath` (in `model.ts`) writes every path with forward slashes and no `.` or `..`. Windows paths keep their drive in capitals (`C:/Users/…`). Every path the mod holds goes through it: the working folder, tool arguments, `/panda` arguments, and paths from the helper and from `$.fs`. So `C:\a\b.md` and `C:/a/b.md` are one tab, and the working-folder check compares Windows paths without case, as Windows does.

**Layout is cached** by path, version, width and view. A key press or scroll only slices the visible lines; it doesn't wrap the whole document again. Scrolling geometry is kept per surface (terminal or desktop).

**A slow load can't win.** `show()` notes the file it is loading and drops the result if another file was asked for in the meantime.

## Comments

A comment holds its file, sheet, range, label, **the text it quotes**, and your words.

- **Tied to text, not row numbers.** Every time a file is read again, each waiting comment looks for its quoted text: its first line (or last line, if the start was edited), nearest to where it was. It moves there, and its label follows (`line 3` becomes `line 5`). If the text is gone, the comment is marked stale ("⚠ text changed") and stays put. In a spreadsheet, a comment stays on its cells unless the same values moved together by whole rows. Then it follows them.
- **Matching is by place, not label.** Selecting the same file, sheet and range again edits that comment.
- **Lifecycle:** `draft` → `queued` (Edit before sending put it in the prompt box) → `sent`, with a batch id.
  - Send submits the prompt and registers the batch. A send made while Claude is mid-turn is marked to skip that turn's end.
  - `prompt.submit` turns queued comments into a sent batch when the prompt carrying them is submitted.
  - `turn.complete` (main agent only) clears exactly the batches that turn answered.
  - File changes never clear comments, because Claude may still be working.

## The prompt

`feedbackPrompt` builds one message:
- One header line that says what to do and that fenced text is data. Each item has, inside a fence named afresh for every prompt (`<file-excerpt-3fa91c07>`), the file (relative to the working folder when inside it), the place, and the quote with every line prefixed `> `; then, outside it, `Feedback:`. Nothing else: no per-format editing advice.
- Look-alikes of the fence tag are neutralised, control and invisible characters are stripped, line separators become new lines, an `@` before a path becomes `＠`, a heading named in the location is cut to 60 characters, and the excerpt is capped at 1,200 characters and labels at 200.
- The header `Lazy Panda Panel feedback:` is how the hooks recognise the pane's own prompts.

## Hooks

| Hook | Why |
|---|---|
| `session.start` | Registers `/panda` and the two tools. Reads the auto-open setting, the working folder's real path, and four environment variables (`TERM`, `TERM_PROGRAM`: can pictures be drawn; `DISPLAY`, `WAYLAND_DISPLAY`: does this Linux have a desktop for **Open in …**), and shows a welcome message once. Rereads the open file and drops sends whose turn this module can no longer follow. Starts the 2-second timer. |
| `tool.call` (`Bash`, `Write`, `Edit`) | A passthrough: it never blocks or changes a call. After Write or Edit it notes the file. After Bash it rereads listed files whose modification time changed, then scans the working folder for new documents (not links or hidden files, not in a home folder or a root, not for subagents). |
| `tool.call` (`open_file`, `open_files`) | The model's tools, confined to the working folder, files Claude wrote, and files already open. A `.catch` answers with an error if opening fails. |
| timer (every 2 s) | Stats the listed files (at most 30) and rereads any whose modification time changed, one refresh at a time. A missing file shows "deleted or moved"; a file still there that reads as broken keeps the last view and lights Reload. |
| `prompt.submit` | Resets the turn's file list; turns queued comments into a sent batch |
| `turn.start` / `turn.complete` | Tracks the running turn; clears answered batches; auto-open |
| `ui.render` (Pane `review`) | Draws the pane |
| `ui.message` | Posts from the viewer and the file bar: select, move, scroll, sheet, tab, and the switches (`source`, `reload`, `auto`). A click or drag that selects asks for the keyboard (`$.ui.open({ focus })`, granted while the prompt box is empty) so the comment box's `autoFocus` takes it; arrow keys never do. |
| `ui.scroll` | The mouse wheel over the pane scrolls the document by three rows a tick; the pane draws its own window, so the engine's is left alone |

Every gating hook has a `.catch` that passes the event on, so a failure in the pane never blocks Claude.

## Design decisions (and why)

These came from the owner's feedback and from two design reviews: a UX/UI critique and a visual and motion spec.

1. **Claude edits, the pane only shows.** Editing Word and Excel in place lost formatting.
2. **Formatted, not raw.** Business users found `##`, `**` and `|` hard to read. Markdown, ADF, HTML and Word render as documents, with Source one click away.
3. **Calculated values in Excel, formulas marked.** Users want to see the sum, know which cells are formulas without clicking, and see the formula when they click. Formula cells get a tint plus `ƒ`. The formula bar shows `ƒx =SUM(…) = 16,700`.
4. **More below says so.** Sheets: "N more ▶", "▼ N more rows" and a scrollbar. Documents: "▼ N more lines below" and a scrollbar. Nobody misses hidden rows.
5. **Short panes stay usable.** Under 26 rows the pane drops spacing, box borders and key hints, so the comment box always shows.
6. **A reread that fails is visible.** When an automatic reread finds a file still there but unreadable (halfway through a save), the pane keeps what it showed and lights **⟳ Changed · Reload**; Reload shows what is on disk.
7. **One box: where you type.** Inside the pane's own frame the only box is the comment box, so new users can find it. No emoji in layout-critical spots, since emoji width breaks alignment. Colours follow the terminal theme; ANSI and colour-blind themes get the theme's own keys.
8. **Click, then type.** Selecting with the pointer moves the keys into the comment box; Esc returns them to Claude's prompt. Sending does too (`releaseKeys`: there's no call to hand the keys back, so the pane lets go of the selection and closes and reopens without asking for focus). The comment box's key changes with each file switch, so unsent text never follows you to another file.
9. **Pictures sharp or not at all.** Half-block previews made text in pictures unreadable, so pictures are drawn only where the terminal shows real pixels (kitty, Ghostty); elsewhere a card opens the file in the computer's own app.
10. **A short prompt.** Only the place, the quote and the feedback for each comment, plus one line marking the quote as data.
11. **Comments stay editable until sent.** Clicking a commented spot edits its comment instead of creating a duplicate.
12. **Auto-open is opt-in** and lives in the top bar, not next to Send.
13. **Comments carry exact anchors** (`Budget!C3`, `content[4].content[1]`, `lines 12–14`) plus quoted text, so Claude edits the right spot.
14. **Motion with a purpose:** the changed-cell glow (the payoff) and the spinner (it's working). Nothing else moves.
15. **Comments follow their text** (owner's requirement), and stale ones say so instead of silently pointing at the wrong line.
16. **Document text is data.** It is fenced in the prompt, and Claude's tools can't open files outside the working folder.

## Developing

```bash
# Load your working copy in a session (hot-reloads as you save)
claude --plugin-dir /path/to/lazy-panda-panel

claude plugin validate .      # what the engine will load, and what it would refuse
claude plugin test .          # the tests
```

To type-check, Claude Code writes its API types to `.claude-plugin/types/` once it has loaded the mod. Then run `tsc -p .`.

Gotchas we hit:
- **Helpers must be declared at the top of a file.** Any function a hook passes `$` to has to be declared at the top level of the module, or the validator refuses it.
- **Atom references need literals:** `atom({ plugin: 'lazy-panda-panel', key: 'files' } as const, …)`.
- **Client props can't hold `undefined`.** Leave the field out instead, or the pane refuses the tree.
- **Choose command names with care.** The engine refused `/review` because it clashes with the built-in `/code-review`. That's why the command is `/panda`.
- **`$` can't be put in an object.** Pass it as an argument to each top-level function instead.
- **Register test mocks before the first `$` call.** `tests/setup.ts` has `begin(on)` for the mocks and `start($)` to start the session in `/w`.
- **The test kit needs mocks for side effects.** It has no fs, process or clock: answer `fs.read`, `process.spawn` and the rest in the test, and use `mock.store(on)` and `mock.clock(on)`.
- **A hook has 10 seconds of its own time.** Reading is budgeted to stay far inside it on a slow laptop: only the start of a large part is unpacked, scans stop when they have enough, and the PDF reader has a work budget.
- **A click doesn't give a pane the keyboard.** `$.ui.focus` is refused until the pane holds the keys; `$.ui.open({ focus: true })` asks for them (granted only over an empty prompt box), and then an `autoFocus` Input takes the ring.
- **`Image` draws only in kitty and Ghostty;** elsewhere it shows its `alt` text. Hence the picture card.
- **`$.ui.open({ rows })` is a request.** A size the person set wins, so the layout must fit any height: see the compact mode in `docHeight`.
- **A mod reads at most 4 MiB and writes only text.** Hence Python, when present, for larger Word, Excel and PDF files and for the binary samples.
