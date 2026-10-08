# Review Pane: project handover

Read this first when picking the project up in a new Claude Code session. It covers what exists, where it lives, how it got here and why, and what's next.

_Last updated: 2026-10-08, at version 0.3.0._

## In one paragraph

Review Pane is a Claude Code mod built by Parag Pandya, a PM, for people who use Claude Code for business work. Their outputs are Excel, Word, PDF, Markdown, Confluence (ADF), HTML and PNG files. The pane opens those files inside Claude Code, formatted the way business readers expect. You highlight a part (cells, lines, paragraphs, an image), write comments, and send them all to Claude, which edits the real file. The pane then shows what changed. The owner's bar for the look: *"unless it's visually amazing and pretty, no one will like it even if it's useful."*

## Where things are

| What | Where |
|---|---|
| Source of truth | `/home/parag/review-pane` (git repository) |
| GitHub | https://github.com/paragpandyareal/review-pane (public). The repo is its own marketplace. |
| Install for anyone | `/plugin install review-pane --marketplace paragpandyareal/review-pane`, then `/review-pane setup` once |
| Develop with hot reload | `claude --plugin-dir /home/parag/review-pane`, or install as above and use `/reload-plugins` after edits |
| Python helper venv | `~/.cache/review-pane/venv` (python-docx, openpyxl, pypdf, pycel) |
| Sample files | `examples/`; also `/home/parag/review-pane-samples/` on the VPS |
| Architecture | [HOW-IT-WORKS.md](HOW-IT-WORKS.md) |

The mod was first developed in a session-scoped folder (`~/.claude/dev-mods/<session-id>/review-pane`). Those folders only load in the session that made them, so **always work from `/home/parag/review-pane`**.

## How it got here: the timeline and the why

1. **Idea.** The owner wanted the files Claude produces to open in a pane inside Claude Code, without hunting for them in folders. Opening a named file on request was part of it too.
2. **First plan: edit in the pane.** For HTML/MD the plan was text editing; for Word/Excel, structured editing. A deep check showed Word and Excel editing by hand in a terminal would be "half-baked": openpyxl drops charts, and formulas don't recalculate.
3. **Pivot: highlight, comment, Claude edits.** This became the core design. The pane is read-only. Comments carry exact anchors and quotes, and Claude does the edit with the right library.
4. **The `/review` name clash.** The engine refused `/review` because it collides with the built-in `/code-review`. That broke `session.start` silently, so the `open_file` tool was missing too. Renamed to `/review-pane`.
5. **Excel formulas.** The owner wanted calculated values, not `=SUM(…)`. Files written by openpyxl carry no cached results, so `pycel` now computes them locally. Formula cells are coloured (owner's request: "different colour") and marked `ƒ`. A formula bar shows the clicked cell's formula.
6. **First UX review** (UX/UI expert agent): one frame instead of boxes in boxes, no emoji in layout, sheet tabs under the grid, an Excel-style formula bar with Σ and average, verb-first copy ("Send 2 comments to Claude", "Edit before sending").
7. **Crash and recovery.** The owner pressed arrow keys and "lost everything". The causes:
   - A redesign changed the cell format while a stale document was held in state, so the pane failed to draw.
   - Arrow keys weren't wired to the file tabs.
   - Claude Code itself restarted (2.1.293 → 2.1.295 update), which unloaded the session-scoped mod.

   Fixes: reread the open file on every reload, a stale-format guard, and arrow keys on the tabs.
8. **Many comments, editable before sending.** The owner commented on C3, then C4, then C6, and wanted to revisit all of them before sending. Adding a comment used to reset the cursor; now it doesn't. The list shows every comment, clicking one jumps to its spot and edits it, and clicking a commented spot edits rather than duplicates.
9. **More formats and the business-user lens.** Added ADF (important for Confluence publishing), PNG, PDF and HTML. The owner was firm that Markdown and ADF must render as formatted documents, not markup, for business readers. Formatted readers were added for Markdown, ADF, HTML and Word, with a Source switch.
10. **Visual and motion pass** (visual design agent):
    - Theme-aware Catppuccin palette and coloured file-type badges.
    - Top bar with the switches (auto-open moved there, since the owner said its old spot was bad).
    - H1 bands, H2 accent bars, panel icons, zebra tables, key-chip footer.
    - A clear divider between comments and key hints (owner: "separation is not clear").
    - Big-sheet indicators (owner: "people may miss that there is other content").
    - The changed-cell green glow, the send spinner, the comment-marker pop and the sliding tab underline.
11. **Tab order fix.** Opening a file used to move it to the front, so → bounced between two files. The order is now stable.
12. **Published** to GitHub as its own marketplace, with docs.

## Current status

- **Done and tested** (19 tests in `tests/`): every file type opens, selects, comments and sends; the multi-comment edit flow; arrow keys; tab order; source switch; the spinner and changed-cell glow; the big-sheet view.
- **Verified for real only in part.** The owner used the Excel flow live and it worked end to end (B2 changed to 700). Mouse dragging works in their terminal. The later visual pass (palette, top bar, motion) passed the test kit but **had not yet been seen live** at handover time. Ask the owner how it looks.
- **Owner's terminal:** reported `TERM=xterm-256color` at 80 columns, so PNG pictures show as text there; only kitty or Ghostty draw them.

## Known limits and ideas for next

- **PNG** can only be commented on as a whole; there's no region selection.
- **HTML** shows as a readable document, not pixel-rendered. A rendered view is possible with headless Chromium streaming frames into an `Image`: the API supports it, and Chromium is at `~/.cache/ms-playwright`. It would only work in kitty or Ghostty.
- **PDF** shows text only. A page image via `pdftoppm`/Chromium is possible in kitty or Ghostty.
- **Excel:** shows at most 500 rows × 40 columns per sheet. No charts. Merged cells show as separate cells.
- **Desktop app:** the pane works, but the Client views (grid, tabs) fall back to plain text there. Commenting needs the terminal.
- **Visual spec items not done yet:**
  - a Raster minimap for big sheets
  - a skeleton shimmer while loading
  - an empty-state animation
  - a `motion: full | reduced | off` setting
  - `?` help and `⋯` overflow menus in the top bar
- **Tests type-check loosely.** The test files have some type errors (`$.command.run` args, `console`). They run fine but should be tidied.
- **Submitting to Anthropic's official plugin directory:** not done. Check the current process for submitting plugins and mods to the official marketplace.

## How to work on it in a new session

1. `cd /home/parag/review-pane && git pull`
2. Start Claude Code with `claude --plugin-dir /home/parag/review-pane`, or install from the marketplace.
3. Read `docs/HOW-IT-WORKS.md`, then `hooks/register.tsx`, which holds the layout in `ui.render`.
4. After changes: `claude plugin validate .` and `claude plugin test .`, then bump the version in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`, update `CHANGELOG.md`, commit and push.
5. Users get updates with `claude plugin update review-pane`, then `/reload-plugins`.
