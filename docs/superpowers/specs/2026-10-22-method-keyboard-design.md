# Method keyboard: the computer keyboard as a performance surface for a deck

Date: 2026-10-22. A Booth feature; builds on the Methods panel (`2026-10-21-method-panel-design.md`, the
Functions section in `2026-10-22-function-panel-design.md`) and the modular rip output (one named line per
part, variations as muted `_name:` lines). Everything here lives in `app/` (Solid + TypeScript) except two
small schema additions in `src-tauri/src/` (a `keys` field on a pattern file and on settings).

## Intent

Tom plays live. Today, adding a method to a running line means finding it in the Methods panel on the far
right, dragging it across the window onto the right line, and pressing Update; taking it off again means
editing text. That is a mouse-and-eyes job, and the moment of hearing what `lpenv` does to the bass is
several seconds and a hand movement away from the thought.

This design turns the computer keyboard into pads. A **key strip** under each deck shows the QWERTY rows.
Tom drags a method from the Methods panel onto a key once; from then on pressing that key appends the
method to the **target line** and re-evaluates the deck, and pressing it again takes it off. Holding the
key auditions it for as long as it is held. Line keys mute and unmute the pattern's named lines, which is
what the muted `_fills:` and `_bass2:` lines were made for. Changes land on the bar line, like a DJ's loop
button, and snapshots on the function keys let him stack five things and then drop back to the clean
pattern in one press.

In Tom's words: "qwerty underneath current strudel viewport where i've dragged and dropped methods, then
when pressing the key, immediately adds and presses 'update' on the canvas so i get immediate feedback
onto the track i'm playing. pressing key again removes it." The hold-to-audition, bar quantisation, line
pads, snapshots and macros were my proposals; Tom said yes to the set and left the two open choices
(perform mode as a switch, bindings global with a per-pattern override) to me.

## Goals

- A **key strip** under each deck's editor: the three letter rows, the digit row and F1 to F8, each key
  showing what it holds and whether it is active.
- **Drag a method or function from the Methods panel onto a key** to bind it, with the catalogue's default
  argument. Dropping a second method onto a bound key makes a **macro**: one key, a chain.
- **Press a method key**: the method is appended to the target line and the deck re-evaluates; press it
  again and it is removed and the deck re-evaluates. The strip shows which keys are currently on.
- **Hold a key** (longer than a tap) to apply the method only while held; release reverts it.
- **Line keys**: the bottom row holds the pattern's named lines; a press flips that line's leading underscore
  (muted ↔ playing). They follow the code, so a rip arrives with its `_fills` and `_bass2` already on keys.
- **Digits 1 to 9 choose the target line** among the pattern's pattern lines; the editor marks it.
- **Shift+key nudges** the bound method's numeric argument on the target line up; Ctrl+key nudges it down.
- **Every key-driven change lands on the next bar line** (configurable: now, beat, bar), and the deck's
  header counts down while something is queued.
- **F1 to F8 are snapshots** of the deck's code: Shift+F saves, F recalls (also on the bar line).
- **Perform mode** is a switch (Esc): on, the keys are pads and the editor is locked; off, the keys type.
- Bindings persist: a **global layout** (your controller), which a **pattern can override** and extend
  (its line keys, and any key you choose to keep with it).
- The density basics that make room for the strip: the editor at 13px instead of Strudel's default 18px,
  decks stretching to the mixer, the editor taking the slack (see part 9).

## Non-goals and anti-goals

- No MIDI in this round. The binding model is written so that a MIDI note could later map onto the same
  key slots, but nothing listens to MIDI here.
- No editing of a binding's argument in the strip beyond nudging; the text editor is where arguments are
  tuned. (A right-click "edit argument" is a later nicety.)
- No per-key colours, icons or custom labels.
- Not a replacement for the Methods panel: the panel stays the browser; the strip is the instrument.
- Anti-goal: a stray letter landing in the code mid-set. That is why perform mode is a switch with the
  editor read-only while it is on, and why nothing is bound by default to a key the user did not fill.
- Anti-goal: a press that breaks the pattern. Insertion uses the same landing rules as the panel's drop
  (`methodDrop.ts`): never inside a string, word or bracket. Removal only ever removes a complete
  `.name(...)` call that the line contains. A removal or insertion that cannot be done safely is refused
  with the deck's error line, and the key does not change state.
- Anti-goal: `orbit` on a key. The catalogue already never offers it; the strip accepts only catalogue
  entries.

## Constraints

- Strudel pinned as before (`@strudel/core` 1.2.6, `@strudel/codemirror`, `superdough` 1.3.0). The
  editor is `StrudelMirror`; read-only is set through a CodeMirror compartment appended to its editor the
  way `methodDropExtension` is.
- Every evaluation goes through the eval lock (`app/src/engine/evalLock.ts`). A key press never evaluates
  directly: it edits the document, then calls the deck's existing `update` (evaluate without changing
  whether the deck is playing).
- The bar line is computed the way sync does it (`secondsToNextBoundary` in `app/src/engine/sync.ts`)
  from the deck's scheduler `now()` and `cps`. Cyclist has no phase API; a cycle is a bar
  (`BEATS_PER_CYCLE` = 4 in `deckState.ts`).
- WebKit: timers and `fetch` unbound (see `docs/handover-2026-10-21.md`); key events on `window`, as the
  Space transport already does (`spaceToggle.ts`).
- Space keeps its meaning (start or stop everything) in both modes. Cmd/Meta chords are never consumed by
  the strip, so Cmd+S, Cmd+Z, Cmd+R keep working.
- macOS sends F1 to F8 to the page only when "Use F1, F2, etc. keys as standard function keys" is on, or
  Fn is held. The Settings tab says so beside the strip's settings.
- Pattern files are JSON read and written by Rust (`src-tauri/src/library.rs`, `Pattern` with serde
  defaults); a new optional field must default so old files load unchanged, and a file with no `keys`
  must be written with none (no churn in Tom's library from merely loading).
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.

## The parts

### 1. Bindings (`app/src/booth/keys/bindings.ts`)

```ts
/** A physical key slot: `KeyQ` … `KeyM` (the 26 letters, by `KeyboardEvent.code`). */
type Slot = string;

type Binding =
  | { kind: 'method'; name: string; snippet: string; argRange: [number, number] | null }   // one catalogue entry
  | { kind: 'macro'; parts: { name: string; snippet: string; argRange: [number, number] | null }[] } // a chain
  | { kind: 'line'; label: string };                                                        // a named line, by label without its underscore

interface Layout { bindings: Partial<Record<Slot, Binding>>; snapshots?: Partial<Record<'F1'|…|'F8', string>> }
```

- A **method** binding is what the Methods panel drags today (`MethodDrag`): its snippet is the text a
  press inserts, `.lpenv(2)`, and `argRange` locates the argument for nudging. **The strip accepts
  `kind: 'method'` drags only.** A standalone function from the Functions section has no line end to land
  on; dropping one on a key is refused with "functions go in the editor, not on a key" in the deck's
  error line. (my call: functions stay a drag-to-pointer thing.)
- A **macro** is made by dropping a method onto an already bound method or macro key; its snippet is the
  parts' snippets concatenated in order. Its `name` for presence checks is the first part's name.
- A **line** binding names a pattern line by its label with any leading underscore removed, so it is the
  same key whether the line is muted or not. Line bindings are derived from the code (below), never saved.

**Effective layout** of a deck = the global layout, overlaid by the loaded pattern's layout slot by slot
(a pattern slot wins; a pattern slot of `null` clears a global key for that pattern). Snapshots come from
the pattern only. Pure function `effectiveLayout(global, pattern, lines)`, the derived line keys last.

**Where a change writes.** A drop or a move writes to the layer that owns the slot as shown: the
pattern layout when the pattern owns that slot, else the global layout. So a key you see is the key you
change, and a drop never looks like it did nothing. Right-click a key offers: **clear** (removes the
binding from the layer that owns it, so a global key is deleted globally); **hide for this pattern** on
a global key (writes `null` into the pattern layout: the slot is empty for this pattern only);
**keep with this pattern** on a global key (copies it into the pattern layout) and **make global** on a
pattern key (moves it). Pattern-layout changes make the deck dirty, since Save writes them; global-layout
changes save at once to settings. Settings also has "Reset key layout" for the whole global layout.
(my call, after the builder check)

**Line keys are derived, not stored.** The bottom row `KeyZ KeyX KeyC KeyV KeyB KeyN KeyM` always shows
the loaded pattern's named lines (`name:` and `_name:`, not `$:`) in document order, one per free slot,
recomputed whenever the code changes; a slot the effective layout fills with a method is skipped, so a
line never shadows a key you bound. Nothing is written to the file for them, the dirty check does not see
them, and a `_bass3:` line added mid-set gets the next free key at once. The Solomun rip therefore lands
with Z drums, X hats, C `_fills`, V bass, B `_bass2`. There is no hand binding of lines; freeing a slot
(clear or hide a method key on the bottom row) is how a line gets it. `Binding.kind === 'line'` exists
only in memory, as the derived binding's shape. (my call, after the builder check: a persisted pre-fill
would stop following the pattern after its first Save, and a "bind line…" dialog is more UI than the
problem needs.)

### 2. Pattern lines and the target (`app/src/booth/keys/lines.ts`)

A **pattern line** is a line whose code (comment stripped, as `scanLine` in `methodDrop.ts` does it) is a
labelled pattern (`name:` or `_name:` or `$:` followed by code, or a bare label whose body is below) or an
unlabelled expression; not blank, not comment-only, not a setup line (`SETUP` in `methodDrop.ts`). Lines
inside a template literal or a multi-line expression belong to the pattern line that opened it. Pure
function `patternLines(code) → { index: number; label: string | null; muted: boolean; first: number;
last: number }[]`, numbered 1..n in document order.

The **target** is one of those, per deck. Digit `n` selects the n-th; a digit with no line flashes the
strip and does nothing. Entering perform mode targets the line under the cursor if it is a pattern line,
else the first. When the code changes (an edit, a load, a snapshot recall), the target is re-found by
label when it has one, else by number, clamped. The target is shown by an amber bar in the editor
gutter and the line's number; the gutter shows pattern-line numbers in place of CodeMirror's line numbers
in both modes (line numbers off, part 9).

### 3. Press semantics (`app/src/booth/keys/press.ts`, pure, plus the controller in part 5)

For the target line `L` and a key's binding:

- **method / macro, not present on L** → insert the snippet at L's landing point (`insertAtLineEnd`
  rules, the same function), so a line that cannot take a method (ends in an operator, an open bracket)
  refuses with the existing message.
- **method / macro, present on L** → remove it. *Present* means L's code, outside strings and comments,
  contains `.name(` for the binding's name (a macro: its first part's name followed by the rest of the
  chain's names in order). Removal takes the last such `.name(` on the line through its balanced closing
  parenthesis (and for a macro, each following part's call in turn); the argument may have been edited by
  hand and is removed with it. A `.name` with unbalanced parentheses refuses.
- **line** → the label's line gets a leading underscore if it has none, else loses it. A line key is
  re-derived with the code, so it is never stale; a `$:` line has no label and gets no key.
- **Shift+key / Ctrl+key** on a present method whose `argRange` is a numeric literal → the literal on L
  is multiplied or divided by 2, rounded to at most 3 significant digits, never below 0.001; a
  non-numeric or absent argument, or a method not present, does nothing but flash the key. (my call: a
  factor of 2 is an octave, a half-time, a doubled attack, and it stays audible; finer steps are the text
  editor's job.) Nudging a macro nudges its first part's argument.

Each press produces one **edit**: `{ from, to, insert }` against the current code, or a refusal reason.
Edits are applied as CodeMirror transactions (one per applied batch, part 4) so Cmd+Z in edit mode undoes
a batch, and `userEvent: 'input.key'` tells the dirty tracking and the library-target logic the same
thing a drop does today.

**Tap vs hold.** `keydown` (not a repeat) starts a press; `keyup` ends it. A press shorter than
`HOLD_MS` (my call: 250 ms) is a **tap**: its edit stays. A longer one is a **hold**: `keyup` queues the
inverse edit (remove what the press inserted, or re-insert what it removed, or flip the underscore back).
A hold always lasts at least one quantum (part 4): if the key is released before the press has even been
applied, the press still applies at its boundary and the revert goes to the following one, so a short
hold on a bar-quantised deck is one bar of audition, never nothing.

The strip reflects **what the code says**, not what was pressed: a key is lit when its binding is present
on the target line (a line key: when its line is unmuted), re-derived whenever the code or the target
changes. Editing the text by hand therefore updates the strip, and a failed Update (an evaluation error)
leaves the code and the lights as they are, with the error in the deck's error line as today.

### 4. Quantised updates (`app/src/booth/keys/quantise.ts`)

A booth-wide setting `keyQuantise: 'now' | 'beat' | 'bar'` (default `'bar'`), shown in Settings and as a
three-way toggle at the right end of each strip's hint line.

Presses on a deck go into that deck's **queue**. When the queue is empty and a press arrives, the deck
computes the wait to the next boundary from `scheduler.now()` and `scheduler.cps` (`'bar'`: the next whole
cycle via `secondsToNextBoundary`; `'beat'`: the next quarter cycle; `'now'`: zero) less the clock's
minimum latency, and sets a timer; a deck that is not started applies at once. When it fires, every queued
edit is applied in order to the then-current code (re-deriving each from the code as it stands, so two
presses of the same key within one window cancel out to nothing, and a key pressed while the text was
edited by hand still acts on the real text), as one transaction, then `update()` once. The queue is a
pure state machine with an injected clock, tested like `SyncController` is.

The deck header shows **"next bar in N"** (beats, counting down) only while the queue is non-empty, and
keys with a queued edit pulse until it lands. A Stop while something is queued drops the queue (nothing
to audition on silence); a Play applies the queue immediately with the start.

Sync: deck B's boundary is its own scheduler's, which while sync is engaged is aligned to A's. Nothing
extra.

### 5. Perform mode and the key handler (`app/src/booth/keys/KeyController.ts`, one per booth)

A booth-wide boolean `perform`, toggled by **Esc** while the Booth tab is showing (and by a `perform`
button in each strip's hint line for the mouse). The **performing deck** is the library's target deck
(`library.state.target`, already "the deck last clicked, typed in or loaded"); **Tab** in perform mode
moves it to the other deck. Entering perform mode blurs the editor and makes both editors read-only
(a CodeMirror `readOnly` compartment, plus `editable` false so no caret shows); leaving it restores them
and focuses the performing deck's editor at the target line. The performing deck's border turns the
accent colour and its header gains a `perform` badge; the other deck's strip is dimmed.

The handler is one `keydown`/`keyup` pair on `window`, installed by the Booth next to the Space handler:

| Key (by `code`) | Perform mode on | Perform mode off |
|---|---|---|
| `Escape` | leave perform mode | enter it (unless a dialog is open) |
| letters | the bound action on the performing deck; unbound: nothing | type |
| `Digit1`–`Digit9` | target line n | type |
| `F1`–`F8` | recall snapshot; with Shift: save one | same (my call: snapshots are safe to take while editing) |
| `Tab` | other deck | the editor's Tab |
| `Space` | transport, as today | transport outside the editor, as today |
| anything with Meta | pass through | pass through |

Consumed keys call `preventDefault`. A key the strip consumes is never seen by the editor because the
editor is blurred; the handler still ignores events whose target is an `input`, `select` or `textarea`
(the panels' search boxes) so the panels stay usable in perform mode. Key repeat is ignored. Letters are
matched by `code`, so a non-QWERTY layout still has the physical strip shape; the strip labels show the
letter `KeyboardEvent.key` reports for that slot once any key has been pressed, else the QWERTY letter.

Mouse: clicking a key in the strip is a tap; pressing and holding it is a hold; the strip is therefore
usable in edit mode too, with the mouse.

### 6. Snapshots

Eight slots per deck, `F1` to `F8`, kept in the pattern layout (so Save keeps them and a reload brings
them back). Shift+F saves the deck's current code into the slot (a filled slot shows a dot). F recalls:
the whole document is replaced by the snapshot as one edit through the queue (so it lands on the bar),
then `update()`. A recall is undoable with Cmd+Z in edit mode. Saving a snapshot marks the deck dirty;
recalling one marks it dirty if the code differs from the saved file, as any edit does. An empty slot
recalled flashes the key.

### 7. The strip (`app/src/booth/keys/KeyStrip.tsx`, `keyStrip.css`)

Under each deck's editor, above the error line and transport, inside the deck's border:

```
[1][2][3][4][5][6][7][8][9]                      [F1·][F2·][F3][F4][F5][F6][F7][F8]
[Q lpenv(2)][W hpf(400)][E room(0.5)][R delay(0.25)][T crush(6)][Y][U][I][O][P]
  [A lpf(300).room(0.8)][S fast(2)][D rev()][F ply(2)][G gain(0.5)][H][J][K][L]
    [Z _fills][X _bass2][C hats][V][B][N][M]
tap commit · hold audition · shift/ctrl+key nudge · 1–9 line · F1–F8 snapshot · tab deck · esc edit   [now|beat|bar] [perform]
```

Key states, each a class: empty; bound; **on** (accent fill); **held** (blue outline, while a hold is
down); **pending** (pulsing outline, queued); **muted** for a line key whose line is muted (dim, struck
through) and unmuted (bound look); **refused** (a method key the target line cannot take: dashed,
grey); **drop** (a method is being dragged over it). A key's label is the binding's
snippet without the leading dot, ellipsised; a macro shows its parts joined. Hovering a key shows the
same tooltip the Methods panel shows for that method (the catalogue's description), reusing its
component.

Drop handling: the strip accepts `METHOD_MIME` drags whose payload is `kind: 'method'`; the drop writes the
binding (part 1) and flashes the key. Dragging a key onto another key moves the binding (my call: cheap,
and the obvious way to reorganise). Right-click opens the small menu from part 1.

The strip can be folded to one hint line per deck (a disclosure in the hint line); folded or not is
remembered per booth session only. In perform mode it always unfolds.

### 8. Persistence

- `Pattern.keys?: Layout` in `src-tauri/src/library.rs` (`#[serde(default, skip_serializing_if =
  "Option::is_none")]`) and in `app/src/library/api.ts`. `patternFromDeck` carries the deck's pattern
  layout into what Save writes; a load sets it. The rip's generated pattern writes no `keys` (the pre-fill
  does the work on load).
- Settings gains `keys: Layout` (global layout; snapshots unused there) and `keyQuantise`, with defaults,
  in `src-tauri/src/settings.rs` and `app/src/settings/settings.ts`. The Settings tab shows the quantise
  choice and a "Reset key layout" button, plus the macOS F-key note.

### 9. Density changes that ride along (`deck.css`, `booth.css`, `Deck.tsx`)

- Editor font 13px (`mirror.setFontSize(13)` after construction; Strudel persists its own `fontSize` in
  localStorage, which this overrides on every mount so a stale 18 never comes back), CodeMirror line
  numbers off (`isLineNumbersDisplayed: false` via Strudel's settings atom) and the pattern-line gutter
  from part 2 in their place.
- Decks stretch (`align-items: stretch` on `.booth-decks`, the deck a column with the editor `flex: 1`),
  deck padding 8px and gap 6px. The footer and side panels are unchanged in this work (Tom turned down the
  footer and focus-mode options for now).

### 10. Tests

Pure, in vitest beside each module: `patternLines` on the Solomun golden and on edge cases (bare label
with body below, template literals, setup lines, comments); `press` insert/remove/nudge/flip including the
refusals and a hand-edited argument; `effectiveLayout` and the write rules; the queue's timing with a fake
clock (`'now'`, `'beat'`, `'bar'`, a hold shorter than a quantum, two presses cancelling, Stop dropping the
queue); the tap/hold state machine. A Solid component test renders the strip in each key state and checks
the drop writes a binding. The Rust side gets a round-trip test that a pattern without `keys` serialises
without it. The existing `tsc --noEmit` and both suites stay green.

## Left to the builder

- Exact sizes, colours and the pulse animation, within the app's palette (`deck.css`, `methodPanel.css`).
- `HOLD_MS` tuning (250 ms is the starting value) and the flash duration for refused keys.
- How the countdown is driven (a `requestAnimationFrame` or a per-beat timer) and its exact wording.
- The right-click menu's component (the library's `ContextMenu.tsx` is there to reuse).
- The order of implementation; a sensible one is parts 1 to 3 with tests, then 4 and 5, then 7, then 6
  and 8, then 9.
