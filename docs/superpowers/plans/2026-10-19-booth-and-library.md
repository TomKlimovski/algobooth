# Booth and Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri desktop app with two Strudel decks, a crossfader with sync and knobs, and a library sidebar backed by a folder of JSON pattern files, all working offline.

**Architecture:** A Solid web UI runs inside a Tauri 2 shell. Each deck owns a `StrudelMirror` editor and REPL; both share one superdough audio engine, and a custom `SuperdoughAudioController` subclass inserts a per-deck knob and fader chain by routing each deck to its own orbit. The Rust shell owns the library folder: tree listing, JSON read and write, and a file watcher that emits change events to the UI.

**Tech Stack:** Tauri 2.12, Rust (stable), Solid 1.9 with TypeScript, Vite 8, vitest 5, `@strudel/core` `mini` `transpiler` `tonal` `draw` 1.2.6, `@strudel/webaudio` `codemirror` 1.3.0, `superdough` 1.3.0, `notify` crate for watching, `serde_json`.

**Spec:** `docs/superpowers/specs/2026-10-19-algobooth-design.md`. This plan covers milestones 1, 2 and 3 and the settings pieces they need. The rip pipeline (milestones 4 and 5) and packaging (milestone 6) are separate plans.

## Global Constraints

- Pin exact versions in `package.json` (no caret): `@strudel/core@1.2.6`, `@strudel/mini@1.2.6`, `@strudel/transpiler@1.2.6`, `@strudel/tonal@1.2.6`, `@strudel/draw@1.2.6`, `@strudel/webaudio@1.3.0`, `@strudel/codemirror@1.3.0`, `superdough@1.3.0`.
- Node 20, pnpm. Rust stable via rustup. Target macOS arm64 only.
- Licence AGPL-3.0. The product name is "Algobooth"; the word "strudel" never appears in the app name, bundle identifier, or window title.
- The booth must work with no network from first launch: synths and bundled drum machine banks load from the app's own assets, never from `strudel.b-cdn.net`.
- Library default location is `~/Algobooth/library`. Headings are folders, leaves are one JSON file each, with the leaf schema in the spec.
- Two decks must play at once. Every `StrudelMirror` is created with `solo: false`.
- Deck A always plays on orbit 1 and deck B on orbit 2, forced by the deck regardless of pattern code.
- Commit after every task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A pattern with a syntax error evaluated on one deck must show the error on that deck and leave the other deck playing. Pinned in Task 3.
2. A library file that is not valid JSON, or lacks `code`, must show as an unreadable leaf and never crash the tree. Pinned in Task 8.
3. A pattern named with `/`, `:` or leading dots must get a safe filename while the JSON keeps the real name. Pinned in Task 8.
4. Pressing Sync while deck A is stopped must do nothing except show a short message. Pinned in Task 6.
5. A missing library folder at startup must be created, and an unwritable one must surface in Settings rather than fail silently. Pinned in Task 8.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `app/index.html`, `app/src/index.tsx`, `app/src/App.tsx`, `src-tauri/` (via `tauri init`), `app/src/version.ts`, `app/src/version.test.ts`
- Modify: `.gitignore` (already lists `src-tauri/target/`, `node_modules/`, `dist/`)

**Interfaces:**
- Produces: `pnpm dev` (Vite only), `pnpm tauri dev` (full app), `pnpm test` (vitest). Vite `root` is `app/`, `publicDir` is `app/public`, build output `app/dist`.

- [ ] **Step 1: Install the Rust toolchain**

Run: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal` then `source ~/.cargo/env && cargo --version`
Expected: a `cargo 1.x` version line.

- [ ] **Step 2: Create the Vite + Solid project at the repo root with `root: 'app'`**

Run `pnpm init`, add `solid-js@1.9.17`, `vite@8.3.4`, `vite-plugin-solid@2.11.14`, `vitest@5.0.5`, `typescript`, `@tauri-apps/cli@2.12.3`, `@tauri-apps/api@2.12.4`. `vite.config.ts` sets `root: 'app'`, `publicDir: 'public'`, `build.outDir: 'dist'`, `server.port: 1420`, `server.strictPort: true`. `vitest.config.ts` sets `environment: 'jsdom'` and `include: ['app/src/**/*.test.ts', 'app/src/**/*.test.tsx']`.

- [ ] **Step 3: Write the failing smoke test**

`app/src/version.test.ts`:
```ts
import { APP_NAME } from './version';
test('app name never contains strudel', () => {
  expect(APP_NAME).toBe('Algobooth');
  expect(APP_NAME.toLowerCase()).not.toContain('strudel');
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test`
Expected: FAIL, cannot find module './version'.

- [ ] **Step 5: Create `app/src/version.ts` exporting `export const APP_NAME = 'Algobooth'`, and `App.tsx` rendering `<h1>{APP_NAME}</h1>`**

- [ ] **Step 6: Run the tests and verify they pass**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 7: Initialise Tauri**

Run: `pnpm tauri init --app-name Algobooth --window-title Algobooth --frontend-dist ../app/dist --dev-url http://localhost:1420 --before-dev-command "pnpm dev" --before-build-command "pnpm build"`. Set `identifier` in `src-tauri/tauri.conf.json` to `io.klimovski.algobooth`. Set `app.windows[0]` to `width: 1400, height: 900, minWidth: 1100, minHeight: 700`.

- [ ] **Step 8: Verify the app opens**

Run: `pnpm tauri dev`
Expected: a window titled "Algobooth" showing the heading. Close it.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Scaffold Tauri, Solid and vitest project"
```

---

### Task 2: Strudel engine bootstrap and bundled samples

**Files:**
- Create: `app/src/engine/strudel.ts`, `app/src/engine/banks.ts`, `app/src/engine/banks.test.ts`, `scripts/fetch-samples.mjs`
- Modify: `.gitignore` (add `app/public/samples/`), `package.json` (add `fetch-samples` script and the pinned Strudel packages)

**Interfaces:**
- Produces: `initEngine(): Promise<void>` in `strudel.ts`. Idempotent. Calls `initAudio()`, `evalScope(...)` over `@strudel/core`, `@strudel/mini`, `@strudel/tonal`, `@strudel/webaudio`, `@strudel/draw`, then `registerSynthSounds()`, then loads the bundled banks and the alias file. Must be awaited before any deck evaluates; decks pass it as the `prebake` option.
- Produces: `BUNDLED_MACHINES: readonly string[]` and `filterManifest(manifest: Record<string, unknown>, machines: readonly string[]): Record<string, unknown>` in `banks.ts`.

- [ ] **Step 1: Write the failing manifest test**

`app/src/engine/banks.test.ts`:
```ts
import { BUNDLED_MACHINES, filterManifest } from './banks';
test('bundled set includes the machines the rip rules name', () => {
  expect(BUNDLED_MACHINES).toEqual(expect.arrayContaining(['RolandTR909', 'RolandTR808', 'RolandTR707', 'RolandTR606', 'LinnDrum', 'AkaiMPC60']));
});
test('filterManifest keeps _base and only entries for bundled machines', () => {
  const m = { _base: 'x/', RolandTR909_bd: ['a.wav'], CasioSK1_bd: ['b.wav'] };
  expect(filterManifest(m, ['RolandTR909'])).toEqual({ _base: 'x/', RolandTR909_bd: ['a.wav'] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test banks`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `banks.ts`**

`BUNDLED_MACHINES` is exactly `['RolandTR909','RolandTR808','RolandTR707','RolandTR606','RolandTR505','LinnDrum','AkaiMPC60','EmuSP12','BossDR110']`. `filterManifest` keeps `_base` and every key whose prefix before the first `_` is in `machines`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test banks`
Expected: 2 passed.

- [ ] **Step 5: Write `scripts/fetch-samples.mjs`**

Node script. Downloads `https://strudel.b-cdn.net/tidal-drum-machines.json` and `https://strudel.b-cdn.net/tidal-drum-machines-alias.json`, applies `filterManifest` (import it from `app/src/engine/banks.ts` via a small TS-free copy or by running with `tsx`; the implementer picks), writes the filtered manifest to `app/public/samples/tidal-drum-machines.json` with `_base` set to `./tidal-drum-machines/`, downloads every listed file under `app/public/samples/tidal-drum-machines/<path>` from `https://strudel.b-cdn.net/tidal-drum-machines/machines/<path>`, skipping files that already exist, and writes the alias JSON unchanged to `app/public/samples/tidal-drum-machines-alias.json`. Prints a file count and total bytes at the end.

- [ ] **Step 6: Run it and record the size**

Run: `pnpm fetch-samples`
Expected: ends with a line like `N files, M MB`. Note M in the task's commit message. If M exceeds 150 MB, drop `EmuSP12` and `BossDR110` from `BUNDLED_MACHINES`, update the test, and rerun.

- [ ] **Step 7: Implement `initEngine()` in `app/src/engine/strudel.ts`**

Load the manifest with `samples(new URL('/samples/tidal-drum-machines.json', location.href).href, new URL('/samples/tidal-drum-machines/', location.href).href, { prebake: true, tag: 'drum-machines' })`, then `aliasBank(new URL('/samples/tidal-drum-machines-alias.json', location.href).href)`. Guard with a module-level promise so repeated calls return the same promise.

- [ ] **Step 8: Verify offline loading in the dev app**

Temporarily call `initEngine()` from `App.tsx` on a button click, run `pnpm tauri dev` with Wi-Fi off, click, and check the webview console (right-click, Inspect) shows no failed network requests and no errors. Remove the temporary button afterwards.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Bootstrap Strudel engine with bundled drum machine banks"
```

---

### Task 3: One deck plays

**Files:**
- Create: `app/src/booth/Deck.tsx`, `app/src/booth/deckState.ts`, `app/src/booth/deckState.test.ts`, `app/src/booth/deck.css`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Produces: `DeckId = 'A' | 'B'`; `ORBIT: Record<DeckId, number> = { A: 1, B: 2 }`.
- Produces: `createDeckState(id: DeckId)` returning a Solid store `{ id, name: string, code: string, playing: boolean, error: string | null, cpm: number }` plus setters `setCode`, `setPlaying`, `setError`, `setCpm`, `setName`.
- Produces: `<Deck state={DeckState} onReady={(api: DeckApi) => void} />` where `DeckApi = { id: DeckId; evaluate(): Promise<void>; stop(): void; setCode(code: string): void; getCode(): string; setName(name: string): void; setFile(filePath: string | null, savedCode: string | null): void; scheduler: { cps: number; now(): number; started: boolean; start(): Promise<void>; stop(): void }; setCps(cps: number): void; afterEval: Set<() => void> }`. `scheduler` and `setCps` come straight from the mirror's `repl`; `setName` and `setFile` write the deck state (`setFile`'s fields are added to the state in Task 11; until then it is a no-op).
- Consumes: `initEngine` from Task 2.

- [ ] **Step 1: Write the failing state test**

`deckState.test.ts`:
```ts
import { createDeckState } from './deckState';
test('eval error is stored per deck and cleared on next successful eval', () => {
  const d = createDeckState('A');
  d.setError('SyntaxError: x');
  expect(d.state.error).toBe('SyntaxError: x');
  d.setError(null);
  expect(d.state.error).toBeNull();
});
test('cpm defaults to 120 and orbit is fixed per deck', () => {
  expect(createDeckState('B').state.cpm).toBe(120);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test deckState`
Expected: FAIL.

- [ ] **Step 3: Implement `deckState.ts` with `createStore` from `solid-js/store`**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test deckState`
Expected: 2 passed.

- [ ] **Step 5: Implement `Deck.tsx`**

On mount, construct `new StrudelMirror({ root, id: 'deck-' + id, initialCode, prebake: initEngine, solo: false, drawContext: canvas.getContext('2d'), drawTime: [-2, 2], editPattern: (pat) => pat.orbit(ORBIT[id]).pianoroll({ fold: 1 }), onToggle: (started) => setPlaying(started), onEvalError: (e) => setError(String(e)), afterEval: ({ code }) => { setError(null); setCpm(mirror.repl.scheduler.cps * 60); afterEval.forEach(f => f()); }, onUpdateState: () => {} })`. Layout per spec: header (name, cpm), canvas visualiser, editor, play / stop / update buttons, and an error line under the editor. `onReady` receives the `DeckApi`. Default `initialCode` for deck A is `setcpm(120/4)\n$: s("bd*4, [~ cp]*2, hh*8").bank("tr909")` and for deck B `setcpm(120/4)\n$: note("c2(5,8)").s("sawtooth").lpf(sine.range(200,3000).slow(8))`.

- [ ] **Step 6: Render a single Deck A in `App.tsx` and verify it plays offline**

Run: `pnpm tauri dev` with Wi-Fi off. Click Play.
Expected: a 909 beat plays, the pianoroll animates, the header shows `120 cpm`. Click Stop: silence.

- [ ] **Step 7: Pin review focus 1 (syntax error isolation)**

Add to `deckState.test.ts`:
```ts
test('an error on one deck does not touch the other', () => {
  const a = createDeckState('A'); const b = createDeckState('B');
  a.setError('boom');
  expect(b.state.error).toBeNull();
});
```
Then in the running app, type `s("bd` (unclosed) in the editor and press Update. Expected: red error text under the editor, no uncaught exception in the console.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Add Deck component with Strudel editor and pianoroll"
```

---

### Task 4: Mixer: per-deck fader, knobs, and crossfade curve

**Files:**
- Create: `app/src/engine/mixer.ts`, `app/src/engine/crossfade.ts`, `app/src/engine/crossfade.test.ts`

**Interfaces:**
- Produces: `crossfadeGains(x: number): [a: number, b: number]` for `x` in `[0, 1]`, 0 is full A.
- Produces: `class DeckMixer extends SuperdoughAudioController` with `setFader(x: number)`, `setKnob(deck: DeckId, knob: 'lpf' | 'gain' | 'reverb', value: number)` (all values in `[0, 1]`), and `installMixer(): DeckMixer` which constructs it with `getAudioContext()` and calls `setSuperdoughAudioController`. Must be called once after `initEngine()` resolves and before any deck starts.
- Consumes: `ORBIT` from Task 3.

- [ ] **Step 1: Write the failing crossfade tests**

```ts
import { crossfadeGains } from './crossfade';
test('centre plateau keeps both decks at full gain', () => {
  expect(crossfadeGains(0.5)).toEqual([1, 1]);
  expect(crossfadeGains(0.4)).toEqual([1, 1]);
  expect(crossfadeGains(0.6)).toEqual([1, 1]);
});
test('ends are exclusive', () => {
  expect(crossfadeGains(0)).toEqual([1, 0]);
  expect(crossfadeGains(1)).toEqual([0, 1]);
});
test('taper is equal power outside the plateau', () => {
  const [a, b] = crossfadeGains(0.8);
  expect(a).toBeCloseTo(Math.cos((0.8 - 0.6) / 0.4 * Math.PI / 2), 5);
  expect(b).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test crossfade`
Expected: FAIL.

- [ ] **Step 3: Implement `crossfadeGains` with a plateau of `[0.4, 0.6]` and a cosine taper to each end**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test crossfade`
Expected: 3 passed.

- [ ] **Step 5: Implement `DeckMixer` in `mixer.ts`**

Override `getOrbit(orbitNum, channels)`. For orbits 1 and 2, on first creation build the chain `orbit.output → BiquadFilterNode(lowpass) → GainNode(knobGain) → GainNode(faderGain) → this.output.connectToDestination(...)`, plus a reverb send: `knobGain → GainNode(reverbSend) → ConvolverNode(2 s generated noise impulse) → faderGain`. Store the nodes per deck. Other orbits use the superclass behaviour. Knob mapping: `lpf` maps `[0,1]` exponentially to `[200, 20000]` Hz, `gain` maps linearly to `[0, 1.2]`, `reverb` maps linearly to send gain `[0, 0.6]`. `setFader` applies `crossfadeGains`. Read the superclass in `node_modules/superdough/superdoughoutput.mjs` to call `connectToDestination` the same way it does.

- [ ] **Step 6: Verify by ear**

Temporarily wire a range input to `setFader` in `App.tsx` with deck A playing. Expected: slider at the right end silences deck A, centre is full. Remove the temporary input.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add DeckMixer with crossfade and per-deck knob chain"
```

---

### Task 5: Booth with two decks, crossfader and knobs

**Files:**
- Create: `app/src/booth/Booth.tsx`, `app/src/booth/Crossfader.tsx`, `app/src/booth/Knob.tsx`, `app/src/booth/booth.css`, `app/src/booth/boothState.ts`, `app/src/booth/boothState.test.ts`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Produces: `createBoothState()` returning a store `{ fader: number; knobs: Record<DeckId, { lpf: number; gain: number; reverb: number }>; decks: Record<DeckId, DeckApi | null> }` with `setFader`, `setKnob`, `registerDeck(id, api)`. Knob and fader state are booth state, not pattern state (spec).
- Produces: `<Booth />` rendering the two decks, the crossfader, sync button (wired in Task 6), master play, and the library sidebar slot (filled in Task 10).
- Consumes: `Deck`, `DeckApi`, `createDeckState` (Task 3); `installMixer`, `DeckMixer` (Task 4).

- [ ] **Step 1: Write the failing booth state test**

```ts
import { createBoothState } from './boothState';
test('fader defaults to centre and knobs to lpf open, unity gain, no reverb', () => {
  const b = createBoothState();
  expect(b.state.fader).toBe(0.5);
  expect(b.state.knobs.A).toEqual({ lpf: 1, gain: 0.83, reverb: 0 });
});
test('setKnob clamps to [0,1]', () => {
  const b = createBoothState();
  b.setKnob('B', 'lpf', 1.7);
  expect(b.state.knobs.B.lpf).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test boothState`
Expected: FAIL.

- [ ] **Step 3: Implement `boothState.ts`** (`gain` default 0.83 maps to 1.0 in the mixer's `[0, 1.2]` range)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test boothState`
Expected: 2 passed.

- [ ] **Step 5: Implement `Knob.tsx` and `Crossfader.tsx`**

`Knob` is a labelled vertical-drag control: `props.value`, `props.onChange(v)`, drag of 150 px spans the full range, double-click resets to `props.default`. `Crossfader` is a horizontal `<input type="range" min=0 max=1 step=0.001>` styled wide, with labels A and B.

- [ ] **Step 6: Implement `Booth.tsx`**

Layout from the mockup `docs/superpowers/mockups/booth-v2.html`, option 1: sidebar slot on the left (an empty `<aside>` for now), decks side by side, footer with three knobs per deck, the crossfader, Sync and master play. `createEffect` pushes `state.fader` and each knob into the `DeckMixer`. Master play evaluates both decks with `autostart`. `installMixer()` runs once inside `onMount` after `await initEngine()`.

- [ ] **Step 7: Verify two decks play together**

Run: `pnpm tauri dev`. Play A, then play B.
Expected: both audible at once (A's beat and B's acid line), crossfader blends, each deck's lpf knob only affects its own deck.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Add Booth with two decks, crossfader and knobs"
```

---

### Task 6: Sync

**Files:**
- Create: `app/src/engine/sync.ts`, `app/src/engine/sync.test.ts`
- Modify: `app/src/booth/Booth.tsx`, `app/src/booth/boothState.ts` (add `sync: boolean`, `message: string | null`)

**Interfaces:**
- Produces: `secondsToNextBoundary(nowCycle: number, cps: number): number`.
- Produces: `class SyncController` with `constructor(getA: () => DeckApi | null, getB: () => DeckApi | null, setTimer = setTimeout)`, `engage(): { ok: true } | { ok: false; reason: string }`, `release(): void`, `get engaged(): boolean`. While engaged: B's cps is set to A's after every eval of either deck (hooked via `afterEval`), and `engage()` stops B and restarts it with `B.scheduler.start()` after `secondsToNextBoundary(A.scheduler.now(), A.scheduler.cps)` seconds. `release()` re-evaluates B so its own `setcpm` takes effect again.

- [ ] **Step 1: Write the failing tests**

```ts
import { secondsToNextBoundary, SyncController } from './sync';
test('seconds to the next cycle boundary', () => {
  expect(secondsToNextBoundary(3.25, 0.5)).toBeCloseTo(1.5);
  expect(secondsToNextBoundary(4.0, 2)).toBeCloseTo(0.5); // exactly on a boundary waits a full cycle
});
test('engage refuses when A is stopped (review focus 4)', () => {
  const a = fakeDeck({ started: false }); const b = fakeDeck({ started: false });
  const s = new SyncController(() => a, () => b);
  expect(s.engage()).toEqual({ ok: false, reason: 'Start deck A first' });
  expect(s.engaged).toBe(false);
});
test('engage copies cps to B and schedules B start on the boundary', () => {
  const timers: Array<[() => void, number]> = [];
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 });
  const b = fakeDeck({ started: true, cps: 0.6 });
  const s = new SyncController(() => a, () => b, (f, ms) => { timers.push([f, ms]); return 0 as any; });
  expect(s.engage()).toEqual({ ok: true });
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(b.scheduler.stop).toHaveBeenCalled();
  expect(timers[0][1]).toBeCloseTo(1500);
  timers[0][0]();
  expect(b.scheduler.start).toHaveBeenCalled();
});
test('while engaged, A re-eval propagates cps to B', () => {
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: true, cps: 0.5 });
  const s = new SyncController(() => a, () => b, () => 0 as any);
  s.engage();
  a.scheduler.cps = 0.55; a.afterEval.forEach(f => f());
  expect(b.setCps).toHaveBeenLastCalledWith(0.55);
});
```
`fakeDeck` is a test helper in the same file building a `DeckApi` with `vi.fn()` members.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test sync`
Expected: FAIL.

- [ ] **Step 3: Implement `sync.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test sync`
Expected: 4 passed.

- [ ] **Step 5: Wire the Sync button in `Booth.tsx`**

Latching button, lit while engaged. A failed `engage()` shows `reason` in the footer for 3 seconds via `boothState.message`. Deck headers show `scheduler.cps * 60` as the effective tempo (already set in Task 3's `afterEval`; also update it when sync changes B's cps).

- [ ] **Step 6: Verify**

Run: `pnpm tauri dev`. Set A to `setcpm(126/4)` and B to `setcpm(100/4)`, play both, press Sync.
Expected: B drops out, comes back on A's next bar at 126, header B reads 126. Press Sync again: B returns to 100 after its re-eval.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add tempo and phase sync between decks"
```

---

### Task 7: App shell: tabs and settings store

**Files:**
- Create: `app/src/shell/Tabs.tsx`, `app/src/settings/settings.ts`, `app/src/settings/settings.test.ts`, `app/src/settings/Settings.tsx`, `app/src/rip/RipPlaceholder.tsx`, `src-tauri/src/settings.rs`
- Modify: `app/src/App.tsx`, `src-tauri/src/lib.rs` (register commands), `src-tauri/Cargo.toml` (add `serde`, `serde_json`, `dirs`)

**Interfaces:**
- Produces (Rust commands): `get_settings() -> Settings`, `set_settings(settings: Settings) -> Result<(), String>`, where `Settings { library_dir: String, visualiser: "pianoroll" | "scope", engine: "webaudio" | "superdirt" }`. Stored as JSON at the Tauri app config dir `settings.json`. Default `library_dir` is `$HOME/Algobooth/library`.
- Produces (TS): `loadSettings(): Promise<Settings>`, `saveSettings(s: Settings): Promise<void>`, `defaultSettings(home: string): Settings`, and a Solid signal `settings` exported from `settings.ts`.
- Produces: `<Tabs>` with `Booth`, `Rip`, `Settings`; Booth is the default tab. The Rip tab renders a placeholder reading "Rip is coming in the next milestone." and nothing else.

- [ ] **Step 1: Write the failing settings test**

```ts
import { defaultSettings } from './settings';
test('defaults', () => {
  expect(defaultSettings('/Users/x')).toEqual({ library_dir: '/Users/x/Algobooth/library', visualiser: 'pianoroll', engine: 'webaudio' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test settings`
Expected: FAIL.

- [ ] **Step 3: Implement `settings.ts` and `settings.rs`**

TS calls the Rust commands with `invoke` from `@tauri-apps/api/core`. Rust unit test in `settings.rs`: `default_settings()` uses `dirs::home_dir()`; round-trip write then read in a `tempfile::tempdir()`.

- [ ] **Step 4: Run both test suites**

Run: `pnpm test settings` and `cd src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 5: Implement `Tabs.tsx`, `Settings.tsx`, `RipPlaceholder.tsx`**

Settings shows: library folder (text field plus a "Choose…" button using `@tauri-apps/plugin-dialog` `open({ directory: true })`), visualiser radio, and the engine radio with "SuperDirt via OSC" disabled and labelled "coming later". Saving calls `saveSettings`. `Deck.tsx`'s `editPattern` now reads `settings().visualiser` and applies `.pianoroll({ fold: 1 })` or `.scope()` accordingly; the change takes effect on the deck's next evaluation.

- [ ] **Step 6: Verify**

Run: `pnpm tauri dev`. Change the library folder, restart the app.
Expected: the new folder persists.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add tab shell, settings store and rip placeholder"
```

---

### Task 8: Library store in Rust

**Files:**
- Create: `src-tauri/src/library.rs`, `src-tauri/src/slug.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (add `tempfile` as a dev dependency, `walkdir`)

**Interfaces:**
- Produces (Rust, all registered as Tauri commands, all taking `root: String` as the first argument which is the configured library folder):
  - `list_tree(root) -> Result<TreeNode, String>` where `TreeNode { name: String, path: String, kind: "heading" | "pattern" | "unreadable", cpm: Option<f64>, children: Vec<TreeNode> }`. Children sorted headings first, then by name, case-insensitive. `path` is relative to `root`.
  - `read_pattern(root, path) -> Result<Pattern, String>` with `Pattern` matching the spec's JSON schema exactly (`name, code, cpm, key, tags, source, notes`; `source` has `kind` and the optional rip fields).
  - `write_pattern(root, heading_path, pattern) -> Result<String, String>` returning the relative file path. Filename is `slugify(name) + ".json"`; on collision with a different file, append `-2`, `-3`, and so on.
  - `create_heading(root, parent_path, name) -> Result<String, String>`
  - `rename_entry(root, path, new_name) -> Result<String, String>` (for a pattern, also updates `name` inside the JSON)
  - `move_entry(root, path, new_parent_path) -> Result<String, String>`
  - `delete_entry(root, path) -> Result<(), String>` (moves to the macOS Trash via the `trash` crate; never a hard delete)
  - `ensure_library(root) -> Result<(), String>`: creates the folder if missing; returns `Err` with the OS message if it cannot be created or is not writable.
- Produces: `slugify(name: &str) -> String`: lowercase, spaces and `/ : \` to `-`, strip leading dots, collapse repeated dashes, keep `[a-z0-9._-]`, max 80 chars, empty becomes `untitled`.

- [ ] **Step 1: Write the failing Rust tests** (in each file's `#[cfg(test)]` module)

```rust
#[test] fn slug_handles_dj_names() {
    assert_eq!(slugify("around the world 1:12"), "around-the-world-1-12");
    assert_eq!(slugify("../evil/name"), "evil-name");
    assert_eq!(slugify(""), "untitled");
}
#[test] fn tree_mirrors_folders_and_marks_bad_json_unreadable() {
    // tempdir with ripped/french house/a.json (valid), mine/b.json (not json), mine/c.json (json without "code")
    // list_tree: ripped and mine are headings, a is pattern with cpm 126, b and c are kind "unreadable", nothing panics
}
#[test] fn write_then_read_round_trips_and_keeps_real_name() {
    // write_pattern(root, "mine/bass", Pattern{name:"Acid: Line/2", ..}) -> "mine/bass/acid-line-2.json"; read_pattern returns name "Acid: Line/2"
}
#[test] fn write_collision_suffixes() { /* two different patterns named "x" -> x.json and x-2.json */ }
#[test] fn ensure_library_creates_missing_and_reports_unwritable() {
    // missing subdir of tempdir -> Ok and exists; a path under a read-only dir (chmod 0o500) -> Err
}
#[test] fn move_and_rename_keep_json_in_sync() { /* rename pattern -> file renamed and name field updated */ }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: compile errors for missing items.

- [ ] **Step 3: Implement `slug.rs` and `library.rs`, register the commands in `lib.rs`**

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add Rust library store with slugified JSON pattern files"
```

---

### Task 9: Library folder watcher

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (add `notify`, `notify-debouncer-mini`)

**Interfaces:**
- Produces (Rust command): `watch_library(root) -> Result<(), String>`. Replaces any previous watcher. Emits the Tauri event `library-changed` with payload `{ paths: Vec<String> }` (relative paths) debounced at 300 ms. Ignores `.DS_Store` and files not ending in `.json`, but always reports folder creation and removal.
- Produces (TS, in Task 10): listeners use `listen('library-changed', ...)` from `@tauri-apps/api/event`.

- [ ] **Step 1: Write the failing test**

```rust
#[test] fn watcher_reports_json_changes_relative_to_root_and_ignores_ds_store() {
    // start watcher on tempdir with a channel sink instead of the Tauri emitter (inject a `Box<dyn Fn(Vec<String>)>`),
    // write mine/x.json and .DS_Store, wait 600ms, assert one batch containing "mine/x.json" only
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test watcher`
Expected: FAIL.

- [ ] **Step 3: Implement `watcher.rs` with the sink injected, and a thin command that passes an `AppHandle::emit` sink**

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-tauri && cargo test watcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add debounced library folder watcher"
```

---

### Task 10: Library sidebar

**Files:**
- Create: `app/src/library/store.ts`, `app/src/library/store.test.ts`, `app/src/library/api.ts`, `app/src/library/LibraryTree.tsx`, `app/src/library/ContextMenu.tsx`, `app/src/library/library.css`
- Modify: `app/src/booth/Booth.tsx` (fill the sidebar slot, fold handle), `app/src/App.tsx` (call `ensure_library` then `watch_library` at startup; surface an `ensure_library` error as a banner linking to Settings)

**Interfaces:**
- Produces: `api.ts` wraps every Task 8 and 9 command with typed `invoke` calls and the `TreeNode` and `Pattern` TypeScript types matching the Rust structs.
- Produces: `createLibraryStore(api)` with store `{ root: TreeNode | null; folded: Set<string>; selected: string | null; collapsed: boolean }` and actions `refresh()`, `toggleFold(path)`, `select(path)`, `load(path, deck: DeckId)`, `rename(path, name)`, `move(path, parent)`, `remove(path)`, `createHeading(parent, name)`, `setCollapsed(bool)`. `load` reads the pattern and calls `deck.setCode(pattern.code)`, `deck.setName(pattern.name)` and `deck.setFile(path, pattern.code)`, via a `decks: () => Record<DeckId, DeckApi | null>` getter passed in.
- Produces: `pickDeckForDoubleClick(decks: Record<DeckId, { started: boolean } | null>): DeckId` returning the deck that is not playing, preferring B when neither or both are.
- Consumes: `DeckApi`, `createDeckState` (Task 3), `boothState.decks` (Task 5).

- [ ] **Step 1: Write the failing store tests** (with a fake `api`)

```ts
test('refresh loads the tree and keeps fold state for surviving paths', async () => { /* fold "mine", refresh with a tree still containing "mine" -> still folded */ });
test('double-click loads into the deck that is not playing', () => {
  expect(pickDeckForDoubleClick({ A: { started: true }, B: { started: false } })).toBe('B');
  expect(pickDeckForDoubleClick({ A: { started: false }, B: { started: true } })).toBe('A');
  expect(pickDeckForDoubleClick({ A: { started: true }, B: { started: true } })).toBe('B');
});
test('load sets deck code and name', async () => { /* fake api.read_pattern returns {name:"x", code:"y"}; deck.setCode called with "y"; deck state name "x" */ });
test('unreadable leaves are shown but cannot be loaded', async () => { /* load on kind "unreadable" rejects with "This file is not a valid pattern" */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test library`
Expected: FAIL.

- [ ] **Step 3: Implement `api.ts` and `store.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test library`
Expected: 4 passed.

- [ ] **Step 5: Implement `LibraryTree.tsx` and `ContextMenu.tsx`**

Tree rows per the mockup: headings with a disclosure triangle, leaves with name and cpm on the right, unreadable leaves greyed with a warning glyph. Interactions: click selects, double-click loads via `pickDeckForDoubleClick`, drag a leaf (HTML5 drag with `dataTransfer` type `application/x-algobooth-pattern` carrying the path) and drop onto a `Deck` which calls `load(path, id)`; drag a leaf or heading onto a heading to `move`. Right-click opens `ContextMenu` with Load to A, Load to B, Rename, Move to…, Duplicate, Delete, and on headings New heading, New pattern (creates an empty pattern named "untitled" with `setcpm(120/4)` as code). Rename is inline. Keyboard: F2 rename, Delete key deletes with a confirm dialog. The sidebar header has a fold handle driving `collapsed`; collapsed state is 36 px wide showing only the handle.

- [ ] **Step 6: Subscribe to `library-changed` and refresh**

In `App.tsx`, after settings load: `await api.ensure_library(dir)`, `await api.watch_library(dir)`, `listen('library-changed', () => store.refresh())`. Re-run all three when `settings.library_dir` changes.

- [ ] **Step 7: Verify**

Run: `pnpm tauri dev`. In a terminal, `mkdir -p ~/Algobooth/library/mine/bass` and write a valid pattern JSON there.
Expected: the tree shows `mine / bass / <name>` within a second without restarting. Drag it onto deck B, press Update: it plays. Right-click rename: file renamed on disk, JSON `name` updated.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Add library sidebar tree with drag to deck and live refresh"
```

---

### Task 11: Save from the booth and disk-change reconciliation

**Files:**
- Create: `app/src/booth/deckFile.ts`, `app/src/booth/deckFile.test.ts`, `app/src/booth/SaveDialog.tsx`
- Modify: `app/src/booth/Deck.tsx` (Save, Save as, New buttons, dirty dot, "changed on disk" bar; `setFile` becomes real), `app/src/booth/deckState.ts` (add `filePath: string | null`, `savedCode: string | null`, `diskChanged: boolean`)

**Interfaces:**
- Produces: `isDirty(editorCode: string, savedCode: string | null): boolean` (`savedCode` null means a never-saved deck, dirty only if the editor is non-empty and differs from the deck's default code).
- Produces: `onDiskChange(state: { filePath: string | null; dirty: boolean }, changedPaths: string[]): 'ignore' | 'reload' | 'prompt'`: `ignore` when the deck's file is not among `changedPaths`; `reload` when it is and the deck is clean; `prompt` when it is and the deck is dirty.
- Produces: `patternFromDeck(state: DeckState, existing?: Pattern): Pattern` building the spec JSON: `name`, `code`, `cpm` from the deck header, `source` kept from `existing` if present else `{ kind: 'mine' }`, `key`, `tags`, `notes` kept from `existing` else `''`, `[]`, `''`.
- Consumes: `api.write_pattern`, `api.read_pattern` (Task 10), `DeckState` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
test('dirty rules', () => {
  expect(isDirty('a', 'a')).toBe(false);
  expect(isDirty('a', 'b')).toBe(true);
  expect(isDirty('', null)).toBe(false);
});
test('disk change decision', () => {
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: false }, ['mine/y.json'])).toBe('ignore');
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: false }, ['mine/x.json'])).toBe('reload');
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: true }, ['mine/x.json'])).toBe('prompt');
  expect(onDiskChange({ filePath: null, dirty: true }, ['mine/x.json'])).toBe('ignore');
});
test('patternFromDeck keeps rip source and fills mine defaults', () => {
  const rip = { kind: 'rip', url: 'u', start: 1, end: 2, rippedAt: 't' } as const;
  expect(patternFromDeck(deck({ name: 'n', code: 'c', cpm: 126 }), { name: 'n', code: 'old', cpm: 120, key: 'A minor', tags: ['x'], source: rip, notes: 'k' }))
    .toEqual({ name: 'n', code: 'c', cpm: 126, key: 'A minor', tags: ['x'], source: rip, notes: 'k' });
  expect(patternFromDeck(deck({ name: 'n', code: 'c', cpm: 120 })).source).toEqual({ kind: 'mine' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test deckFile`
Expected: FAIL.

- [ ] **Step 3: Implement `deckFile.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test deckFile`
Expected: 3 passed.

- [ ] **Step 5: Wire the deck**

Save writes to `filePath` (or opens `SaveDialog` when null). Save as opens `SaveDialog`: name field plus a heading picker built from the library tree. New clears the editor to the deck's default code and `filePath` to null, asking to save first if dirty. A dot after the deck name shows dirty. On `library-changed`, run `onDiskChange`: `reload` replaces the code silently; `prompt` shows a bar under the header "Changed on disk. Reload or Keep mine." Neither path ever writes to disk by itself.

- [ ] **Step 6: Verify**

Run: `pnpm tauri dev`. Edit deck A, Save as "test loop" under `mine`. Open the JSON in a text editor, change the code, save.
Expected: deck A (clean) reloads the new code. Now edit deck A in the app, then change the file again: the "Changed on disk" bar appears, and Keep mine leaves the editor alone.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add save, save as, new, and disk-change reconciliation on decks"
```

---

### Task 12: Seed library and README

**Files:**
- Create: `library-example/mine/drums/four-on-the-floor.json`, `library-example/mine/bass/acid-line.json`, `library-example/mine/pads/warm-pad.json`
- Modify: `README.md`, `src-tauri/src/library.rs` (`ensure_library` copies `library-example` into a brand-new library folder on first creation; the example folder is bundled as a Tauri resource)

**Interfaces:**
- Consumes: `ensure_library` (Task 8).

- [ ] **Step 1: Write the failing Rust test**

```rust
#[test] fn ensure_library_seeds_examples_only_when_creating() {
    // missing root -> created and contains mine/drums/four-on-the-floor.json; existing empty root -> left empty
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test seeds`
Expected: FAIL.

- [ ] **Step 3: Write the three example patterns (valid spec JSON, `source.kind` "mine", cpm 120, 126, 120) and implement the seeding**

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 5: Update `README.md`**

Replace the status line with: how to run (`rustup`, `pnpm i`, `pnpm fetch-samples`, `pnpm tauri dev`), how to test (`pnpm test`, `cargo test` in `src-tauri`), and where the library lives.

- [ ] **Step 6: Full verification**

Run: `pnpm test && (cd src-tauri && cargo test) && pnpm tauri dev` with Wi-Fi off, delete `~/Algobooth/library` first.
Expected: all suites pass; the app opens with the seeded tree; both example patterns load onto decks and play together; sync works; save works.

- [ ] **Step 7: Commit and push**

```bash
git add -A && git commit -m "Seed example library and document how to run" && git push
```
