# Method Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A key strip under each deck that turns the computer keyboard into pads: a letter adds or removes a bound Strudel method on the target line and re-evaluates, holding auditions it, digits pick the line, the bottom row mutes named lines, F-keys recall snapshots, and every change lands on the bar.

**Architecture:** Pure modules under `app/src/booth/keys/` decide everything (what a press edits, when it lands, which layer a binding lives in); one `KeyController` per booth owns the window key handlers and drives the decks through three small additions to `DeckApi` (apply edits as one transaction, lock the editor, read code); `KeyStrip.tsx` renders state and takes drops. Persistence is one optional `keys` field on a pattern file and two fields on settings.

**Tech Stack:** Solid, TypeScript, CodeMirror 6 (the copies `@strudel/codemirror` resolves), `@strudel/codemirror` 1.3.0's `StrudelMirror`, vitest + jsdom, Rust/serde for the two schema fields.

**Spec:** `docs/superpowers/specs/2026-10-22-method-keyboard-design.md`

## Global Constraints

- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.
- No new npm or cargo dependencies. CodeMirror imports come from `@codemirror/state` and `@codemirror/view` as `methodDrop.ts` does (a second copy makes `appendConfig` throw).
- A key press never evaluates directly: it edits the document, then calls the deck's existing update path (`evaluate(false)` on `DeckApi`, which keeps the deck playing or stopped as it was). Every evaluation stays under the eval lock.
- Timers: pass `setTimeout`/`clearTimeout` unbound (WebKit), injected for tests as `SyncController` does.
- Pattern files without `keys` must serialise without a `keys` field. Old files load unchanged.
- Space keeps its meaning in both modes; chords with Meta are never consumed by the strip.
- Letters match by `KeyboardEvent.code` (`KeyQ` … `KeyM`); digits by `Digit1`–`Digit9`; snapshots by `F1`–`F8`.
- `HOLD_MS = 250`. Nudge factor 2, rounded to 3 significant digits, floor 0.001.
- Editor font 13px, CodeMirror line numbers off, pattern-line numbers in a custom gutter.
- Suites that must stay green: `pnpm exec vitest run`, `pnpm exec tsc --noEmit -p .`, `cargo test` in `src-tauri`.

## Review Focus

1. A key pressed after the text was edited by hand (argument changed, method moved, line renamed): the press must act on the live code, and removal must still find `.name(…)` with the edited argument. Pinned in Task 4.
2. The target line disappears (deleted, or a snapshot recall with fewer lines): the target re-finds by label, else clamps, never throws. Pinned in Task 3 and Task 7.
3. Two presses of the same key inside one bar window must cancel out to no change and one Update, not an insert followed by an error. Pinned in Task 6.
4. A press while the deck is stopped applies at once, evaluates, and does not start the deck. Pinned in Task 6 and Task 7.
5. Esc while the Save as dialog is open, or a key while a panel search box has focus, must not enter perform mode or fire a pad. Pinned in Task 7.

---

### Task 1: Schema: `keys` on a pattern file, key settings on both sides

**Files:**
- Modify: `src-tauri/src/library.rs:16-33` (Pattern), tests at the bottom of the file
- Modify: `src-tauri/src/settings.rs` (Settings, default_settings, test)
- Modify: `app/src/library/api.ts:21-29`
- Modify: `app/src/settings/settings.ts`, `app/src/settings/settings.test.ts`
- Create: `app/src/booth/keys/bindings.ts` (types only in this task; functions in Task 2)
- Modify: `app/src/booth/deckFile.ts:50-62` (`patternFromDeck`), `app/src/booth/deckFile.test.ts`

**Interfaces:**
- Produces (TS, in `bindings.ts`):
  ```ts
  export type Slot = string; // 'KeyQ' … 'KeyM'
  export type SnapshotKey = 'F1'|'F2'|'F3'|'F4'|'F5'|'F6'|'F7'|'F8';
  export interface MethodPart { name: string; snippet: string; argRange: [number, number] | null }
  export type Binding =
    | ({ kind: 'method' } & MethodPart)
    | { kind: 'macro'; parts: MethodPart[] }
    | { kind: 'line'; label: string };
  export interface Layout { bindings: Partial<Record<Slot, Binding | null>>; snapshots?: Partial<Record<SnapshotKey, string>> }
  export const EMPTY_LAYOUT: Layout = { bindings: {} };
  export type Quantise = 'now' | 'beat' | 'bar';
  ```
- Produces: `Pattern.keys?: Layout` (api.ts); `Settings.keys: Layout` and `Settings.key_quantise: Quantise` (settings.ts); `patternFromDeck(deck: Pick<DeckFields,'name'|'code'|'codeCpm'> & { keys?: Layout | null }, existing?: Pattern): Pattern` writes `keys` only when given a layout with at least one binding or snapshot.
- Rust: `Pattern.keys: Option<serde_json::Value>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`; `Settings.keys: serde_json::Value` (`#[serde(default = "default_keys")]`, `{"bindings":{}}`) and `Settings.key_quantise: String` (`#[serde(default = "default_key_quantise")]`, `"bar"`).

- [ ] **Step 1: Rust tests**

In `library.rs` tests add:
```rust
#[test]
fn keys_round_trip_and_are_absent_when_none() {
  let dir = tempfile::tempdir().unwrap();
  let root = dir.path();
  let p = Pattern { name: "k".into(), code: "c".into(), cpm: 120.0, key: String::new(), tags: vec![], source: Source::Mine, notes: String::new(), keys: None };
  let path = write_pattern(root, "", &p).unwrap();
  let text = fs::read_to_string(root.join(&path)).unwrap();
  assert!(!text.contains("\"keys\""));
  let with = Pattern { keys: Some(serde_json::json!({"bindings": {"KeyQ": {"kind":"method","name":"lpenv","snippet":".lpenv(2)","argRange":[7,8]}}})), ..p.clone() };
  save_pattern(root, &path, &with).unwrap();
  assert_eq!(read_pattern(root, &path).unwrap().keys, with.keys);
}
```
In `settings.rs` test `defaults_use_home_library` add `assert_eq!(s.keys, serde_json::json!({"bindings": {}}));` and `assert_eq!(s.key_quantise, "bar");`, plus a test `old_settings_file_gets_key_defaults` that deserialises the JSON of a settings file lacking both fields and checks the defaults.

- [ ] **Step 2: Run `cargo test` in `src-tauri`** — expected: compile error (no field `keys`).
- [ ] **Step 3: Add the fields** as in Interfaces; fix every `Pattern { … }` literal in tests with `keys: None`. `serde_json` is already a dependency.
- [ ] **Step 4: Run `cargo test` in `src-tauri`** — expected: all pass (42 + 2).
- [ ] **Step 5: TS tests**

`settings.test.ts`: extend the expected default with `keys: { bindings: {} }, key_quantise: 'bar'`.
`deckFile.test.ts`:
```ts
test('patternFromDeck writes keys only when the layout has something', () => {
  const base = { name: 'n', code: 'c', codeCpm: 120 };
  expect(patternFromDeck(base)).not.toHaveProperty('keys');
  expect(patternFromDeck({ ...base, keys: { bindings: {} } })).not.toHaveProperty('keys');
  const keys = { bindings: { KeyQ: { kind: 'method', name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] } } } as const;
  expect(patternFromDeck({ ...base, keys }).keys).toEqual(keys);
  expect(patternFromDeck({ ...base, keys: { bindings: {}, snapshots: { F1: 'x' } } }).keys).toEqual({ bindings: {}, snapshots: { F1: 'x' } });
});
```
- [ ] **Step 6: Run `pnpm exec vitest run app/src/settings app/src/booth/deckFile.test.ts`** — expected: FAIL.
- [ ] **Step 7: Implement** `bindings.ts` types, `api.ts` field, `settings.ts` fields and defaults, `patternFromDeck`.
- [ ] **Step 8: Run the two test files and `pnpm exec tsc --noEmit -p .`** — expected: pass, clean.
- [ ] **Step 9: Commit** `Pattern files and settings carry a key layout`.

---

### Task 2: Layers: effective layout and where a change writes

**Files:**
- Modify: `app/src/booth/keys/bindings.ts`
- Create: `app/src/booth/keys/bindings.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  export const LETTER_ROWS: Slot[][]; // [['KeyQ'…'KeyP'], ['KeyA'…'KeyL'], ['KeyZ'…'KeyM']]
  export const LINE_ROW: Slot[]; // the third row
  export const SLOT_LETTER: Record<Slot, string>; // 'KeyQ' → 'Q'
  export type Owner = 'pattern' | 'global';
  export interface Shown { binding: Binding; owner: Owner | 'derived' }
  /** Global overlaid by pattern (a pattern `null` hides), then derived line keys on free LINE_ROW slots in order. */
  export function effectiveLayout(global: Layout, pattern: Layout, lines: string[]): Partial<Record<Slot, Shown>>;
  /** The layer a drop on `slot` writes to: 'pattern' when the pattern owns the shown slot, else 'global'. */
  export function dropTarget(global: Layout, pattern: Layout, slot: Slot): Owner;
  /** A method dropped on a slot: a bound method/macro there becomes a macro with the part appended. */
  export function withDrop(layout: Layout, slot: Slot, part: MethodPart): Layout;
  export function withCleared(layout: Layout, slot: Slot): Layout;            // removes the slot
  export function withHidden(pattern: Layout, slot: Slot): Layout;            // writes null
  export function withMoved(layout: Layout, from: Slot, to: Slot): Layout;    // moves within one layer
  export function withSnapshot(pattern: Layout, key: SnapshotKey, code: string | null): Layout;
  export function sameLayout(a: Layout | null | undefined, b: Layout | null | undefined): boolean; // structural, treats EMPTY and undefined alike
  export function labelOf(binding: Binding): string; // 'lpenv(2)', 'lpf(300).room(0.8)', '_fills' is NOT here: a line label shows as the code's current label (Task 3 gives it)
  export function nameOf(binding: Binding): string | null; // method name / macro first part / null for line
  ```
  `withDrop` on a slot holding a `line` binding replaces it (lines are derived, so this never happens on a stored layer; keep the branch simple).

- [ ] **Step 1: Tests** (`bindings.test.ts`), with `lpenv = { name:'lpenv', snippet:'.lpenv(2)', argRange:[7,8] }`, `room = { name:'room', snippet:'.room(0.5)', argRange:[6,9] }`:
  - `effectiveLayout`: global Q=lpenv, pattern Q=room → Q shown as room, owner pattern; pattern Q=null → Q absent; lines `['drums','_fills']` with no bindings → Z=`{kind:'line',label:'drums'}` X=`{kind:'line',label:'fills'}` owner derived; a method on Z pushes the first line to X; more lines than free slots: extra lines dropped; `$`-labelled lines are never passed in (Task 3's job) so no test.
  - `dropTarget`: pattern owns → 'pattern'; only global → 'global'; empty → 'global'; pattern null → 'pattern'.
  - `withDrop`: empty → method; onto method → macro of two parts; onto macro → three parts; returns a new object, input untouched.
  - `withMoved`, `withCleared`, `withHidden`, `withSnapshot(null)` removes the key and drops an empty `snapshots` object.
  - `sameLayout(undefined, EMPTY_LAYOUT)` true; differing argRange false.
  - `labelOf` macro → `'lpenv(2).room(0.5)'`; `nameOf` line → null.
- [ ] **Step 2: Run `pnpm exec vitest run app/src/booth/keys/bindings.test.ts`** — expected: FAIL.
- [ ] **Step 3: Implement.** Line labels passed to `effectiveLayout` are already without underscore (Task 3 strips).
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `A key layout is the global one under the pattern's, with the lines derived`.

---

### Task 3: Pattern lines and the target

**Files:**
- Create: `app/src/booth/keys/lines.ts`, `app/src/booth/keys/lines.test.ts`
- Modify: `app/src/booth/methodDrop.ts` (export `scanLine`, `SETUP`, `BARE_LABEL`; no behaviour change)

**Interfaces:**
- Produces:
  ```ts
  export interface PatternLine { n: number; label: string | null; muted: boolean; from: number; to: number; firstLine: number; lastLine: number }
  // n is 1-based; label without a leading underscore, null for `$:` and unlabelled lines; from/to are
  // document offsets of the whole pattern line (a multi-line chain or template literal spans to its last line, `to` excludes the trailing newline).
  export function patternLines(code: string): PatternLine[];
  /** Labels for the derived line keys: labelled lines in document order, `$:` excluded. */
  export function lineLabels(lines: PatternLine[]): string[];
  /** After the code changed: the same label if still there, else the same n clamped to 1..length, else null when there are none. */
  export function refindTarget(prev: { n: number; label: string | null } | null, lines: PatternLine[]): PatternLine | null;
  /** The pattern line containing document offset `pos`, or null. */
  export function lineAt(lines: PatternLine[], pos: number): PatternLine | null;
  ```
- Rules: a pattern line starts at a line whose code (comment stripped) is non-blank, not `SETUP`; a bare label (`BARE_LABEL`) starts one whose body is the following lines; a line is part of the previous pattern line when the previous one is still open (inside a template literal, or its code ends with `.`, an operator, a comma, or an open bracket, or this line's code starts with `.`). `muted` is a label beginning with `_`.

- [ ] **Step 1: Tests**, including the Solomun golden (`service/tests/golden/solomun.strudel` read with `fs.readFileSync`): expect labels `['drums','hats','fills','bass','bass2']` with `muted` `[false,false,true,false,true]`, and n 1..5 (the `setcpm` and comment lines are not pattern lines). Also: `$: s("bd")` → label null; a bare label `bass:` with its body on the next two chained lines → one pattern line spanning three lines; a `.lpf(800)` continuation line belongs to the line above; a template literal across lines; `refindTarget({n:2,label:'hats'}, …)` after `hats` is renamed → n 2; after deletion leaving one line → n 1; empty code → null; `lineAt` on the `setcpm` line → null.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement**, reusing the exported scanners from `methodDrop.ts`.
- [ ] **Step 4: Run `lines.test.ts` and `methodDrop.test.ts`; expected PASS.**
- [ ] **Step 5: Commit** `The pattern lines of a deck, numbered, with their labels and mute state`.

---

### Task 4: What a press edits

**Files:**
- Create: `app/src/booth/keys/press.ts`, `app/src/booth/keys/press.test.ts`
- Modify: `app/src/booth/methodDrop.ts` (export `insertAtLineEnd`'s helper `landing` as `landingOffset(code, lineIndex)`; no behaviour change)

**Interfaces:**
- Consumes: `PatternLine` (Task 3), `Binding`, `nameOf` (Task 2), `landingOffset`.
- Produces:
  ```ts
  export interface Edit { from: number; to: number; insert: string }
  export type Outcome = { ok: true; edits: Edit[]; on: boolean } | { ok: false; reason: string };
  export const REFUSED_LINE = 'this line cannot take a method';
  export const REFUSED_ARG = 'nothing to nudge';
  /** Whether the binding is present on the line: `.name(` outside strings/comments for a method; for a macro each part's `.name(` in order. */
  export function isOn(code: string, line: PatternLine, binding: Binding): boolean; // a line binding: true when NOT muted
  /** Toggle: insert at the landing point of the line's last physical line when off; remove the last `.name(…)` (balanced) when on. `on` is the state after the edit. */
  export function toggle(code: string, line: PatternLine, binding: Binding): Outcome;
  /** The edit that undoes `toggle`'s result on the then-current code: just `toggle` again, re-derived. (No separate function; documented.) */
  export function nudge(code: string, line: PatternLine, binding: Binding, dir: 'up' | 'down'): Outcome; // factor 2, 3 sig figs, floor 0.001
  export function flipMute(code: string, line: PatternLine): Outcome; // label `_x:` ↔ `x:`; on = now playing
  export function applyEdits(code: string, edits: Edit[]): string; // edits applied from the end, non-overlapping
  ```

- [ ] **Step 1: Tests** on the Solomun golden plus small cases:
  - `toggle` off→on on `bass`: the code gains `.lpenv(2)` right after `.lpf(800)` (end of line, before any comment), `on: true`.
  - on→off: removing from `…lpf(800).lpenv(2)` gives the original; with a hand-edited argument `.lpenv(0.75, 3)` removal still works (review focus 1); nested parens `.lpenv(sine.range(1,4))` removed whole.
  - `.lpenv(` inside a string on the line does not count as present.
  - A line ending in `=>` or an open bracket → `{ok:false, reason: REFUSED_LINE}`.
  - Macro `[lpf(300), room(0.8)]`: insert writes `.lpf(300).room(0.8)`; `isOn` false when only `.lpf(` present; remove deletes both calls.
  - A multi-line pattern line (bare label with body below): insertion lands on the last physical line.
  - `nudge` up on `.lpenv(2)` → `.lpenv(4)`; down on `.lpf(800)` → `.lpf(400)`; down from `0.001` stays `0.001`; `0.3` up → `0.6`; `1/3`-like non-literal argument → `REFUSED_ARG`; not present → `REFUSED_ARG`.
  - `flipMute` on `_fills` → `fills:` with `on: true`; on `drums` → `_drums:`, `on: false`; `$:` line → `{ok:false}`.
  - `applyEdits` with two edits in one call.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement.** Presence and removal scan the line's text with the same string/comment tracking as `scanLine`; removal of a macro removes parts from last to first.
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `A key press toggles, nudges or mutes on the target line, as pure edits`.

---

### Task 5: Tap or hold

**Files:**
- Create: `app/src/booth/keys/hold.ts`, `app/src/booth/keys/hold.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HOLD_MS = 250;
  export type PressEvent = { type: 'press'; slot: string } | { type: 'release'; slot: string; held: boolean };
  /** Tracks keydown/keyup per slot with an injected clock; ignores repeats and a keyup with no keydown. */
  export class PressTracker {
    constructor(now: () => number, holdMs?: number);
    down(slot: string): PressEvent | null;   // null on repeat
    up(slot: string): PressEvent | null;     // held = now - downAt >= holdMs
    cancelAll(): string[];                   // slots that were down (window blur); caller treats each as a release with held=true
  }
  ```
- [ ] **Step 1: Tests**: down → `{press}`; down again → null; up at +100 → `{release, held:false}`; up at +250 → held true; up without down → null; `cancelAll` returns the down slots and clears them.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** `A tap and a hold are told apart by the clock`.

---

### Task 6: The queue: changes land on the bar

**Files:**
- Create: `app/src/booth/keys/quantise.ts`, `app/src/booth/keys/quantise.test.ts`
- Modify: `app/src/engine/sync.ts` (export `startDelay`'s clock-lead helper if private; otherwise nothing)

**Interfaces:**
- Consumes: `secondsToNextBoundary(nowCycle, cps)` from `sync.ts`; `Quantise` (Task 1).
- Produces:
  ```ts
  export interface QueueDeck { scheduler: { started: boolean; cps: number; now(): number; clock?: { duration?: number; minLatency?: number } } }
  export type Job = () => void; // re-derives its edit from the live code when run (Task 7 builds these)
  export interface QueueOptions { setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; quantise: () => Quantise }
  export class KeyQueue {
    constructor(deck: () => QueueDeck | null, onFlush: (jobs: Job[]) => void, opts: QueueOptions);
    /** Adds a job; arms the timer if none. A stopped deck or 'now' flushes synchronously. */
    push(job: Job): void;
    /** Seconds until the armed boundary from `now`; null when idle. */
    secondsLeft(): number | null;
    /** Beats until the boundary, ceil; null when idle. */
    beatsLeft(): number | null;
    drop(): void;      // Stop pressed: discard
    flushNow(): void;  // Play pressed: run what is queued at once
    get pending(): number;
  }
  /** Seconds to the next boundary for a quantise mode, less the clock lead (duration + minLatency, defaults as sync's). */
  export function waitSeconds(deck: QueueDeck, q: Quantise): number; // 'beat' = quarter cycle; never negative
  ```
  `onFlush` receives all jobs in push order; the controller (Task 7) runs them against the live code, applies one transaction and one update.

- [ ] **Step 1: Tests** with `vi.useFakeTimers()` and a fake deck like `sync.test.ts`'s (`now` in cycles, `cps` 0.5, clock lead 0):
  - `waitSeconds` at now=0.25, cps 0.5: bar → 1.5 s; beat → 0.5 s; now → 0; at a boundary bar → 2 s (as `secondsToNextBoundary`); lead 0.06 subtracts.
  - push on a started deck arms once; two pushes → one flush with two jobs after the wait (review focus 3 is the controller's; here: both jobs delivered in order).
  - stopped deck: flush synchronously inside `push` (review focus 4).
  - `drop()` → timer cleared, no flush; `flushNow()` → flush immediately, timer cleared.
  - `beatsLeft()` at 1.5 s to go, cps 0.5 → 3; null when idle.
  - quantise read at push time: `quantise: () => 'now'` flushes synchronously.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement.** **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** `Key presses queue and land on the deck's next bar`.

---

### Task 7: The controller and the deck hooks

**Files:**
- Create: `app/src/booth/keys/KeyController.ts`, `app/src/booth/keys/KeyController.test.ts`
- Modify: `app/src/booth/Deck.tsx` (DeckApi additions, read-only compartment, `'input.key'` user event), `app/src/booth/deckState.ts` (fields), `app/src/booth/boothState.ts` (`perform`), `app/src/booth/Booth.tsx` (install), `app/src/booth/spaceToggle.ts` (none; Space stays)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces on `DeckApi`:
  ```ts
  applyEdits(edits: Edit[], userEvent?: string): void; // one CodeMirror transaction, userEvent default 'input.key'
  setLocked(on: boolean): void;        // readOnly + editable:false via a Compartment; blur when locking
  focusLine(n: number): void;          // puts the cursor at a 1-based document line and focuses
  ```
  On `DeckFields`: `keys: Layout` (the pattern layer, in memory), `savedKeys: Layout | null`, `targetLine: number | null` (a pattern-line n), `queued: number`, `beatsLeft: number | null`; setters `setKeys`, `setTargetLine`, `setQueue(queued, beatsLeft)`. `setFile(filePath, savedCode, pattern)` also sets `keys` to `pattern?.keys ?? EMPTY_LAYOUT` and `savedKeys` to the same; `isDirty` memo becomes `isDirty(code…) || !sameLayout(keys, savedKeys)`; `patternFromDeck` is called with `keys`.
  On `BoothState`: `perform: boolean`, `setPerform`.
  ```ts
  export interface ControllerDeps {
    decks: () => Record<DeckId, DeckApi | null>;
    deckState: Record<DeckId, DeckState>;
    performing: () => DeckId;             // library.state.target
    setPerforming: (id: DeckId) => void;  // library.setTarget
    booth: BoothState;                    // perform flag
    global: () => Layout;                 // settings().keys
    setGlobal: (l: Layout) => Promise<void>;
    quantise: () => Quantise;
    boothShowing: () => boolean;
    now?: () => number; setTimer?; clearTimer?;
  }
  export class KeyController {
    constructor(deps: ControllerDeps);
    install(target: Window): () => void;   // keydown/keyup/blur listeners; returns uninstall
    // for the strip (mouse) and tests:
    press(id: DeckId, slot: Slot): void; release(id: DeckId, slot: Slot): void;
    nudge(id: DeckId, slot: Slot, dir: 'up'|'down'): void;
    selectLine(id: DeckId, n: number): void;
    snapshot(id: DeckId, key: SnapshotKey, save: boolean): void;
    togglePerform(): void;
    drop(id: DeckId, slot: Slot, part: MethodPart): void;      // writes per dropTarget
    menu(id: DeckId, slot: Slot, action: 'clear'|'hide'|'keep'|'global'): void;
    move(id: DeckId, from: Slot, to: Slot): void;
    shown(id: DeckId): Partial<Record<Slot, Shown & { on: boolean; held: boolean; pending: boolean; refused: boolean }>>;
    lines(id: DeckId): PatternLine[];
  }
  ```
- Behaviour pinned here:
  - `press`: a job that, when flushed, re-derives (`patternLines(getCode())`, `refindTarget`) and runs `toggle` / `flipMute`; refusals go to `deck.setError(reason)`; after the flush one `applyEdits` with all ok edits then `evaluate(false)`. `release` with `held` pushes the inverse job (another `toggle`), and if the press has not flushed yet the inverse is pushed anyway so the hold lasts one quantum (spec part 3).
  - Key handling (`keydown`): ignore when `!boothShowing()`, when `e.metaKey`, when target is `input|textarea|select` or inside `.save-dialog`; `Escape` toggles perform (not when a `.save-backdrop` exists); in perform mode: letters → press, digits → selectLine, `Tab` → other deck, `F1–F8` → snapshot (Shift saves), Shift+letter → nudge up, Ctrl+letter → nudge down; `Space` untouched (falls through to the existing handler). F-keys also work outside perform mode. Consumed keys `preventDefault()`. `keyup` → release. `blur` → `cancelAll` → releases.
  - Perform on: both decks `setLocked(true)`; the performing deck's target = `lineAt(cursor)` if any, else line 1. Perform off: `setLocked(false)` and `focusLine` on the performing deck's target.
  - Snapshot recall: a job replacing the whole document (`{from:0,to:len,insert}`), queued like a press; save: `withSnapshot` into `keys`.
  - `deck.onToggle(false)` → queue.drop(); `onToggle(true)` → queue.flushNow(). After every `afterEval` and every code change (`onUpdateState`), `targetLine` is re-found and `shown` recomputed (a memo over `deckState.code`/editor code; the controller exposes a `version` signal bumped on changes, or reads the deck's `editorCode` signal: builder's choice, documented in code).
  - The countdown: a 100 ms interval while any queue is pending updates `setQueue(pending, beatsLeft)`.

- [ ] **Step 1: Tests** with fake decks (extend `sync.test.ts`'s `fakeDeck` into a shared `app/src/test/fakeDeck.ts` with the new methods and an in-memory `code` that `applyEdits` mutates), fake timers, and a minimal `deps`:
  - Q bound globally to lpenv, perform on, deck A stopped: `press('A','KeyQ')` → code gains `.lpenv(2)` on target line 1, `evaluate` called once with `false`, `shown('A').KeyQ.on` true; press again → removed.
  - started deck at now 0.25 cps 0.5: press then press within the window → after 1.5 s one `applyEdits` with no net change… assert code unchanged and `evaluate` called once (review focus 3).
  - hold: down, up at +300 ms before the flush → after flush code has it; after the next boundary it is gone; `evaluate` twice.
  - digits: `selectLine('A', 9)` with 5 lines → target unchanged, no throw; snapshot recall with fewer lines → `targetLine` clamped (review focus 2).
  - keydown `KeyQ` while `perform` false → nothing; `Escape` with a `.save-backdrop` element in the DOM → `perform` stays false; keydown with target an `<input>` → nothing (review focus 5); `metaKey` → not consumed.
  - `Tab` in perform → `setPerforming('B')`; `togglePerform` → `setLocked(true)` on both, then false on both and `focusLine` on the performing deck.
  - `drop` on a slot the pattern owns writes `deckState.keys`; on an unowned slot calls `setGlobal`; `menu('hide')` writes null into the pattern layer; `menu('clear')` on a global key calls `setGlobal` without it.
  - `onToggle(false)` drops a pending queue: no `applyEdits`.
- [ ] **Step 2: Run; FAIL.**
- [ ] **Step 3: Implement** `KeyController.ts`, the `DeckApi` additions in `Deck.tsx` (compartment appended at mount beside `methodDropExtension`; `applyEdits` dispatches `{changes, userEvent}`; the existing `updateListener` treats `input.key` like `input.drop` for clearing refusals), the state fields, and install in `Booth.tsx` (`new KeyController({...}).install(window)` in `onMount`, uninstall in `onCleanup`; `settings().keys` and `updateSettings` for the global layer).
- [ ] **Step 4: Run `KeyController.test.ts`, then the whole suite and `tsc`; expected PASS, clean.**
- [ ] **Step 5: Commit** `The key controller: pads on the performing deck, perform mode, snapshots`.

---

### Task 8: The strip

**Files:**
- Create: `app/src/booth/keys/KeyStrip.tsx`, `app/src/booth/keys/keyStrip.css`, `app/src/booth/keys/KeyStrip.test.tsx`
- Modify: `app/src/booth/MethodPanel.tsx` (export the tooltip as `MethodTip(props:{method: MethodDoc; x:number; y:number})` and `findMethod(name): MethodDoc | undefined` from `app/src/methods/catalogue.ts`), `app/src/library/ContextMenu.tsx` (reuse as is)

**Interfaces:**
- Consumes: `KeyController` (Task 7), `LETTER_ROWS`, `SLOT_LETTER`, `labelOf`, `METHOD_MIME`/`MethodDrag`.
- Produces: `KeyStrip(props: { deck: DeckId; controller: KeyController; state: DeckState; perform: () => boolean; performing: () => boolean; quantise: () => Quantise; setQuantise: (q: Quantise) => void })`.
- DOM contract (tests and CSS rely on it): root `.key-strip[data-deck]`, `.key-strip.folded`, `.key-strip.dimmed` (perform on, other deck); rows `.key-row` ×5 (digits+F row, Q, A, Z, hint); keys `.key[data-slot]` with classes `bound|on|held|pending|refused|line|muted|derived|drop`; `.key-letter`, `.key-label`; digits `.key.num[data-n]` with `.on` for the target; F keys `.key.fn[data-key]` with `.filled`; hint row `.key-hint` with `.key-quantise` (three buttons `[data-q]`, `.on`) and `.key-perform` button (`aria-pressed`), `.key-fold` disclosure.
- Behaviour: `pointerdown` on a key → `controller.press`, `pointerup`/`pointerleave` → `release`; Shift+click → nudge up, Ctrl+click → nudge down; click a digit → `selectLine`; click F → recall, Shift+click → save; `dragover` with `METHOD_MIME` → `.drop` and `dropEffect='copy'`; `drop` → parse `MethodDrag`; `kind !== 'method'` → `state.setError('functions go in the editor, not on a key')`; else `controller.drop`. Dragging a key (`draggable`, own MIME `application/x-algobooth-key` carrying the slot) onto another → `controller.move`. `contextmenu` on a bound key → `ContextMenu` with items per owner: pattern-owned: `clear`, `make global`; global-owned: `clear`, `hide for this pattern`, `keep with this pattern`; derived line: no menu. Hover 400 ms (`PREVIEW_DELAY_MS`) on a method key → `MethodTip` for `findMethod(nameOf(binding))`. Folding: a signal per strip; forced open while `perform()`.

- [ ] **Step 1: Tests** (render with a `KeyController` over fake decks as in Task 7, or a stub implementing the methods the strip calls):
  - renders 26 letter keys, 9 digits, 8 F keys; a bound Q shows `.key-label` `lpenv(2)`; derived Z shows `_fills` with `.line.muted`.
  - pointerdown/up on Q calls `press` then `release`; Shift+click calls `nudge(…,'up')`.
  - a `drop` event with a function payload sets the deck error text; with a method payload calls `controller.drop` with the part.
  - contextmenu on a global key lists `clear`, `hide for this pattern`, `keep with this pattern`.
  - `perform()` true → `.folded` never applied; `performing()` false while perform → `.dimmed`.
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement** strip and CSS (palette from `deck.css`/`methodPanel.css`: on `#e94f37`, held outline `#61afef`, target `#ffb86c`, pending a 1 s pulse of the outline). **Step 4: Run; PASS.**
- [ ] **Step 5: Commit** `The key strip under a deck`.

---

### Task 9: Deck integration, gutter, header, density, settings

**Files:**
- Modify: `app/src/booth/Deck.tsx` (mount strip, gutter, header countdown and badge, font, line numbers), `app/src/booth/deck.css`, `app/src/booth/booth.css`, `app/src/settings/SettingsTab.tsx`, `app/src/settings/settings.css`
- Create: `app/src/booth/keys/lineGutter.ts` (+ `lineGutter.test.ts`)

**Interfaces:**
- Produces: `lineGutterExtension(lines: () => PatternLine[], target: () => number | null): Extension` — a `gutter` from `@codemirror/view` whose marker on a pattern line's first physical line shows `n`, class `cm-pattern-n`, plus `on` for the target; other lines get no marker. Also `patternLineDecoration(target)` giving the target's physical lines the class `cm-target-line` (a `ViewPlugin` with line decorations).
- `Deck` props gain `controller: KeyController`, `perform: () => boolean`, `performing: () => boolean`, `quantise`, `setQuantise`. `Booth.tsx` passes them.

- [ ] **Step 1: Tests** (`lineGutter.test.ts`: build an `EditorState` with the extension in jsdom via a real `EditorView`, assert gutter elements' text `['1','2',…]` and that the target has `.on`; assert the `setcpm` line has no marker) and a `Deck`-level check in an existing test file if one mounts a deck (if none does, the gutter test suffices; note it in the commit).
- [ ] **Step 2: Run; FAIL.** **Step 3: Implement:**
  - `Deck.tsx`: after constructing the mirror, `mirror.setFontSize(13)` and `mirror.reconfigureExtension('isLineNumbersDisplayed', false)` (both exist on `StrudelMirror`); append `lineGutterExtension` and the decoration; render `<KeyStrip …/>` between `.deck-editor` and `.deck-error`; header: `<Show when={deck.state.queued > 0}>` `next {quantise} in {beatsLeft}` and `<span class="deck-perform">perform</span>` when performing; `.deck.performing` border accent.
  - CSS: `.booth-decks { align-items: stretch }`, `.deck { padding: 8px; gap: 6px }`, `.deck-editor { flex: 1; min-height: 120px }` and `.cm-editor { height: 100% }`, `.cm-pattern-n`, `.cm-target-line { background: rgba(233,79,55,.12); box-shadow: inset 2px 0 #e94f37 }`.
  - Settings tab: a `Keys` fieldset: quantise radios (`now`, `beat`, `bar`) saving `key_quantise`; a `Reset key layout` button saving `keys: EMPTY_LAYOUT` after `window.confirm`; hint text: "On a Mac, F1–F8 reach the app only with “Use F1, F2, etc. keys as standard function keys” on in System Settings → Keyboard, or with Fn held."
- [ ] **Step 4: Run the whole suite, `tsc`, and `cargo test`; expected PASS, clean.**
- [ ] **Step 5: Run the app** (`pnpm tauri dev` in the background or via the project's launch config) and check by hand: font is 13px, the gutter numbers pattern lines, Esc locks the editor and lights the badge, dragging `lpenv` from the panel onto Q and pressing Q adds it on the bar and the deck keeps playing, holding reverts, Z mutes `_fills` on the Solomun rip, F1 with Shift then F1 recalls. Fix what is off.
- [ ] **Step 6: Commit** `Decks mount the key strip, number their pattern lines, and sit tighter`.

---

### Task 10: Documentation and hand-over

**Files:**
- Modify: `README.md` (a short "Playing with the keys" section: the table from spec part 5 and the macOS F-key note), `docs/handover-2026-10-21.md` ("Where things live": `app/src/booth/keys/`; one paragraph under "State of the work" naming the spec).

- [ ] **Step 1: Write the two sections.**
- [ ] **Step 2: `pnpm exec vitest run`, `pnpm exec tsc --noEmit -p .`, `cargo test` once more; record the counts in the commit message.**
- [ ] **Step 3: Commit** `Document the method keyboard`.
