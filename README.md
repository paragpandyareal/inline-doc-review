# Review Pane for Claude Code

**Review what Claude makes without leaving Claude Code.**

When Claude produces a spreadsheet, a Word document, a PDF, a Confluence page, a Markdown report or a web page, Review Pane opens it in a side pane. You read it formatted as it should look, highlight the part you want changed, write a comment, and send your comments to Claude. Claude edits the real file. The pane shows the result, and the cells or paragraphs that changed glow green for a moment.

There's no hunting for the file in a folder and no switching apps. You don't need to know how to edit an `.xlsx` or ADF file either.

```
 XLSX  pilot-budget.xlsx  ▾ ‹ 1/3 ›                                    ⟳ Reload   ● Auto-open
  E2     ƒx  =SUM(B2:D2)                                                        = 16,700
 ───────────────────────────────────────────────────────────────────────────────────────
      ┃  A                    B          C          D          E
    1 ┃  Line item            Jan        Feb        Mar        Total
 ━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    2 ┃  Facebook ads           700●     8,000      8,000   ƒ  16,700
    3 ┃  Letterbox print      9,600      4,800          0   ƒ  14,400
    6 ┃  Total            ƒ  13,500  ƒ  21,000  ƒ  16,200   ƒ  50,700
   Budget   Sign-ups
   ━━━━━━
 ✎ Comment on E2  What should change here?                                       Add ⏎

 ── Comments · 2 ── click one to review or edit it ─────────────────────────────────────
 ●  1  B2      Change this to 700                                                    ✕
 ●  2  E2:E5   Should include GST                                                    ✕

 [ ➤ Send 2 comments to Claude ]   Edit before sending
 ───────────────────────────────────────────────────────────────────────────────────────
  click  a cell    drag  a range    ←↑↓→  move    ⇧+arrows  extend    [ ]  sheet
```

## What it shows

| File | How it looks in the pane | What a comment points Claude to |
|---|---|---|
| **Excel** `.xlsx` | A spreadsheet grid with calculated values (not raw formulas). Formula cells are tinted and marked `ƒ`; clicking one shows its formula. Selecting a range shows Σ, the average and a sparkline. Large sheets show "12 more ▶", "▼ 47 more rows" and a scrollbar. | `Budget!B2:D3`, with the cell values and formulas |
| **Word** `.docx` | A formatted document: title, headings, bullets, aligned tables | `paragraph 5 (under "Pricing")` |
| **Confluence** `.adf` | The page as Confluence shows it: headings, @mentions, status lozenges, info and warning panels, tables, checklists | the exact JSON node, e.g. `content[4].content[1]` |
| **Markdown** `.md` | A formatted document, with no `#`, `**` or `\|` symbols. Supports callouts (`> [!NOTE]`). | `lines 12–14 (under "Budget")` |
| **HTML** `.html` | The readable page: headings, text, lists, tables | `<p> at line 15` |
| **PDF** `.pdf` | The text, page by page | `page 2, line 7` |
| **PNG** `.png` | The picture (in kitty or Ghostty terminals) | the whole image |
| Text, CSV, JSON, YAML | Numbered lines | `lines 3–4` |

Markdown, HTML and Confluence files have a **‹› Source** switch for when you want the raw file.

## Install

In Claude Code (terminal), type:

```
/plugin install review-pane --marketplace paragpandyareal/review-pane
```

Answer `y` to add the marketplace and pick a scope. Then, once, run:

```
/review-pane setup
```

This installs the small Python libraries the pane uses to read Word, Excel and PDF files (`python-docx`, `openpyxl`, `pypdf`, `pycel`). They go into their own folder, `~/.cache/review-pane/venv`, and nothing touches your system Python. Markdown, Confluence, HTML, text and PNG files need nothing extra.

**Requirements:** Claude Code with mod (function-hook plugin) support, and Python 3.9 or later. A terminal that supports images (kitty, Ghostty) is only needed to see PNGs.

## Use it

| To… | Do this |
|---|---|
| Open a file | `/review-pane path/to/file.xlsx`, or ask Claude "open the budget". Claude has an `open_file` tool. |
| Open the pane | `/review-pane` |
| Have files open by themselves | Click **○ Auto-open** at the top right, or run `/review-pane auto on`. When Claude finishes a turn that produced 1–5 Word, PDF, PNG, HTML, Markdown or Confluence files, the pane opens on them. It's off until you turn it on. |
| Comment | Click or drag over cells, lines or paragraphs. Type in **Comment on…** and press Enter. Repeat for as many places as you like. |
| Review or change a comment | Click it in the list. It jumps to the spot and the box edits it. Clear the text and press Enter, or click ✕, to delete it. |
| Send | **➤ Send N comments to Claude** sends them now. **Edit before sending** puts them in your prompt box first. |
| Switch files | Click ▾ next to the file name to drop down every open file and pick one, or use ← → on the top bar to step through them. |
| Switch sheets | Click a sheet tab under the grid, or press `[` and `]`. |

**Keyboard** (click the document first): arrows move, Shift+arrows extend the selection, PgUp/PgDn scroll, Backspace clears the selection.

## What Claude receives

One message, with every comment tied to its exact place:

```
Review feedback from the review pane. Apply each item by editing the file directly. …

1. `/home/you/pilot-budget.xlsx`, Budget!C3
   > C3: 4,800
   Feedback: Print is too high, cut to 3,000

2. `/home/you/project-update.adf`, content[4].content[1] (under "Highlights")
   > Penrith is converting best at 32%.
   Feedback: Add the Blacktown figure too
```

The message also tells Claude how to edit each format safely:
- **Word and Excel:** edit with `python-docx` or `openpyxl`, keeping the formatting.
- **ADF:** edit the node at the given path and keep every other node, mark and `localId`.
- **PDF and PNG:** regenerate them from whatever they were made from.

## What it runs and accesses

Review Pane is open about everything it does on your machine:

- **Reads files** you open, and files Claude writes or edits in the session's working folder. After each command Claude runs, it also lists that folder (three levels deep, skipping `node_modules`, `.git` and similar) to notice new or changed documents.
- **Runs a local Python helper** (`scripts/extract.py`) with `python3` to read Word, Excel and PDF files. It runs inside its own virtual environment and does nothing else.
- **Downloads Python packages only when you ask:** `/review-pane setup` creates `~/.cache/review-pane/venv` and installs exact, pinned versions from PyPI: `python-docx==1.2.0`, `openpyxl==3.1.5`, `pypdf==6.19.0` and `pycel==1.0b30`, plus their dependencies.
- **Writes files only when you ask:** `/review-pane examples` writes sample files into the folder you name, `./review-pane-examples` by default. The pane itself never edits your documents.
- **Sends nothing over the network.** Your comments go to Claude only when you press Send or Edit before sending, as a normal prompt in your session.
- **Remembers one setting:** whether auto-open is on, in Claude Code's plugin store.

## Try it

```
/review-pane examples
```

This writes a sample of each type into `./review-pane-examples` and opens them all. The Excel and Word samples are generated on your machine, which needs `/review-pane setup` first. They include `site-consumption.xlsx`, a 60-row × 18-column sheet for trying the big-sheet indicators. The Markdown, Confluence, HTML, CSV and PNG samples are in [`examples/`](examples/).

## Learn more

- [How it works](docs/HOW-IT-WORKS.md): the architecture, for anyone changing the code
- [Project handover](docs/HANDOVER.md): history, design decisions and what's next
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © Parag Pandya
