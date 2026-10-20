# Algobooth: design

Date: 2026-10-19
Status: draft for owner approval

## Intent

Tom wants to play an electronic set in a club one day, live-coding the music in Strudel. Strudel already scratches the music-and-code itch. What is missing is a performance surface built around it, and a way to learn from existing DJ music by turning snippets of tracks he likes into Strudel patterns he can tweak and reuse.

Algobooth is a desktop app for the laptop, fully usable offline, that wraps Strudel as the sound engine in a two-deck DJ booth, keeps a personal library of patterns organised as a tree, and has a "rip" workflow that takes a YouTube link plus start and stop times and hands back a Strudel approximation of that snippet.

The point of the rip is a starting sketch and an understanding of how a groove is built. It is not a faithful reproduction. Rhythm and notes should be good. Timbre will be approximate, and the user fixes it by hand. That tweaking is the fun part.

## Goals

- Run offline on macOS once installed, except when ripping from YouTube.
- Two Strudel decks that can play simultaneously with a crossfader between them, so a set is a sequence of blends from one pattern into the next.
- A library of patterns the user organises into a tree with their own headings, stored as plain files that work with git and hand-editing.
- A rip pipeline that turns a snippet of a track into idiomatic Strudel code: tempo, drum pattern, bass line, chords, and a rough sound choice.
- Audition the original stems against the Strudel result so the user can judge the approximation.
- Design so that swapping the audio engine for SuperDirt over OSC later is a settings toggle, not a rewrite.

## Non-goals (version one)

- Not a DAW. No timeline, no multitrack recording.
- No recording or exporting of mixes.
- No faithful timbre cloning. Nothing will tell you the exact synth settings of a Daft Punk bass.
- No cloud, accounts, or sync.
- No Windows or Linux builds. Mac only to start, though nothing should block them later.
- No MIDI controller mapping in version one, though the knobs are designed so mapping is a later addition.

## Anti-goals

- A rip that produces a wall of numbers. The output must read like something a person wrote in Strudel: short lines, mini-notation, one named line per instrument (`drums:`, `bass:`...), a `setcpm` at the top.
- A booth that stutters. Two editors and two visualisers redrawing must not cause audio glitches.
- Anything that needs internet during a performance.
- Putting "strudel" in the product name. Strudel's FAQ asks derived projects not to.

## Constraints

- Strudel is AGPL-3.0. Algobooth is therefore AGPL-3.0 too, source published on GitHub under `tomklimovski`.
- Strudel's pattern engine, editor and visualiser are JavaScript on Web Audio. They must run in a webview. This fixes the shape of the app: a native shell around a web UI.
- Stem separation and transcription models are Python. They run in a local service, not in the webview.
- Pin Strudel's npm packages to one version so patterns do not break when upstream changes.
- YouTube download is for the user's own study. The app does not store or redistribute audio beyond the user's local cache.

## Decided: the user experience

### Tabs

Three top-level tabs: **Booth**, **Rip**, **Settings**. Booth is the home screen. Rip deliberately sits behind it; it is a workshop tool, not the main event.

### Booth

Left: a foldable **library sidebar** showing the tree. A handle folds it away for a clean booth on the night. Dragging a leaf onto a deck loads that pattern into the deck's editor. Double-click does the same into the target deck: the deck last clicked, typed in or loaded, marked "◂ library" in its header (A at first). Resting the pointer on a pattern shows its code beside the row.

Centre: **two decks**, A and B, side by side. Each deck has:

- a header with the loaded pattern's name and its tempo in cycles per minute
- a visualiser above the editor (Strudel's built-in pianoroll or scope; owner's choice of default is pianoroll)
- a Strudel code editor (Strudel's CodeMirror-based editor from `@strudel/codemirror`)
- play, stop, and update (re-evaluate) controls
- three knobs: low-pass filter cutoff, gain, and a reverb send. Turning a knob applies the value to the deck's output as a post-processing stage, so the code stays as written. The knob positions are saved with the deck state, not with the pattern.

Bottom: a **crossfader** between A and B, a **sync** button, and a master play. The crossfader is DJ-style: a constant-gain plateau around centre with an equal-power taper to either side, so centre means both decks at full gain. 

**Sync** works the way a DJ expects, and this is the author's call: it matches tempo and phase, and it latches. While sync is on, deck B runs at deck A's effective tempo regardless of the `setcpm` in B's code, and B's cycle boundaries are locked to A's. Turning sync off returns B to its own code's tempo. This needs a per-deck tempo override that beats the code's `setcpm` (intercept it in the transpiled pattern, or run a shared scheduler clock with a per-deck ratio). The deck header shows the effective tempo, not the code's.

**Saving from the booth** is also the author's call: the deck is where Tom writes his own patterns, not only where ripped ones are played. Each deck has save, save as (with a heading picker), and new. A dirty indicator shows when the editor differs from the library file. If the file changes on disk under an edited deck, the deck keeps its edits and shows a "changed on disk, reload?" prompt; it never silently overwrites either side.

Each deck plays through its own Strudel instance so tempo and cycle position can differ until synced. Both instances share one Web Audio context so the crossfader is a simple gain stage.

### Library

A tree with user-defined headings at any depth. Leaves are patterns. Example:

```
ripped/
  french house/
    around the world 1:12
    music sounds better 0:30
  uk garage/
mine/
  bass/
    acid line
    sub wobble
  drums/
sets/
```

Each leaf shows name and tempo. Right-click gives rename, move, delete, duplicate, and "load to A" / "load to B". Headings are created and renamed inline. Drag reorders and moves between headings.

On disk the library mirrors the tree exactly: headings are folders, leaves are one JSON file each, under a `library/` folder the user picks in Settings (default `~/Algobooth/library`). The app watches the folder so edits made in a text editor or `git checkout` appear live.

Leaf file format:

```json
{
  "name": "around the world 1:12",
  "code": "setcpm(126/4)\ndrums: s(\"bd*4, [~ cp]*2, hh*8\").bank(\"tr909\")\n...",
  "cpm": 126,
  "key": "A minor",
  "tags": ["house", "4/4"],
  "source": {
    "kind": "rip",
    "url": "https://www.youtube.com/watch?v=...",
    "start": 72.0,
    "end": 88.0,
    "rippedAt": "2026-10-19T10:00:00+11:00"
  },
  "notes": ""
}
```

`source.kind` is `rip` or `mine`. For `mine`, `source` has only `kind`.

### Rip

Top: a URL field, start and stop time fields (accept `1:12` or `72` seconds), and an **Analyse** button. Clip length is capped at 60 seconds in version one.

Below, two columns.

Left, **Stems & analysis**: tempo, key, meter, bar count. A row of stem buttons (drums, bass, other, vocals) that play the separated original. A toggle to A/B the original against the Strudel result, both locked to the same start.

Right, **Strudel result**: the generated code in an editor the user can edit before saving. Buttons: play, save to library (with a heading picker), load to deck A, load to deck B.

Progress is shown per stage (download, separate, analyse, generate) because separation can take tens of seconds on a laptop.

### Settings

- Library folder.
- Audio engine: **Web Audio** (default) or **SuperDirt via OSC** (present in the UI from the start, greyed out with "coming later" until implemented).
- Default visualiser.
- Rip: cache folder, whether to keep downloaded audio, and an optional Claude API key for the tidy-up pass described below.

## Decided: the rip pipeline

Runs in the Python service. Stages, each a separate module with a plain data interface so they can be tested and replaced individually.

1. **Download.** `yt-dlp` fetches best audio for the URL, `ffmpeg` trims to the start/stop window and converts to 44.1 kHz WAV. Cached by URL and window.
2. **Separate.** Demucs (`htdemucs`) splits into drums, bass, other, vocals. Models download once on first use into the app's models folder and are reused offline thereafter.
3. **Tempo and grid.** Tempo and beat positions from librosa on the full mix. Downbeats estimated from the drums stem. The result is a bar grid; everything after this is quantised to it. Default grid resolution is 16 steps per bar; the generator uses finer resolution only when onsets clearly fall off the 16 grid.
4. **Key.** Krumhansl-Schmuckler key estimation on the "other" plus bass stems.
5. **Drums.** Onset detection on the drums stem, then classify each onset as kick, snare or clap, closed hat, open hat, or other, using a small spectral-centroid and band-energy classifier. Builds one mini-notation line per drum voice.
6. **Bass.** Basic Pitch on the bass stem gives note events. Quantise to the grid, snap to the estimated key when within a semitone, collapse to one monophonic line.
7. **Chords and melody.** Chord estimation per bar on the "other" stem by template matching against the chroma. A `chord("<...>")` line results. Melody from Basic Pitch on "other" is included only when a clear monophonic line is present, otherwise omitted.
8. **Sound choice.** Rules, not learning: four-on-the-floor at 118 to 132 cpm suggests `bank("tr909")`; breakbeats suggest `bank("tr808")` or a break sample; bass with strong harmonics suggests `sawtooth` with a low-pass, a cleaner bass suggests `sine` or `triangle`. Reverb and filter values are coarse guesses.
9. **Generate.** A deterministic Strudel code generator that emits: `setcpm`, one named line (`drums:`, `hats:`, `bass:`, `chords:`, `melody:`) per part, so a part can be muted with a leading underscore (`_bass:`), each with the sound and effect choices. Uses `<>` for things that change per bar, `*` and `[]` for subdivisions, and Euclidean notation when a pattern matches one. Output is formatted for reading, not minimal.
10. **Optional tidy.** If a Claude API key is set and the machine is online, the generated code plus a compact analysis summary is sent to Claude with instructions to make the code more idiomatic without changing what it plays. The user sees both versions and picks. Off by default; the app must work fully without it.

The service exposes a small local HTTP API on localhost with a per-launch random port and token: `POST /rip` starts a job, `GET /rip/{id}` reports stage progress and the result, `GET /rip/{id}/stem/{name}` streams a stem for audition.

## Decided: technology

- **Shell:** Tauri 2. Rust shell handles the window, the file system, launching and supervising the Python service, and the library folder watcher. Strudel's own repo ships a Tauri wrapper, so this is a known-good pairing.
- **UI:** Solid with TypeScript, Vite for the build. Chosen over React for lower rendering overhead with two live editors and visualisers.
- **Engine:** Strudel's npm packages (`@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/webaudio`, `@strudel/codemirror`, `@strudel/tonal`, and the draw package for the visualiser), pinned to one version. Default sample banks are bundled with the app so they load offline.
- **Analysis service:** Python 3.11, FastAPI, `yt-dlp`, `ffmpeg`, Demucs, librosa, Basic Pitch. Packaged with the app as a self-contained Python environment. The user does not install Python.
- **Library format:** one JSON file per pattern in a folder tree, as above.
- **Later engine:** SuperDirt over OSC, using Strudel's `@strudel/osc` package and its Node bridge or a Rust equivalent. Out of scope to implement now; in scope to leave room for.
- **Licence:** AGPL-3.0.

Developer prerequisites on this machine today: Node 20 and pnpm are present. Rust and `cargo` are not installed and are needed for Tauri. Python 3.10 is present; the service targets 3.11 and will use its own environment.

### Target machine, install size, and signing (author's calls)

- The target is Tom's own laptop: an Apple M2 with 8 GB of memory and ample disk. Demucs runs on Apple's MPS backend there; a 60 second clip separates in tens of seconds. With 8 GB, the service must run Demucs with a small segment size and must not hold more than one job in memory at a time. Intel Macs are not a target.
- The installer stays small. PyTorch and the Demucs weights, together roughly 2 GB, download on the first rip into the app's models folder, with a clear progress screen that says this happens once. Everything else, including the Strudel sample banks needed for `bank("tr909")` and `bank("tr808")`, ships inside the app so the booth works offline from the first launch.
- Version one is for Tom's machine only. It is ad-hoc signed; no Apple Developer ID is assumed. Distributing to others later needs a Developer ID, notarisation, hardened runtime, and entitlements for every bundled binary (Python, torch, ffmpeg, yt-dlp), which is a separate piece of work and is out of scope here.

## Repository layout

```
algobooth/
  app/            Solid + Vite web UI
  src-tauri/      Rust shell
  service/        Python analysis service
  docs/superpowers/specs/     design docs
  docs/superpowers/mockups/   the brainstorm HTML mockups
  library-example/            a few sample patterns to seed a new library
```

## Milestones

1. **Booth plays.** Tauri app opens, one deck plays a Strudel pattern offline with bundled samples, visualiser works.
2. **Two decks and crossfader.** Second deck, shared audio context, crossfader, sync, knobs.
3. **Library.** Sidebar tree, folder-mirroring JSON store, watcher, drag to deck.
4. **Rip, rhythm only.** Python service runs from the app, download and separate work, tempo and drum pattern come back as Strudel, audition stems.
5. **Rip, notes.** Bass, chords, key, sound choice rules, optional Claude tidy.
6. **Polish.** Settings tab, SuperDirt toggle stub, packaging as an ad-hoc signed Mac app with the first-run model download.

## Left to the builder

- Exact knob-to-effect mapping curves and ranges.
- How the two Strudel instances are isolated (two REPL instances in one page versus iframes); shared audio context is the constraint.
- Drum classifier details and whether a small pretrained model beats hand rules.
- The code generator's formatting choices, within the anti-goal above.
- Packaging of the Python environment (PyInstaller, a bundled venv, or uv) and of Demucs model weights.
- Keyboard shortcuts.

## Open questions for the owner

None at the time of writing. Calls made without asking are marked as such in the text above and summarised here:

- Default visualiser is the pianoroll.
- Knobs are filter, gain, reverb send, applied post-pattern.
- Sync matches tempo and phase and latches, overriding B's `setcpm` while on.
- Decks can save, save as, and create new library patterns; disk changes under an edited deck prompt rather than overwrite.
- Clip length cap of 60 seconds for rips.
- Library default location `~/Algobooth/library`.
- Mac only in version one, Apple Silicon, ad-hoc signed for Tom's laptop only.
- PyTorch and Demucs weights download once on first rip; everything else ships in the app.
- The Claude tidy pass is optional and off by default.
