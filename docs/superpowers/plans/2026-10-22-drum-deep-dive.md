# Drum deep dive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native) or superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The grid sits on the kicks, each drum voice plays the bank sample shaped like the stem's at the stem's level, and quiet ghost hats get their own line.

**Architecture:** `grid.estimate_grid` aligns the tracker's beats to the kick onsets and picks the downbeat by accent or backbeat; `drums.drum_tone` measures each voice's level and fall on the stem; a committed `kits.json` (built by a script from the app's sample packs) gives the same measures for every 909/808 sample; `sounds.choose_sounds` matches them into `drum_samples` and `drum_gains`; `generate.drum_lines` writes one line per voice with inline indices and per-line gains. `classify_drums` routes quiet hats to a `gh` voice. `bass._sounding`/`bass_envelope` look a quarter step before the line for the onset.

**Tech Stack:** Python 3.11, numpy, librosa, scipy, pydantic (service); TypeScript mirror in `app/src/rip/ripApi.ts`.

**Spec:** `docs/superpowers/specs/2026-10-22-drum-deep-dive-design.md`

## Global Constraints
- Suites: `cd service && uv run pytest -q`; `cd app && pnpm exec vitest run --clearCache && pnpm exec vitest run`; `pnpm exec tsc --noEmit -p .`.
- Constants with the spec's names and values: `KICK_AGREEMENT = 0.75`, `KICK_DEAD_ZONE = 0.5` (steps), `ACCENT_LEAD = 1.0` (dB), `GHOST_DB = 12.0`, `GAIN_WRITE_DB = 2.0`, Strudel default gain `0.8`, gain cap `1.0`, fall measured to −12 dB, bands kick <150 Hz, snare/clap 1–6 kHz, hats >6 kHz, onset look-back a quarter step when that quarter is 6 dB under the note's loudest.
- The 36:40 golden's grid and every line's pattern stay byte-identical; only `:n` indices, `.gain()` and the `drums:`/`claps:` split may change.
- Trailer on every commit, exactly: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never commit audio.
- Stay in `service/`, `app/src/rip/*`, goldens, docs (a parallel session owns `app/src/booth/*`, `app/src/library/api.ts`, `src-tauri/*`).

## Review Focus
- Kicks on every offbeat 8th with no on-beat kick: read as the beat (aligned), not left. Task 1.
- A clip whose kicks disagree (breakbeat, under 75% within half a step of the mean): the grid does not move. Task 1.
- Aligning forward past the clip's end must not produce a zero-bar grid: the shorter way is taken and bars recomputed; a grid that would lose its only bar keeps the tracker's beats. Task 1.
- A voice with no hits in the stem (no snare) gets no sample, no gain and no line; a stem with no kick gets no gains at all (no reference); a voice with hits but a fall that never reaches −12 dB before the next hit uses the time to the next hit. Task 4.
- A legato bass note (its predecessor loud a quarter step before the line) keeps its onset at the line. Task 2.

---

### Task 1: the kick is the beat (`grid.py`, `onsets.py`)

**Files:**
- Create: `service/algorip/onsets.py` (move `band`, `_rms_envelope`, `_peak_rms`, `_detect`, `_lead_in`, `band_onsets` and their constants out of `drums.py`; `drums.py` imports and re-exports them so every existing import keeps working)
- Modify: `service/algorip/grid.py` (`downbeat_phase`, `estimate_grid`), `service/algorip/drums.py`
- Test: `service/tests/test_grid.py`

**Interfaces:**
- Produces: `align_beats_to_kicks(beats: np.ndarray, drums: np.ndarray, sr: int, bpm: float) -> np.ndarray` (the beats moved onto the kicks, or unchanged); `downbeat_phase(drums, sr, beats) -> int` with the new tie-break; `estimate_grid(mix, drums, sr, duration)` unchanged signature, calls both when `drums` is given.

- [ ] **Step 1: failing tests** in `test_grid.py`, using `tests.synth.drum_loop` (HOUSE from `test_drums.py`: kicks on 0,4,8,12, claps on 4,12) at 124 bpm, 4 bars:

```python
def test_beats_half_a_beat_off_move_onto_the_kicks():
    y = drum_loop(HOUSE, 124, 4); beat = 60 / 124
    beats = np.arange(16) * beat + 0.6 * beat          # the tracker locked on the offbeat hats
    aligned = align_beats_to_kicks(beats, y, SR, 124)
    assert np.allclose(aligned % beat, 0.0, atol=0.02) or np.allclose(aligned % beat, beat, atol=0.02)

def test_beats_a_frame_late_are_left_alone():
    beats = np.arange(16) * beat + 0.03                # 30 ms, under half a step (121 ms)
    assert align_beats_to_kicks(beats, y, SR, 124) is beats or np.array_equal(..., beats)

def test_disagreeing_kicks_do_not_move_the_grid():   # breakbeat: kicks on 0, 10 | 0, 6, phases spread
def test_four_equal_kicks_put_the_claps_on_two_and_four():
    # HOUSE with claps on steps 4 and 12, beats exactly on the kicks, no accent: phase 0 (the earlier of 0 and 2)
    assert downbeat_phase(y, SR, beats) == 0
    # the same loop with the claps on steps 0 and 8: phase 1
def test_an_accented_downbeat_still_wins():          # click_track accents: the old argmax (existing test stays green)
def test_estimate_grid_aligns_a_late_grid():        # estimate_grid on drum_loop(HOUSE) preceded by 0.6 beat of silence puts kicks on step 0 of each bar: classify_drums(...)["bd"] == {(b, s) for b in range(4) for s in (0,4,8,12)}
```

- [ ] **Step 2: run, see them fail** (`align_beats_to_kicks` undefined).
- [ ] **Step 3: implement.** `onsets.py` first (pure move; `uv run pytest -q tests/test_drums.py` green). Then in `grid.py`: kick onsets = `band_onsets(drums, sr, None, 150.0)`; phases `((t - beats[0]) / beat) % 1` in beats; circular mean via `np.angle(np.mean(np.exp(2j*np.pi*phase)))`; agreement = share within `0.5 * step` (`step = beat / 4`) of the mean; move by the signed mean in `(-0.5, 0.5]` beats when agreement ≥ `KICK_AGREEMENT` and `|mean| > KICK_DEAD_ZONE` steps. `downbeat_phase`: low-band scores as now; if `max/second-max ≥ 10**(ACCENT_LEAD/20)` return argmax; else 1–6 kHz band (`band(drums, sr, 1000., 6000.)`) RMS over 100 ms after each beat per phase; backbeat `b = argmax`; the two downbeats that put `b` on beat 2 or 4 are `(b - 1) % 4` and `(b - 3) % 4`; return the smaller. `estimate_grid`: beats → align (when drums given) → phase → bars; if `bars < 1` after the move, fall back to the unmoved beats.
- [ ] **Step 4: run** `uv run pytest -q tests/test_grid.py tests/test_drums.py`: PASS.
- [ ] **Step 5: commit** `The kick is the beat: the grid's beats move onto the kicks and the backbeat picks the downbeat among equal kicks`.

### Task 2: the bass onset a quarter step before the line (`bass.py`) — built, then withdrawn at review (see the spec's change 2)

**Files:** Modify `service/algorip/bass.py` (`_sounding`, `_note_filter`, `bass_tone`, `bass_envelope`); `service/tests/synth.py` (`filtered_bass` accepts a negative `onset_lag_seconds`: the note is placed earlier, clipped at 0); Test `service/tests/test_bass.py`.

**Interfaces:** `_sounding(x, sr, lead: int = 0)`: `lead` frames of `x` precede the line; the onset search starts at 0 when every frame in `x[:lead]` is more than `ONSET_WITHIN_DB` under the loudest, else at `lead`. `bass_tone`/`bass_envelope` cut each note's span from `start - grid.step_seconds / 4` and pass the lead.

- [ ] **Step 1: failing tests**: `test_a_note_starting_just_before_its_line_keeps_its_filter_opening` (filtered_bass with `onset_lag_seconds=-0.012`, open 2000 Hz, hold 300: `bass_tone(...).open_hz / hold_hz >= 2**1.0` as the existing lagged test asserts for +lag); `test_a_note_after_a_held_note_takes_its_onset_at_the_line` (bass_line with notes `(0,0,4,m)` and `(0,4,4,m)` back to back: `bass_envelope` attack within 5 ms of the single-note value).
- [ ] **Step 2: fail.** **Step 3: implement.** **Step 4:** `uv run pytest -q tests/test_bass.py` PASS. **Step 5: commit** `The bass measurements find an onset a quarter step before the line`.

### Task 3: the kit table (`scripts/measure_kits.py`, `kits.json`, `kits.py`)

**Files:** Create `service/scripts/measure_kits.py`, `service/algorip/kits.json`, `service/algorip/kits.py`; Test `service/tests/test_kits.py`.

**Interfaces:** `kits.json`: `{"tr909": {"bd": [{"n": 0, "file": "Bassdrum-01.wav", "level_db": -3.9, "fall_ms": 30}, ...], "sd": [...], "cp": [...], "hh": [...], "oh": [...]}, "tr808": {...}}`. `kits.py`: `KitSample(n: int, file: str, level_db: float, fall_ms: float)`; `kit_samples(bank: str, voice: str) -> list[KitSample]`; `nearest_sample(bank: str, voice: str, fall_ms: float) -> KitSample` (nearest `|log(fall)|`; ties to the lower `n`); `VOICE_BANDS = {"bd": (None, 150.), "sd": (1000., 6000.), "cp": (1000., 6000.), "hh": (6000., None), "oh": (6000., None)}` shared with Task 4.

- [ ] **Step 1: failing tests**: `nearest_sample("tr909","bd",150).n == 3`, `("tr909","bd",35).n == 0`, `("tr909","oh",62).n == 2`, `("tr909","cp",65).n == 4`, `("tr808","hh",40).n == 0`; `len(kit_samples("tr909","sd")) == 16`; every entry's `fall_ms > 0`.
- [ ] **Step 2: fail.** **Step 3: implement** the script: reads `app/public/samples/tidal-drum-machines.json` (path relative to the repo root, `RolandTR909_bd` → `tr909`/`bd`), each wav via soundfile (mono mean), band via `onsets.band`, 5 ms RMS envelope, `level_db` = 20·log10 of the band peak, `fall_ms` = ms from the peak to the first frame 12 dB under it (the last frame if never); writes the json sorted. Run it: `uv run python scripts/measure_kits.py`. Loader reads the json beside it once (`functools.cache`).
- [ ] **Step 4:** `uv run pytest -q tests/test_kits.py` PASS. **Step 5: commit** `A table of every 909 and 808 sample's level and fall, and the nearest by shape` (json included).

### Task 4: the stem's drum tone (`drums.py`, `schema.py`)

**Files:** Modify `service/algorip/drums.py`, `service/algorip/schema.py` (`DrumTone(levels: dict[str, float], falls: dict[str, float])`; `Analysis.drum_tone: DrumTone | None = None`); Test `service/tests/test_drums.py`.

**Interfaces:** `drum_tone(drums: np.ndarray, sr: int, hits: DrumHits, grid: Grid) -> DrumTone | None` (None when no voice has a hit). Per voice with hits: band from `kits.VOICE_BANDS` (`sd` for the snare voice, `hh` for `gh`); per hit, the band's 5 ms RMS peak within `[t - step/2, t + step/2]` of `grid.time_of(bar, step)`, its dB, and its fall to −12 dB (cut at the voice's next hit; the time to that hit if never reached); medians.

- [ ] **Step 1: failing tests**: `test_drum_tone_reads_each_voices_fall` (drum_loop with bd (0.15 s sweep, `_decay`) and oh (0.3 s) and hh (0.03 s) → `falls["oh"] > falls["hh"]`, `30 <= falls["bd"] <= 150`); `test_drum_tone_levels_follow_the_mix` (`drum_loop({"bd":...}) + 0.3 * drum_loop({"oh":...})` vs both at 1.0: `levels["oh"] - levels["bd"]` differs by 10.5 ± 1 dB); `test_drum_tone_is_none_without_hits`.
- [ ] **Step 2–5** as above; commit `The drum stem's level and fall per voice`.

### Task 5: samples and gains (`sounds.py`, `schema.py`)

**Files:** Modify `service/algorip/sounds.py`, `service/algorip/schema.py` (`SoundChoice.drum_samples: dict[str, int] = {}`, `SoundChoice.drum_gains: dict[str, float] = {}`); Test `service/tests/test_sounds.py`.

**Interfaces:** `choose_sounds(a)`: for each voice in `a.drum_tone.falls`: list = `kit_samples(bank, "cp"/"sd" for "sd" per `snare_name`; "hh" for "gh"; else the voice)`; `n = nearest_sample(...).n`, stored when `n != 0`. Gains, kick as reference (`kick = nearest for "bd"`, or the bank's `bd` n=0 when the stem has no kick): `diff = (levels[v] - levels["bd"]) - (sample.level_db - kick.level_db)`; `gain = min(1.0, round(0.8 * 10**(diff/20), 2))`; stored when `|diff| >= GAIN_WRITE_DB`. Pure functions `sample_for(bank, voice, snare_name, fall_ms) -> int` and `gain_for(diff_db) -> float | None` for the tests.

- [ ] **Step 1: failing tests** with a hand-built `Analysis` (`drum_tone=DrumTone(levels={"bd": -8, "oh": -21.5, "sd": -25}, falls={"bd": 150, "oh": 62, "sd": 65})`, 909/house): `drum_samples == {"bd": 3, "oh": 2, "sd": 4}`; `drum_gains["oh"] == pytest.approx(0.52, abs=0.03)` and `drum_gains["sd"] == pytest.approx(0.32, abs=0.03)`; a voice within 2 dB has no gain; `gain_for(+6) == 1.0`; no `drum_tone` → both empty.
- [ ] **Step 2–5**; commit `Each drum voice plays the bank sample shaped like the stem's, at the stem's level`.

### Task 6: ghosts, one line per voice, inline indices (`drums.py`, `drumloop.py`, `generate.py`)

**Files:** Modify `service/algorip/drums.py` (`VOICES = ("bd","sd","hh","oh","gh")`, ghost test before D3), `service/algorip/drumloop.py` (`VOICE_LINES = {"drums": ("bd",), "snare": ("sd",), "hats": ("hh","oh"), "ghosts": ("gh",)}`; `gh` fills cleared before the `FILL_MIN_HITS` count), `service/algorip/generate.py`; Tests `service/tests/test_drums.py`, `test_drumloop.py`, `test_generate.py`.

**Interfaces:** `generate.drum_lines(a, s)`: label `"claps"` in place of `"snare"` when `s.snare_name == "cp"`; voice name written as `f"{name}:{n}"` when `n = s.drum_samples.get(voice)` is set (`gh` writes `hh`); each line ends `.bank(...)` then `.gain(g)` when `g` for the line's main voice (most hits on the line) is in `s.drum_gains`; the fills line has no gain and no `gh` hits. In `classify_drums`: among kept hats not on a kick or snare, `median_over = median(over)`; a hat with `over < median_over - GHOST_DB` goes to `"gh"` (both shared and unshared hats are tested against the unshared median; a lone hat is never a ghost).

- [ ] **Step 1: failing tests**: `test_quiet_sixteenth_hats_are_ghosts` (HOUSE's oh on step 14 plus `0.1 * drum_loop({"hh": {(b, 13)...}})`: step 13 in `hits["gh"]`, not in `hh`/`oh`; the open hats unchanged); `test_ghost_strays_are_not_fills`; `test_drum_lines_are_one_per_voice_with_indices_and_gains` (`drums: s("bd:3*4").bank("tr909")`, `claps: s(...).bank("tr909").gain(0.32)`, `hats: ...gain(0.52)`, `ghosts: s("[~ ~ ~ hh:1]*4")...gain(0.07)`; `_fills` line without `.gain(`); `test_the_snare_line_is_named_snare_on_the_808`; existing generate tests updated to the split lines.
- [ ] **Step 2–5**; commit `Ghost hats on their own line, one drum line per voice, the kit's index inline`.

### Task 7: wiring, mirror, goldens, docs

**Files:** Modify `service/algorip/pipeline.py` (`drum_tone=drum_tone(drums, SR, hits, grid)` into `Analysis`), `app/src/rip/ripApi.ts` (`Analysis.drum_tone: { levels: Record<string, number>; falls: Record<string, number> } | null`; `SoundChoice.drum_samples: Record<string, number>; drum_gains: Record<string, number>`), the rip test fixtures in `app/src/rip/*.test.ts(x)` (add `drum_tone: null`, `drum_samples: {}`, `drum_gains: {}`), `service/tests/test_fixtures.py`, goldens, `docs/handover-2026-10-21.md`, the spec's Goldens section, `README.md`/`service/README.md` drum paragraphs.

- [ ] **Step 1:** regenerate: `uv run python scripts/bass_fixture.py stems ~/Algobooth/cache/stems/6d44d581d8ad286f solomun --title "Solomun – Live at Alexandra Palace, London (2026) (Official Film)" --start 2200 --end 2220`, the same for `3dd127e18e1f4e87 solomun2 --start 2930 --end 2940`, and `synthetic build`; read the diffs against the spec's Goldens section. 36:40: grid, hats pattern and bass lines byte-identical apart from `:n`/gain and the `claps:` split; 48:50: `bd*4`-shaped kick line, claps on 2 and 4, `[~ oh:2]*4`, a `ghosts:` line, the bass `[~ ~ ~ d#2] [~ ~ d#1@2] [~ ~ e3@2] [~ ~ d#2@2]`. Where a prediction misses, investigate before accepting; record the outcome in the spec.
- [ ] **Step 2:** `test_fixtures.py`: solomun2 asserts `drums: s("bd:3*4").bank("tr909")`, a `claps:` line with `[~ cp` on beats 2 and 4, `hats: s("[~ oh:2]*4")`, a `ghosts:` line, the bass loop above; solomun keeps its existing assertions and gains `claps:` present and `bd*4` in `drums:`.
- [ ] **Step 3:** both suites and tsc green (Global Constraints). **Step 4:** docs. **Step 5: commit** `The drum deep dive lands: kick-aligned grid, shaped samples, levels and ghosts on both Solomun clips`.
