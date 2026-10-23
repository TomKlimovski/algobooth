# Algobooth

A desktop DJ booth built around [Strudel](https://strudel.cc), the browser live-coding music environment.

- **Booth.** Two Strudel decks, a crossfader, sync, and a few knobs. Runs offline.
- **Library.** Your patterns, ripped or written, in a tree you organise yourself. Plain JSON files on disk.
- **Rip.** Give it a YouTube link and a start and stop time. It separates the stems, works out tempo, drums, bass and chords, and hands back Strudel code you can tweak.

## Run

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust toolchain
pnpm i
pnpm tauri dev   # fetches the drum machine samples first when they are missing
```

## Test

```sh
pnpm test
cd src-tauri && cargo test
cd service && uv run pytest
```

After a Strudel version bump, run `pnpm build-methods` to rebuild the Methods catalogue; until you do, `app/src/methods/catalogue.test.ts` fails because the installed version differs from the catalogue's.

## Library

Patterns live in `~/Algobooth/library` as plain JSON files (change the folder in Settings). A brand-new library is seeded with a few examples from `library-example/`. Rest the pointer on a pattern to see its code. Drag it onto a deck's body to load it, or onto a deck's header to cue it (see Keys). Double-click sends it to the target deck, the one you last clicked, typed in or loaded, marked "◂ library" in its header: a stopped deck **loads** the pattern and a playing deck **cues** it. Shift+double-click does the other one, and right-click offers Load to A / B and Cue on A / B.

## Methods

The Methods panel on the Booth's right edge lists Strudel's chainable methods (`.lpf`, `.room`, `.fast` and about 270 more) in folders: Sound, Pitch, Filter, Envelope, Dynamics, Ducking, Delay and Reverb, Modulation, Distortion, Pan and Space, Time, Structure and Other. Below them a Functions section lists the standalone functions (`seq`, `stack`, `cat`, the signals such as `sine`, the random pickers, `run`, `setcpm`) in folders Combine, Signals, Random, Sources, Setup and Other. The folders start collapsed; the search box looks across all of them. Rest the pointer on a row, or focus it with the keyboard, to see the call as it will be inserted, Strudel's own description, synonyms and parameters. Drag a row onto a deck's editor and `.name(default)` lands at the end of the line you dropped on, whatever column, with the default argument selected so you can type over it. Double-click inserts on the cursor's line of the target deck, marked "◂ library" in its header. A drop on a blank or comment line borrows the nearest pattern line, and a bare label such as `$:` sends it to the pattern body below; a line that opens a bracket like `stack(`, or a document with no pattern line, shows "drop onto a pattern line" under the deck. A function is an expression rather than a method call, so it lands exactly where the pointer is, as a complete expression such as `sine.range(0.2, 1).slow(4)` or `stack(s("bd*4"), s("hh*8"))`. The pointer must be where a value can go: inside `( )`, after a comma or a label, and anywhere else (inside a word, after a `)`, before a `.`) refuses with a message under the deck. On a blank line a combinator or source is written as its own `$:` line so the deck plays it, `setcpm` goes in as it is, and a signal refuses because it has nothing to drive. Nothing plays until you press Update. A deck's Format button lays every chain out one method per line (`bass: note("g1")` then `.s("sawtooth")`, `.lpf(370)` indented under it, a chain inside an argument staying inline); it is one undo step and changes nothing the deck plays.

The list is built offline from the JSDoc of the pinned Strudel packages (`pnpm build-methods` writes `app/src/methods/catalogue.json`), so the panel needs no network. Default arguments, the methods and functions left out and the tooltip notes are hand-kept in `app/src/methods/defaults.ts`; `samples(...)` is left out because it fetches from a URL. `orbit` is never offered: orbits are the app's deck channels.

## Keys

A key strip under each deck turns the computer keyboard into pads. Drag a method from the Methods panel onto a key to bind it (functions are refused: they go in the editor); drop a second method on the same key and it becomes a macro, one key for a chain. Press **Esc** to enter perform mode: the editor locks and the letters are pads, and Esc again gives the keys back to the editor. The performing deck is the one marked "◂ library" in its header; **Tab** switches it. The digits **1** to **9** pick the target line among the deck's pattern lines, which the editor gutter numbers in place of line numbers. A letter key taps or holds: a tap commits (the method is appended to the target line, or taken off if it is already there), a hold auditions it and reverts on release. **Shift**+letter nudges the bound method's argument up by a factor of 2 and **Ctrl**+letter down. The bottom row, Z to M, holds the pattern's named lines in document order (a rip's `_fills` and `_bass2` land on keys by themselves), and a press flips that line's leading underscore. **F1** to **F8** recall snapshots of the deck's code and **Shift**+F saves one. By default every change lands on the next bar; Settings → Keys chooses now, beat or bar, and the deck header counts down while something is queued.

**Cue.** A cue mixes a second pattern into a playing deck without stopping it. Cue one from the library (see above) and the deck's code gets a `// cued: <name> · <cpm> cpm …` comment followed by that pattern's lines, muted and prefixed with a short name taken from the pattern (`_acid_line:`, `_solomun_live_bass:`); its `setcpm` line is left out, so the deck keeps its tempo. Nothing new sounds yet. The cued lines sit on the free home-row keys A to L, in a blue tone, labelled without the prefix, and a press flips one on the bar like any line key. The deck's header shows `next: <name>` with **Go** and **Clear** buttons (in perform mode, **Enter** is Go and **Shift+Enter** is Clear). Go lands on the bar: the deck's own lines go, the prefixes come off (a line still muted stays muted), the tempo stays, and the deck becomes the cued pattern, so it shows as changed from its file until you save. Clear removes the cued block and leaves the deck as it was. A half-mix you saved comes back as a half-mix, with `(from file)` beside the cue. Design: [docs/superpowers/specs/2026-10-23-cue-lines-design.md](docs/superpowers/specs/2026-10-23-cue-lines-design.md).

On a Mac, F1–F8 reach the app only with “Use F1, F2, etc. keys as standard function keys” on in System Settings → Keyboard, or with Fn held.

Right-click a key for clear, hide for this pattern, keep with this pattern or make global. Method keys live in a global layout (Settings has Reset key layout); a pattern's own keys and snapshots are saved in its file under `keys`, so Save keeps them. The design is in [`docs/superpowers/specs/2026-10-22-method-keyboard-design.md`](docs/superpowers/specs/2026-10-22-method-keyboard-design.md).

## Rip

The Rip tab sends a YouTube link and a start and end time to a local Python service (`service/`, package `algorip`), which downloads the clip, separates it into stems with Demucs, works out tempo, key, drums, bass and chords, and writes Strudel code for it: one named line per part (`drums:` for the kick, `claps:` or `snare:`, `hats:`, `ghosts:` for quiet hat ticks, `bass:`, `chords:`, `melody:`; the drum lines are loops, like the bass, each on the bank sample shaped like the stem's (`bd:3`) at the stem's level (`.gain()`), plus muted lines: `_bass2:` for what some bars add on top of the bass loop, and `_fills:` for the fills: bars where the drum loops miss at least three hits, each in its own bar, and any drum voice that has no steady loop), so you can mute one by writing `_bass:` in front of it. The app starts and stops the service itself.

It needs [uv](https://docs.astral.sh/uv/) on the path; `pnpm tauri dev` syncs `service/.venv` itself
(`uv sync`, a tenth of a second once it is there), so a fresh clone or worktree needs no separate step.

- **First rip downloads the models.** PyTorch, torchaudio, Demucs and the htdemucs weights are not part of `uv sync`; the Rip tab offers a one-time download of about 600 MB (561 MB on disk, measured). They go in the app data folder, `~/Library/Application Support/io.klimovski.algobooth/models` on macOS, and nothing else needs the network after that except fetching new clips.
- **Cache.** Downloads, stems and analysis results live in `~/Algobooth/cache` (change the folder in Settings). Ripping the same clip again is served from the cache, offline: the **Recent** menu on the Rip tab lists the cached clips; picking one fills in the link and window and brings back its last result at once (every rip stores its result beside its stems), and Analyse recomputes it. Source audio is deleted after a rip unless you tick "Keep downloaded audio" in Settings.
- **Bass is the loop.** The `bass:` line is the pattern the bass stem plays, not a bar-by-bar transcript: the analysis tests which period (1, 2, 4 or 8 bars) the bars repeat at. A bar belongs to the loop when it plays what the loop plays, whatever else it adds, so a sparse line with a varying last beat is still one bar; the loop's notes are taken from the bars that add the least, so a long build cannot outvote a short loop; and a longer period wins only when it explains clearly more of the notes, so an alternation is a two-bar loop but a varying beat is not. When no period fits, the bass is written out bar by bar. A beat of retriggered 16ths on one pitch is written `g1*4`.
- **Pitch.** Each 16th's pitch comes from a pitch tracker (pyin). A loud step the tracker is unsure of gets a second opinion from the spectrum, which corrects the tracker's habit of reading a note an octave down (the 48:50 Solomun clip's fourth beat); a quiet step never does, so tails and bleed stay rests.
- **Tuning and chromatic notes.** The clip's offset from 440 tuning (the median over the pitched steps) is removed before any note is rounded, and a note that is then clearly on a semitone keeps it even when it is not in the key; only an ambiguous reading, more than 35 cents from any semitone, snaps to the key. The 48:50 Solomun clip's third beat is an E3 in D# minor. An offset of 10 cents or more shows on the Rip tab's analysis line.
- **Filter.** The lowpass cutoff is the stem's own: the 85% rolloff of the notes' held part, and when the notes open at least an octave brighter at their attack and take 50 ms or more to close, `.lpenv().lpdecay().lpsustain(0)` move the filter the same way.
- **Gate.** When the stem's notes die before their end (6 dB or more down), the bass lines carry a measured envelope, `.attack(a).clip(c).release(r)`: the attack and the cut as the stem plays them, and the note held at full level for the share of its length the stem holds it. A held bass gets none.
- **Variation.** What the bars add on top of the loop comes as a muted `_bass2:` line under the bass, with a comment naming the bars it came from: written once when those bars all add the same thing, and bar by bar when they fill in gradually. A bar adding fewer than two steps adds a stray, which is left out. Remove the underscore to switch it on.
- **Match.** The analysis line on the Rip tab ends with the loop length and a 0–1 match of the loop against the bass stem, for example `bass loop 1 bar · match 0.80`. The generated line for that clip is `bass: note("[~ ~ g1@2] [~ g1 ~ g1] [~ ~ g1@2] [~ g1@2 g2]")`.
- **Drum match.** The drum number on the analysis line, for example `drums loop 1 bar · 92% of hits`, is how well the loops' hits agree with the classified drum hits (an F1 score shown as a percentage), so a hit the loops miss and a hit they play that a bar did not have both lower it. It is agreement with the drum classifier, not with the stem, so read it as weaker than the bass match. Hits outside the loops go to the muted `_fills:` line when a bar has three or more of them; a voice with no steady loop is written there whole. Remove the underscore to hear them. The grid itself sits on the kicks: when the beat tracker lands half a beat off them, the beats are moved onto the kicks and the bar starts so the claps fall on 2 and 4.
- **Backtest a clip.** `service/scripts/bass_fixture.py` runs the bass analysis on a rip's cached stems and writes the expected loop as test fixtures; see `service/README.md`.
- **Optional tidy pass.** Put a Claude API key in Settings and tick Tidy on the Rip tab to have Claude rewrite the generated code more idiomatically, keeping the tempo. Without a key the pass is off and nothing leaves your machine but the YouTube download.
- **Limits.** A clip is at most 60 seconds. Demucs runs on the GPU through Metal, so ripping is supported on Apple Silicon Macs only.

See [`service/README.md`](service/README.md) for the service's API, and [the design document](docs/superpowers/specs/2026-10-19-algobooth-design.md) for how it works.

Licensed under AGPL-3.0, as Strudel is. Algobooth is not affiliated with the Strudel project.
