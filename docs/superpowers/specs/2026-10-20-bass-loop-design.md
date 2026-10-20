# Bass loop: transcription, loop finding and backtest

Date: 2026-10-20. Builds on the rip pipeline in `2026-10-19-algobooth-design.md` and the plan
`docs/superpowers/plans/2026-10-19-rip-pipeline.md`. Everything here lives in `service/` (Python, package
`algorip`) except one vitest guard and two fields on the Rip tab.

## Intent

The `bass:` line of a rip should be the loop the track actually plays, written as short as it can be,
with a number next to it saying how well it matches the stem. Today the bass is whatever Basic Pitch
returns, bar by bar: on the first real clip (Solomun, 129 bpm, G minor, 9 bars) it found 3 notes per bar
where the stem plays 9, invented a D3 that is not there, and gave a different answer for bars that are
audibly identical, so the generator wrote all nine bars out verbatim.

A quick look at that stem with a pitch tracker (pyin) and the energy of each 16th step showed the
truth is simple: one bar, repeated, `~ ~ g1 g1 ~ g1 ~ g1 ~ ~ g1 g1 ~ g1 g1 g2`, identical in bars 0–3;
bars 4–8 keep those nine hits and fill the gaps in until bar 7 is G1 on every step (a build: a second
layer stacked under an unchanged loop). The design makes that reading the pipeline's reading.

## Goals

- The bass line is the loop, found by testing which period the bars repeat at, and nothing else plays.
- Where some bars add material on top of the loop, that material is offered as a second, muted line
  the user can switch on, with a comment saying which bars it came from. It is never folded into the loop.
- Every rip reports how well the loop matches the stem (a 0–1 score shown on the Rip tab), computed
  against the stem's own pitch track, independently of the transcriber.
- The pipeline can be backtested: real clips' per-step grids are fixtures (derived data, not audio), and
  synthetic basslines with known notes round-trip through the whole chain.
- The written mini-notation provably plays the loop: a vitest test evaluates the generated line with the
  real Strudel packages and compares the queried events with the loop.

## Non-goals and anti-goals

- Melody and chords are untouched: melody stays on Basic Pitch, chords on chroma. Only the bass changes.
- No audio rendering of Strudel for comparison (no offline web audio, no Python synthesis of the result).
  The comparison is symbolic: notes against a pitch track.
- No Claude in this loop. Everything is deterministic. The pitch tracker is the only slow part: it must
  take under 5 s for a 60 s clip (settings below); the loop finder, scorer and writer are well under a second.
- Anti-goal: a longer, "more faithful" bass line. If a candidate scores a few points better but reads
  longer, the shorter one wins (see Simplicity below).
- Anti-goal: `.orbit()` anywhere in generated code. Orbits are the app's deck channels.

## Constraints

- Python 3.11, numpy/scipy/librosa already pinned; `mir_eval` 0.8.2 is already in the lock (a Basic Pitch dependency) and becomes a direct dependency in `pyproject.toml`.
  No new native dependencies. The test suite keeps `--disable-socket`.
- Wire types change additively (`Analysis` gains fields); the TypeScript mirror in `app/src/rip/ripApi.ts`
  follows. Existing golden tests must still pass or be regenerated deliberately with a stated reason.
- Generated code keeps the named-line convention (`bass:`, muted lines `_name:`); the Strudel transpiler
  turns `name:` into `.p('name')`, verified.
- Copyrighted audio is never committed. Fixtures from real clips are the derived per-step grids as JSON.

## The parts

### 1. Bass grid: pitch and energy per step (replaces Basic Pitch for bass)

New module `algorip/bassgrid.py`. Input: the bass stem (mono, SR) and the `Grid`. Output: a
`BassGrid` with, per bar and 16th step, the step's pitch (midi int, or none when unvoiced or quiet) and
whether a note *starts* on that step.

- Pitch: the stem resampled to 11025 Hz (a bass fundamental is under 400 Hz, and pyin's cost scales with
  samples times frame length), then `librosa.pyin` (fmin 30 Hz, fmax 400 Hz, frame 2048, hop 256, so a
  frame every 23 ms, about five per 16th at 129 bpm). Measured at 44.1 kHz with a 4096 frame it took
  9 s for 17 s of audio, which is too slow; the builder times the reduced settings and, if a 60 s clip is
  still over 5 s, tracks pitch only over regions whose RMS is above the floor. Per step the pitch is the
  median midi of the voiced frames inside the step; a step is pitched only when at least a third of its
  frames are voiced and its RMS is above a floor (0.02 of full scale worked on the Solomun stem; make it
  a module constant, measured relative to the stem's peak RMS so quiet stems still work).
- Onsets: a note starts on a step when the step is pitched and either the previous step is unpitched,
  the pitch class differs from the previous step, or `librosa.onset.onset_strength` has a peak inside
  the step above a threshold (module constant; the Solomun bass retriggers G1 on consecutive 16ths and
  the drops between hits are plain in the RMS, so the threshold must catch those).
- `grid_to_notes(bass_grid) -> list[Note]` turns it into the existing `Note(bar, step, length, midi)`
  shape (a note runs from its start to the next start or the first unpitched step), snapped to the key
  with the existing `snap_to_key` and folded with `fold_octaves` as today. `transcribe_bass` in
  `bass.py` switches to this; the `predict` parameter is kept for the melody path only.
- `harmonic_ratio` (the sawtooth/triangle/sine choice) is unchanged and still measures the stem over
  the transcribed notes.

### 2. Loop finder

New module `algorip/loop.py`, used for bass only in this design but written over the generic per-bar
`dict[int, value]` shape `mini.consensus` already uses, so drums can adopt it later.

- Candidate periods: 1, 2, 4 bars, and 8 when the clip has at least 16 bars. For each period, the
  template is the per-phase majority vote over all bars at that phase, on (step → pitch class), exactly
  as `consensus()` votes today.
- Agreement of a bar with its template: the share of steps occupied in either where both hold the
  same value (`_agrees` today, but returning the share, not a yes/no).
- Core bars are those whose agreement is at least `LOOP_AGREE = 0.8`; deviating bars are the rest. The
  loop is the shortest period for which at least `LOOP_CORE_SHARE = 0.4` of the bars are core bars and
  at least 2 bars are core (0.4, not a half: the Solomun clip has four core bars of nine). If no period qualifies, there is no loop: the bass is written out as today.
  (The difference from today's `consensus`, which demands that *every* bar agree, is what lets the
  Solomun loop through: bars 4–8 deviate and must not veto bars 0–3.)
- The vote runs twice: once over all bars to find the core bars, then again over the core bars alone to
  make the template, after which core and deviating bars are recomputed against that template. (On the
  Solomun clip five of nine bars are build bars; a single all-bars vote would put the build's extra hits
  into the template and the loop would lose its gaps.)
- Result: `Loop(period, templates: list[dict[int, Note]], core: list[int], deviating: list[int])`.
  Template notes are picked as `_template_note` does today (commonest (midi, length) among core bars).
- The layer: for the deviating bars, the notes on steps where the template is silent or holds a
  different pitch class. These are reduced to their own loop the same way (period 1 first), giving
  `Loop.extra: list[dict[int, Note]] | None` and the bar range they came from. If the extra material is
  on fewer than `LAYER_MIN_STEPS = 4` steps per bar on average, it is noise, and there is no layer.

### 3. Generated code

In `generate.py`:

- `bass: note("...")...` is the loop's templates through `notes_mini`'s bar writer and `cycle`, so a
  one-bar loop is one bar of notation, a two-bar loop is `<[...] [...]>`.
- When there is a layer: a second line, muted, directly under the bass line:
  `_bass2: note("...").s(<bass sound>)<same lpf>.gain(0.6)` preceded by a comment line
  `// bars 5–9 add this under the bass (a build): remove the underscore to hear it`. Bar numbers in the
  comment are 1-based and are the deviating range as the listener counts it.
- Rhythm notation: a run of consecutive 16ths on one pitch that retrigger (each a note start) is written
  with `*` when a whole beat group is one pitch (`g1*4`), otherwise as today. A full bar of one pitch is
  `g1*16`. This needs a small addition to `notes_bar_mini` (a group whose four slots all start the same
  pitch); nothing else in the writer changes.

### 4. Scorer and the match number

New module `algorip/score.py`, using `mir_eval`.

- Truth: the `BassGrid` (pitch per step, starts). Candidate: a list of notes expanded over all the clip's
  bars (the loop repeated; for the layer check, loop plus layer).
- Frame score: over the steps where either truth or candidate is pitched, the share where both are
  pitched and agree on pitch class (octave-insensitive, since the bass register fold is deliberate).
- Onset score: `mir_eval.transcription.precision_recall_f1_overlap` with onsets converted to seconds
  on the grid, onset tolerance half a step, pitch tolerance one semitone after folding, offset ignored
  (`offset_ratio=None`). The F1 is used.
- `bass_match = 0.5 * frame + 0.5 * onset_f1`, rounded to 2 decimals. It is computed for the loop
  alone (what the generated `bass:` line plays). When there is a layer, a second score is computed for
  what the code plays with the layer unmuted: both lines stacked over every bar, so on each step the
  candidate holds the set of pitch classes of the template and the layer, a truth step agrees when its
  pitch class is in that set, and the onsets are the union of both lines' starts. The layer's comment
  reports both numbers.
- `Analysis` gains `bass_loop: BassLoop | None`, where `BassLoop` has `period: int`, `templates:
  list[list[Note]]` (one list per phase, bar-relative), `layer: list[list[Note]] | None`, `layer_bars:
  tuple[int, int] | None` (1-based inclusive, the deviating range), `match: float` and
  `match_with_layer: float | None`. `Analysis.bass` keeps the raw per-bar notes from the grid, so the
  verbatim fallback, `harmonic_ratio` and the sound rules work as before. `generate` writes the loop from
  `bass_loop` when it is present and `bass` as today when it is null, so the existing goldens' analysis
  files gain `"bass_loop": null` and their output is unchanged. `ripApi.ts` mirrors the new type; the Rip
  tab's analysis line becomes `tempo 129 · key G minor · 4/4 · 9 bars · bass loop 1 bar · match 0.92`
  (the bass part omitted when there is no loop).

### 5. Simplicity: the candidate search

Before scoring, the loop is written in a few ways and the shortest acceptable one wins:

- Candidates: (a) the loop as heard on the 16th grid; (b) the same on an 8th grid (starts on odd steps
  moved to the nearest even step, merging with a neighbour of the same pitch, dropped if that leaves
  them nowhere); (c) sustained instead of retriggered (consecutive starts on one pitch merged into one
  note); (d) both b and c.
- Each candidate's notation is produced and its `bass_match` computed. The winner is the candidate with
  the fewest characters of mini-notation among those scoring within `SIMPLER_TOLERANCE = 0.05` of the
  best; ties go to the earlier letter. The reported `bass_match` is the winner's.
- The Solomun loop must come out as (a): its 16th-note retriggers are the groove and (c) would score
  well below it on onsets.

### 6. Round-trip guard (vitest)

`app/src/rip/roundtrip.test.ts`: for each golden under `service/tests/golden/` that has a
`<name>.bass-events.json` (written by a pytest from `bass_loop` for every golden whose analysis has one:
one entry per note of the loop as `{cycle, step, length, note}` over `period` cycles), read the
`.strudel` file's `bass:` line. Evaluate the
line's mini-notation with `@strudel/mini` and `@strudel/core` (as the editor tests already do, under the
kabelsalat stub), query `period` cycles, and assert the events match: same note names at the same
`cycle + step/16` positions with the same durations in steps. This proves any change to the writer
(including the `*` addition) still plays the loop it meant.

### 7. Fixtures and backtest

- Solomun becomes a full golden: `solomun.bassgrid.json` (the bass stem's per-step grid, pitch and
  starts, 9 bars), `solomun.analysis.json` (the whole analysis from the cached stems, with `bass_loop`
  filled in), `solomun.strudel` and `solomun.bass-events.json`, all generated once by a script under
  `service/scripts/` from the cached stems and committed; no audio is committed. A test runs the loop
  finder on the grid and asserts period 1 with core bars 0–3, the template above, a layer over bars
  5–9 (1-based), and that the generated `bass:` line is exactly
  `bass: note("[~ ~ g1 g1] [~ g1 ~ g1] [~ ~ g1 g1] [~ g1 g1 g2]").s("sawtooth").lpf(800)`
  (the sound and filter come from the existing sound rules on this stem; if they choose differently the
  test pins whatever they choose, with the note string fixed).
- Synthetic round trip: `tests/synth.bass_line` renders a known 2-bar loop for 8 bars, with a build layer
  added in bars 6–8 that includes a full beat of retriggered 16ths on one pitch (so the `*` form is
  exercised); the audio goes through `bassgrid`, the loop finder and the generator, and the test asserts
  the period, the template notes, the layer and a `bass_match` above 0.9. This case also becomes a golden
  (`build.*`), so the vitest guard covers the `*` writer path. A second synthetic case with no repetition
  (4 different bars) asserts "no loop" and the verbatim fallback.
- The script that builds the fixture files from any cached stem is the backtest entry point for future
  clips: run it on a rip's stems, look at the grid, commit the files with the expected loop.

## Decided for the builder

- Thresholds above (`LOOP_AGREE`, `LOOP_CORE_SHARE`, `LAYER_MIN_STEPS`, `SIMPLER_TOLERANCE`, the RMS
  floor and pyin settings) are module constants with the values given; tuning them on more clips is
  later work and must come with a fixture.
- The layer line's name is `_bass2`; the melody keeps its name; nothing is renamed.
- `mir_eval` is used for the onset F1 only; the frame score is a few lines of numpy.
- The loop, the layer and both scores are found in the analyse stage and travel in `Analysis.bass_loop`;
  `generate` stays a pure function of `Analysis`, as the goldens require.
- The Solomun fixture's expected strings are the authority where this document and the spike's figures
  disagree; the builder regenerates the grid from the cached stem and reads it.

## Left to the builder

- The exact onset-strength threshold and how the peak is found inside a step.
- How `notes_bar_mini` detects a `*`-able group, as long as the round-trip guard passes.
- Whether `loop.py` replaces `mini.consensus` for drums now or later (later is fine; the drum goldens
  must not change in this work).
