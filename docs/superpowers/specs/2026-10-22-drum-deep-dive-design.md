# Drum deep dive: the kick is the beat, the kit is chosen by shape, the voices sit at the stem's levels

Date: 2026-10-22. Follows `2026-10-22-bass-tone-design.md`; the same method (measure every part against
the stem once its loop has landed, redesign from the numbers), applied to the drums and hats of the
48:50 Solomun clip, checked against the 36:40 clip. Tom: "do the deep dive on the drums and hats".

## What the stem plays, and what the rip writes

| part | 48:50 drum stem | the rip |
|---|---|---|
| grid | every kick lands 2.3 steps after the grid's beat, all 22 within 0.1 step of each other; the open hats 2.0 steps before each kick (the offbeat 8ths); the bass 1.1 steps before the kick on beat 1 and 2.0 steps after it elsewhere | kicks on steps 2, 6, 10, 14: `[~ bd]*4`, hats on the beats, `four_on_the_floor` false, so the 808 kit and `sd` |
| kick | low band, about 48 Hz, held then cut: −12 dB at 100 to 200 ms, −20 at 110 to 215 ms, −30 within 20 ms more; little click (6 kHz+ 21 to 37 dB under the low band) | 909 `bd` is `Bassdrum-01.wav`: −12 dB at 30 ms, −20 at 35 ms. `Bassdrum-04.wav` (−12 at 110, −20 at 180) is the stem's shape |
| the hit on the kick | on two of the four beats a clap-shaped hit: 1 to 2.5 kHz sustained (−9 dB at 60 ms, −12 at 90), spectrum peaking at 1 to 1.5 kHz and falling 7 dB to 3–6 kHz, 17 dB under the kick's low band at its peak; on the other two beats only the kick's own click, 11 to 16 dB less at 1 to 2.5 kHz | `sd(2,8,1)` on the right beats, but named `sd` on the 808 (a snare; the stem's hit is a clap), at the sample's own level: 909 `Clap.wav` sits 9 dB under `Bassdrum-01`, so the clap comes out 8 dB too loud |
| open hats | the offbeat 8ths, every bar: 6 kHz+ peak −21 dB, 13 dB under the kick; −12 dB at 60 ms, −20 at 145, −30 at 390 | 909 `oh` is `Hat Open.wav`: −12 at 90 ms, −20 at 235, 7 dB under the kick sample: longer, 6 dB too loud. `oh02.wav` (−12 at 60, −20 at 155) is the stem's shape |
| the 16th after the beat | a short tick on the 16th after beats 2 and 4 in most bars (12 hits): 6 kHz+ peak −39 dB, 18 dB under the offbeat hats, −12 dB at 40 ms | written as `oh` at full level in the hats line (`[oh ~ ~ oh]`), or as `hh` in the fills |
| the 6 kHz+ onset on every kick | 9 dB under the offbeat hats, the clap's air and the kick's click | dropped by D2's own-level rule (right) |

Every one of these is a timing or a sound-choice error, not a pattern error: the classifier hears the
right hits. The 36:40 clip's kicks sit 0.13 step from its beats, so its grid is right as it stands.

## Changes

1. **The kick is the beat** (`grid.py`, `drums.py`, `pipeline.py`). After the beat tracker's tempo and
   beats, the kick onsets (the low band's onsets, as `band_onsets` finds them) are read as phases
   within a beat, in steps. When at least `KICK_AGREEMENT = 0.75` of them lie within half a step of
   their circular mean, and that mean is more than `KICK_DEAD_ZONE = 0.5` step from the beat, every
   beat moves the shorter way onto the kicks (the tracker reads onsets a frame late on every clip; a
   grid within half a step of the kicks is left where the tracker put it, so a clip the tracker got
   right is unchanged). Then the downbeat among the four aligned beats: the low-band accent rule as now
   when one phase leads the others by `ACCENT_LEAD = 1` dB; when none does (four equal kicks), the
   backbeat decides: the phase with the most 1 to 6 kHz energy in the 100 ms after its beats, summed
   over the clip, is beat 2 or 4, and of the two downbeats that allow, the earlier. The downbeat rule
   runs on every clip, moved or not: where one phase leads by a decibel it is the old argmax (36:40's
   phases spread 2 dB, the synthetic click track accents its downbeats), so only a clip with four
   equal kicks sees the backbeat test. The bar count is recomputed from the moved downbeat. `band`/`band_onsets` move to `algorip/onsets.py` (re-exported
   from `drums`) so `grid` can import them without a cycle.
   On 48:50: the beats move 197 ms earlier, the kicks land on steps 0, 4, 8, 12, `four_on_the_floor`
   is true, the kit is the 909, the clap falls on 2 and 4, and the bass line reads
   `[~ ~ ~ d#2] [~ ~ d#1@2] [~ ~ e3@2] [~ ~ d#2@2]`: a 16th pickup into beat 2, then the offbeat
   8ths. Its lengths are truer than before: the stem's notes last 1.3, 2.1, 2.1 and 2.2 steps (the
   old lines sat 0.2 step before each onset and read the note's fall into a third step, then needed
   `.clip(0.57)` to cut it back). On 36:40 nothing moves.
2. **The bass measurements find an onset just before the line** (`bass.py`). With the lines on the
   kicks, the bass onsets fall 12 ms before their step (the bass leads the kick), and `_sounding`,
   which starts at the note's line, read the filter already closing: the 1.7-octave opening and the
   240 Hz hold became no opening and 420 Hz. `_sounding` and `bass_envelope`'s onset search start a
   quarter step before the note's line when that quarter step is quiet (more than 6 dB under the
   note's loudest frame), and at the line otherwise (a legato or retriggered note's predecessor is
   loud there and must not be taken for the onset). The measurements themselves are unchanged.
3. **The kit's sample by shape** (`scripts/measure_kits.py` → `algorip/kits.json`, `sounds.py`,
   `generate.py`). A committed table of every sample in the two banks the rip writes (`tr909`,
   `tr808`, from `app/public/samples/tidal-drum-machines.json`): for each voice (`bd`, `sd`, `cp`,
   `hh`, `oh`) and index `n`, the file, the voice band's peak level (5 ms RMS, dB), and `fall_ms`, the
   time from that peak to 12 dB under it (the first 12 dB of the fall, which every voice reaches
   before the floor; the voice bands are the classifier's: kick under 150 Hz, snare and clap 1 to
   6 kHz, hats 6 kHz up). `drum_tone(drums, sr, hits, grid)` in `drums.py` measures the stem the same
   way: for each hit of each voice, the voice band's peak within half a step either side of the hit's
   grid time, its level and its `fall_ms`; medians over the voice's hits (`DrumTone`, on `Analysis`
   as `drum_tone`). `choose_sounds` picks, per voice, the bank sample whose `fall_ms` is nearest the
   stem's on a log scale (`drum_samples: dict[str, int]`, only entries with `n` other than 0), and
   `generate` writes the index inline, Strudel's `bd:3*4`, `[~ oh:2]*4`, `cp:4(2,8)`. The ghost voice
   chooses from the closed-hat list by its own fall time. The kick's pitch (48 Hz against the 909's
   55 to 60) is measured and reported, not written.
   Measured: 48:50 kick `fall_ms` about 150 → `bd:3`; hats 62 → `oh:2`; clap 65 → `cp:4` (45; the
   909's claps all fall in 30 to 45 ms). 36:40 kick 35 → `bd:0`: its line keeps `bd`.
4. **Each voice at the stem's level** (`sounds.py`, `generate.py`). The kick is the reference. For
   every other voice, the stem's level relative to the kick (the voice band's median peak less the
   kick's) is compared with the chosen samples' (the sample's band peak less the chosen kick sample's),
   and the difference becomes the line's gain: `0.8 × 10^(diff/20)` (Strudel's default gain is 0.8 and
   the curve is linear), two decimals, written only when it is 2 dB or more from the default, never
   above 1. Since gains are per line, the lines become one per voice:
   `drums:` the kick; `claps:` (or `snare:` on the 808) the snare voice; `hats:` closed and open hats;
   `ghosts:` (change 5); `_fills:` as now, all voices, no gain. A line holding two voices (hats with
   both `hh` and `oh`) takes the gain of the voice with more hits on it; the ghosts' gain is read
   against the ghost sample. The 36:40 line
   `drums: s("bd*4, [cp ~ cp ~] ...")` therefore splits into `drums:` and `claps:`.
   Measured on 48:50 with `bd:3`, `oh:2`, `cp:4`: hats about −4 dB (gain 0.5), clap about −8 dB
   (gain 0.32).
5. **Ghost hats** (`drums.py`, `drumloop.py`, `generate.py`). A hat that is not on a kick or a snare
   and whose level over the hat band's floor is more than `GHOST_DB = 12` under the median of the
   other such hats (closed and open pooled, since D3 has not yet split them; the test runs in
   `classify_drums` before D3) is a ghost: voice `gh`, written with the closed-hat sample on its own
   `ghosts:` line at its measured gain (change 4), looped like any voice by `drum_loops`. Its strays
   are dropped, not written as fills. Measured on 48:50: the offbeat hats sit 24 to 26 dB over the
   floor, the 16th ticks 6 to 10 (the split is 15 dB wide); no other hat lies between. The hats line
   becomes `[~ oh:2]*4`.

## Non-goals

- No per-hit gains or sample choices; one per voice, as for the bass.
- No pitch (`.speed`) on the kick, no EQ on the hats (the stem's hat centroid is 4.5 kHz against the
  909's 6 kHz, but a separated stem's highs are not to be trusted to a filter setting).
- The Rip tab's drum summary is unchanged; `ripApi.ts` mirrors the new `SoundChoice` and `Analysis`
  fields and the rip test fixtures carry them.
- `FILL_MIN_HITS`, the fills line and the drum classifier's rules D1 to D4 are unchanged.

## Goldens

The patterns below are requirements (which steps each line plays); the sample indices, gains, match
and the 197 ms are the measurements' predictions, and the build regenerates the goldens with
`scripts/bass_fixture.py` and records what they came to. The 36:40 lines keep their patterns
byte-identical (its grid cannot move: 0.13 step is inside the dead zone, and its accents spread 2 dB);
its hats line may gain an index and a gain like any other.

- `solomun2` (48:50): the grid's downbeat moves 197 ms earlier; `drums: s("bd:3*4").bank("tr909")`,
  `claps: s("[~ cp:4]*2").bank("tr909").gain(0.32)` (values as the build measures them),
  `hats: s("[~ oh:2]*4").bank("tr909").gain(0.5)`, a `ghosts:` line on the 16ths after beats 2 and 4,
  the bass `[~ ~ ~ d#2] [~ ~ d#1@2] [~ ~ e3@2] [~ ~ d#2@2]` with the filter envelope recovered by
  change 2 and whatever gate the truer lengths leave; the drum match stays 0.93.
- `solomun` (36:40): grid, hats and bass lines byte-identical; `drums:` splits into `drums:` and
  `claps:` with the measured indices and gains.
- `build` (synthetic): the kit's shortest samples (its 10 ms ramps); gains as measured on the
  synthetic kit; lines split the same way.

## Decided

- The kick defines the beat; a kick on every offbeat 8th is indistinguishable from a half-beat grid
  error and is read as the beat, since that is what a listener hears.
- The dead zone is half a step: a well-tracked clip's grid does not move.
- Sample choice is by the first 12 dB of the fall alone; level is matched by gain, not by sample.
- Lines are one per voice so each can carry its gain; the fills line carries none.
