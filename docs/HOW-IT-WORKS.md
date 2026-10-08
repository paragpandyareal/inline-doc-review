# How Review Pane works

Review Pane is a Claude Code **mod**: a plugin made of *function hooks* (TypeScript that runs inside Claude Code) rather than shell-command hooks. It draws a pane, listens to what Claude does, and hands your comments back to Claude as a prompt.

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
| `hooks/register.tsx` | hooks environment | **The core.** Hooks, state, file loading, the pane layout (`ui.render`) and message handling (`ui.message`). |
| `hooks/viewer.tsx` | drawing thread (a `Client` surface module) | The document and grid view. Turns mouse drags and keys into posts. Runs the motion: the changed-cell glow and the comment-marker pop. |
| `hooks/filebar.tsx` | drawing thread | The top bar: file-type badge, the open file's name, a ▾ dropdown of all open files, a ‹ n/N › stepper (← →), and switches |
| `hooks/tabs.tsx` | drawing thread | Sheet tabs under a spreadsheet, wrapping when many; the underline slides between tabs |
| `hooks/spinner.tsx` | drawing thread | "Claude is working on N comments…" with a braille spinner and a sweeping highlight |
| `hooks/md.ts`, `html.ts`, `adf.ts` | hooks environment | Read Markdown, HTML and ADF into formatted rows (`DocRow`) |
| `hooks/format.ts` | hooks environment | Shared helpers: inline Markdown, table layout, span tidying |
| `hooks/palette.ts` | hooks environment | Colours: a slate-and-blue scheme (GitHub-style dark/light) chosen by the `/config` theme, theme keys under ANSI and colour-blind themes, and file-type badges |
| `scripts/extract.py` | a Python process | Reads `.docx`, `.xlsx` and `.pdf` into JSON. Runs itself under `~/.cache/review-pane/venv` once `/review-pane setup` has created it. Uses `pycel` to calculate formulas that have no saved result (files written by openpyxl never have one). |
| `types/index.d.ts` | — | The state contract. Every `$.state` value and its type, declared under `PluginState['review-pane']`. |
| `tests/*.test.tsx` | `claude plugin test` | 19 tests: every file type opened and commented on, the comment flow, keys, motion, tab order. `dump*.test.tsx` print what the pane draws, which is useful when changing the layout. |

## The document model

Every file becomes one of these:

- **`lines`:** a list of `DocRow`s (`text`, `anchor`, `style`, `spans`, `indent`, `marker`, `tone`).
  - `anchor` is the place, in words Claude can act on: `line 12`, `paragraph 5 (under "Pricing")`, `content[4].content[1]`, `<p> at line 15`, `page 2, line 7`.
  - `isFormatted` docs (Markdown, ADF, HTML, Word) draw without line numbers and use `style` (h1–h3, p, li, quote, code, th/td, panel, rule, space).
- **`grid`:** sheets of cells, `{ v: shown value, f?: formula, x?: number }`.
- **`image`:** PNG bytes plus their size, read from the header.
- **`error`:** a message the pane shows instead.

`wrapRows` (in `register.tsx`) turns rows into the visual lines that fit the pane's width, keeping each span's emphasis. Tables and code never wrap.

## State

Everything the drawing reads lives in `$.state` (declared in `types/index.d.ts`), never in module variables, because a hot reload resets those:

| Key | What it holds |
|---|---|
| `files` | Open tabs. Order is stable: new files are added at the end. |
| `current`, `doc` | The shown file and its read model |
| `view` | `top`, `left` (scroll), `sheet`, `raw` (source view), and the keyboard cursor `cur` and anchor `anc` |
| `selection` | What is highlighted, already turned into a `label` and `quote` |
| `comments` | `draft` comments wait in the list. `sent` ones are cleared when the file changes on disk. |
| `autoOpen` | Mirrored to `$.store`, so it outlives the session |
| `changed` | What Claude's last edit changed (rows or `sheet:row:col` cells) plus a counter `key`. The viewer glows when the key changes. |

## Hooks

| Hook | Why |
|---|---|
| `session.start` | Registers `/review-pane` and the `open_file` tool. Reads the theme and the auto-open setting. Rereads the open file, since the format may have changed across versions. |
| `tool.call` (Write, Edit, MultiEdit, NotebookEdit) | Notes files Claude wrote |
| `tool.call` (Bash) | Scans the working folder (3 levels deep, skipping `node_modules`, `.git` and the like) for supported files changed during the command, which catches files Python scripts make |
| `prompt.submit` / `turn.complete` | Collects the files made in a turn. If auto-open is on and the turn made 1–5 documents, opens the pane on them. |
| `ui.render` (Pane `review`) | Draws the pane |
| `ui.message` | Posts from the viewer and tabs: select, move, scroll, sheet, tab, and the switches (`source`, `reload`, `auto`) |

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
9. **Motion with a purpose:** the changed-cell glow (the payoff), the spinner (it's working), the comment pop and the tab slide. All motion runs on the viewer's own frame clock and stops itself.

## Developing

```bash
# Load your working copy in a session (hot-reloads as you save)
claude --plugin-dir /path/to/review-pane

claude plugin validate .      # what the engine will load, and what it would refuse
claude plugin test .          # the 19 tests
```

To type-check, Claude Code writes its API types to `.claude-plugin/types/` once it has loaded the mod. Then run `tsc -p .`.

Gotchas we hit:
- **Helpers must be declared at the top of a file.** Any function a hook passes `$` to has to be declared at the top level of the module, or the validator refuses it.
- **Atom references need literals:** `atom({ plugin: 'review-pane', key: 'files' } as const, …)`.
- **Client props can't hold `undefined`.** Leave the field out instead, or the pane refuses the tree.
- **Choose command names with care.** The engine refused `/review` because it clashes with the built-in `/code-review`. That's why the command is `/review-pane`.
- **The views can run a newer version than the main module.** `viewer.tsx` and `tabs.tsx` are read from disk on each draw, while `register.tsx` reloads only between turns. Mid-update, a new view can get an old main module's props, so every new prop needs a default in the view. `tests/old-props.test.tsx` guards this.
- **The test kit needs mocks for side effects.** It has no fs, process or clock: answer `fs.read`, `process.run` and the rest in the test, and use `mock.store(on)` and `mock.clock(on)`.
