---
name: google-slides
description: Drive Google Slides in a real browser. Covers creating a deck, typing into placeholders, adding and reordering slides, speaker notes, text boxes, layouts, themes, images, slide numbers, page setup, presenting, and the only reliable ways to read a deck's text back. Explains why page read returns slide text without spaces, how to apply a theme before typing, and why images must be pre-sized before insertion.
---

# Google Slides automation

A practical guide for agents that need to build, edit or verify a presentation in a real browser. It applies to the browse extension's Firefox-native driver, Playwright/CDP, and OS-level keyboard automation. Everything here was verified in a live deck (`slides.new`, Firefox + the browse add-on); read "Reading a deck" before choosing a verification method.

## TL;DR

1. Open `https://slides.new` for a new deck, or `/presentation/d/<id>/edit` for an existing one.
2. Type like a person: click a placeholder once (`Click to add title`) and type; the prompt text is replaced. Enter in a body placeholder starts a new bullet.
3. `Ctrl+M` adds a slide in the current layout, `Ctrl+D` duplicates, `Ctrl+↑/↓` (or `←/→`) reorders, `PgUp`/`PgDn` navigate, `Home`/`End` jump to the ends.
4. To make it look good: apply a theme **before** typing (`Alt+/` → `change theme`), and pre-resize any image to ~720 px wide before inserting it, because Slides inserts pictures at pixel size.
5. `page read` **does** return slide text, but with the spaces stripped (`GlobalWarming:TheEvidenceAshortdeckbuiltbyanagent`). Use it to confirm content exists, never as the source of truth.
6. Exact text comes from either the deck's **HTML view** (`/presentation/u/0/d/<id>/htmlpresent`), which lists every slide with slide numbers, bullets and speaker notes, or from **copy-back**: double-click a text box, `Ctrl+A`, `Ctrl+C`, read the clipboard.
7. Speaker notes are typed by clicking `Click to add speaker notes` at the bottom, and they show up in both the HTML view and `page read`.
8. Never use `Ctrl+W` to "close" anything: in the browser it closes the tab, and an agent tab that held the editor is gone. `Escape` is the dismiss key.
9. The Alt+/ command palette works in Slides exactly as in Docs; it is the reliable way to reach every command (see [Command palette](#command-palette)).

## Reading a deck

### What the DOM gives you

`page read` returns the UI chrome, the right-hand rail (`Image`, `Templates`, `Blocks`, `Media`, `Uploads`, `Transform`), and all slide text as one run-on line. A two-slide deck read back as:

```
1GlobalWarming:TheEvidenceAshortdeckbuiltbyanagent2WhatthedatashowsCO2reached424ppmin20242011-2020was1.1CwarmerSealevelupabout0.20msince1900
```

That is the film strip plus the current slide's placeholders. The slide numbers and order are useful; the missing spaces are not. Speaker notes appear the same way (`Say:thetrendismeasured,notforecast.`).

### The HTML view: the text dump to use

Run the palette command **HTML view of the presentation** (`Alt+/` → type `html view` → Enter, or File → …). It opens a plain page at:

```
https://docs.google.com/presentation/u/0/d/<id>/htmlpresent
```

It reads like a transcript, with spaces, slide numbers and notes:

```
1 of 2

Global Warming: The Evidence

A short deck built by an agent

2 of 2

What the data shows

CO2 reached 424 ppm in 2024

2011-2020 was 1.1 C warmer

Sea level up about 0.20 m since 1900

Say: the trend is measured, not forecast.
```

The obvious guess `.../presentation/d/<id>/htmlview` returns **Page Not Found**; use the generated `htmlpresent` URL.

### Copy-back for one text box

```
double-click into the text box  → Ctrl+A → Ctrl+C → xclip -selection clipboard -o
```

Verified: it returns the three bullets with spaces intact, exactly as typed. Use it when you need one shape's text, not the whole deck.

### The present view

Opening `/presentation/d/<id>/present` in the current tab renders the deck full-size (URL gains `#slide=id.p`). `page read` there shows only the slide number (`1`), so verification is a screenshot. `→`/`←` (and `PgDn`/`PgUp`) advance and go back; the slide number appears bottom-right once [slide numbers](#slide-numbers) are enabled. The toolbar **Slideshow** button at the top right did not open a window or change the URL in this profile — treat that as a possible popup block and prefer the `/present` URL.

## Building a deck by typing

1. `https://slides.new` creates "Untitled presentation" and may show a *"Hello, you. Let's start creating"* panel (Slides Beta, Images, Infographics, Templates, Import, Blank slide). Close it with the `X` at the top right of the panel.
2. Click the title placeholder once and type. The box shows selection handles; typing replaces `Click to add title`. Escape leaves the box.
3. Click the subtitle placeholder and type the same way.
4. `Ctrl+M` adds a slide using the layout that follows a title slide (title + body text).
5. In the body placeholder, type a line, `Enter`, the next line, and so on. Each Enter makes a new bullet (`Tab` demotes one level in Slides' list handling).
6. Speaker notes: click `Click to add speaker notes` at the bottom of the window and type.

### Text boxes need a placement click

`Insert text box` from the palette does **not** create anything by itself. Run the command, then click on the slide where the box should sit, then type. Verified: the text then appears in the deck (and in `page read`, concatenated).

### Selecting and formatting

- One click selects the object (handles, no caret); a second click (or double-click) puts the caret in the text.
- `Ctrl+A` while the caret is in a text box selects that box's text, which is what makes copy-back work.
- The toolbar switches to text controls (font, size, B/I/U, colour, alignment, lists, `Format options`, `Animate`) while a text box is active.
- Escape closes panels, drops selections and leaves text editing; it never deletes a slide.
- A placeholder is an object like any other: click it once to select the frame (blue handles), then `Delete` removes the placeholder itself. If the caret is inside the text instead, `Delete` only eats characters — press `Escape` first, then click once.

## Making it look good

Order matters: **theme first, then type**. A theme rewrites the fonts, colours and background of every slide, so text typed afterwards already matches; text typed first gets restyled too but any manual formatting you applied is lost.

### Applying a theme

1. `Alt+/` → `change theme` → Enter. A **Themes** side sheet opens.
2. The sheet lists `In this presentation` plus named themes (*Simple Light*, *Simple Dark*, *Streamline*, …), but **none of the names are in `page read`** — the text only shows `Close side sheet`. Screenshot the sheet and click a thumbnail by position.
3. One click applies it to the whole deck immediately (no Apply button) and closes nothing; close the sheet with its `X` at the top right, not `Escape` (Escape leaves the selection, the sheet often stays).
4. Verify with a screenshot: the slide background and title colour change, existing text is kept.

### Images: pre-size the file, do not resize in Slides

`Alt+/` → `upload` → Enter opens the file chooser; `Ctrl+L`, type the path, `Enter`, then wait ~6 s while it uploads and inserts.

Slides inserts an image at roughly its **pixel size** (1 px ≈ 1 screen px at this zoom), so a 1600 px-wide chart lands about 2.8 slide-widths wide and overflows the canvas. Instead of fighting it:

```sh
convert /tmp/chart.png -resize 720x /tmp/chart-720.png   # ~60% of slide width at 1080p
```

Then insert that. Measured: 1600 px → ~1505 px wide (slide ≈ 1115 px), 720 px → ~675 px wide, which sits comfortably under a title. Regenerating the chart at a smaller figure size also works.

If it still needs nudging: click once to select the image, then drag its **body** (the middle) or nudge with the arrow keys. The selection handles are **crop** handles — dragging one shows only part of the picture instead of scaling it (`Ctrl+Z` undoes that).

### Rebuilding a messy slide

When text has interleaved or a placeholder is in the way, rebuilding is faster than repairing: `Alt+/` → `delete slide`, then `Ctrl+M`, then retype. A slide with an image wants no body placeholder at all — select the empty body box once and `Delete` it before inserting the picture.

### Slide numbers

`Alt+/` → `slide number` → dialog **Slide numbers / Show slide numbers (toggle, on by default) / Skip title slides / Apply to selected slides only / Cancel / Save**. Tick *Skip title slides*, click **Save**: numbers then appear bottom-right on slides 2…n and are confirmed by the HTML view, which prints a bare `2`, `3`, `4` line after each slide's text.

### Renaming the deck

Clicking the title text at the top left and typing did **not** rename the deck (the tab kept saying *Untitled presentation*). The palette route works: `Alt+/` → `rename` → Enter → `Ctrl+A` → type the new name → `Enter`. Verify with the tab title (`page read`'s first line).

## Command palette

`Alt+/` opens the same "Menus" search as in Docs: type a keyword, `Enter` runs the first result, `Escape` closes it. Verified inventory:

| Query | Commands |
|---|---|
| `new slide` | New slide (Ctrl+M), New presentation |
| `layout` | Layout: Title slide, Layout: Section header, Show guides (Ctrl+Alt+E Ctrl+Alt+G), Grid view (Ctrl+Alt+1) |
| `theme` | Edit theme, Change theme, Theme builder, Templates |
| `transition` | Transition, Motion (Ctrl+Alt+Shift+B) |
| `animation` | Transition |
| `page setup` | Page setup |
| `present` | Presentation display options, Make a copy: Entire presentation, Make a copy: Selected slides |
| `speaker` | Show speaker notes, Go to speaker notes (Ctrl+Alt+Shift+S) |
| `grid` | Grid, Grid view (Ctrl+Alt+1), Snap to: Grid |
| `guides` | Show guides, Edit guides (Ctrl+Alt+E Ctrl+Alt+W), Clear guides, Snap to: Guides |
| `text box` | Insert text box |
| `shape` | Insert shape: Rectangle, Rounded Rectangle, Line, Arrow, flowchart shapes |
| `table` | Insert table: 2 columns x 2 rows |
| `chart` | Insert pie chart, Insert line chart, Insert column chart |
| `html view` | HTML view of the presentation |
| `rename` | Rename (dialog with the deck name preselected) |
| `upload` | Upload and insert image |
| `slide number` | Slide numbers (dialog) |
| `size` | Crop image, Mask image: Rectangle, Mask image: Rounded Rectangle, Page setup (no Size & position) |
| `background` | Change background |

### Page setup

`palette "page setup"` → dialog reading **Page setup / Widescreen 16:9 / "Note: Measurement unit preferences can be set under Tools > Preferences" / Cancel / Apply**. Accept with the dialog's Apply button; Escape cancels.

## Keyboard shortcuts

`Ctrl+/` opens the **Keyboard shortcuts** dialog (same as Docs), grouped by Film strip, With objects, Text and so on.

| Shortcut | Action | Source |
|---|---|---|
| `Ctrl+M` | New slide | Verified dialog |
| `Ctrl+D` | Duplicate slide | Verified dialog |
| `Ctrl+↑` / `Ctrl+↓` (or `Ctrl+←` / `Ctrl+→`) | Move slide up / down | Verified dialog |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Move slide to beginning / end | Verified dialog |
| `PgUp` / `PgDn` (or `←` / `→`) | Previous / next slide | Verified dialog |
| `Home` / `End` | First / last slide | Verified dialog |
| `Ctrl+Alt+1` | Grid view | Verified palette |
| `Ctrl+Alt+E Ctrl+Alt+G` | Show guides | Verified palette |
| `Ctrl+Alt+E Ctrl+Alt+W` | Edit guides | Verified palette |
| `Ctrl+Alt+Shift+S` | Go to speaker notes | Verified palette |
| `Ctrl+Alt+Shift+B` | Motion (animation panel) | Verified palette |
| `Ctrl+Alt+X` | Spell check | Verified palette |
| `Ctrl+/` | Keyboard shortcuts dialog | Verified |
| `Escape` | Close panel / drop selection / leave text edit | Verified |

## Traps

| Symptom | Cause | Fix |
|---|---|---|
| `page read` gives `GlobalWarming:TheEvidence` | Slides exposes text runs without whitespace nodes | Use the HTML view or copy-back for exact text |
| `Ctrl+W` did nothing useful and the editor vanished | It closed the browser tab | Reopen `/presentation/d/<id>/edit`; autosave keeps the deck. Use `Escape` |
| `page read` answers "Missing host permission for the tab" | The active tab is `about:newtab` (or another internal page) | Switch to the deck's tab, or navigate the tab to the deck URL |
| A palette "Insert text box" produced nothing | The box needs a placement click on the slide | Run the command, click the canvas, then type |
| Clicks land on the wrong toolbar button | The Gemini promo banner (or the new-deck panel) shifts everything below it down by about 55 px | Screenshot first and take coordinates from that image |
| The toolbar Slideshow button does nothing | Popup blocked in this profile | Open `/present` in the tab instead |
| Typed title text ends up mixed into the body bullets (`The planet is alreaCO2 reached…`) | The click missed the title box and landed in the body placeholder; the caret stayed in the body, so both strings went there | Screenshot before typing, click the title box, and check the caret is in it before the first keystroke. Rebuild the slide if it interleaves |
| `Delete` did nothing to an empty placeholder | The click put the caret in its text | `Escape`, then one click to select the frame, then `Delete` |

## Diagnostics for extension authors

- `Ctrl+/` → **Keyboard shortcuts** is the authoritative, in-app list of editor shortcuts; it agreed with every shortcut above.
- The palette's result list is ordinary page text, so `page read` between the menu-bar line and the `Background Layout Theme Transition` line returns the matches — the same sentinel script used for Docs works unchanged.
- `htmlpresent` is a plain HTML rendering rather than the canvas editor, so it reads cleanly (each slide under `1 of 2`, `2 of 2` markers) even while the deck is private.
- The film-strip text (`1…2…`) at the start of the concatenated line confirms slide order, which screenshots alone make easy to misread.

## Complete worked example

```sh
# 0. New deck, then theme before any typing
xdotool key ctrl+t; xdotool type "https://slides.new"; xdotool key Return; sleep 13
xdotool key alt+slash; xdotool type "change theme"; xdotool key Return; sleep 2.5
xdotool mousemove <theme-thumb-x> <theme-thumb-y> click 1   # from a screenshot; names are not in page text
xdotool mousemove <sheet-close-x> <sheet-close-y> click 1; sleep 1.5

# 1. Title slide
xdotool mousemove <title-x> <title-y> click 1; sleep 1.2
xdotool type --delay 20 "Global Warming"
xdotool mousemove <subtitle-x> <subtitle-y> click 1; sleep 1.2
xdotool type --delay 20 "The evidence, the causes, and what still works"
xdotool key Escape

# 2. A bullets slide, then repeat Ctrl+M for each further slide
xdotool key ctrl+m; sleep 2.5
xdotool mousemove <title-x> <title-y> click 1; sleep 1.2
xdotool type "The planet is already 1.1 C warmer"
xdotool mousemove <body-x> <body-y> click 1; sleep 1.2
xdotool type "CO2 reached 424 ppm in 2024"; xdotool key Return
xdotool type "2023 was the warmest year on record"
xdotool key Escape

# 3. A chart slide: drop the body placeholder, insert a pre-sized PNG
xdotool key ctrl+m; sleep 2.5
xdotool mousemove <title-x> <title-y> click 1; xdotool type "CO2 keeps climbing"; xdotool key Escape
xdotool mousemove <body-edge-x> <body-edge-y> click 1; sleep 1   # selects the empty body frame
xdotool key Delete; xdotool key Escape
convert /tmp/chart.png -resize 720x /tmp/chart-720.png        # ~60% of slide width
xdotool key alt+slash; xdotool type "upload"; xdotool key Return; sleep 3.5
xdotool key ctrl+l; xdotool type "/tmp/chart-720.png"; xdotool key Return; sleep 7
xdotool key Escape

# 4. Speaker notes and slide numbers
xdotool key Home; sleep 1.5
xdotool mousemove <notes-x> <notes-y> click 1; xdotool type "Open cold: the trend is measured, not forecast."
xdotool key Escape
xdotool key alt+slash; xdotool type "slide number"; xdotool key Return; sleep 2.5
xdotool mousemove <skip-title-checkbox-x> <y> click 1      # tick Skip title slides
xdotool mousemove <save-x> <save-y> click 1; sleep 2

# 5. Name it (clicking the on-canvas title does not rename)
xdotool key alt+slash; xdotool type "rename"; xdotool key Return; sleep 2
xdotool key ctrl+a; xdotool type "Global Warming: The Evidence"; xdotool key Return

# 6. Verify: HTML view for text, /present for looks
#    palette: Alt+/ -> "html view" -> Enter, then read the page
node cli/dist/cli.mjs page read | head -40
xdotool key ctrl+t
xdotool type "https://docs.google.com/presentation/d/<ID>/present"; xdotool key Return; sleep 9
node cli/dist/cli.mjs page screenshot --out /tmp/deck.png
```

## Pre-flight checklist

- [ ] Deck URL contains `/presentation/d/` and the tab is the editor.
- [ ] Theme applied **before** typing anything (screenshot to pick the thumbnail).
- [ ] Intro panel and promo banner dismissed, or coordinates measured after they appeared.
- [ ] Title/subtitle typed into placeholders (not into a stray text box) — checked with a screenshot before the first keystroke.
- [ ] Images pre-resized (~720 px wide) and empty body placeholders deleted.
- [ ] Speaker notes typed where needed.
- [ ] Slide numbers on, title slide skipped.
- [ ] Deck renamed through the palette.
- [ ] HTML view read back and compared with the intended slide order and wording.
- [ ] A screenshot of `/present` for the visual check.
- [ ] `Escape` used instead of `Ctrl+W` for any dismissal.

## Bottom line

Treat Slides as a canvas application with a text-searchable echo: apply a theme before typing, pre-size images, type into placeholders like a person, drive structure with `Ctrl+M`/`Ctrl+D`/`Ctrl+↑↓`, reach settings through `Alt+/`, and verify text with the `htmlpresent` page or a clipboard copy — never with the run-on `page read` line alone.
