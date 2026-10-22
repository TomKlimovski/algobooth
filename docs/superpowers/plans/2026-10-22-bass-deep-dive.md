# Bass deep dive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The bass grid hears a loud note pyin calls unvoiced, and the bass lines carry a measured pluck envelope.

**Spec:** `docs/superpowers/specs/2026-10-22-bass-deep-dive-design.md`

## Global Constraints
- Suites: `cd service && uv run pytest -q`; `pnpm exec vitest run --clearCache && pnpm exec vitest run`; `pnpm exec tsc --noEmit -p .`.
- The 36:40 golden's grid and loop line stay byte-identical. Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus
- A quiet step (under the RMS floor) never gets a fallback pitch. Task 1.
- The fallback on a tone with a dominant second harmonic still reads the fundamental. Task 1.
- A flat synthetic note yields no envelope; a decaying one yields a decay near the synthesised value. Task 2.
- The envelope is written on `_bass2:` as well as `bass:`, and on the no-loop fallback line. Task 2.
- `ripApi.ts` mirrors the new fields so the Rip tab's typing stays honest. Task 2.

### Task 1: the spectral fallback (`bassgrid.py`)
- Tests first in `test_bassgrid.py`: `hps_midi(tone(D#2, harmonics 1..6), PYIN_SR) == 39`; a tone whose 2nd harmonic is twice the fundamental's amplitude still gives 39; a C1 (24) tone gives 24; `bass_grid` on a `tests.synth.bass_line` is unchanged against its current output (pyin confident). Watch them fail.
- Implement `hps_midi(y: np.ndarray, sr: int) -> int | None` (None when the window is too short) and the `PYIN_CONFIDENT` gate in `bass_grid`. Commit.

### Task 2: the envelope (`bass.py`, `schema.py`, `sounds.py`, `generate.py`, `ripApi.ts`)
- `tests/synth.py` gains `decaying_bass(notes, bpm, bars, decay_seconds)`: exponential fall of 60 dB over `decay_seconds` from each note's start (10 ms attack), cut at the note's end.
- Tests first: `bass_envelope` on `bass_line` gives `end_db > -3` and `choose_sounds` sets no envelope; on `decaying_bass(..., 0.3)` gives `decay_ms` within 30% of the time an exponential 60 dB/0.3 s fall takes to drop 12 dB (60 ms) and `end_db < -12`; `choose_sounds` sets `{attack: 0.01, decay: 0.06, sustain: ...}`; `generate` writes `.attack(0.01).decay(0.06).sustain(0.1)` on both lines. Watch them fail.
- Implement `BassEnvelope(attack_ms, decay_ms, end_db)` on `Analysis` (optional, default None), `bass_envelope`, `SoundChoice.bass_envelope: Envelope | None` with `Envelope(attack, decay, sustain)`, `choose_sounds`, `generate`'s suffix, the `_analyse` wiring, `ripApi.ts`. Commit.

### Task 3: goldens and docs
- Regenerate `solomun`, `solomun2`, `build` with `bass_fixture.py`; the other `.strudel` goldens through `generate`. Read the diffs: `solomun2` gains beat 4 and the envelope; `solomun`'s loop line unchanged. Add a `test_fixtures` assertion that `solomun2`'s loop line is `[~ d#2@2 ~] [d#1@3 ~] [d#3@3 ~] [d#2@2 ~ ~]` (as built; the envelope became a gate at review, see the spec). Both suites. README bass paragraph, `service/README.md`, handover. Commit.
