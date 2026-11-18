---
name: google-docs
description: Drive Google Docs in a real browser. Covers opening documents, focusing the editor, entering long text reliably, formatting, verifying content, fitting an essay to one page, and renaming. Explains why Google Docs' canvas renderer, hidden text-entry iframe, CSP, and synthetic-input rejection break naive automation, and which input paths actually work.
---

# Google Docs automation

A practical guide for agents that need to read, write, format, and verify Google Docs in a real browser. It applies to the browse extension's Firefox-native driver, Playwright/CDP, and OS-level keyboard automation. Read the "Why Docs is different" section before writing any automation: most obvious approaches fail silently.

## TL;DR

1. Google Docs paints the document on a canvas. Document text is **not** in the DOM and `page read` returns only UI chrome.
2. Programmatic DOM insertion (`execCommand`, synthetic `beforeinput`/`input`/`paste`) is ignored. The hidden `.docs-texteventtarget-iframe` may accept text but Docs does not commit it.
3. `page eval` fails on Docs with `call to eval() blocked by CSP`. Do not build a Docs workflow around in-page JavaScript.
4. Use **trusted input**: CDP/WebDriver keyboard APIs when available, or OS-level input (`xdotool` on X11, `ydotool`/`wtype` on Wayland) for the Firefox-native extension driver.
5. For anything longer than a sentence, put the text on the clipboard and press **Ctrl+V**. Do not use `xdotool type` for multi-paragraph text: newlines may be dropped and fast typing can garble line ends.
6. Verify by selecting all, copying, and comparing the clipboard to the source file. A screenshot alone is not proof of character-perfect content.
7. Keep the source text in a file on disk. A single mis-aimed click followed by Ctrl+A and typing can replace the whole document.

## Why Google Docs is different

### Canvas rendering
Docs renders the page into canvas tiles (`document.querySelectorAll('.kix-canvas-tile-content')` is non-zero when the editor is ready). `document.body.innerText` and the extension's `page read` return the menus, ruler numbers, sidebar text, and status messages — not the essay. This is expected, not a load failure.

Consequences:
- Never try to read or edit the document through the DOM.
- To read document text, use Ctrl+A, Ctrl+C, and read the system clipboard.
- To change document text, use trusted keyboard input or a trusted paste.

### The hidden text-event iframe
Docs listens for native typing through a hidden iframe:

```
iframe.docs-texteventtarget-iframe
  └─ document
       └─ body
            └─ div[contenteditable]
```

A diagnostic from a successful-but-ignored insertion attempt looked like:

```json
{
  "ok": true,
  "via": "docs-iframe",
  "focused": true,
  "canvas": 3,
  "frame": true,
  "body": true,
  "editable": false,
  "designMode": "off",
  "active": "div[editable]"
}
```

`execCommand('insertText')` inside that iframe returns `true` and changes the hidden div's `textContent`, but the document canvas does not change. Docs requires trusted input events; synthetic ones are discarded. Accumulated text in the hidden div is internal buffer noise and does not appear in the document.

### CSP blocks eval
Evaluating JavaScript in the Docs page fails:

```json
{
  "result": {
    "type": "object",
    "subtype": "error",
    "description": "call to eval() blocked by CSP"
  }
}
```

Extension scripts injected into the page's MAIN world are subject to the page's CSP for `eval` and `new Function`. Reading the DOM through an extension API still works; arbitrary JS evaluation does not. Plan around this instead of trying to bypass it.

### Browser shortcut conflicts
Browser-level shortcuts can win when focus is not inside the editor:
- `Ctrl+E` focuses the browser's search/address bar. It is **not** center-align in Docs. Use `Ctrl+Shift+E`.
- `Ctrl+0` resets browser zoom. Do not use it as a "Normal text" command. The documented Docs shortcut is `Ctrl+Alt+0`.
- `Ctrl+M` can mute the tab in Firefox. Do not use it for formatting.
- `Ctrl+B` bolds text when the editor has focus, but otherwise opens the Firefox bookmarks sidebar.
- When in doubt, apply formatting with a toolbar click and a screenshot check, or use the Docs menu.

## Input methods, ranked

| Method | Trusted? | Works in Docs? | Notes |
|---|---|---|---|
| Playwright `page.keyboard.type` / `insertText` over CDP | Yes | Yes | Best option for Chromium. Produces native input events. |
| WebDriver `sendKeys` / BiDi `input.performActions` | Yes | Yes | Best option for stock Firefox via WebDriver. |
| OS-level input (`xdotool type`, `ydotool`, `wtype`) | Yes | Yes | Works with the Firefox-native extension driver. X11 for `xdotool`; Wayland needs `ydotool`/`wtype`. |
| Clipboard + browser Ctrl+V | Yes | Yes | Most reliable for long, multi-paragraph text. |
| `execCommand('insertText')` in the page | No | **No** | May modify the hidden iframe, never the document. |
| Synthetic `beforeinput` / `input` / `paste` events | No | **No** | Ignored by Docs. |
| Setting `textContent` / `innerHTML` | No | **No** | Canvas has no editable DOM text. |
| `page eval` / `Runtime.evaluate` | — | **No** | Blocked by CSP on Docs. |

Rule of thumb: if the input path does not go through the browser's native event pipeline or the OS input stack, Docs will ignore it.

## Standard workflow

### 1. Confirm the toolchain
With the browse CLI and the Firefox-native driver:

```sh
node cli/dist/cli.mjs status
```

Check that the relay and extension versions match and the extension is connected. A stale relay build can silently lack new commands; rebuild and restart if necessary.

For OS-level input:

```sh
command -v wmctrl xdotool xclip
echo "$XDG_SESSION_TYPE"   # x11 required for xdotool
```

### 2. Open or find the document
New document:

```sh
node cli/dist/cli.mjs page goto --tab <TAB> https://docs.google.com/document/create
```

`https://docs.new` also works, but redirects can race with the next command. Poll until the URL contains `/document/d/<id>/edit` and the title is `Untitled document - Google Docs`:

```sh
node cli/dist/cli.mjs page read --tab <TAB> --json
```

Existing document: use its full `/document/d/<id>/edit` URL. Recent documents are listed at `https://docs.google.com/document/u/0/`.

Confirm the editor is ready:
- URL contains `/document/d/`.
- Title ends with `- Google Docs`.
- `page read` text includes Docs UI strings such as `Normal text`, `Arial`, `Editing`, `Document tabs`, and ruler numbers.
- The mode chip near the top right says **Editing**, not Viewing or Suggesting. Switch to Editing before writing.
- The screenshot shows a white page with the toolbar and, for a blank doc, template chips near the top.

### 3. Focus the browser window
The tab can be active while the window is not focused. Docs ignores keystrokes when the document does not have focus.

```sh
wmctrl -l | grep -i "google docs"
wmctrl -a "<unique substring of the window title>"
sleep 0.5
xdotool getactivewindow getwindowname
```

`page focus --tab <TAB>` brings the tab to the front of its window, but it does not necessarily focus the OS window. Use both when in doubt.

### 4. Calibrate screen coordinates before clicking
`page screenshot` returns the tab viewport (for example 1920x1007), which excludes the browser's tab strip and address bar. `xdotool` uses absolute screen coordinates. Window geometry does not reliably tell you where the viewport starts, because decorations and capture behavior differ.

Do not compute the offset and trust it. Calibrate:

1. Take a screenshot.
2. Pick a harmless, clearly observable target: the document title text at the top-left, a menu label, or the Share button.
3. Click your best guess and take another screenshot.
4. Adjust in roughly 20-pixel steps until the click lands on the intended element.

Observed example from a real session: the window was reported at `(0,64)` with size `1920x1120`, screenshots were `1920x1007`, yet title-row clicks at screen `y=180` and `y=201` opened the Edit menu, while `y=159` opened the rename field. The computed offset was wrong by about 40 pixels. Empirical calibration succeeded.

Safe and unsafe clicks:
- Clicking in the middle-left of the page is safe and only moves the caret.
- Clicking the title row is safe; it opens the rename field or does nothing.
- Clicking toolbar icons and menus is safe but can change formatting or open panels.
- **Never** send Ctrl+A or type after a click you have not verified. A click that misses the title can leave focus in the document, and the next Ctrl+A + typing will replace the entire body.

### 5. Place the caret in the document
Click inside the page area, below any template chips (`Templates`, `Meeting notes`, `Email draft`, `More`) and away from the toolbar. In a blank document, clicking below the current text line places the caret at the nearest line, usually the first line.

Verify with a screenshot: the caret should blink in the page, and the toolbar should show text controls rather than a dialog or the gray margin. `document.hasFocus()` becomes true once the window and page are focused.

### 6. Clear existing content (if needed)
With the caret in the document:

```sh
xdotool key --clearmodifiers ctrl+a
sleep 0.5
xdotool key --clearmodifiers Delete
sleep 1
```

Then take a screenshot. Do not assume the clear worked. If a menu is open or focus is elsewhere, Ctrl+A may select a different scope.

### 7. Enter text

#### Long text and multiple paragraphs: paste
This is the recommended path.

```sh
xclip -selection clipboard /tmp/essay.txt
sleep 0.5
xdotool key --clearmodifiers ctrl+v
sleep 3
```

Notes:
- Put the exact text in the file first. Plain-text newlines become paragraph breaks in Docs.
- `xclip` may stay running to serve the clipboard selection; that is normal.
- Paste is fast and preserves every character, unlike per-character typing.
- Verify with a screenshot and with the copy-back check in step 9.

#### Short text: type
```sh
xdotool type --clearmodifiers --delay 20 -- "Hello from automation"
```

Limitations observed:
- Newlines were not reliably converted to paragraph breaks; all paragraphs merged in one test.
- Typing hundreds of words quickly can cause Docs to render overlapping or garbled line ends while it reflows. A fresh screenshot may still show the overlap.
- Use typing only for short labels, titles, or test strings. Use paste for anything substantial.

#### Character set and keyboard layout
`xdotool type` follows the active XKB layout. On a non-US layout, characters such as quotes, braces, and punctuation may differ. Prefer paste for text containing symbols, accents, or non-ASCII characters.

### 8. Format the document
Select the heading line and apply formatting while the editor has focus:

```sh
xdotool key --clearmodifiers ctrl+Home      # start of document
xdotool key --clearmodifiers shift+End      # select the first line
xdotool key --clearmodifiers ctrl+b         # bold
xdotool key --clearmodifiers ctrl+shift+e   # center align
xdotool key --clearmodifiers ctrl+shift+period  # increase font size
xdotool key --clearmodifiers Right          # collapse selection
```

Verified in the Firefox/Docs combination: Ctrl+B bolded the heading, Ctrl+Shift+E centered it, and Ctrl+Shift+Period increased 11pt to 13pt. All require focus in the editor; otherwise browser shortcuts may fire instead.

Useful shortcuts:

| Shortcut | Action | Status |
|---|---|---|
| `Ctrl+A` | Select all document content | Verified |
| `Ctrl+C` / `Ctrl+V` | Copy / paste | Verified |
| `Ctrl+Home` / `Ctrl+End` | Start / end of document | Verified |
| `Ctrl+Down` | Next paragraph | Verified |
| `Shift+End` | Select to end of line | Verified |
| `Ctrl+B` | Bold | Verified with editor focus |
| `Ctrl+Shift+E` | Center align | Verified; `Ctrl+E` is the browser search bar |
| `Ctrl+Shift+.` / `Ctrl+Shift+,` | Increase / decrease font size | Verified increase |
| `Right` | Collapse selection | Verified |
| `Escape` | Close menus/panels | Verified |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo | Documented |
| `Ctrl+Shift+L/E/R/J` | Left / center / right / justify | Documented |
| `Ctrl+\` | Clear formatting | Documented |
| `Ctrl+Alt+0` | Normal text | Documented; do not use `Ctrl+0` (browser zoom reset) |

For a title-style heading without direct formatting, use the style dropdown (`Normal text` in the toolbar) or `Ctrl+Alt+0` for Normal text and a heading shortcut if appropriate. Direct bold + center + size is sufficient for an essay title.

### 9. Verify the content exactly
The strongest check is a round trip through the clipboard.

```sh
# caret in the document
xdotool key --clearmodifiers ctrl+a
sleep 0.3
xdotool key --clearmodifiers ctrl+c
sleep 1
xclip -selection clipboard -o > /tmp/doc-check.txt
xdotool key --clearmodifiers Right   # collapse the selection

wc -w /tmp/doc-check.txt
```

Compare against the source with normalization:

```sh
python3 - <<'PY'
import difflib, re

doc = open('/tmp/doc-check.txt', encoding='utf-8').read()
src = open('/tmp/essay.txt', encoding='utf-8').read()

def norm(s):
    s = s.replace('\u00a0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n\s*\n', '\n\n', s)
    return s.strip()

a, b = norm(src), norm(doc)
print('MATCH' if a == b else 'MISMATCH')
if a != b:
    for line in list(difflib.unified_diff(a.splitlines(), b.splitlines(), 'source', 'document', lineterm=''))[:40]:
        print(line)
PY
```

This catches dropped characters, merged paragraphs, duplicated text, and accidental full-document replacements. A screenshot shows layout; this check proves content.

### 10. Fit the document on one page
Default formatting (11pt Arial, 1.15 line spacing, 1-inch margins) fits roughly 400–450 words including a heading and blank lines between paragraphs.

Observed benchmark:
- 427 words plus a bold centered title and six paragraphs fit comfortably on page 1.
- 474 words overflowed page 1 by about two lines.
- The overflow was fixed by trimming about 45 words; single line spacing would also have worked.

Ways to fit:
- Trim 30–60 words of filler.
- Select all and set Format → Line & paragraph spacing → Single.
- Reduce page margins via File → Page setup.

Check the page count:
- Scroll to the bottom with the mouse wheel (`xdotool click --repeat 6 5` over the page) or take a full-page screenshot.
- A multi-page document shows a page badge such as `1 of 2` at the right edge and a gray gap between pages.
- A one-page document ends with gray space below the page and no page badge.
- `Ctrl+End` moves to the end of the text but does not necessarily reveal the page bottom; scroll after it.

### 11. Rename the document (optional)
The document name is in the title row at the very top-left of the Docs page, next to the star and folder label. Click the name text (calibrate first) and the rename field opens with the current name selected.

```sh
# after clicking the document name
xdotool type --clearmodifiers --delay 20 "The Effects of Global Warming"
xdotool key --clearmodifiers Return
```

Verify:

```sh
node cli/dist/cli.mjs page read --tab <TAB> --json | head -4
wmctrl -l | grep -i "google docs"
```

The page title becomes `<name> - Google Docs`, and the Firefox window title updates too.

If the click opens the Edit menu, the y coordinate is too low; move up about 20 pixels. If nothing happens, the click landed in the gray margin; adjust toward the title text. If the rename field opens but the name is not selected, press Ctrl+A while the field is focused, type the new name, then Enter.

Renaming is cosmetic. If coordinate calibration is uncertain, skip it rather than risk clicking into the document and overwriting content.

### 12. Confirm the save
Docs autosaves. Wait for the status text in the top bar to read **Saved to Drive** (it may show **Saving…** immediately after edits). Do not close the tab or navigate away while it is still saving. `page read` can confirm the title and URL; a screenshot confirms the save indicator.

## Navigation reference

- **Menu bar**: File, Edit, View, Insert, Format, Tools, Extensions, Help. On some layouts Docs collapses this into a `Menus` hamburger. Do not assume the full bar is present.
- **Toolbar**: undo/redo, print, paint format, zoom, paragraph style, font, size, bold/italic/underline, text color, link, comment, image, alignment, line spacing, lists, indent, clear formatting.
- **Title row**: document name, star, folder location (`In My Drive`), and the save status.
- **Top right**: version history, comments, Share, account menu. The mode chip (`Editing`) is nearby.
- **Left sidebar**: Document tabs (`Tab 1`) and the outline. A document can contain multiple tabs; make sure you are editing the intended one.
- **Ruler and page area**: click in the page to place the caret. Page boundaries appear as white sheets separated by gray gaps when the document has multiple pages.

Scrolling and selection:
- `Ctrl+Home` / `Ctrl+End`: start/end of document (moves the caret and view).
- Mouse wheel: scroll without moving the caret; useful for inspecting page count.
- `PageUp` / `PageDown`: scroll by a viewport.
- `Ctrl+Down`: next paragraph; useful for navigating between blank lines and the body after clearing.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `page read` shows menus, ruler numbers, and `Document tabs` but no essay text | Canvas rendering; the document text is not in the DOM | Use a screenshot for layout and copy/paste for text. |
| `page type` returns `ok:true`, `via:"docs-iframe"`, but the canvas is unchanged | Docs ignored synthetic input | Use trusted input: paste via Ctrl+V or OS-level typing. |
| `page eval` returns `call to eval() blocked by CSP` | Docs CSP blocks eval in page context | Do not use page JS; use DOM-reading extension APIs and trusted input. |
| `browse.execute` never returns against the Firefox-native driver | Driver/native-shim incompatibility on certain Playwright calls | Use the direct `page` CLI commands (`goto`, `read`, `screenshot`, `focus`, `type`) instead. |
| Typed text is invisible, `focused:false` | Tab/window not focused | `wmctrl -a`, click into the page, verify the caret, retry. |
| Paragraph breaks missing after typing | `xdotool type` newline handling | Put the text in a file, load it with `xclip`, press Ctrl+V. |
| Text appears with overlapping or garbled line ends | Typing too fast while Docs reflows | Paste instead; or increase `--delay` and verify with a screenshot. |
| Clipboard paste does nothing | Window not focused, or clipboard owner exited | Re-run `xclip`, focus the window, click the page, Ctrl+V. |
| Ctrl+E does nothing or focuses the browser search bar | Browser intercepts Ctrl+E | Use Ctrl+Shift+E for center align. |
| Ctrl+0 did not apply Normal text | Browser zoom reset | Use Ctrl+Alt+0 for Normal text, or paste and keep the default style. |
| Ctrl+B opened a sidebar instead of bolding | Focus was not in the editor | Click the page, verify the caret, retry. |
| Whole document replaced by a title or short string | A click missed the rename field, then Ctrl+A + typing hit the body | Keep the source file. Try Ctrl+Z; otherwise clear and repaste. Never type after an unverified click. |
| Page badge shows `1 of 2` | Content slightly over one page | Trim 30–60 words or set single line spacing. |
| Rename click opens the Edit menu | Y coordinate is one row too low | Move up about 20 pixels and click the title text. |
| Rename click does nothing | Clicked the gray margin or the star | Aim at the document-name text itself, between the name and the star. |
| `xdotool` fails or does nothing | Wayland session or missing package | Use `ydotool`/`wtype` on Wayland, or CDP/WebDriver input. |

## Recovery after an accidental overwrite

If Ctrl+A + typing replaced the body:

1. Press Ctrl+Z immediately while focus is still in the document. Docs undo may restore the previous content.
2. If undo fails, do not keep typing. Clear the document, load the source file onto the clipboard, and paste it again.
3. Reapply the title formatting (Ctrl+Home, Shift+End, Ctrl+B, Ctrl+Shift+E).
4. Re-run the copy-back verification.
5. Rename the document only after the content is verified and saved.

Keeping the essay in `/tmp/essay.txt` (or another path outside the browser) is what made recovery quick. Always have a source of truth on disk.

## Diagnostic details for extension authors

These are the DOM facts worth checking without eval (for example through an extension's MAIN-world script API):

- `document.querySelectorAll('.kix-canvas-tile-content').length` — greater than zero means the Docs editor is rendering.
- `document.querySelector('iframe.docs-texteventtarget-iframe')` — the hidden text-entry iframe exists.
- Inside that iframe, `contentDocument.querySelector('[contenteditable]')` — the editable buffer div.
- `document.hasFocus()` — whether the page believes it is focused.
- The hidden iframe's `execCommand('insertText')` returns true and changes the buffer, but does not change the document; do not use it as a success signal.
- `page read`/`pageInsertText` diagnostics are useful only to explain failures, not to drive the document.

## Complete worked example

```sh
#!/usr/bin/env bash
set -euo pipefail

TAB=11
WIN="Google Docs"
PAGE_X=700          # calibrated point inside the page area
PAGE_Y=556
SRC=/tmp/essay.txt

# 0. Readiness: URL contains /document/d/ and the title ends with "- Google Docs"
node cli/dist/cli.mjs page read --tab "$TAB" --json | head -4

# 1. Focus the OS window
wmctrl -a "$WIN"
sleep 0.8
xdotool getactivewindow getwindowname

# 2. Click into the document page (verified point)
xdotool mousemove "$PAGE_X" "$PAGE_Y" click 1
sleep 0.8

# 3. Clear any existing content
xdotool key --clearmodifiers ctrl+a
sleep 0.4
xdotool key --clearmodifiers Delete
sleep 1

# 4. Paste the source text
xclip -selection clipboard "$SRC"
sleep 0.5
xdotool key --clearmodifiers ctrl+v
sleep 3

# 5. Visual check
node cli/dist/cli.mjs page screenshot --tab "$TAB" --out /tmp/docs-after-paste.png

# 6. Copy-back verification
xdotool key --clearmodifiers ctrl+a
sleep 0.3
xdotool key --clearmodifiers ctrl+c
sleep 1
xclip -selection clipboard -o > /tmp/docs-check.txt
xdotool key --clearmodifiers Right

python3 - <<'PY'
import re
doc = open('/tmp/docs-check.txt', encoding='utf-8').read()
src = open('/tmp/essay.txt', encoding='utf-8').read()
def norm(s):
    s = s.replace('\u00a0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n\s*\n', '\n\n', s)
    return s.strip()
print('MATCH' if norm(doc) == norm(src) else 'MISMATCH')
PY

# 7. Style the heading
xdotool key --clearmodifiers ctrl+Home
xdotool key --clearmodifiers shift+End
xdotool key --clearmodifiers ctrl+b
xdotool key --clearmodifiers ctrl+shift+e
xdotool key --clearmodifiers ctrl+shift+period
xdotool key --clearmodifiers Right
sleep 1

# 8. Final visual check, page count, title, and save state
node cli/dist/cli.mjs page screenshot --tab "$TAB" --out /tmp/docs-final.png
node cli/dist/cli.mjs page read --tab "$TAB" --json | head -4
```

Adapt `PAGE_X` and `PAGE_Y` per window and zoom level. Recalibrate whenever the window moves, the layout changes, or the browser zoom changes.

## Pre-flight checklist

- [ ] Relay and extension versions match; extension connected.
- [ ] Target tab URL contains `/document/d/`.
- [ ] Page title ends with `- Google Docs`.
- [ ] Mode chip says **Editing**.
- [ ] Browser window is focused (`xdotool getactivewindow getwindowname`).
- [ ] Coordinates calibrated against the current window and zoom.
- [ ] Caret is visibly in the page before any Ctrl+A or typing.
- [ ] Source text is saved to a file on disk.
- [ ] Clipboard contains the exact source before Ctrl+V.
- [ ] Copy-back check reports `MATCH`.
- [ ] Screenshot shows the heading and body with no overlap.
- [ ] Page count is one (no `1 of 2` badge; gray space below the page).
- [ ] Save status reads **Saved to Drive**.
- [ ] Document title and URL recorded for the final report.

## Bottom line

Treat Google Docs as a canvas application that accepts only native input. Use the browser's trusted keyboard path when you have one; otherwise use OS-level input and the clipboard. Read document text through select-all + copy, not the DOM. Verify content exactly, calibrate clicks empirically, and keep a copy of the source text so a misclick never costs more than a paste.
