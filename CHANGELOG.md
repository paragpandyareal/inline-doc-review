# Changelog

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
