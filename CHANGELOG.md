# Changelog

## 0.9.2 — 2026-10-10

- Directory check MOD_CAPABILITY_USE_NOT_PLAIN: the helper that takes `$` is renamed `knownPath`, so no other name in the file (a local `listed` remained) can be mistaken for it. No change in behaviour.

## 0.9.1 — 2026-10-10

Fixes for the directory's automated checks; nothing changes in how the pane looks or works.
- `$` is only ever passed to helpers or called plainly: a local variable that shared the helper name `listed` is renamed (MOD_CAPABILITY_USE_NOT_PLAIN).
- No class constructors and no word the directory notes (such as "eval") anywhere in the code: the PDF, picture, formula and timing classes are made by small factory functions instead (MOD_SPELLING_IN_TEXT). Checked against the 0.9.0 readers on 1,155 public test files, 341 pictures and the 6–55 MB files: identical output.
- The key hint for PDFs says "click a line".

## 0.9.0 — 2026-10-10

**Nothing to install. Every file opens straight away, because the pane now reads Word, Excel and PDF files itself.**

**Why:** this change is for the people using the pane. Installing Python was the biggest barrier to getting started, especially on Windows and on work laptops where installing software is hard or not allowed. It also caused most of the problems reviewers found: a setup that could get stuck on Ubuntu, slow files reported as "no Python", Apple's developer-tools prompt popping up on a Mac, and downloads from PyPI. All of that is gone.

- **Shorter prompt.** What the pane sends Claude is one header line plus, for each comment, the file and place, the quoted text and the comment. The per-format editing advice is gone. The quote is still fenced and marked as data.
- **Easier commenting.** Clicking or dragging over lines or cells puts the keys straight in the comment box (no second click), and the box is drawn with a border so it's easy to find; Esc returns to Claude's prompt, and so does sending. Long place names are shortened so the box stays on one line. A short pane drops spacing and hints so the comment box always shows.
- **More below, and the wheel.** Documents say "▼ N more lines below" and have a scrollbar, as sheets do, and the mouse wheel scrolls them.
- **Reload you can see.** If the pane can't reread a changed file by itself (read halfway through a save), it keeps what it showed and lights **⟳ Changed · Reload**. The status line no longer says "/panda to open" for the file already open.
- **A neater panda,** asleep and smaller, shown only when it fits whole.
- **Built-in readers.** Word, Excel and PDF are read by the pane's own TypeScript readers (`hooks/docx.ts`, `xlsx.ts`, `pdf.ts`, with `zip.ts` and `xml.ts`). No Python, no packages, no `/panda setup`, no downloads. Checked against 1,155 public test files: every file the old readers opened still opens, Excel values match Excel more closely, and reading is 3–5 times faster.
- **Files over 4 MB:** Claude Code lets a mod read at most 4 MB, so larger Word, Excel and PDF files (up to 50 MB) need Python 3 on your computer, used only to pass the file's bytes. It's optional: without it, the pane says so plainly. `/panda setup` now only checks for Python, and if it's missing can put a request in your prompt box for Claude to help (nothing happens unless you press Enter).
- **Big files open fast.** Only the start of a large sheet or document is unpacked, so a 20 MB workbook opens in about a second. A PDF that holds more than can be read quickly shows what was read, with a note.
- **Pictures.** Pictures in Word, PDF, Markdown and HTML files each get a **▣ Picture** row. Click it and, in kitty or Ghostty, the picture is drawn sharp under the document. Other terminals can only draw coloured blocks, which made pictures unreadable, so there the pane shows a card with an **Open in …** button that opens the file in the computer's own app (not over SSH, where it would open on the server). Pictures the pane can't draw (EMF and WMF drawings, Word charts, scanned black-and-white PDF pages, pictures on the web, Confluence pictures) say what they are and where to see them. Excel says how many charts and pictures a workbook has. PNG files open up to 4 MB (was 2 MB).
- **Safer prompts.** The fence around quoted text has a new random name in each prompt, and now holds the file name and location too. Invisible characters are removed, line separators become new lines, and an `@` before a path becomes `＠`. **Quoted for Claude**, under the comment box, shows exactly what a comment will quote. A comment whose text changes before it's sent is marked as changed.
- **Security.** No reading of Claude Code's settings (colours are the theme's own). Claude's tools refuse a file whose real location can't be found. The scan after a command skips links and hidden files. Another plugin can't drive `/panda` to change settings or open files outside the working folder. The `NotebookEdit` hook is gone.
- **Easier start.** A one-time welcome message after install, an empty pane that says what to try, `/panda examples` that works without Python (the Markdown, Confluence, HTML and CSV samples; the Excel, Word and picture samples still need Python), into a new folder every time, `~` in `/panda` paths, and paths dragged in from a Mac terminal.
- **Excel:** whole-column sums such as `=SUM(B:B)` are calculated, and very large numbers show as Excel does (`1E+100`).
- **Directory checklist:** the sample picture is now drawn by `make_examples.py` itself (`plan-prices.png`), so no script refers to a bundled image; README images use Markdown image syntax.
- **Upgrading from 0.8 or earlier:** the Python setup is no longer used. You can delete its folder, `~/.cache/lazy-panda-panel/venv` (on Windows, `%USERPROFILE%\.cache\lazy-panda-panel\venv`). Python itself, if you installed it, is an ordinary app you can keep or remove.
- **Smaller fixes:** notes under the document wrap instead of being cut off; one product name in every message; the same file in different letter case is one tab on Windows; Windows long paths (`\\?\C:\…`) are understood.

## 0.8.1 — 2026-10-09

**Help for people without Python, and they stay in charge.**
- When `/panda setup` finds no Python, it installs nothing. It puts a plain-language request in the prompt box, asking Claude to help install Python. Nothing happens unless you press Enter. Claude is asked to explain what it would install, ask before installing, and walk you through it step by step.
- When `/panda setup` fails, the error goes into a request the same way, so Claude can explain it and help fix it.
- Opening a Word, Excel or PDF file without Python now says "Run /panda setup and Claude can help you install it", not developer instructions.

## 0.8.0 — 2026-10-09

**Windows support**, and fixes from the directory's scan and from a first install on another machine.

- **Windows:**
  - Paths with drive letters and backslashes work. Claude's `open_file` and `open_files` open files in a Windows working folder; before, they were refused.
  - Paths that differ only in letter case count as the same, as Windows treats them.
  - The scan for new files is skipped at a drive root and in `C:\Users\<name>`.
  - Python is found as `python3`, then `py -3`, then `python`. On Windows, `python3` is often only the Microsoft Store placeholder.
  - The venv is found in `Scripts\python.exe`.
  - The helper waits for its venv copy rather than calling `execv`, which on Windows lost the output.
  - The helper reads and writes UTF-8 whatever the system code page.
- **`/panda` always answers.** If it fails, it says why. Before, it could show Claude Code's "no command.run hook answered it" (seen on `/panda examples` without Python).
- **No Python:** opening a Word, Excel or PDF file, `/panda setup` and `/panda examples` say how to install Python.
- **One helper command.** The mod runs only `scripts/extract.py`, with its task on standard input. `/panda examples` goes through it too.
- **README:**
  - Restart Claude Code (or `/reload-plugins`) after installing.
  - Windows requirements.
  - `~` isn't expanded in `/panda` paths.
  - The hooks are only `Bash`, `Write`, `Edit` and `NotebookEdit`, not every tool call.
  - A fuller credentials statement, including what the theme read sees.
  - The uninstall steps cover the marketplace too.
- The project's internal working notes (handover, review plan and review reports) are no longer shipped with the plugin.

## 0.7.0 — 2026-10-09

**Renamed: Inline Doc Review is now Lazy Panda Panel.** The new name is distinctive, so it won't be confused with generic tools.

- Plugin `lazy-panda-panel`, command `/panda` (was `/inline-review`), tools `mcp__lazy-panda-panel__open_file` and `open_files`.
- The repository is now `paragpandyareal/lazy-panda-panel`. GitHub redirects the old URL.
- The Python helpers now live in `~/.cache/lazy-panda-panel/venv`. Run `/panda setup` once, then you can delete `~/.cache/inline-doc-review`.
- For the directory review:
  - Every command the mod runs is now fixed text; file paths go to the Python helper on standard input.
  - The tool hooks name only `Bash`, `Write`, `Edit` and `NotebookEdit`, not every tool.
  - The mod reads no environment variables, so `~` is no longer expanded in `/panda` paths; type the full path.
  - `/panda examples` now has the bundled Python script write the samples, so the mod itself writes no files.
  - The README has a section on exactly what the mod hooks, runs, sends and writes.
  - There is a listing icon.
- A pixel-art panda, drawn in half-block characters like Claude Code's own mascot, naps in the empty pane and sits at the top of the README.
- Existing users: install `lazy-panda-panel` and uninstall `inline-doc-review`. Claude Code treats a renamed plugin as a new one.

## 0.6.0 — 2026-10-09

Security, reliability and clean-up, after independent security, QA, code-quality, transparency and simplification reviews.

**Comments**
- Comments are tied to the text they quote, not row numbers. When the file changes, each waiting comment finds its text again, even if it moved. If the text was rewritten, it's marked **⚠ text changed**, and the prompt tells Claude.
- A comment is matched by its exact place (file, sheet, range), so two paragraphs on one HTML line no longer share a comment.
- "Claude is working" now lasts until Claude's turn ends, and a send made while Claude is busy waits for the right turn.
- Edit before sending adds your comments after anything already in the prompt box. They show as "in the prompt box", with **↩ back to drafts** to take them back out.

**Security**
- Spreadsheet formulas are calculated by a small built-in calculator (`scripts/formulas.py`), not pycel, which compiled formulas into Python and ran them.
- `/inline-review setup` installs from a hash-locked `scripts/requirements.txt` (wheels only, every dependency pinned).
- The prompt fences quoted document text as data (`<file-excerpt>`, lines prefixed `> `). A document can't close the fence.
- Claude's `open_file` and `open_files` only open files in the working folder (no hidden folders), files Claude wrote, or files already open.
- Control characters and terminal escapes are stripped from everything shown or sent.
- Size limits: text over 10 MB is refused and over 2 MB is shown plain; at most 20,000 rows; images over 2 MB are refused; Word, Excel and PDF files over 50 MB are refused.
- The folder scan after commands is skipped in the home folder, at `/`, and for subagents.
- The helper only switches into its venv if no other user can write to it.
- `SECURITY.md`, plus README sections on permissions, privacy and uninstalling.

**Fixes**
- Word: numbered and nested lists, tracked insertions, content controls, equal adjacent cells, numbering restarts.
- Excel: chart sheets, wrong dimension tags, time and currency formats, array formulas, hidden sheets, newlines in cells, CJK and emoji widths, sheet names with apostrophes or `!`.
- PDF: password-protected files, and a note when pages are cut.
- Markdown: `snake_case`, `# C#`, escapes, single-dash and pipeless tables, underlined headings, 4-space lists, nested fences, table anchors.
- HTML: a 1 MB page now parses in well under a second (it took about 12 s). Also attributes containing `>`, unclosed `<head>`, `colspan`, more entities, out-of-range entities, per-table headers.
- ADF: null or unknown nodes, nested task lists, deep nesting.
- Large files no longer hit the state limit: documents are cached outside `$.state`.
- Quick key presses no longer drop moves. The first arrow key starts where you're looking. ← → do nothing in documents.
- Clicking a comment in a long wrapped document scrolls to it.
- A deleted file says so. Files restored with an older modification time are picked up.
- Auto-open no longer resets the view of a file you're already reading.
- `/inline-review` accepts quoted paths and `~`, and refuses unsupported types.
- The file bar fits narrow panes.

**Removed**
- The sliding sheet tabs (now buttons), the comment-marker pop, the range sparkline, and compatibility code for older versions.

## 0.5.0 — 2026-10-08

**Renamed: Review Pane is now Inline Doc Review.**

- Plugin name `inline-doc-review` (was `review-pane`); command `/inline-review` (was `/review-pane`); tools `mcp__inline-doc-review__open_file` / `open_files`. Saying "open inline review" opens it.
- Repository moved to `paragpandyareal/inline-doc-review`; GitHub redirects the old URL.
- Python helpers live in `~/.cache/inline-doc-review/venv`. Run `/inline-review setup` once after updating.
- Existing users: install `inline-doc-review` and uninstall `review-pane`, since a rename is a new plugin to Claude Code.
- Fix: `/inline-review examples` did not switch into the helper venv (a venv's python links to the system one), so generating the Excel and Word samples failed.

Entries below use the old name.

## 0.4.1 — 2026-10-08

- Fix: after Claude edited a file with a command (e.g. a Python script), the pane could keep showing "Claude is working on 1 comment" and not refresh. The pane now checks the open files' modification times directly after every command and every 2 seconds, so any edit shows at once. When Claude finishes a turn, sent comments stop showing as in progress.

## 0.4.0 — 2026-10-08

Ready for Anthropic's plugin directory checks.

- `/review-pane examples` writes a sample of each file type and opens them. The Excel and Word samples are generated locally (`scripts/make_examples.py`), so the plugin holds no Office or PDF binaries.
- `/review-pane setup` installs exact, pinned package versions.
- The README now lists everything the plugin runs, reads, writes and downloads.
- Adds `displayName` "Review Pane".

## 0.3.5 — 2026-10-08

- The top bar is one line: the open file's name (with extension), a ▾ dropdown listing every open file, and a ‹ n/N › stepper. Click ▾ or press ↓/Enter on the bar to drop the list down; ↑↓ and Enter, or a click, jump to a file; ← → step through them in order.

## 0.3.4 — 2026-10-08

- File tabs no longer squeeze names: tabs wrap onto extra rows, names drop their extension, and a coloured square shows each file's type.
- New calmer colour scheme (slate and blue, GitHub-style dark and light) replaces the purple Catppuccin palette: blue for focus, teal for formulas, amber for comments, green for changes.

## 0.3.3 — 2026-10-08

- Fix: `open_file` and `open_files` failed in a live session. Claude Code passes tool arguments on the event itself (not under `input`, as the test kit does), and it requires a text result.

## 0.3.2 — 2026-10-08

- New `open_files` tool: Claude can open several files as tabs at once, in order. `replace: true` starts the pane fresh, with only those tabs and no old comments (for a clean review or a demo).
- Up to 8 file tabs show in the top bar (was 6).

## 0.3.1 — 2026-10-08

- Fix: pressing keys while the mod was mid-update could crash the pane (`props.colors.text`, `pal.selection`). The views are read from disk on each draw, while the main module reloads between turns, so for a moment the two could be on different versions. Both views now fall back to theme colours and safe defaults for anything missing.

## 0.3.0 — 2026-10-08

First public release.

- **File types:** Excel, Word, PDF, Markdown, Confluence (ADF), HTML, PNG, and text/CSV/JSON/YAML.
- **Formatted views** for Markdown, ADF, HTML and Word, with no raw markup on screen. A **Source** switch shows the raw file.
- **Excel:**
  - Calculated values, with formulas worked out locally by `pycel` when the file holds no saved results.
  - Formula cells tinted and marked `ƒ`; a formula bar shows the clicked cell's formula.
  - Σ, average and a sparkline for a selected range.
  - Frozen header, zebra rows, "N more ▶" / "▼ N more rows" markers and a scrollbar.
- **Comments:** many per file and across files, each editable from the list. Clicking a commented spot edits its comment rather than duplicating it. Send now, or put them in the prompt box first.
- **Motion:**
  - Cells and paragraphs Claude changed glow green and fade.
  - A spinner shows while Claude works.
  - A new comment's marker pops in.
  - The tab underline slides.
- **Look:** a theme-aware palette (Catppuccin Mocha / Latte), with the theme's own colours under ANSI and colour-blind themes. Each file type gets a coloured badge.
- **Opening files:** auto-open (off by default) once Claude finishes a turn that made 1–5 documents. `/review-pane` command and an `open_file` tool Claude can call.
