# Cue lines: mixing a second pattern into a playing deck, line by line

Date: 2026-10-23. A Booth feature; builds on the method keyboard (`2026-10-22-method-keyboard-design.md`:
pattern lines, derived line keys, the quantised queue) and the modular rip output (one named line per
part, variations as muted `_name:` lines). Everything here lives in `app/` (Solid + TypeScript). No file
format or Rust change.

## Intent

Tom is playing the Solomun rip on deck B and wants Acid Line next. Today a library double-click, drag or
"Load to B" replaces the deck's editor text with Acid Line's. The deck keeps sounding Solomun until the
next evaluation, but Solomun's code, its line keys and its snapshots are gone, and the first key press or
Update swaps the whole deck to Acid Line at once. There is no way to bring Acid Line's bass in under
Solomun's drums, then take Solomun's bass out, then its hats: the two patterns are never in the deck
together.

This design adds a **cue**: the second pattern's lines arrive at the bottom of the deck's code, every one
muted with a leading underscore and prefixed with the cued pattern's name, under a comment that marks the
block. The muted lines are visible in the editor, each one sits on a key of its own in the strip, and a
press flips it on or off on the bar like any line key. Mixing is flipping pads: Acid's bass on, Solomun's
bass off, hats swapped. When the move is done, **Go** drops what is left of the old pattern and makes the
deck Acid Line's; **Clear** drops the cue instead.

In Tom's words, choosing this over a clip-launcher swap: "i like muted things i can see and switch on and
off." The cue block, the prefixing, the second key row, Go and Clear are my proposals.

## Goals

- **Cue a library pattern onto a deck** without touching the lines already there: the pattern's code is
  appended as a marked block of muted, prefixed named lines.
- **Every cued line is a pad**: the strip shows the cued lines as line keys, apart from the deck's own,
  and a press flips the underscore through the queue (on the bar, beat or now, as set), hold auditions.
- **The code is the truth.** The cue is nothing but text in the editor: the marker comment and the
  prefixed lines. The header, the keys, Go and Clear are all derived from it, so Save keeps a half-done
  mix, Cmd+Z undoes a cue, and a hand edit of a cued line is as good as a key press.
- **Go** finishes the move: the old pattern's lines go, the prefixes come off, the deck is now the cued
  pattern (name, file, key layer), the tempo stays as it was running.
- **Clear** abandons the cue: the block goes, the old pattern is as it was.
- Tempo never jumps on a cue: the cued pattern's `setcpm` line is left out.

## Non-goals and anti-goals

- No automatic mixing (no fades, no scheduled flips). The pads are the instrument.
- No crossfader change. Mixing *between* decks is the crossfader's job and stays as it is.
- Not a clip launcher: there is no "next slot" that swaps the whole deck in one press. Go is the end of a
  mix, not the start of one, and Go never unmutes anything.
- One cue per deck at a time. Cueing another pattern replaces the cued block.
- Anti-goal: the playing pattern changing sound because something was cued. A cue writes muted lines
  only and leaves the tempo line alone; the first audible change is the first pad the user presses.
- Anti-goal: losing the running pattern. Nothing a cue does removes or edits an existing line; only Go
  does, and Go is one undoable edit.

## The cue block

Cueing pattern P onto a deck whose code is C appends to C, after one blank line:

```
// cued: Acid line · 126 cpm · its lines are on the home row · Go finishes, Clear drops
_acid_line: note("c2(5,8)").s("sawtooth").lpf(sine.range(300, 2200).slow(8)).lpq(8).decay(0.2).sustain(0).gain(0.7)
```

and for a pattern with named lines (Solomun cued onto something else):

```
// cued: Solomun – Live at Alexandra Palace… · 129 cpm · its lines are on the home row · Go finishes, Clear drops
_solomun_drums: s("bd*4, …").bank("tr909")
_solomun_hats: s("[~ oh ~ ~] …").bank("tr909")
// bars 1–9 add these hits (a fill): remove the underscore to hear them
_solomun_fills: s("<…>").bank("tr909")
_solomun_bass: note("[~ ~ g1@2] …").s("sawtooth").lpf(800)
…
```

Rules, applied by a pure function `cueBlock(name, code) → string` in `app/src/booth/keys/cue.ts`:

- **The marker** is a comment line `// cued: <name> · <cpm> cpm · its lines are on the home row · Go finishes, Clear drops`.
  The name is the pattern's full name; `<cpm>` is the pattern file's `cpm`. The marker is how a cue is
  recognised (below), so its first two words are a fixed prefix `// cued: `.
- **The slug** is derived from the pattern name: lower-cased, every run of non-word characters replaced
  by one underscore, leading and trailing underscores dropped, then cut at the first word boundary at or
  after 12 characters (the first word always survives, however long). "Acid line" → `acid_line`;
  "Solomun – Live at Alexandra Palace, London (2026) (Official Film) 36:40" → `solomun_live`;
  "Acid-switch-angel" → `acid_switch_angel`. A slug that starts with a digit gets `p_` in front, so the
  label is an identifier.
- **Every pattern line of P** (as `patternLines` finds them, so a chain over several physical lines is
  one line) is rewritten with the label `_<slug>_<label>`: a labelled line keeps its label after the
  prefix (`bass` → `_acid_line_bass`), an already muted `_fills` becomes `_acid_line_fills` (muted
  either way; the underscore is not doubled), a `$:` line or an unlabelled expression gets a number in
  document order among the unlabelled lines (`_acid_line_1`, `_acid_line_2`). A one-line pattern whose
  only line is unlabelled gets the bare slug, `_acid_line`, as in the first example.
- **Setup lines**: `setcpm(` and `setcps(` lines are dropped. Other setup lines (`const`, `let`,
  `samples(`, `await`) are kept as they are, in place, since the lines below may need them.
- **Comments** and the physical layout inside a pattern line are kept; blank lines are collapsed to none
  inside the block. A comment line that is itself a cue marker (P was saved mid-mix) is dropped along with
  nothing else: the cued pattern's own cued lines come in as ordinary lines (their labels already carry
  a prefix; they get another).
- The block is appended as **one CodeMirror transaction** with `userEvent: 'input.cue'`, so Cmd+Z in
  edit mode removes the whole cue, the dirty dot comes on as for any edit, and the deck becomes the
  library target as a drop does.
- If the deck is playing, the deck **evaluates at once** after the cue (not through the queue: muted
  lines make no sound, so there is nothing to land on a bar). This surfaces a syntax error in the cued
  code in the error line now rather than at the first pad press. A stopped deck is not started.

## Recognising a cue

A deck **has a cue** when its live code contains a line whose trimmed text starts with `// cued: `.
The **cued lines** are the pattern lines after that marker whose label starts with the slug derived from
the marker's name plus `_`, or equals the slug. Everything else is the deck's **own lines**. Pure
function `cueOf(code) → { name, cpm, slug, markerLine, lines: PatternLine[] } | null` in `cue.ts`; a
second marker is ignored (the first wins), and a deck with a marker but no cued lines left still has a
cue (Clear removes the marker).

Derived this way, a cue survives Save and Load (a saved half-mix is still a mix when it comes back), a
hand-typed `_acid_line_pad:` line under the marker joins the cue, and a hand-deleted one leaves it.

## The strip

Today the bottom row `Z X C V B N M` shows the pattern's named lines on its free slots, in order.
With a cue:

- The deck's **own lines** stay on the bottom row as today.
- The **cued lines** take the free slots of the **home row** `A S D F G H J K L`, in document order, a
  free slot being one the effective layout leaves without a method or macro binding and that the pattern
  layout has not hidden. Lines past the last free slot are dropped, as on the bottom row.
- A cued key shows the line's label **without the slug prefix** (`bass`, `1`, or the bare slug when that
  is all there is) in a distinct colour, and the hint line says `home row: Acid line` while a cue is
  present. Its states (on, muted, held, pending) are the bottom row's.
- `effectiveLayout(global, pattern, lines, cued)` takes the cued labels as a fourth argument (empty today)
  and places them on `LETTER_ROWS[1]` by the same rule it uses for `LINE_ROW`. A line binding keeps
  `{ kind: 'line', label }` with the full label, so `flipMute` and the presence check are unchanged.

A press on a cued key is a line press: flip the underscore through the queue, hold to audition. Nothing
new in `press.ts` or the queue.

Why the home row and not more of the bottom row: the Solomun rip already has seven named lines, which
fill `Z` to `M`; a cue needs room of its own, and two rows for two patterns is readable without looking.
Home-row method keys the user bound stay where they are and simply leave fewer slots for cued lines.

## The header

While a deck has a cue, its header shows, after the name and the library marker:

```
next: Acid line   [Go]  [Clear]
```

`next:` and the name in the countdown's amber; Go and Clear are ghost buttons like Reload / Keep mine.
Both act on the performing deck too through keys, in perform mode only: **Enter** is Go and
**Shift+Enter** is Clear (neither key is used by the keyboard today; Space stays with the transport).

## Go

Go turns the mix into the cued pattern:

1. One edit: every **own pattern line** is removed (its physical lines, and a comment line directly
   above it that has no blank line between, since the rip writes its bar notes that way); the marker
   line goes; every cued line that had a label of its own loses its `_<slug>_` prefix, keeping its
   current mute state (a cued line still muted stays `_bass:`; one switched on becomes `bass:`). A
   numbered line (`_acid_line_1`) or the bare-slug line (`_acid_line`) that was switched on becomes a
   `$:` line again; one still muted **keeps its cued label as it is**, so it stays muted and stays on a
   key (now the bottom row, as one of the deck's own lines) for the user to switch on later. Go never
   changes what is sounding except by removing the own lines. Own setup lines (`setcpm`, `const`) and
   comment lines not attached to a removed pattern line stay. So the tempo stays the running one.
2. The deck is pointed at the cued pattern: name = the marker's name, file = the path it was cued from,
   `savedCode` = that file's code, key layer = that file's `keys`. The deck shows dirty when the result
   differs from the file (it will, at least by the tempo line, and that is right: Save then writes the
   mixed result over Acid Line, Save as puts it elsewhere).
3. The whole of Go runs **as one job through the deck's queue**, exactly as a snapshot recall does: the
   job rewrites the working code at flush time (so until the bar the code, the header's `next:` and the
   cued pads are all still there, and the header counts down `next bar in N` as for a press), the flush
   writes it as one transaction and evaluates it, and the file pointer (step 2) is set **after** the
   flush's evaluation, from an `after` hook the job leaves on the flush's `Work` (a small addition to
   `flush`). The order matters because `setFile` fires `onLoad`, whose `loaded` hook drops the deck's
   queue: by then the flush has already drained it, so nothing is lost. The flush's transaction may carry
   a job-chosen `userEvent` (`'input.go'`, a second small addition; a plain press stays `'input.key'`).
   A pad press queued in the same window after Go re-derives from the new code at flush time, finds no
   line of that label and is refused, as a stale press is today. On a stopped deck, or with quantise
   `now`, the job runs at once, as any job does.

Go needs the cued pattern's path and file, which the code does not carry. The deck state gets
`cueSource: { path: string; pattern: Pattern } | null`, set by the cue and cleared by Go, Clear, a load
and a new pattern. When a cue is recognised in the code but `cueSource` is null (the deck was loaded
from a file saved mid-mix), Go still does step 1 and 3 and leaves the file pointer alone (step 2 skipped,
the deck keeps its current name and file); the header says `next: Acid line (from file)` so it is clear.

Go with unsaved own edits asks nothing: the own lines are discarded by design, and Cmd+Z brings them
back in edit mode.

## Clear

Clear removes the cue block (marker and cued lines, with the comment lines that came with them) and
clears `cueSource`. When any cued line is unmuted it is sounding, so Clear runs as a queued job like Go
(the edit and its evaluation land on the bar, `userEvent: 'input.clear-cue'`); when every cued line is
muted the edit is applied at once with no evaluation, since nothing audible changes.

Cueing another pattern while one is cued is Clear then cue as one edit, and it follows Clear's rule: at
once when the old cue is all muted, else as one queued job (the old cued lines stop and the new ones
arrive, muted, on the bar; the evaluation at the flush covers the new block's syntax check).

## The gesture

How a cue is asked for from the library (Tom's choice, 2026-10-23):

- **Double-click cues when the target deck is playing and loads when it is stopped.** The live case is
  the one where an overwrite hurts, and a stopped deck has nothing to mix into. **Shift+double-click
  does the other thing** (loads a playing deck, cues onto a stopped one). The context menu always offers
  both: `Load to A / B` as today and `Cue on A / B` new. "Playing" is the deck's `scheduler.started`.
- A load onto a playing deck (Shift+double-click, drag, the menu) behaves as today, dirty prompt included.

A drag onto a deck keeps loading in either case (a drop is deliberate, and the deck lights up as a
target); a drag onto a deck's **header** cues. (my call)

A cue is refused, with the reason in the library's error line, for a heading or an unreadable file, as a
load is. A cue onto a deck that holds unsaved edits asks nothing: nothing is lost.

## Where it lives

- `app/src/booth/keys/cue.ts`: `slugOf`, `cueBlock`, `cueOf`, `goEdits`, `clearEdits`, all pure over
  code strings and `PatternLine`s, with tests beside them (Acid Line onto Solomun; Solomun onto Acid
  Line; a `$:`-only pattern; a pattern saved mid-mix; a pattern with a `const` line; a long name).
- `bindings.ts`: `effectiveLayout` takes cued labels; `KeyStrip.tsx` draws the cued keys and the hint;
  `keyStrip.css` their colour.
- `KeyController.ts`: `cue(id, path, pattern)`, `go(id)`, `clearCue(id)`; Enter and Shift+Enter in
  perform mode; the `loaded` hook also clears `cueSource`.
- `Deck.tsx`: the header slot and buttons; `deckState.ts`: `cueSource`.
- `library/store.ts`: `cue(path, deckId)` beside `load`, and the double-click rule; `LibraryTree.tsx`:
  the menu items and the modifier.
- README's Keys section gains a Cue paragraph; the handover file's state section is updated.

## Left to the builder

- The exact amber and the cued key colour; the header slot's layout at narrow widths.
- Whether the cued block's marker comment is elided in the gutter's pattern-line numbering (it is a
  comment, so it is not a pattern line; nothing to do unless it looks wrong).
- The slug cut-off (12 characters) if it reads badly on a long rip name.
- Test coverage of the double-click rule in `store.test.ts` and of Go's file pointer in `Deck` tests.
