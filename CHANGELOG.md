# Changelog

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
