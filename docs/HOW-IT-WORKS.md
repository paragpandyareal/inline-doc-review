# How Inline Doc Review works

Inline Doc Review is a Claude Code **mod**: a plugin made of *function hooks* (TypeScript that runs inside Claude Code) rather than shell-command hooks. It draws a pane, listens to what Claude does, and hands your comments back to Claude as a prompt.

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

The pane **never edits files itself**. Claude does every edit with the right library (openpyxl, python-docx, JSON for ADF), so formatting survives. This was deliberate: an early version let you edit inside the pane, and Word and Excel edits made that way lost formatting.

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
| `hooks/palette.ts` | hooks environment | Colours by `/config` theme, and file-type badges |
| `scripts/extract.py` | a Python process | Reads `.docx`, `.xlsx` and `.pdf` into JSON. It switches into `~/.cache/inline-doc-review/venv` once `/inline-review setup` has made it, but only if no one else can write to it. |
| `scripts/formulas.py` | a Python process | A small, safe formula calculator for formulas with no saved result (files written by openpyxl never have one). It reads formulas and never runs them as code. |
| `scripts/requirements.txt` | — | The setup packages, pinned and hash-locked |
| `types/index.d.ts` | — | The state contract. Every `$.state` value and its type. |
| `tests/*.test.tsx` | `claude plugin test` | 84 tests: each file type, the comment flow, keys, re-anchoring, the send lifecycle, prompt fencing, tool confinement, size limits, reader edge cases (from the QA review) |
| `tests/python/*.py` | Python | `check_formulas.py` (the calculator, including hostile formulas) and `check_extract.py` (tricky Word, Excel and PDF files, generated on the fly) |

## The document model

Every file becomes one of these:

- **`lines`:** a list of `DocRow`s (`text`, `anchor`, `style`, `spans`, `indent`, `marker`, `tone`).
  - `anchor` is the place, in words Claude can act on: `line 12`, `paragraph 5 (under "Pricing")`, `content[4].content[1]`, `<p> at line 15` (`<p> #2 at line 15` for the second on that line), `page 2, line 7`.
  - Formatted documents (Markdown, ADF, HTML, Word) draw without line numbers and use `style` (h1–h3, p, li, quote, code, th/td, panel, rule, space).
- **`grid`:** sheets of cells, `{ v: shown value, f?: formula, x?: number }`, with `isCut` and `isHidden` flags.
- **`image`:** PNG bytes plus their size, read from the header.
- **`error`:** a message the pane shows instead.

**Parsed documents are not kept in `$.state`.** A workbook can be far bigger than a state value may be (about 4 million characters). They live in a small cache in `register.tsx`, keyed by path. `$.state` holds only `open: { path, version }`. Each new read bumps `version`, and that redraws the pane.

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
- A header that says what follows is data. Each item has `File:`, `Location:`, the quote inside `<file-excerpt>` with every line prefixed `> `, and then `Feedback:`.
- A `</file-excerpt` inside the file is neutralised, control characters are stripped, and the excerpt is capped at 1,200 characters and labels at 200.
- The header `Review feedback from the Inline Doc Review pane.` is how the hooks recognise the pane's own prompts.

## Hooks

| Hook | Why |
|---|---|
| `session.start` | Registers `/inline-review` and the two tools. Reads the theme, the auto-open setting and the working folder's real path. Rereads the open file and drops sends whose turn this module can no longer follow. Starts the 2-second timer. |
| `tool.call` (all tools) | A passthrough: it never blocks or changes a call. After Write, Edit, MultiEdit or NotebookEdit it notes the file. After Bash it rereads listed files whose modification time changed, then scans the working folder for new documents (not in the home folder or `/`, not for subagents). |
| `tool.call` (`open_file`, `open_files`) | The model's tools, confined to the working folder, files Claude wrote, and files already open |
| timer (every 2 s) | Stats the listed files (at most 30) and rereads any whose modification time changed. A missing file shows "deleted or moved". |
| `prompt.submit` | Resets the turn's file list; turns queued comments into a sent batch |
| `turn.start` / `turn.complete` | Tracks the running turn; clears answered batches; auto-open |
| `ui.render` (Pane `review`) | Draws the pane |
| `ui.message` | Posts from the viewer and the file bar: select, move, scroll, sheet, tab, and the switches (`source`, `reload`, `auto`) |

Every gating hook has a `.catch` that passes the event on, so a failure in the pane never blocks Claude.

## Design decisions (and why)

These came from the owner's feedback and from two design reviews: a UX/UI critique and a visual and motion spec.

1. **Claude edits, the pane only shows.** Editing Word and Excel in place lost formatting.
2. **Formatted, not raw.** Business users found `##`, `**` and `|` hard to read. Markdown, ADF, HTML and Word render as documents, with Source one click away.
3. **Calculated values in Excel, formulas marked.** Users want to see the sum, know which cells are formulas without clicking, and see the formula when they click. Formula cells get a tint plus `ƒ`. The formula bar shows `ƒx =SUM(…) = 16,700`.
4. **Big sheets say so.** "N more ▶", "▼ N more rows" and a scrollbar, so nobody misses hidden columns or rows.
5. **One frame, three accents.** No boxes inside the pane's own frame and no emoji in layout-critical spots, since emoji width breaks alignment. Colours follow the terminal theme. ANSI and colour-blind themes get the theme's own keys.
6. **Comments stay editable until sent.** Clicking a commented spot edits its comment instead of creating a duplicate.
7. **Auto-open is opt-in** and lives in the top bar, not next to Send.
8. **Comments carry exact anchors** (`Budget!C3`, `content[4].content[1]`, `lines 12–14`) plus quoted text, so Claude edits the right spot.
9. **Motion with a purpose:** the changed-cell glow (the payoff) and the spinner (it's working). Nothing else moves.
10. **Comments follow their text** (owner's requirement), and stale ones say so instead of silently pointing at the wrong line.
11. **Document text is data.** It is fenced in the prompt, and Claude's tools can't open files outside the working folder.

## Developing

```bash
# Load your working copy in a session (hot-reloads as you save)
claude --plugin-dir /path/to/inline-doc-review

claude plugin validate .      # what the engine will load, and what it would refuse
claude plugin test .          # the 84 tests
python3 -I tests/python/check_formulas.py
~/.cache/inline-doc-review/venv/bin/python -I tests/python/check_extract.py
```

To type-check, Claude Code writes its API types to `.claude-plugin/types/` once it has loaded the mod. Then run `tsc -p .`.

Gotchas we hit:
- **Helpers must be declared at the top of a file.** Any function a hook passes `$` to has to be declared at the top level of the module, or the validator refuses it.
- **Atom references need literals:** `atom({ plugin: 'inline-doc-review', key: 'files' } as const, …)`.
- **Client props can't hold `undefined`.** Leave the field out instead, or the pane refuses the tree.
- **Choose command names with care.** The engine refused `/review` because it clashes with the built-in `/code-review`. That's why the command is `/inline-review`.
- **`$` can't be put in an object.** Pass it as an argument to each top-level function instead.
- **Register test mocks before the first `$` call.** `tests/setup.ts` has `begin(on)` for the mocks and `start($)` to start the session in `/w`.
- **The test kit needs mocks for side effects.** It has no fs, process or clock: answer `fs.read`, `process.run` and the rest in the test, and use `mock.store(on)` and `mock.clock(on)`.
