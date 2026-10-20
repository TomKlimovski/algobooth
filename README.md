# Algobooth

A desktop DJ booth built around [Strudel](https://strudel.cc), the browser live-coding music environment.

- **Booth.** Two Strudel decks, a crossfader, sync, and a few knobs. Runs offline.
- **Library.** Your patterns, ripped or written, in a tree you organise yourself. Plain JSON files on disk.
- **Rip.** Give it a YouTube link and a start and stop time. It separates the stems, works out tempo, drums, bass and chords, and hands back Strudel code you can tweak.

## Run

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust toolchain
pnpm i
pnpm fetch-samples
pnpm tauri dev
```

## Test

```sh
pnpm test
cd src-tauri && cargo test
cd service && uv run pytest
```

## Library

Patterns live in `~/Algobooth/library` as plain JSON files (change the folder in Settings). A brand-new library is seeded with a few examples from `library-example/`. Rest the pointer on a pattern to see its code. Drag it onto a deck to load it, or double-click: that loads into the target deck, the one you last clicked, typed in or loaded, marked "◂ library" in its header.

## Rip

The Rip tab sends a YouTube link and a start and end time to a local Python service (`service/`, package `algorip`), which downloads the clip, separates it into stems with Demucs, works out tempo, key, drums, bass and chords, and writes Strudel code for it: one named line per part (`drums:`, `hats:`, `bass:`, `chords:`, `melody:`; `drums:` and `hats:` are loops, like the bass, plus muted lines: `_bass2:` when the bass has a repeating build layer, and `_fills:` for every hit the drum loops do not play, each in its own bar), so you can mute one by writing `_bass:` in front of it. The app starts and stops the service itself.

Set it up once, alongside the steps above (needs [uv](https://docs.astral.sh/uv/)):

```sh
cd service && uv sync
```

- **First rip downloads the models.** PyTorch, torchaudio, Demucs and the htdemucs weights are not part of `uv sync`; the Rip tab offers a one-time download of about 600 MB (561 MB on disk, measured). They go in the app data folder, `~/Library/Application Support/io.klimovski.algobooth/models` on macOS, and nothing else needs the network after that except fetching new clips.
- **Cache.** Downloads, stems and analysis results live in `~/Algobooth/cache` (change the folder in Settings). Ripping the same clip again is served from the cache, offline: the **Recent** menu on the Rip tab lists the cached clips; picking one fills in the link and window and brings back its last result at once (every rip stores its result beside its stems), and Analyse recomputes it. Source audio is deleted after a rip unless you tick "Keep downloaded audio" in Settings.
- **Bass is the loop.** The `bass:` line is the pattern the bass stem plays, not a bar-by-bar transcript: the analysis tests which period (1, 2, 4 or 8 bars) the bars repeat at, and bars that deviate, like a build, do not veto the loop. When no period fits, the bass is written out bar by bar. A beat of retriggered 16ths on one pitch is written `g1*4`.
- **Build layer.** Extra notes in the deviating bars, when they repeat and are dense enough, come as a muted `_bass2:` line under the bass, with a comment naming the bars they came from. Remove the underscore to switch it on.
- **Match.** The analysis line on the Rip tab ends with the loop length and a 0–1 match of the loop against the bass stem, for example `bass loop 1 bar · match 0.80`. The generated line for that clip is `bass: note("[~ ~ g1@2] [~ g1 ~ g1] [~ ~ g1@2] [~ g1@2 g2]")`.
- **Drum match.** The drum number on the analysis line, for example `drums loop 1 bar · 92% of hits`, is the share of the classified drum hits the loops account for. It is agreement with the drum classifier, not with the stem, so read it as weaker than the bass match. Hits outside the loops go to the muted `_fills:` line; remove the underscore to hear them.
- **Backtest a clip.** `service/scripts/bass_fixture.py` runs the bass analysis on a rip's cached stems and writes the expected loop as test fixtures; see `service/README.md`.
- **Optional tidy pass.** Put a Claude API key in Settings and tick Tidy on the Rip tab to have Claude rewrite the generated code more idiomatically, keeping the tempo. Without a key the pass is off and nothing leaves your machine but the YouTube download.
- **Limits.** A clip is at most 60 seconds. Demucs runs on the GPU through Metal, so ripping is supported on Apple Silicon Macs only.

See [`service/README.md`](service/README.md) for the service's API, and [the design document](docs/superpowers/specs/2026-10-19-algobooth-design.md) for how it works.

Licensed under AGPL-3.0, as Strudel is. Algobooth is not affiliated with the Strudel project.
