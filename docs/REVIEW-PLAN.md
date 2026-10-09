# Independent review: plan and status

_Started 2026-10-08. If you are a new Claude Code session picking this up, read this file first, then `docs/HANDOVER.md`._

## What the owner asked for

1. **Transparent docs.** The README and docs must say plainly everything the plugin uses, needs, reads, writes, runs and downloads, because people may see it as a security risk.
2. **Independent reviews** to find every issue, flaw and hack-proofing gap:
   - QA
   - code quality
   - information security
   - transparency and docs
   - code simplification: AI tends to write more code than needed, so get expert feedback on bloat
3. **Fix everything they find**, keep all tests passing, then commit and push to GitHub (`paragpandyareal/inline-doc-review`). **Do not submit to Anthropic's directory**; the owner will do that later.

## Status

| Review | Status | Findings saved to |
|---|---|---|
| Information security and hack-proofing | **done** | `docs/reviews/security.md` |
| QA (exploratory, new tests) | **done** | `docs/reviews/qa.md` (+ tests in `docs/reviews/qa-tests/`, to port into `tests/` as bugs are fixed) |
| Code quality | **done** | `docs/reviews/code-quality.md` |
| Transparency and docs | **done** | `docs/reviews/transparency.md` |
| Simplification and bloat | **done** | `docs/reviews/simplification.md` |

When a review finishes, its report is saved to the file above and this table is updated. **If a report file is missing after a reset, that review did not finish: run it again** with the brief below.

## Briefs, for re-running a review

Each review is an independent agent that **does not modify** the repo; it works on a copy in `/tmp`. All of them get the same context:
- the repo `/home/parag/inline-doc-review`
- the plugin API declarations: the `types/claude-code.d.ts` file that the `plugin-authoring` skill writes, under `/tmp/claude-1001/bundled-skills/<version>/<hash>/plugin-authoring/`
- the test kit: `claude plugin test <dir>`

| Review | Brief |
|---|---|
| Security | Threat model: a malicious document, a malicious working folder, a compromised PyPI, a local attacker, and the model being tricked into calling `open_file`. Check prompt injection through quoted document text in the auto-submitted feedback prompt; whether pycel formula evaluation allows code execution; XML, zip and regex DoS; arbitrary file reads through `open_file`; path traversal in `examples <folder>`; venv hijack through `os.execv`; terminal escape sequences; anything that weakens Claude Code's permission model. Report each finding with severity, file:line, exploit and fix. |
| QA | Edge cases for every file type (merged cells, dates, errors, huge sheets, encrypted or corrupt PDFs, malformed MD, HTML and ADF, unicode, CRLF, deleted files) and every flow (comments, send, source toggle, auto-open, spinner, change detection, narrow pane). Write new tests. Report steps, expected versus actual, and fixes. |
| Code quality | Correctness, races, leaks (timers), performance (re-parsing on every render, the folder scan, the 2-second stat timer), API misuse, error handling, type holes, unbounded growth, weak tests. |
| Transparency | Inventory from the code of every fs, process, prompt, tool, store, config, clock and network effect (file:line). Compare with the docs and list the gaps. Draft SECURITY.md, a plain-language "Permissions & data" section, a privacy note and uninstall steps. |
| Simplification | Line counts, ranked deletions and merges with lines saved, platform features that could replace custom code, a target size, and what is justified. |

## After all five reviews: the fix plan

1. Merge the findings into one prioritised list in `docs/reviews/SUMMARY.md`: Critical, High, Medium, Low.
2. Fix Critical and High first, especially prompt injection and any code-execution path.
3. Apply the simplification plan without losing user-facing behaviour, unless the summary says a feature is dropped.
4. Write `SECURITY.md`, rewrite the README's "What it runs and accesses" section, and add "Privacy" and "Uninstall" sections.
5. Check that it all still passes: `claude plugin validate --strict .`, `claude plugin test .` (25+ tests), and the TypeScript check.
6. Bump the version, update `CHANGELOG.md`, copy the files into the session mods folder if one is in use, then commit and push.
7. Tell the owner what was found, what was fixed, and anything deliberately left as is, with reasons.

## Decisions (owner, 2026-10-08)

The owner leaves the design of each fix to Claude, with two firm requirements:
- **Comments are tied to the file and the text itself, not row numbers.**
- **The goal is official acceptance in Anthropic's plugin directory.** Everything Anthropic checks must be covered: the pre-submission checklist, the security scan and the Software Directory Policy.

### Fix design (chosen)

| Area | Decision | Fixes |
|---|---|---|
| Excel formulas | **Remove pycel** (it compiles formulas to Python and runs `exec`). Replace it with a small, safe formula evaluator in `extract.py`: a parser with no `eval` or `exec`, covering numbers, cell refs and ranges (including `'Sheet'!A1`), `+ - * / ^ &`, comparisons, `SUM AVERAGE MIN MAX COUNT COUNTA ROUND ABS IF IFERROR AND OR NOT`. It reads cached values first. Anything unsupported shows as `ƒ` "not calculated". This also drops numpy and networkx from the supply chain. | SEC F1, F6 (part) |
| Python packages | `requirements.txt` with exact versions **and sha256 hashes for every file on PyPI**, for direct and transitive dependencies. Install with `--require-hashes --only-binary=:all:` and no `--upgrade`. | SEC F6 |
| Prompt injection | Document text goes in a fenced block, marked as untrusted file content, with a closing marker that can't be forged. Labels and file names lose control characters and newlines, and are length-capped. The prompt tells Claude to treat excerpts as data, not instructions. | SEC F2 |
| DoS | Size cap for text formats (about 2 MB) and a row cap with a visible note. Fix the `markdownInline` regex backtracking. A newline-offset table for `htmlRows` `lineAt`. Recursion depth cap for ADF. Safe `fromCodePoint`. | SEC F3, F8; CQ F3, F19 |
| File access | The model's tools (`open_file`, `open_files`) only open files under the session's working folder, after resolving symlinks with `fs.stat(resolve)`, or files the plugin already saw Claude write. `/inline-review <path>` typed by the user may open any path. | SEC F4 |
| Folder scan | Skip it when the working folder is `$HOME` or `/`. Skip it for subagents. Never evict the open file. | SEC F5; CQ F7 |
| Document state | Parsed documents live in a module cache keyed by path and mtime. `$.state` only holds small values (`open: {path, version}`). Loads carry a token, and stale results are dropped. Layout and wrapping are cached by path, version, width and raw. | CQ F1, F2, F4, F8 |
| Comments | Anchored by **file and quoted text**. On reload, drafts re-anchor by finding their text (grid comments keep their cell reference). A draft whose text can't be found is marked "text changed" for the user. The lifecycle is draft → in prompt box → sent → done: a turn only clears the comments that turn received, and "Edit before sending" keeps comments until that prompt is actually submitted. | CQ F5, F6, F10 |
| Robustness | Cursor moves are computed inside the update closure. Animation timers start once on mount. mtime changes are compared with `!==`, and missing files are marked. Gating hooks get `.catch` handlers. extract.py uses `reset_dimensions`, closes workbooks, emits no NaN, and reports truncation. | CQ F9, F11-F17 |
| Simplify | Delete `tabs.tsx` (sheet tabs become Buttons), the pre-0.2 and pre-0.3 compatibility shims, the sparkline, the comment pop, the tab slide and the dump tests. Add shared helpers for repeated update sequences and tool results. Use `atob` for the PNG header. Remove dead types and fields. | SIMP 1-12 |
| Docs | SECURITY.md (threat model, private reporting), plus README sections for permissions and data in plain language, privacy, uninstall and requirements. Bring HOW-IT-WORKS and HANDOVER up to date. Tool descriptions must match behaviour. | TRANSPARENCY |

### Order (commit and push after each phase)
1. Python: safe evaluator, hashed requirements, extract robustness.
2. TypeScript core: document cache, open atom and token, layout cache, comment anchoring and lifecycle, file confinement, scan, catches, DoS fixes, prompt fencing.
3. Simplification removals.
4. Docs.
5. Tests for every fix, then full validation (`--strict`), the test suite and the TypeScript check, then release 0.6.0.

## Progress log
- All 5 reviews done (2026-10-08). QA's failing-by-design tests are parked in `docs/reviews/qa-tests/`. Move each into `tests/` once its bug is fixed.
- Phase 1 started: `scripts/formulas.py` (safe calculator, replaces pycel), written and unit-checked; not yet wired into `extract.py`.
- Phase 1 done in code: `extract.py` rewritten (safe `formulas.py` calculator instead of pycel; hash-locked `requirements.txt`, installed with `--require-hashes --only-binary=:all: --no-deps`; control-character stripping; size and zip-bomb caps; chart sheets, hidden sheets, dates, times, currencies, array formulas; Word numbering, merged cells, tracked insertions, content controls, image placeholder; PDF password message and cut-off note). QA reader checks: 18 of 19 pass. The remaining "numbered list" check is a test error: that file's numbering definition is a bullet.

## Phase 2+ detailed task list (written before a context compaction; this is the source of truth)

State on 2026-10-08:
- Phase 1 (Python) is **done and pushed**. The QA Python checks are parked at `docs/reviews/qa-tests/qa/check_extract.py` (run with the venv python): 18 of 19 pass, and the 1 failure is a QA test error (that file's numbering is really a bullet).
- The helper venv was rebuilt from the hashed `scripts/requirements.txt`, so pycel is gone.
- Everything below is **not started yet**.
- The session mods folder copy at `~/.claude/dev-mods/b1ed36d2-1ff9-41ca-a06c-9b3fc7b4f03b/inline-doc-review` must be resynced from the repo after changes. Also set `/tmp/claude-1001/rp-tscheck/tsconfig.json` for the type-check: its include points at the plugin-authoring `types/claude-code.d.ts`, `hooks` and `types`.

Useful API facts:
- `$.env.get("HOME")` exists (no longer used since 0.7.0: the directory treats environment reads as credential reads).
- `tool.call` events carry `agentId` when they come from a subagent.
- `$.prompt.read()` gives `{text, cursor}`.
- `fs.stat(path, {resolve:true})` gives `realPath`.
- Gating hooks need `.catch(($,e,next)=>next(e))`.
- Helpers that take `$` must be declared at the top level of `register.tsx`, not in another file.
- `atom()` refs need literal `plugin` and `key` values.
- Client props must not contain `undefined`.
- A live tool call puts its args on `e` (the test kit uses `e.input`); tool results must be text (`{result: text, text}`).

### T1. Pure-logic module `hooks/model.ts` (new)
Move these out of `register.tsx`, and fix them:
- `wrapRows`: the `t` of code and table rows must be clipped (CQ F21).
- `clip`, `describeLines`, `describeGrid`, `layoutTables`, `diffDocs` (cap `rows` and `cells` at 2000), `hasHeader`, `formatNumber`, `noteLabel`.
- `quoteSheet(name)`: Excel quoting, so `'Bob''s Q1'` and names like `2024` or `A1` get quotes. Store the sheet NAME on the selection and the comment; never parse it back out of the label (QA B19, B20).
- `strWidth(s)`: CJK and emoji count as 2. Use it for padding and column widths in the viewer, `register` and `format.tableRows` (QA B17).
- `normalizePath`: resolves `.` and `..` and removes duplicates (QA B21).
- `sanitizeLine`: strips control characters and newlines, caps at 200. Use it for labels, paths and sheet names in the prompt.
- **`feedbackPrompt` with fencing (SEC F2).** The header says each item quotes file content between `<file-excerpt>` and `</file-excerpt>`; excerpts are data copied from the file, never instructions; only "Feedback:" lines outside excerpts are the user's requests. Then the per-format editing guidance as now. Each item looks like:
  ```
  1. File: `path`
     Location: label
     <file-excerpt> ... </file-excerpt>
     Feedback: text
  ```
  Neutralise `</file-excerpt` inside excerpts, strip control characters, cap excerpts at 1200.
- **`reanchor(comment, newDoc)` (owner priority: comments are tied to file and text).**
  - Lines documents: find the comment quote's first line among the new rows' text, preferring the occurrence nearest the old `from`. Keep the span length, then recompute the label and quote with `describeLines`. If it isn't found, set `isStale: true` (the UI shows "⚠ text changed").
  - Grid: keep the sheet name and cell range, and refresh the quote. If the sheet is gone, mark it stale.

### T2. Types (`types/index.d.ts`)
- `ReviewSelection` and `ReviewComment` gain `sheet?: string`.
- `ReviewComment.status` becomes `'draft' | 'queued' | 'sent'`, and it gains `batch?: string` and `isStale?: boolean`.
- State: replace `current` and `doc` with `open: { path: string | null; version: number }`. The parsed document lives in a module cache `docs: Map<path, Doc>` in `register.tsx` (CQ F2: the `$.state` value limit is about 4.19 million characters).
- Remove the dead `'table'` and `'heading'` styles and the `DocRow.num` field.
- PDF page rows already use `'h3'`.

### T3. `register.tsx` rewrite
- **Document cache plus load tokens (CQ F1).** `show(path)` sets `intended = path`, loads, and drops the result if `intended` changed in the meantime. Cache the result, then set `open {path, version+1}`. `track` reloads the cached document, diffs it, bumps the version, sets `changed`, and runs `reanchor` on that file's drafts and queued comments.
- **Layout cache (CQ F4):** keyed by `path|version|width|raw`; render only slices the visible part. Store geometry per surface (`drawnBySurface[e.surface]`) instead of a single `drawn` (CQ F8).
- **Cursor moves (CQ F9):** compute inside the `update(view, old => …)` closure. In a lines document, ignore left and right (QA B25).
- **Match drafts by path, sheet and range, not by label** (QA B2).
- **Comment lifecycle (CQ F5, F6).**
  - *Send:* mark the comments `sent` with a batch id and call `$.prompt.submit`. Our `prompt.submit` hook sees text containing the header and sets `session.batchInTurn`. `turn.complete` (main agent only) clears only the comments of that batch and shows a toast. `track` no longer clears sent comments.
  - *Edit before sending:* use `$.prompt.read()`. If the box isn't empty, append instead of replacing. Mark the comments `queued` ("in prompt box", with a "↩ back to drafts" button). When the user submits a prompt containing the header, queued comments move to sent.
- **File confinement (SEC F4).** The model's tools only accept paths whose `realPath` is under the realpath of the working folder, or files the plugin saw Claude write this session (`session.claudeWrote`), or files already open. Otherwise return a clear error that tells the user to run `/inline-review <path>`. Tool descriptions must say this.
- **The `/inline-review <path>` command:**
  - strip quotes, expand `~` (QA B24)
  - check `isSupported` (QA B23)
  - check the size cap
- **Scan (SEC F5, CQ F7).**
  - Skip it when the working folder is HOME or `/`, and when `e.agentId` is set (a subagent).
  - Never evict the open file when capping the list at 30.
  - Files written outside the working folder are still caught by the Write/Edit hook.
- **Change detection (CQ F12):** compare mtime with `!==`. A missing file shows an error document ("deleted or moved").
- **`.catch` on all gating hooks** (CQ F13).
- **Auto-open:** don't call `show()` again if the file is already open; just refresh (QA B12).
- **Selection follows edits:** `jumpTo` scrolls to `firstVisual[c.from]` (QA B10).
- **Text formats:**
  - Strip ANSI and control characters right after reading (QA B1).
  - Size cap: over 2 MB shows plain lines with a note, and over 10 MB is refused.
  - Row cap of 20000 with a note.
- **Grid bar:** show `d.note` (QA B15) and keep the "N more rows in file" hint while a cell is selected (QA B34). Mark hidden sheets "(hidden)" (QA B31).
- **Setup message:** no mention of pycel; it now names the hashed requirements.
- **Theme:** read it again on each `session.start` (already done).

### T4. Readers
- **`format.ts` `markdownInline` (SEC F3, a backtracking DoS):**
  - bounded quantifiers with no newline, e.g. `[^\]\n]{0,300}`
  - skip inline parsing above 5000 characters
  - `_` italic only at word boundaries (QA B29 `my_var_name`)
  - backslash escapes
- **`md.ts` (QA B3, B29):**
  - record each table row's source line while parsing
  - separator rows `|:-|` with a single dash
  - tables without a leading pipe (a line containing `|` followed by a separator line)
  - setext `===` / `---` headings
  - closing `#`s only after a space (`# Learn C#`)
  - nesting from an indent stack (4-space lists)
- **`html.ts` (SEC F3, CQ F3, QA B26, B27, B28):**
  - a newline-offset table with binary search for `lineAt`
  - attribute-aware tag regex: `<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>`
  - skip `<head>` only when `</head>` exists
  - `colspan` support (cap 10)
  - a bigger entity table, plus a guard on `fromCodePoint` (try/catch, falling back to U+FFFD)
  - detect `th` per table
  - unique anchors per element (`<p> #3 at line 1`)
- **`adf.ts` (SEC F8, QA B30):**
  - depth cap of 50
  - skip non-object nodes
  - recurse into nested task lists
  - render the text of unknown nodes

### T5. Simplification (docs/reviews/simplification.md)
- **Delete `hooks/tabs.tsx`;** sheet tabs become `Button`s.
- **Remove compatibility code:** the old-props shims in `viewer.tsx` and `filebar.tsx`, `tests/old-props.test.tsx` and `isCurrentShape`.
- **Remove decoration:** the sparkline, the comment pop and the tab slide. Keep the green glow on changed cells, with ONE timer started on mount (CQ F11) and no functions in Client state.
- **Delete the dump tests** (`tests/dump.test.tsx`, `tests/dump-grid.test.tsx`).
- **Add helpers** for the repeated "reset view and selection" steps and for tool results.
- **Use `atob`** for the PNG size instead of `decodeHead`.
- **Share the parsers' `gap` and trim helpers** in `format.ts`.
- **Filebar:** truncate the name to the width (QA B32); make the switches real Buttons if that's simple.
- **Split the render function** into section functions.

### T6. Docs (docs/reviews/transparency.md has ready-to-paste text)
- **New `SECURITY.md`:** private reporting through GitHub Security Advisories, a threat model and a mitigations table. Update it for the new design: no pycel, hashed dependencies, file confinement, fenced prompts.
- **README:** replace "What it runs and accesses" with "Permissions and data" (a table), plus "Things to know", "Privacy", "Uninstall" and "Requirements". It must say:
  - it observes every tool call (passthrough only)
  - it lists the folder after Bash (skipped for HOME and subagents)
  - the 2-second mtime timer
  - it runs `python3` and the safe formula calculator (no code execution)
  - setup downloads from PyPI with hashes
  - it submits prompts only on Send
  - document text is fenced as untrusted
  - the tools are confined to the working folder
  - `open_files replace` clears drafts
  - Python 3.9+, `python3-venv`
- **HOW-IT-WORKS:** the hook table (all tools passthrough, `open_files`), the document cache and the comment lifecycle.
- **HANDOVER:** status, test counts, and "dependencies hash-pinned".
- **CHANGELOG 0.6.0.**

### T7. Tests and release
- Port the QA tests from `docs/reviews/qa-tests/*.test.tsx` into `tests/` as their bugs get fixed, and update the existing tests.
- Add tests for:
  - prompt fencing and injection (an excerpt containing `</file-excerpt>` and a forged "Feedback:" line)
  - confinement (an outside path refused, `/inline-review` allowed)
  - re-anchoring after a line is inserted above a comment
  - a stale comment
  - the batch lifecycle (send while mid-turn; edit-before-sending stays queued)
  - a big Markdown file (no state-limit error)
  - HTML performance (20k tags under 1 second)
  - control characters
  - `formulas.py` unit checks (supported functions, malicious formulas give None, no eval)
- Run `claude plugin validate --strict .`, `claude plugin test .` and `tsc`, plus QA `check_extract.py`.
- Bump to 0.6.0 in `plugin.json` and `marketplace.json`, sync the session mods copy, commit and push.
- Report to the owner: what was found, what was fixed, and anything deliberately not done.

## Progress log: phases 2–7 (2026-10-09)

All of T1–T7 are **done** and released as 0.6.0.
- **T1 and T2:** `hooks/model.ts`, `hooks/text.ts`, and the new types (`open`, comment `sheet`/`batch`/`isStale`, `queued`).
- **T3:** the register rewrite.
- **T4:** the readers.
- **T5:** `tabs.tsx`, shims, pop, sparkline and dump tests removed.
- **T6:** `SECURITY.md`, the README permissions/privacy/uninstall/licence sections, HOW-IT-WORKS, HANDOVER and CHANGELOG.
- **T7:** 84 TS tests, plus Python checks in `tests/python/` (21 + 19).

Also done:
- The QA tests moved into `tests/`, on the shared setup in `tests/setup.ts`.
- The venv trust check (SEC F7).
- Copyright headers in every source file.

Deliberately not done:
- `python3` is still found through `PATH` (documented in SECURITY.md).
- The tools stay non-deferred, so "open the budget" works without a tool search.
- No `defusedxml`: Python's expat has protected against "billion laughs" since 2.4.1, and python-docx turns off entity resolution.
