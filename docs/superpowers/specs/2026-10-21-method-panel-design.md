# Method panel: Strudel's chainable methods as drag-and-drop, with descriptions

Date: 2026-10-21. A Booth feature; builds on the booth and library in `2026-10-19-algobooth-design.md`.
Everything here lives in `app/` (Solid + TypeScript) plus one dev-time script in `scripts/`.

## Intent

Tom plays live and does not have Strudel's surface memorised. Mid-set, at a deck with a pattern
playing, he wants to reach for a method such as `lpenv` or `duckattack` without leaving the booth: see
what exists, read in one line what it does, drag it onto the pattern, and press Update. The dropped
method must work the moment it lands, with a default argument that does something audible.

In Tom's words: "I drag it from a side panel into the deck editor", "with a default argument. It should
work the moment I drop it in and click Update", "just the chainable ones for now".

## Goals

- A **Methods panel** on the right of the Booth, mirroring the pattern library on the left, listing
  Strudel's chainable methods grouped in folders, with a search box.
- **Hover** on a method shows a tooltip: the call as it will be inserted, Strudel's own description, and
  its synonyms.
- **Drag** a method onto a deck editor: the text `.name(default)` lands at the end of the line it was
  dropped on, the default argument left selected, and Update evaluates without error.
- The method list, descriptions and defaults are **built offline** from the pinned Strudel packages and
  committed; nothing is fetched at run time.
- A test proves every method in the panel evaluates with its default when chained onto a plain pattern.

## Non-goals and anti-goals

- Only chainable methods: things you can write after a dot on a pattern. Sources used standalone
  (`stack`, `cat`, `sine`, `run`, `samples`), transport and drawing helpers are not listed.
- The Rip tab's result editor is not a drop target in this work (its editor is a second `StrudelMirror`;
  adding it later is the same drop handler on another instance).
- No snippet library, no multi-method presets, no editing of defaults in the panel.
- Anti-goal: `orbit` in the panel. Orbits are the app's deck channels; a dropped `.orbit(2)` would
  silently reroute deck A through deck B's chain. It is never offered.
- Anti-goal: a drop that breaks the pattern. Dropping must never split a string, a word or a bracket.

## Constraints

- Strudel is pinned (`@strudel/core` 1.2.6, `@strudel/tonal` 1.2.6, `superdough` 1.3.0); the packages
  ship `.mjs` sources with JSDoc (`@name`, `@synonyms`, `@param`, `@example`, `@memberof`,
  `@noAutocomplete`, `@superdirtOnly`, `@deprecated`) but no generated `doc.json`. The build script
  reads those sources.
- Offline by default: the generated JSON is committed to the repo, the way the bundled samples are.
- WebKit quirks apply (see `docs/handover-2026-10-21.md`): drag events and timers as the library tree
  already does them.
- Every Strudel evaluation goes through the eval lock; the drop itself does not evaluate, Update does.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.

## The parts

### 1. The method catalogue (`scripts/build-methods.ts`, output `app/src/methods/catalogue.json`)

A dev-time script run with `pnpm build-methods` (tsx, like `fetch-samples`). It reads the JSDoc blocks
of `@strudel/core` (`controls.mjs`, `pattern.mjs`, `signal.mjs`) and `@strudel/tonal` (`tonal.mjs`,
`voicings.mjs`) from `node_modules` and writes one JSON array. Per method:

```ts
interface MethodDoc {
  name: string;          // the @name
  synonyms: string[];    // @synonyms, split on commas
  description: string;   // the block's first paragraph, one line, JSDoc markup stripped
  params: { name: string; type: string; description: string }[];
  snippet: string;       // what a drop inserts, e.g. `.duckattack(0.2)`
  argRange: [number, number] | null; // character offsets of the argument inside snippet, for selection
  group: string;         // folder, from part 2
  source: string;        // package and file, for the tooltip's "from" line and for debugging
}
```

**Which blocks count as chainable.** A block is in when its symbol is registered on `Pattern`:
every `registerControl` / `registerMultiControl` name and alias in `controls.mjs`; every `register(`
and `@memberof Pattern` function in `pattern.mjs`, `signal.mjs` and the tonal files. A block is out
when it carries `@noAutocomplete`, `@superdirtOnly` or `@deprecated`, or its name is on the deny-list.

**Deny-list** (in the script, with a one-line reason each): `orbit` (deck channel); `p`, `q`, `hush`
(transport and naming, the editor handles these); the drawing methods `pianoroll`, `punchcard`,
`scope`, `spiral`, `pitchwheel`, `markcss`, `color` (the deck draws its own visualiser); `log`,
`logValues`, `analyze` (console); `keyDown`, `whenKey` (gated on a held computer key); `bypass` (its
whole point is silence). The builder may extend the list with the same rule: a method whose effect is
not sound, or that cannot be made to sound with any default on any test base. Anything excluded for
another reason is a design change. Blocks marked `@memberof Pattern` whose name is not actually on
`Pattern.prototype` (checked by importing core) are skipped as not chainable.

**Default argument.** The snippet's argument is, in order: (a) the hand table
`app/src/methods/defaults.ts`, (b) the first `.name(ARG)` call found in the block's first `@example`,
when `ARG` is a single number or quoted string literal, (c) nothing, when `@param` lists no
parameters (`.rev()`). A method with parameters and no default from (a) or (b) fails the build with
its name, so the hand table is extended by hand rather than shipping `.lpf()`. The hand table is also
where an example's argument is a poor default for a running pattern (an example that shows `0` or an
extreme value). Both (a) and (b) are my call; Tom asked only that the default works and is audible.

The hand table's entry is the argument text with the part to select marked between `§` signs, for
example `every(§4§, x => x.fast(2))`, `euclid(§3§, 8)`, `jux(rev)` (no marker: nothing selected).
The marked part is the one literal a player most wants to change, never a callback, so typing a
number after a drop cannot wipe the function. The script strips the markers and computes `argRange`
from them; for rule (b) the single literal is the range. The table may also give a `base` for the
evaluate test (part 5) when the method only sounds on a particular kind of pattern: the `voicing`
family (`voicing`, `voicings`, `rootNotes`) needs a `chord()` pattern, and their tooltips gain the line
"needs a chord() pattern". (my call, from the builder check)

**Synonyms** are listed in the tooltip, not as separate rows; the row is the `@name`.

The script is deterministic (sorted by group then name) so a re-run on an unchanged `node_modules`
produces no diff. Bumping Strudel means re-running it; a vitest test fails if the committed JSON's
recorded package versions differ from the installed ones, with a message saying to run the script.

### 2. Groups (`app/src/methods/groups.ts`)

A hand map `name → group`, with every name not in the map falling into `Other`. The groups, in
panel order (my call, after Strudel's own reference pages):

| Group | Holds, for example |
|---|---|
| Sound | `s`, `bank`, `n`, `note`, `clip`, `legato`, `begin`, `end`, `speed`, `loopAt`, `fit`, `cut` |
| Pitch | `transpose`, `scale`, `voicing`, `rootNotes`, `add`/`sub` on notes, `detune`, `vowel` |
| Filter | `lpf`, `lpq`, `lpenv`, `lpattack` and the hpf/bpf families, `ftype`, `vowel`'s filter cousins |
| Envelope | `attack`, `decay`, `sustain`, `release`, `adsr`, `hold` |
| Dynamics | `gain`, `velocity`, `postgain`, `compressor` and its parts, `amp` |
| Ducking | `duckorbit`, `duckattack`, `duckdepth`, `duckonset` |
| Delay and Reverb | `delay`, `delaytime`, `delayfeedback`, `room`, `size`, `roomsize`, `dry` |
| Modulation | `vib`, `vibmod`, `fm`, `fmh`, `fmattack`, `phaser` and its parts, `tremolo` and its parts |
| Distortion | `distort`, `crush`, `coarse`, `shape`, `drive` |
| Pan and Space | `pan`, `jux`, `juxBy`, `panspan`, `panwidth` |
| Time | `fast`, `slow`, `hurry`, `rev`, `early`, `late`, `off`, `ply`, `iter`, `chop`, `striate`, `segment`, `swingBy`, `palindrome` |
| Structure | `every`, `sometimes`, `sometimesBy`, `degradeBy`, `rarely`, `often`, `struct`, `mask`, `euclid`, `when`, `firstOf`, `lastOf` |
| Other | everything unmapped |

Within a group, rows are sorted alphabetically. The `Ducking` tooltips append one line the JSDoc
does not have: "orbits here are decks: 1 = deck A, 2 = deck B". A test asserts every name in the
map exists in the catalogue (so a Strudel rename surfaces) and prints the `Other` members so the
map can be tended; `Other` is allowed to be non-empty.

### 3. The panel (`app/src/booth/MethodPanel.tsx`, styles in `booth.css`)

- Lives in `Booth.tsx` to the right of `.booth-main`, class `booth-methods`, `flex: 0 0 210px`, a
  left border, same font and colours as `.booth-library`. Header "Methods", a search input under it,
  then the folder tree.
- Folders collapse and expand on click; all collapsed on first open except none (my call: start with
  all collapsed, so the list fits without scrolling; the user's expand state is kept for the app's
  lifetime, not persisted).
- Search filters rows by substring on name, synonyms and description, case-insensitive; while a
  search is non-empty every folder with a match is expanded and empty folders are hidden.
- Each row is `draggable`. `dragstart` sets `text/plain` to the snippet and a private MIME
  `application/x-algobooth-method` to the method's JSON (name, snippet, argRange), so the deck's
  drop handler can tell a method from any other dragged text.
- Hover shows the tooltip after the library's `PREVIEW_DELAY_MS`, beside the row, to its left (the
  panel is at the window's right edge): the snippet in code style, the description, "also: " plus
  synonyms when any, the parameters as `name: type` lines when any. Pointer leaving the row or the
  panel hides it. Keyboard focus on a row shows it too.
- Double-click on a row inserts the snippet into the library's target deck (the deck marked
  "◂ library", see `library/store.ts`) at the end of the line the cursor is on, with the same rule as a
  drop. My call, for parity with the library's double-click.

### 4. The drop (`app/src/booth/methodDrop.ts`, wired in `Deck.tsx`)

- A pure function `insertAtLineEnd(code: string, lineIndex: number, snippet: string): { code: string;
  selection: [number, number] | null } | null`:
  - the target line is the dropped-on line, or when that line is blank or starts with `//`, the
    nearest line above that is neither; no such line gives `null` (the deck flashes "drop onto a
    pattern line" in its footer message slot);
  - the snippet goes at the end of the target line's code, before a trailing `//` comment and before
    trailing whitespace; a trailing `;` is kept after the snippet;
  - `selection` is the argument's range in the new code (from `argRange`), or `null` when the snippet
    has no argument.
- In `Deck.tsx`, a CodeMirror `EditorView.domEventHandlers` extension appended to the mirror's editor
  (`mirror.editor`, via `StateEffect.appendConfig`) handles `dragover` (allow the drop when the private
  MIME is present) and `drop`: take the line from `posAtCoords`, run `insertAtLineEnd` on the current
  document, dispatch the change with the selection set to the argument, focus the editor, and
  `preventDefault` whenever the private MIME is present, including when `insertAtLineEnd` returns
  `null`, so CodeMirror's own text drop never inserts the `text/plain` copy mid-token. Drops without
  the private MIME are left to CodeMirror. The "drop onto a pattern line" message uses the deck's
  existing error slot.
- The deck's dirty tracking follows the document change the same way typing does (the mirror's
  `onUpdateState` already feeds `editorCode`); the builder verifies this and the "◂ library" target
  switch on drop (a drop is an interaction with that deck, like clicking in it).
- Nothing evaluates on drop. Update is Tom's.

### 5. Tests

- `scripts/build-methods.test.ts` (vitest): the JSDoc parser on a fixture string with two blocks
  (one control with synonyms and an example, one `@memberof Pattern` function with no parameters);
  the exclusion tags; the default-argument order (table beats example beats none); the build fails on
  a method with parameters and no default.
- `app/src/methods/catalogue.test.ts`: the committed JSON is in sync with the installed Strudel
  versions; `orbit` is absent; every group-map name exists; every row has a non-empty description.
- `app/src/methods/evaluate.test.ts`: for every row, a base pattern plus the snippet is evaluated with
  the real Strudel bundles (the setup in `rip/roundtrip.test.ts`) and must evaluate without error and
  query at least one event in the first cycle. The base is `s("bd*4").bank("tr909")` by default,
  `note("c3 e3 g3 c4").s("sawtooth")` for the `Pitch` group, and the hand table's `base` when it gives
  one (`chord("<C^7 Dm7>")` for the voicing family). No exemption list: a row that sounds on no base is
  denied under the rule in part 1. This is the test behind "works the moment I drop it".
- `app/src/booth/methodDrop.test.ts`: `insertAtLineEnd` on a plain line, a line with a trailing
  comment, a line ending in `;`, a blank line under a pattern line, a comment line under a pattern
  line, a document with only comments (null), a multi-line chain (the drop lands on the dropped-on
  line, not the chain's last line), and the selection range.
- `MethodPanel.test.tsx` (jsdom, as `LibraryTree.test.tsx`): rows render by group; search filters
  and expands; `dragstart` carries both MIME types; hover shows the tooltip with the description.

## Decided

- Placement: a panel of its own on the right, not a tab on the library panel (Tom chose B of two
  mockups).
- A drop lands at the end of the dropped-on line, whatever the column.
- The default argument is selected after a drop.
- Chainable methods only; `orbit` never.
- Descriptions are Strudel's own JSDoc, built at dev time and committed; no network at run time.
- Groups are hand-curated with an `Other` bucket. (my call)
- Defaults: hand table, then the first example's literal argument, then none; the build fails rather
  than shipping an empty argument list for a method that takes parameters. (my call)
- Double-click inserts into the library's target deck, through a new `DeckApi` method that inserts at
  the cursor's line. (my call)
- Multi-argument defaults come from the hand table with the one tweakable literal marked for
  selection; a test `base` per method where needed; methods that cannot sound at all are denied. (my
  call, from the builder check)
- Folders start collapsed; expand state lives for the app's lifetime only. (my call)
- The Rip tab's editor is not a target yet.

## Left to the builder

- The JSDoc parser's exact shape (a small hand-rolled block scanner is enough; no `jsdoc` dependency).
- The deny-list's long tail beyond the names above, under the stated rule.
- Tooltip positioning details and the row's focus styling.
- Whether the panel can be collapsed to a thin strip; not required.
- Test literals, as long as they pin the behaviours above.
