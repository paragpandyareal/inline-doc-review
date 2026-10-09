# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Please report it privately. On GitHub, open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue. You'll get a reply within 7 days.

## Threat model

**Trust boundary.** Inline Doc Review is a Claude Code mod. It runs inside Claude Code with your user account's permissions, outside Claude Code's sandbox. Claude Code's permission rules don't govern the mod's own file reads, process launches or prompt submissions. That is why the mod keeps them few and narrow. The README's [Permissions and data](README.md#permissions-and-data) section lists each one.

**What it treats as untrusted:** the content of every document it shows. That includes text, cell values, formulas, sheet names, headings, HTML and ADF structure.

| Risk | Mitigation |
|---|---|
| **Prompt injection:** a document contains text meant to steer Claude, which ends up in the prompt carrying your comments | A prompt is only sent when you press Send, or press Enter after "Edit before sending". Quoted text sits inside `<file-excerpt>` fences, each line starts with `> `, and the prompt says it is data, never instructions. A document can't close the fence early: `</file-excerpt` inside it is neutralised. Control characters and ANSI escapes are stripped, and labels are capped at 200 characters and excerpts at 1,200. For untrusted files, use Edit before sending and read the prompt first. |
| **Code execution from spreadsheet formulas** | Formulas are calculated by `scripts/formulas.py`, a small interpreter for 17 functions (SUM, IF, SUMIF and so on). It never calls `eval`, `exec` or `compile`; `tests/python/check_formulas.py` checks this. Anything else is left uncalculated. It is capped at 2,000-character formulas, 100,000-cell ranges, nesting depth 60 and 2 million steps. |
| **Parser denial of service** (huge or deeply nested files, regex backtracking) | Text files over 10 MB are refused; over 2 MB they are shown as plain text. Documents are cut at 20,000 rows. Inline Markdown patterns are bounded and skipped for lines over 5,000 characters. The HTML reader works in linear time. ADF nesting is capped at 50 levels. Word, Excel and PDF files over 50 MB, or over 300 MB unzipped, are refused, and the helper has a 60-second timeout. |
| **Malformed Word, Excel or PDF files exploiting parsers** (lxml, openpyxl, pypdf) | Pinned versions, a 60-second timeout, and size limits. The helper runs as you, so open untrusted files with the care you'd give any document. |
| **Claude opening files it shouldn't** | `open_file` and `open_files` only open files under the working folder (links resolved, no hidden folders), files Claude wrote this session, and files already open. Anything else needs you to run `/inline-review <path>`. The tools never return file content to Claude. |
| **Supply chain at setup** | `/inline-review setup` installs from `scripts/requirements.txt`: every package pinned, every wheel hash-checked (`--require-hashes --only-binary=:all: --no-deps`), so no source builds. |
| **Venv tampering** (`~/.cache/inline-doc-review/venv` is executed) | The helper only switches into the venv if it belongs to you (or root) and no other user can write to it. The venv is created with umask 022. To be sure, delete the folder and run setup again. |
| **Terminal escape injection** (a file that moves the cursor or rewrites the screen) | ANSI escapes and control characters are removed from all document text before drawing. |
| **Scanning more than intended** | The post-command scan covers the working folder only, 3 levels deep with a 4,000-entry limit. It is skipped when the working folder is your home folder or `/`, and for subagents. |

**Known limits:**
- Before setup, the helper runs on your system `python3` and uses whatever packages are installed there.
- `python3` is found through your `PATH`.
- Text inside a document can still try to persuade Claude. The fence makes this much harder but can't make it impossible.

**Out of scope:** Claude Code itself, Anthropic's API, and what Claude does with a prompt you send.
