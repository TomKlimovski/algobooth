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

Patterns live in `~/Algobooth/library` as plain JSON files (change the folder in Settings). A brand-new library is seeded with a few examples from `library-example/`.

## Rip

The Rip tab sends a YouTube link and a start and end time to a local Python service (`service/`, package `algorip`), which downloads the clip, separates it into stems with Demucs, works out tempo, key, drums, bass and chords, and writes Strudel code for it. The app starts and stops the service itself.

Set it up once, alongside the steps above (needs [uv](https://docs.astral.sh/uv/)):

```sh
cd service && uv sync
```

- **First rip downloads the models.** PyTorch, torchaudio, Demucs and the htdemucs weights are not part of `uv sync`; the Rip tab offers a one-time download of about 600 MB (561 MB on disk, measured). They go in the app data folder, `~/Library/Application Support/io.klimovski.algobooth/models` on macOS, and nothing else needs the network after that except fetching new clips.
- **Cache.** Downloads, stems and analysis results live in `~/Algobooth/cache` (change the folder in Settings). Ripping the same clip again is served from the cache, offline: the **Recent** menu on the Rip tab lists the cached clips and fills in the link and window for one, so a clip survives a restart and can be analysed again in seconds. Source audio is deleted after a rip unless you tick "Keep downloaded audio" in Settings.
- **Optional tidy pass.** Put a Claude API key in Settings and tick Tidy on the Rip tab to have Claude rewrite the generated code more idiomatically, keeping the tempo. Without a key the pass is off and nothing leaves your machine but the YouTube download.
- **Limits.** A clip is at most 60 seconds. Demucs runs on the GPU through Metal, so ripping is supported on Apple Silicon Macs only.

See [`service/README.md`](service/README.md) for the service's API, and [the design document](docs/superpowers/specs/2026-10-19-algobooth-design.md) for how it works.

Licensed under AGPL-3.0, as Strudel is. Algobooth is not affiliated with the Strudel project.
