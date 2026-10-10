# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Please report it privately. On GitHub, open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue. You'll get a reply within 7 days.

## Threat model

**Trust boundary.** Lazy Panda Panel is a Claude Code mod. It runs inside Claude Code with your user account's permissions, outside Claude Code's sandbox. Claude Code's permission rules don't govern the mod's own file reads, process launches or prompt submissions. That is why the mod keeps them few and narrow. The README's [Permissions and data](README.md#permissions-and-data) section lists each one.

**What it treats as untrusted:** the content of every document it shows. That includes text, cell values, formulas, sheet names, headings, HTML and ADF structure.

| Risk | Mitigation |
|---|---|
| **Prompt injection:** a document contains text meant to steer Claude, which ends up in the prompt carrying your comments | A prompt is only sent when you press Send, or press Enter after "Edit before sending". The file name, the place and the quoted text sit inside a fence whose name is random for every prompt (`<file-excerpt-3fa91c07>`), so a document can't close it; look-alike tags are neutralised too. Each quoted line starts with `> `, and the prompt says the fenced text is data, never instructions. Control characters, ANSI escapes and invisible characters (zero-width spaces, tag characters, variation selectors) are removed from what is drawn and what is sent alike; line and paragraph separators become plain new lines. An `@` before a path in a document becomes `＠`, so sending the prompt box can't attach a file. Under the comment box, **Quoted for Claude** shows exactly what will be quoted, including text the view cuts off. A comment whose text changes before it is sent is marked as changed. For untrusted files, use Edit before sending and read the prompt first. |
| **Code execution from spreadsheet formulas** | Formulas are calculated by `hooks/formulas.ts`, a small interpreter for 17 functions (SUM, IF, SUMIF and so on). It has no `eval` or `Function`, and anything else is left uncalculated. It is capped at 2,000-character formulas, 100,000-cell ranges (whole columns read only the rows in use), nesting depth 60 and a total work budget. |
| **Parser denial of service** (huge, deeply nested or malformed files, zip bombs, regex backtracking) | The readers are written in TypeScript for the pane and tested against over 1,100 public Word, Excel and PDF test files. Text files over 4 MB are refused; over 2 MB they are shown as plain text. Documents are cut at 20,000 rows (Word and PDF at 4,000). Only the start of a large sheet or Word document is unpacked; a zip may unpack to at most 300 MB in all, and each part's checksum is checked. PDF reading has a work budget, after which what was read is shown. Word, Excel and PDF files over 50 MB are refused. Pictures over 16 million pixels aren't decoded, a picture is decoded only in terminals that can show it (kitty, Ghostty), and decoding stops after 3 seconds. Inline Markdown patterns are bounded and skipped for lines over 5,000 characters. ADF nesting is capped at 50 levels. XML entities other than the five standard ones are never expanded. |
| **Pictures a document points at** | A Markdown or HTML picture is read only if it is an ordinary file (links followed) inside the document's folder or the working folder and not in a hidden folder, and at most 4 MB. Devices and pipes are never read. Web addresses are never fetched. |
| **Claude opening files it shouldn't** | `open_file` and `open_files` only open files whose real location (links followed) is under the working folder and not in a hidden folder, files Claude wrote this session with Write or Edit, and files already open. If the real location can't be found, the file is refused. Anything else needs you to run `/panda <path>`. The tools never return file content to Claude. |
| **Another plugin driving `/panda`** | Only you can change auto-open, write the samples, or open a file outside the working folder with `/panda`; the same command run by another plugin is refused. |
| **Running programs** | The mod installs nothing and downloads nothing. When you press **Open in …** on a picture card, it runs your computer's own "open this file" command (`open`, `xdg-open` or `explorer.exe`) without a shell, with the shown file's path as the only argument; it never offers this over SSH. It runs Python only if it is already on your computer, only for Word, Excel and PDF files over 4 MB and for `/panda examples`, with fixed commands (`python3 -I ./scripts/read_file.py` and the like) in the plugin's own folder; a file's path goes on standard input, never into a command. On a Mac it checks that a real Python is installed first, so Apple's developer-tools prompt is never triggered. Both scripts use the standard library only. |
| **Overwriting your files** | `/panda examples` always writes into a new folder, and its scripts create each file new (`O_EXCL`), so nothing is written over or through a link. |
| **Terminal escape injection** (a file that moves the cursor or rewrites the screen) | ANSI escapes and control characters are removed from all document text before drawing, including text decoded from HTML entities and ADF escapes after the file was read. |
| **Scanning more than intended** | The post-command scan covers the working folder only, 3 levels deep with a 4,000-entry limit, and skips links and hidden files and folders. It is skipped in home folders and drive or share roots, and for subagents. Files it finds don't count as files Claude wrote. |

**Environment variables.** The mod reads six, none of them secret: `TERM`, `TERM_PROGRAM`, `SSH_CONNECTION`, `SSH_TTY`, `DISPLAY` and `WAYLAND_DISPLAY`. It uses them only to decide whether pictures can be drawn and whether **Open in …** can work. It reads no other settings or credentials.

**Known limits:**
- Python, when used, is found through your `PATH`: `python3`, then `py -3` (the Windows launcher), then `python`.
- Text inside a document can still try to persuade Claude. The fence makes this much harder but can't make it impossible.

**Out of scope:** Claude Code itself, Anthropic's API, and what Claude does with a prompt you send.
