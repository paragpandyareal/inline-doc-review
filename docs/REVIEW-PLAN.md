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
| Code quality | running | `docs/reviews/code-quality.md` |
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
