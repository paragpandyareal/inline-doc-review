# Inline Doc Review: project handover

Read this first when picking the project up in a new Claude Code session. The independent review and fix round (security, QA, code quality, transparency, simplification) is **done** in 0.6.0; see [REVIEW-PLAN.md](REVIEW-PLAN.md) and the reports in `reviews/`. This file covers what exists, where it lives, how it got here and why, and what's next.

_Last updated: 2026-10-09, at version 0.6.0._

## In one paragraph

Inline Doc Review is a Claude Code mod built by Parag Pandya, a PM, for people who use Claude Code for business work. Their outputs are Excel, Word, PDF, Markdown, Confluence (ADF), HTML and PNG files. The pane opens those files inside Claude Code, formatted the way business readers expect. You highlight a part (cells, lines, paragraphs, an image), write comments, and send them all to Claude, which edits the real file. The pane then shows what changed. The owner's bar for the look: *"unless it's visually amazing and pretty, no one will like it even if it's useful."*

## Where things are

| What | Where |
|---|---|
| Source of truth | `/home/parag/inline-doc-review` (git repository) |
| GitHub | https://github.com/paragpandyareal/inline-doc-review (public). The repo is its own marketplace. |
| Install for anyone | `/plugin install inline-doc-review --marketplace paragpandyareal/inline-doc-review`, then `/inline-review setup` once |
| Develop with hot reload | `claude --plugin-dir /home/parag/inline-doc-review`, or install as above and use `/reload-plugins` after edits |
| Python helper venv | `~/.cache/inline-doc-review/venv` (python-docx, openpyxl, pypdf; hash-locked in `scripts/requirements.txt`) |
| Sample files | `examples/`; also `/home/parag/review-pane-samples/` on the VPS |
| Architecture | [HOW-IT-WORKS.md](HOW-IT-WORKS.md) |

The mod was first developed in a session-scoped folder (`~/.claude/dev-mods/<session-id>/inline-doc-review`). Those folders only load in the session that made them, so **always work from `/home/parag/inline-doc-review`**.

## How it got here: the timeline and the why

1. **Idea.** The owner wanted the files Claude produces to open in a pane inside Claude Code, without hunting for them in folders. Opening a named file on request was part of it too.
2. **First plan: edit in the pane.** For HTML/MD the plan was text editing; for Word/Excel, structured editing. A deep check showed Word and Excel editing by hand in a terminal would be "half-baked": openpyxl drops charts, and formulas don't recalculate.
3. **Pivot: highlight, comment, Claude edits.** This became the core design. The pane is read-only. Comments carry exact anchors and quotes, and Claude does the edit with the right library.
4. **The `/review` name clash.** The engine refused `/review` because it collides with the built-in `/code-review`. That broke `session.start` silently, so the `open_file` tool was missing too. Renamed to `/inline-review`.
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
12. **Published** to GitHub as its own marketplace, with docs. Renamed from Review Pane to Inline Doc Review (0.5.0).
13. **Independent reviews and fixes (0.6.0).** Five reviews were run: security, QA, code quality, transparency and simplification. The main changes:
    - pycel (which compiled formulas into Python and ran them) was replaced by a small safe calculator.
    - Setup dependencies are hash-locked.
    - Document text is fenced in the prompt as data.
    - Claude's tools are confined to the working folder.
    - Comments are tied to their text, not row numbers (owner's requirement), and stale ones are flagged.
    - Documents moved out of `$.state` into a cache.
    - The send lifecycle follows Claude's turn.
    - 34 QA bugs were fixed and about 15% of the code was cut.

## Current status

- **Done and tested:**
  - 84 tests in `tests/`: every file type, the comment flow, keys, tab order, the source switch, the glow and spinner, re-anchoring, the send lifecycle, prompt fencing, tool confinement, size limits, and the QA reader cases.
  - Two Python checks in `tests/python/`: the formula calculator (21 checks, including hostile formulas) and the extraction of tricky Word, Excel and PDF files (19 checks).
- **Seen live:** the owner used the Excel flow live up to 0.5.0. **0.6.0 has passed the test kit but not yet been used live.** Ask the owner to try it.
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
- **Anthropic directory listing:** prepared, not submitted. The owner will publish later; see "Publishing to Anthropic's directory" below.

## How to work on it in a new session

1. `cd /home/parag/inline-doc-review && git pull`
2. Start Claude Code with `claude --plugin-dir /home/parag/inline-doc-review`, or install from the marketplace.
3. Read `docs/HOW-IT-WORKS.md`, then `hooks/register.tsx`, which holds the layout in `ui.render`.
4. After changes: `claude plugin validate .` and `claude plugin test .`, then bump the version in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`, update `CHANGELOG.md`, commit and push.
5. Users get updates with `claude plugin update inline-doc-review`, then `/reload-plugins`.

## Start a new session on this project

From the VPS shell:

```bash
cd /home/parag/inline-doc-review && git pull && claude --plugin-dir /home/parag/inline-doc-review "Read docs/HANDOVER.md and docs/HOW-IT-WORKS.md, then let's continue on Inline Doc Review"
```

`--plugin-dir` loads this working copy (and hot-reloads it as files change), so the session both runs and develops the mod. The demo files for screen recordings are in `/home/parag/energy-regs-demo/`. Ask Claude to "open the demo files in the inline review pane".

## Publishing to Anthropic's directory (when the owner decides)

**Where it would live.** [Anthropic's directory](https://claude.ai/directory) is the official public catalog. People browse it on claude.ai (Customize → Plugins → Discover), with `/plugin directory` in Claude Code, and at [claude.com/marketplace/plugins](https://claude.com/marketplace/plugins). Mods are listed there **for Claude Code**. Anthropic's `claude-plugins-official` marketplace is a different thing: it takes listings only through Anthropic partner contacts.

**Readiness (checked 2026-10-08 against the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)):**

| Check | Status |
|---|---|
| `claude plugin validate --strict .` | ✔ passes |
| `name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license` | set |
| README (more than 40 words) and LICENSE | present (MIT; copyright header in every source file) |
| Text and images only, files under 256 KiB, under 512 files, no system files or symlinks | ✔ (check again before submitting: `find . -size +256k -not -path './.git/*'`) |
| Dependencies pinned | every package and its dependencies pinned with sha256 hashes in `scripts/requirements.txt`; wheels only |
| README discloses what it runs, reads, writes and downloads | "Permissions and data", "Things to know", "Privacy", "Uninstall" |
| Security contact and threat model | `SECURITY.md` (private GitHub advisories) |
| Tool descriptions match behaviour | they state the folder confinement, that no content is returned, and that `replace` deletes unsent comments |
| No code execution from documents | formulas are interpreted by `scripts/formulas.py`, with no `eval` or `exec` |
| No credentials, no network calls of its own | ✔ |

**Possible reviewer holds (not blockers):**
- **Generic name:** `inline-doc-review` is made of generic words, so the portal may hold it as "Name may be confused with an existing listing". A reviewer then decides. If the owner wants to avoid that, rename **before the first listing** (for example `parag-inline-doc-review`), since names are permanent once people install.
- **Package installs:** `/inline-review setup` downloads from PyPI. Everything is hash-locked, but a reviewer may still note it.
- **A hook on every tool call:** it is a passthrough, and the README says so.

**Steps:**
1. Bump `version` in `.claude-plugin/plugin.json` and `marketplace.json`, update `CHANGELOG.md`, then commit and push.
2. Sign in to claude.ai with a paid plan and open [claude.ai/directory/manage](https://claude.ai/directory/manage).
3. **Submit new** → **Plugin bundle** → repository `paragpandyareal/inline-doc-review`, branch `main`, plugin path: the repository root.
4. Press **Validate**. Fix anything marked **Blocking**, push, then **Re-validate**.
5. Submit. After that the security scan and review run; the developer portal shows progress.
6. For later versions, bump `version` and push; the directory picks up new commits on the followed branch.
