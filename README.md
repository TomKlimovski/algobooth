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
```

## Library

Patterns live in `~/Algobooth/library` as plain JSON files (change the folder in Settings). A brand-new library is seeded with a few examples from `library-example/`.

Rip is the next milestone. See [the design document](docs/superpowers/specs/2026-10-19-algobooth-design.md).

Licensed under AGPL-3.0, as Strudel is. Algobooth is not affiliated with the Strudel project.
