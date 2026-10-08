# Transparency and trust review: inline-doc-review 0.5.0

_Reviewed 2026-10-08 against the code (hooks/register.tsx, scripts/*.py, manifests) and the installed venv. No code was changed._

## 1. Ground truth (from code)

| # | Behaviour | When | Evidence |
|---|---|---|---|
| 1 | Wraps **every** tool call Claude makes (`tool.call` with no filter). It only observes: it always calls `next(e)` and returns the result unchanged, so it never approves, denies or rewrites a call | Every tool call, all session | register.tsx:591-610 |
| 2 | After every **Bash** call: stats each open file, then **lists the working folder 3 levels deep** (up to 4000 entries, skips dot-dirs and node_modules/.git/venv/dist/build etc.), and adds up to 20 supported files modified during the command to the pane's file list | Every Bash call | :594-601, :31, :374-391 |
| 3 | After Write/Edit/MultiEdit/NotebookEdit: records `file_path` (any absolute path, not only inside cwd) if the extension is supported | Every successful edit | :605-607, :367-372 |
| 4 | **Timer every 2 s**: `stat` each open file (up to 30) and re-read any whose mtime grew; a changed .docx/.xlsx/.pdf re-runs the Python helper | Whole session, from start | :452, :409-423, :161-179 |
| 5 | Reads file contents: text types via `fs.read`; PNG as bytes (refused over ~2 MB); docx/xlsx/pdf via Python | When a file is shown or changes | :66-110 |
| 6 | Spawns `python3 <plugin>/scripts/extract.py <docx\|pdf\|xlsx> <path>` (60 s timeout); re-execs into the venv if present, otherwise runs on **system python3** with whatever packages it has | Each docx/xlsx/pdf load | :77; extract.py:27-29, 285 |
| 7 | **pycel compiles Excel formulas into Python source and `exec`s it** (pycel/excelformula.py:904) for formula cells with no cached value. Formulas come from the file | Opening an .xlsx | extract.py:224-240, 256-257 |
| 8 | Parses untrusted files with openpyxl (loaded twice), python-docx/lxml, pypdf; `defusedxml` is not installed | Opening docx/xlsx/pdf | extract.py:79, 169, 219-220 |
| 9 | `/inline-review setup`: `python3 -m venv ~/.cache/inline-doc-review/venv`, then `pip install --quiet --upgrade` 4 pinned packages. **Network to PyPI (or your pip index)**; no `--require-hashes`; transitive deps unpinned and `--upgrade` takes newest compatible: lxml, typing_extensions, et-xmlfile, numpy, networkx (<2.7), python-dateutil, ruamel.yaml, six. 10 min timeout | User command only | :527-530; extract.py:17-20, 32-36; venv METADATA |
| 10 | `/inline-review examples [folder]`: writes 4 text samples (overwrites same-named files) and runs `make_examples.py <folder>` → 3 generated .xlsx/.docx (`os.makedirs`) | User command only | :505-525; make_examples.py:391-398 |
| 11 | Registers 2 tools for Claude, always loaded (`isDeferred:false`): `open_file(path)`, `open_files(paths, replace)`. Any readable path with a supported extension; content goes to the pane, **not** to Claude (result is a one-line status). Results reveal whether a path exists. `replace:true` **discards the user's unsent draft comments** | When Claude calls them (subject to permission rules) | :460-486, :544-584 |
| 12 | **Submits a prompt as the user** (`$.prompt.submit`) or fills the prompt box (`$.prompt.fill`), containing: absolute paths, anchor labels (incl. heading text from the doc), **quoted document text** (up to 1200 chars per comment, up to 60 cells), the user's comment, and fixed instructions to edit files directly | Only on Send / Edit before sending | :336-350, :1106-1124 |
| 13 | Auto-open (opt-in): at turn end opens the pane on 1-5 new documents; otherwise status line | Every main-agent turn end | :612-635 |
| 14 | Reads the full Claude Code config list, uses only `theme` | Session start | :448 |
| 15 | Persistent state: `autoOpen` in `$.store`; open files/comments/selection in `$.state` atoms (session) | Toggle / session | :33-40, :453-454, :495, :659 |
| 16 | Registers `/inline-review` command; draws pane; toasts/status | Session start / UI | :455, :711 |
| 17 | No network calls in TS or extract/make_examples except pip. HTML is parsed as text; scripts/styles dropped, nothing fetched | — | html.ts:6, :106 |
| 18 | Platform: POSIX venv path (`venv/bin/python`), Python ≥3.9 per pinned deps; Debian/Ubuntu need `python3-venv`; PNG only in kitty/Ghostty; commenting terminal-only | — | extract.py:18; HANDOVER.md:63 |

**Left behind on uninstall:** `~/.cache/inline-doc-review/` (venv, ~100+ MB with numpy), any examples folders, prompts already sent (they are in Claude Code transcripts under `~/.claude/projects/`). `$.store` data is removed with the plugin's data dir unless `--keep-data`.

## 2. Doc gaps

| Sev | Gap |
|---|---|
| **High** | README never says the plugin **hooks every tool call** (#1). HOW-IT-WORKS lists only Write/Edit and Bash hooks; the catch-all is not named. |
| **High** | No disclosure that **document text is pasted into a prompt submitted as you**, and that a malicious document can carry **prompt-injection** text that reaches Claude with user-level trust plus "apply each item by editing the file directly". Risk is higher under auto-accept/bypass modes. Recommend "Edit before sending" for untrusted files. |
| **High** | "Sends nothing over the network" (README:109) is misleading: the submitted prompt (with document quotes) goes to Anthropic like any prompt, and setup downloads from PyPI. |
| **High** | **pycel executes generated Python from spreadsheet formulas** (#7) — not disclosed; README only says "calculated values". |
| Med | "exact, pinned versions … plus their dependencies" (README:107) understates: transitive deps are **unpinned and upgraded**, no hash checking; names not listed. HANDOVER's readiness table claims "Package installs pinned". |
| Med | "nothing touches your system Python" is true for installs, but **before setup, extract.py runs under system python3** and imports any system/user-site packages (#6). |
| Med | No **uninstall/cleanup** section: venv path, examples folder, transcripts. |
| Med | 2-second timer and its cost not in README (only HOW-IT-WORKS/CHANGELOG). Scan scope understated: up to 4000 entries; a session started in `~` scans your home folder. |
| Med | `open_files replace:true` lets Claude clear unsent comments — undocumented. |
| Med | No SECURITY.md (vulnerability contact), no privacy note (directory policy §3.A/§3.B expect contact + data handling statement). |
| Low | Edits outside cwd are tracked (README says "in the session's working folder"). |
| Low | Reads whole config list (#14); examples overwrite files; tool always in context (token cost); path-existence oracle; no defusedxml; mods run outside the sandbox and permission rules (Anthropic docs) — not restated. |
| Low | HANDOVER says 19 tests / v0.4.0, HOW-IT-WORKS says 23; HOW-IT-WORKS hook table omits `open_files`. |

## 3. Research notes

- Anthropic plugin security page: plugins "execute arbitrary code on your machine with your user privileges"; mod processes run **outside the sandbox** and permission rules don't cover them; users are told to run `claude plugin validate` to see `hooks:`/`calls:`.
- Mods overview lists what a mod can reach (all files, processes, every prompt and tool call, submit prompts as you) — authors should state which of these they actually use.
- Software Directory Policy: document how it works (§3.C), security contact (§3.B), privacy link if collecting data (§3.A), collect only necessary context (§1.D), tool descriptions must match behaviour (§2.B).
- Conventions: browser/VS Code extensions present a plain permission list ("Read and change…"); GitHub SECURITY.md = supported versions + private reporting + response time.

## 4. Ready-to-paste docs

### README: replace "What it runs and accesses" with

```markdown
## Permissions and data (plain language)

Inline Doc Review is a Claude Code *mod*: code that runs inside Claude Code with
your user account's permissions, outside Claude Code's sandbox. This is what it
actually uses:

| It can… | When | Why |
|---|---|---|
| See every tool call Claude makes (it never blocks, approves or changes one) | Always | To notice files Claude creates |
| List your working folder, 3 levels deep, up to 4000 entries | After each shell command Claude runs | To find documents a script made |
| Check open files' modification time | Every 2 seconds | To refresh the pane when a file changes |
| Read the files shown in the pane | When opened or changed | To display them |
| Run `python3` on Word/Excel/PDF files | When one is shown | To read them |
| Calculate Excel formulas (pycel turns formulas into Python and runs it) | Opening .xlsx files without saved results | To show values |
| Download Python packages from PyPI | Only `/inline-review setup` | Word/Excel/PDF support |
| Write sample files | Only `/inline-review examples` | Demo |
| Send a prompt as you, containing quoted document text and your comments | Only when you press Send (or Enter after "Edit before sending") | So Claude applies your feedback |
| Let Claude open files in the pane (`open_file`, `open_files`) | When Claude calls them | "Open the budget" |

It never edits your documents, never makes network requests of its own (besides
setup), and has no telemetry or accounts. Run `claude plugin validate <dir>` to see
its hooks and calls yourself.

### Things to know
- **Documents can contain instructions.** Quoted text goes into a prompt sent as you.
  For files from others, use **Edit before sending** and read the prompt first.
- **Excel formulas are evaluated** locally by pycel. Treat spreadsheets from
  untrusted sources as you would any file you open.
- Before setup, the helper runs on your system `python3` and uses any
  `python-docx`/`openpyxl`/`pypdf`/`pycel` already installed there.
- `/inline-review setup` pins the four packages above; their dependencies (lxml,
  numpy, networkx, python-dateutil, ruamel.yaml, six, et-xmlfile,
  typing_extensions) resolve to the newest compatible versions, without hash checks.
- `open_files` with `replace: true` clears unsent comments.
- Starting Claude Code in your home folder means the post-command scan covers it.

## Privacy

- The plugin collects nothing and sends nothing to its author or any third party.
- Comments and quoted text you send become a normal prompt: they go to Anthropic
  under your Claude Code account and are kept in your session transcript.
- Stored on your machine: the auto-open setting (Claude Code plugin store) and the
  Python venv. Open files and comments are held for the session only.

## Uninstall

1. `/plugin uninstall inline-doc-review` (or `claude plugin uninstall inline-doc-review --scope <scope>`).
2. `rm -rf ~/.cache/inline-doc-review` (the Python venv; not removed automatically).
3. Delete any `inline-doc-review-examples` folders you created.
4. Optional: `rm -rf ~/.claude/plugins/cache/*/inline-doc-review` (otherwise swept after 14 days).
Upgrading from `review-pane`: also uninstall `review-pane`.

**Requirements:** Claude Code with mods (v2.1.287+), Python 3.9+ with `venv`
(`sudo apt install python3-venv` on Debian/Ubuntu), Linux or macOS. Works offline
except `/inline-review setup`.
```

### SECURITY.md

```markdown
# Security policy

## Supported versions
Only the latest release receives fixes.

## Reporting a vulnerability
Please report privately via GitHub → Security → "Report a vulnerability"
(private advisory) on paragpandyareal/inline-doc-review. Do not open a public
issue. Expect an acknowledgement within 7 days.

## Threat model
**Trust boundary:** the mod runs in Claude Code with your user permissions and
outside the sandbox. Claude Code's permission rules do not govern its own file
reads, process launches or prompt submissions.

**What it does:** see README → Permissions and data.

**Risks and mitigations**
| Risk | Mitigation |
|---|---|
| Prompt injection via quoted document text | Prompts only sent on explicit click; "Edit before sending" lets you inspect |
| Malicious .xlsx formulas executed by pycel | Only on open; 60 s timeout; process runs as you — do not open untrusted spreadsheets |
| Malformed docx/xlsx/pdf exploiting parsers (lxml, openpyxl, pypdf) | Pinned top-level versions; 60 s timeout |
| Supply chain on `/inline-review setup` | Top-level versions pinned; transitive deps unpinned (known gap) |
| Venv tampering (`~/.cache/inline-doc-review/venv` is executed) | Same-user directory; delete and re-run setup if in doubt |
| Claude clearing comments via `open_files replace:true` | Documented; the tool's description states it |

**Out of scope:** Claude Code itself, Anthropic's API, what Claude does with your prompt.
```

### Other fixes
- HOW-IT-WORKS hook table: add "`tool.call` (all tools) — passthrough wrapper" and `open_files`; fix test count; HANDOVER: change "Package installs pinned" to "top-level pinned; transitive unpinned".
- Code (optional, improves the story): `pip install` with a hashed `requirements.txt` (`--require-hashes`); install `defusedxml`; drop `--upgrade`; scan only when cwd isn't `$HOME`; set `isDeferred: true`.
