# Simplification review: inline-doc-review 0.5.0

Short answer: the core isn't badly bloated. Most of `register.tsx` is real work: loading files, naming anchors, the diff, the grid maths and the comment flow. The excess sits in three places:
- two hand-rolled UI client modules,
- compatibility shims for versions that can no longer occur (the plugin was renamed in 0.5.0, so its state namespace starts empty),
- decorative motion.

Removing these takes about 15% off the code without losing any feature that matters. I checked every claim below against the source. I did not modify or run anything. The line savings are estimates.

## 1. Size per file

| File | Lines | Could go |
|---|---|---|
| hooks/register.tsx | 1293 | ~12% (≈150) |
| hooks/viewer.tsx | 456 | ~20% (≈90) |
| hooks/tabs.tsx | 175 | **100%** (replace with ~10 lines of Buttons) |
| hooks/filebar.tsx | 152 | ~30% (≈45); 100% if you accept `Select` |
| hooks/spinner.tsx | 35 | ~25% (optional) |
| hooks/palette.ts | 122 | ~15% (≈18) |
| hooks/md.ts / html.ts / adf.ts / format.ts | 181 / 199 / 209 / 95 | ~5% (≈30 together) |
| types/index.d.ts | 114 | ~5% |
| scripts/extract.py / make_examples.py | 295 / 107 | ~3% |
| tests (5 files) | 528 | ~25% (≈130) |
| **Total code** | **≈3960** | **≈600** |

## 2. Ranked simplifications

**1. Delete `tabs.tsx` and draw the sheet tabs as Buttons. Saves about 165 lines.**
`tabs.tsx` is used only for sheet tabs (register.tsx:1037-1044). Several of its props are never passed: `dots`, `badge`, `asides`, and `group: 'files'`. That leaves these as dead code:
- the badge row (tabs.tsx:133-140)
- the asides hit-testing (92-105, 156-163)
- the dot widths

The underline slide animation (67-89, 117-123) is about 30 lines of frame-timer state for a 180 ms effect. Sheets are few, and `[` / `]` already switch them (viewer.tsx:244). Replacement:
```tsx
<Box flexDirection="row" columnGap={2}>{d.sheets.map((s, i) =>
  <Button key={`sheet-${i}`} label={s.name} plain={i !== sheetIndex} onPress={() => pickSheet($, i)} />)}</Box>
```
After this, the `post.type === 'tab'` sheets branch in `ui.message` (649-651) collapses into `pickSheet`.

**2. Remove the old-version shims. Saves about 75 lines.**
- `isCurrentShape` (register.tsx:885-887, 1256-1260) guards "pre-0.2" state. It is dead twice over:
  - The `inline-doc-review` state namespace was created in 0.5.0.
  - `session.start` already re-reads the open document on every load (440-447).
- viewer.tsx:121-126 `FALLBACK`, 142-157 prop defaulting and 160 palette merge cover "a main module from before 0.3".
- The same pattern appears in tabs.tsx:36-42 and filebar.tsx:24-27.
- tests/old-props.test.tsx (43 lines) exists only to test these shims.

If you want a guard against a mismatched main module and client module during a hot reload, wrap the client module once in `try/catch` and return `<Text/>`. A generic guard like that also covers future versions; field-by-field defaults only cover the versions they were written for.

**3. Move the top-bar switches to Buttons in the hook render. Saves about 40 lines.**
The ⟳ Reload / Source / Auto-open "asides" are drawn as text inside `filebar.tsx` and then hit-tested by x coordinate (filebar.tsx:41-64). The same code is duplicated in tabs.tsx:91-105.

The Pane already has `Button` on every surface. Use `<Button key="reload" label="⟳ Reload" plain onPress={...}/>` and drop:
- the `aside` post type
- `asideAt` and its maths
- `FileBarProps.asides`

Tests that post `{type:'aside'}` would `press({key:'reload'})` instead.

Optional: the platform's `Select` (`SelectProps`: `options`, `value`, `onSelect`; available on terminal and desktop) could replace the whole file dropdown, which would delete `filebar.tsx` entirely. The cost is losing the ‹ n/N › stepper and the ←/→ file stepping. I would keep the file bar, since the stepper is part of the 0.3.5 design, but this is the cheapest option if you decide it's dispensable.

**4. Drop the comment-marker "pop" animation. Saves about 25 lines.**
It shows a dot growing over 8 frames when a comment is added. The code is:
- viewer.tsx:77, 106, 109, 128, 184-187, 191-192, 263-265, 382, 396-397
- register.tsx:736, 869, 946, 962

A toast (register.tsx:1079) and the comment list already confirm the save. **Keep the change glow** (`flashKey`): it is the review signal for "what Claude changed".

**5. Merge the duplicated `update($, …)` sequences in register.tsx. Saves about 40 lines.**
- **Reset view and clear selection.** The same pair is written six times: 187-191, 432-433, 446, 649-650, 664-665, 667-668. Use `resetView($, patch)`.
- **Toggle auto-open.** Lines 493-495 and 657-659 are the same toggle. Use `setAutoOpen($, on)`.
- **Add a file to the list.** `track` (162-163) and `show` (182-183) both start with the same two lines. Use `addFile($, path)`.
- **Find the comment being edited.** `matchOf` (1057-1058) is re-implemented inside `saveComment` (1065).
- **Strip the sheet name from a label.** `shortLabel` (1126) and `noteLabel` (1271) both do it.
- **Quote a sheet name.** The quoting regex appears twice, at 321 and 915.

**6. Use one helper for tool results, and route `open_file` through `open_files`. Saves about 20 lines.**
Every return writes the same string twice: `{ result: X, text: X }` at 549, 552, 558, 571 and 583. Replace it with `const reply = (text, isError?) => ({ result: text, text, ...(isError && { isError }) })`.

The `open_file` handler (544-559) can be `openMany($, [path], false)`. Keep both tool registrations so the model-facing API doesn't change.

**7. Replace the hand-written base64 decoder with `atob`. Saves about 15 lines.**
`decodeHead` and the `B64` table (register.tsx:47-64) exist only to read the PNG width and height. `atob` is declared in the runtime types (claude-code.d.ts:14857):
```ts
const h = atob(base64.slice(0, 32)); const u32 = (i: number) => ((h.charCodeAt(i) << 24) | (h.charCodeAt(i+1) << 16) | (h.charCodeAt(i+2) << 8) | h.charCodeAt(i+3)) >>> 0
```

**8. Remove dead types and fields. Saves about 10 lines.**
- `RowStyle` `'table'` is never produced, yet it is checked at register.tsx:220.
- `'heading'` is produced only by extract.py:172. Emit `'h3'` there and drop the alias at viewer.tsx:299.
- `DocRow.num` is never set by any reader. `row.num ??` appears at register.tsx:209 and 793.
- In viewer.tsx:387, `isHeader ? pal.text : pal.text` and `isError ? error : isNeg ? error` are redundant ternaries.

**9. Fold the palette aliases. Saves about 20 lines.**
`ViewPal` (viewer.tsx:17-37) is a copy of `Palette`; use `import type { Palette }`. Five palette keys are exact aliases in both DARK and LIGHT:
- `h2`, `link` and `info` equal `accent`
- `h3` equals `formula`
- `note` equals `subtle`

Folding them only changes the ANSI and colour-blind THEMED palette slightly. Flag that to the owner before doing it.

**10. Drop the sparkline. Saves about 12 lines.**
It draws a 16-character bar chart of a selected range (register.tsx:1015, 1278-1286). Keep Σ and average, which are useful and match how Excel behaves. The sparkline is decoration.

**11. Share the parsers' common parts. Saves about 25 lines.**
md.ts, html.ts and adf.ts each re-implement the same three things:
- `gap()` (md 32-35, html 36-39, adf 85-88)
- trimming leading and trailing spacer rows (md 178-179, html 196-197, adf 206-207)
- an h1 followed by a rule row

Put `gap` and `trim` in format.ts.

Separately, `make_examples.py:14-21` copies `reexec_in_venv` from extract.py. Replace it with `from extract import reexec_in_venv`; the script's directory is already on `sys.path`.

**12. Tests. Saves about 130 lines.**
- `dump.test.tsx` and `dump-grid.test.tsx` assert nothing. They also duplicate the `lines()` walker and copy the example files as long inline JSON strings.
- Delete both. If the dump is still useful when changing the layout, keep it as one opt-in script.
- Move the shared fixtures (`FILES`/`TEXTS`, `BUDGET`) into `tests/fixtures.ts`.
- Delete `old-props.test.tsx` together with item 2.

**13. Split `ui.render` (register.tsx:711-1253, 540 lines). This saves no lines.**
Split it into `renderLines`, `renderGrid`, `formulaBar`, `commentRow`, `commentList` and `actions`. This is the biggest readability win. Do it last, after the deletions above have shrunk it.

## 3. Large code that should stay

- **`wrapRows`, `describeLines`, `describeGrid` (register.tsx:203-332).** Word-wrapping that keeps emphasis, plus range labels that Claude can act on ("lines 3–4", "Budget!C2:E2"). This is the product.
- **The md/html/adf parsers.** The platform's `Markdown` element can't replace them: the viewer needs each row to be selectable, with source-line or JSON-path anchors. They are already compact for what they cover.
- **`diffDocs` plus the change glow.** About 50 lines that answer "what did Claude change?"
- **The file watching.** The 2-second mtime poll, the refresh after each Bash command, and the scan for new files. Each one covers a real gap: script edits, outputs that auto-open, and immediate refresh. CHANGELOG 0.4.1 records the bug this fixed.
- **The grid view** in viewer.tsx and register.tsx:888-1052: frozen header, column fitting, scrollbar, formula bar. These are spreadsheet basics.
- **extract.py.** Pinned venv, pycel for formulas with no saved result, number formats. All of it is needed.
- **The `Client` / `Input` / `Image` fallbacks** for surfaces that lack those elements. They are a few lines each and correct.
- **spinner.tsx.** It is small. Dropping the sweep saves only about 8 lines, so this is optional.

## 4. Target size and order

**Target:** about 3,350 lines, down from about 3,960. That is about 15% smaller with identical behaviour, apart from the features dropped below. It would be about 3,250 if you replace the file bar with `Select`.

**Features I recommend dropping:**
- tab-underline slide
- comment-marker pop
- sparkline

Each is decoration that adds state or timers and no review value.

**Order** (run `claude plugin test` after each step):
1. Dead code and shims (items 2 and 8), together with `old-props.test`. This is pure deletion and the lowest risk.
2. Dump tests and shared fixtures (item 12).
3. Helpers in register.tsx (items 5, 6 and 7).
4. Sheet tabs as Buttons and switches as Buttons (items 1 and 3). The tests change from `post aside` to `press`.
5. Decoration removals (items 4 and 10) and palette folding (item 9).
6. Shared parser helpers (item 11).
7. Split `ui.render` (item 13).

**One unrelated bug I noticed.** html.ts:160 detects a `<th>` header with `html.indexOf('<tr', 0)`. That searches from the start of the document, not from the current table, so a `<th>` in an earlier table makes a later table's first row bold. Track the header per table instead; it would also be shorter.
