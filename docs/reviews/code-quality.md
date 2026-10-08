# inline-doc-review: code-quality review (v0.5.0)

Scope: everything in `hooks/`, `scripts/`, `types/`, `tests/` and `docs/`, checked against `claude-code.d.ts` and `reference.md` (2.1.295). `claude plugin validate --strict` passes, and 25/25 tests pass. I confirmed some claims with extra tests that I ran on a copy in `/tmp/claude-1001/codereview/idr`:

- A 20k-line Markdown file fails with `$.state.set: the value is 6546686 characters, over the 4194304 limit`, and the hook is skipped.
- An 8,000-paragraph HTML file takes **8.0 s** to open (the hook budget is 10 s).
- In a 6,000-line Markdown file, 10 arrow keys take **more than 5 s**.
- A slow reload of A that lands after the user switches to B leaves the tab bar on B and the **viewer showing A**.

## Findings

| ID | Sev | Where | Problem → why it matters | Fix |
|---|---|---|---|---|
| F1 | High | register.tsx:161-171, 181-187, 426-434 | `track`, `show` and `toggleSource` await `loadDoc` (up to 60 s) and then write `doc` without checking `current` again. `current`, `doc` and `view` are written separately. Confirmed: B's tab shows A's content, so comments, glow and toasts go to the wrong file. | Use one atom `{path, doc, view}` written once, and a load token. Drop stale results. |
| F2 | High | register.tsx:66-110, 167, 186 | The whole parsed document (about 3× the source size) is one `$.state` value, and the limit is 4.19M characters. Files over about 1.5 MB fail with no message. Every render also reads the full document. | Keep the parsed document in a module cache keyed by path+mtime, and only small state in atoms. Or cap the rows and set `note`. |
| F3 | High | html.ts:23, 110 | `lineAt` slices and splits the whole prefix on every tag, so parsing is O(n²). A medium-sized page hits the hook budget and the hook is dropped. | Build a newline-offset table once and binary-search it. |
| F4 | High | register.tsx:793-837 | Every render runs `wrapRows` on the whole document, plus the stripe pass, `rows.some` ×3 and `filter`, on every key or scroll. That's more than 0.5 s per key at 6k lines. | Memoize the layout by (path, version, width, raw). Only slice it per render. |
| F5 | High | register.tsx:612-622, 1119 | `$.prompt.submit` only *queues* the prompt. If Claude is mid-turn, that turn's `turn.complete` clears "sent" comments and toasts "Claude finished" before Claude has seen them. `track` (173-177) clears them on *any* reload. | Give sent comments a batch id. Clear them only on the completion of the turn that the submit started. |
| F6 | Medium | register.tsx:1111-1123 | `fill` marks comments `sent` even if the user never presses Enter, so the spinner can run forever. `mode:'replace'` also wipes what the user typed. | Keep the comments as drafts until a matching `prompt.submit`. Append when the prompt box isn't empty. |
| F7 | Medium | register.tsx:591-603, 374-391 | After every Bash call, subagents included, the hook walks cwd (depth 3, 4,000 entries, one `fs.list` per directory) and pushes up to 20 files into the tabs. `slice(-30)` can evict the open file. With cwd=`$HOME`, DFS uses up the budget before reaching the project, and files outside cwd are never seen. | Skip the scan when `agentId` is set. Scan only paths the command names. Never evict `current`. Put found files in a "new" list, not the tabs. |
| F8 | Medium | register.tsx:355-362, 796-801, 911 | Render writes module-level `drawn`, which scrolling then reads. With terminal and desktop both drawing, the last one wins. `drawn` is empty after a hot reload. | Derive the geometry in `ui.message` from the memoized layout, per `e.surface`. |
| F9 | Medium | register.tsx:641-706 | `move` computes from `v` and `sel` snapshots taken at the start of the hook. Concurrent posts start from the same `cur`, so key repeat drops moves and the anchor jumps. | Compute inside the `update(view, old => …)` closure. |
| F10 | Medium | register.tsx:813, 1057; `ReviewComment.from/to` | Drafts store row indices and match on label equality. After any edit they point at different text, which is the core use case. | Re-anchor drafts by `quote` on reload and flag the ones that can't be found. |
| F11 | Medium | viewer.tsx:165-187; tabs.tsx:221-241 | `surface.every` is started during render on prop changes (the API says: start it once, while `state` is undefined). Overlapping flashes run two timers and the older one cuts the newer short. Tabs stores a closure in client state. | One mount-time frame timer that advances from state. No closures in state. |
| F12 | Medium | register.tsx:416 | The `now > before` check misses files restored with an older mtime (git checkout, `cp -p`). Deleted files stat to 0 and stay in the tabs for good. | Compare with `!==`. Mark missing files. |
| F13 | Medium | register.tsx:586, 591 | Validate reports "gating hook without .catch" for `prompt.submit` and the global `tool.call` hook, which does heavy work after `next`. | `.catch(($, e, next) => next(e))`. |
| F14 | Medium | extract.py:219-246 | `read_only` trusts the file's `<dimension>` tag, which is often wrong or missing, so a sheet can show only A1. Neither workbook is `close()`d. The pycel fallback loads the full workbook, which is slow for exactly the openpyxl-written files Claude makes. | `ws.reset_dimensions()` plus computing the bounds yourself. `try/finally: close()`. Cap the pycel work and add a note when it's skipped. |
| F15 | Medium | extract.py:291; register.tsx:79-81 | `json.dumps` emits `NaN`, which `JSON.parse` rejects, so the user sees "Could not open the file: SyntaxError". `as Doc` accepts any shape. | Map non-finite values to strings and use `allow_nan=False`. Validate the shape in TS. |

**Low:**
- **F16 (extract.py:156, 177):** output is truncated at 4,000 rows with no `note`.
- **F17 (extract.py:27, 286):** `execv` into a broken venv, or a missing argv, produces a raw traceback, and `setup` never repairs a half-made venv. The venv code is duplicated in make_examples.py.
- **F18 (html.ts:160):** `indexOf('<tr', 0)` makes the `<th>` check apply to the whole document, so later tables get false header rows.
- **F19 (html.ts:14):** `fromCodePoint` throws on an out-of-range entity, which turns the whole page into an error.
- **F20 (format.ts:32):** `_italic_` matches inside snake_case identifiers.
- **F21 (register.tsx:221):** table and code rows send an unclipped `t`, so a long minified line can push Client props past 100k characters and unmount the viewer.
- **F22 (register.tsx:142, 448):** `changed.rows` has no cap, and the theme is read only once per session.
- **F23 (register.tsx:546, 562, 606):** the `(e.input ?? e)` and `as unknown as` casts exist only for the tests' non-standard `input:` calls. The live spread shape works (I tested it).
- **F24:** dead code: Tabs' file-bar mode (`dots`, `badge`, `asides`, group `files`) and `isCurrentShape` (register.tsx:885, 1256). Keep the intentional props-skew fallbacks.

## Test-suite weaknesses

- `dump*.test.tsx` have no assertions; they only log, so they always pass.
- `review.test.tsx:184` asserts `/C/` in the spinner, which almost any text matches.
- Untested: Write/Edit detection, auto-open, the Bash scan, the 2 s watcher (`mock.clock` would cover it), every error path, large documents, races, comment drift after edits, the light theme.
- extract.py has no tests. Pytest with tiny generated fixtures (formula with no cached value, bad dimension tag) would cover F14-F16.
- old-props stubs `every`, so the animation code never runs.
- Click tests depend on fixed coordinates, so layout tweaks break them.

## Top 5 refactors

1. **Document cache outside `$.state`:** `Map<path, {mtime, doc, layoutByWidth}>`, with only small view state in atoms. Fixes F2, F4 and F8.
2. **One `open` atom plus a load token:** a single `load(path)` that commits `{path, doc, view, selection}` in one write. Fixes F1 and the duplication across show, track and toggleSource.
3. **Comment state machine:** `draft → queued(batch) → in-progress(turn) → done`, with re-anchoring by quote. Fixes F5, F6 and F10.
4. **Split register.tsx (1,294 lines)** into load, layout, watch, commands and pane modules, and unit-test the pure functions (`wrapRows`, `describe*`, `diffDocs`, parsers) directly.
5. **Targeted change detection:** watch the open files plus paths named in the command, through one serialized refresh queue. Fixes F7, F12 and F13.

## Done well

- State is written only through `update()` closures, never during render. The Spinner and FileBar timers are correct. Tools are registered in `session.start` and awaited.
- Client props carry only the visible rows and columns. Views tolerate props from an older main module, with tests for that.
- Comment anchors are precise (line ranges, `Sheet!C3:E5`, ADF JSON paths), and the feedback prompt tells Claude how to edit each format in place.
- Python: an isolated venv with pinned versions, read-only extraction, and capped grids.
- `diffDocs` uses a multiset comparison, so it is O(n), and its output is capped. Tests cover both the terminal and desktop surfaces.
