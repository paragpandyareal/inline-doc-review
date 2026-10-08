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
| QA (exploratory, new tests) | running | `docs/reviews/qa.md` |
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
