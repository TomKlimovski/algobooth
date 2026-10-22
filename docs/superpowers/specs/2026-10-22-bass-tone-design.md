# Bass tone: the clip's tuning, the chromatic note, the closing filter and the wobble

Date: 2026-10-22. Follows `2026-10-22-bass-deep-dive-design.md`. Tom, on the gated version of the
48:50 bass: raising the attack to a second "sounded closer", and the sound needs "a shaking, quaver",
which he called reverb. A sawtooth that never reaches full level is a quieter, darker tone; so the
tone was measured: tuning, partial pairs, amplitude wobble, and the filter's motion through each note.

## What the stem plays

| measurement | 48:50 Solomun bass |
|---|---|
| tuning | every note 32 to 55 cents flat of 440-tuning; beat 3's fundamental is 162.8 Hz, 21 cents flat of E3 and 79 cents sharp of D#3 |
| beat 3 | E3, not D#3: the tracker said E3 at 0.9 confidence; the key snap (D# minor has no E) moved it. D#2 D#1 E3 D#2 is a Phrygian figure |
| filter | every note opens bright (85% rolloff 1.7 to 9.6 kHz in the first 23 ms) and closes within about 120 ms to a very dark hold: h2 is 6 to 10 dB under h1, h3 14 dB, rolloff 150 to 600 Hz |
| wobble | the hold's level swings 5 to 10 dB; a periodic rate shows on beat 1 (about 8 Hz) and beat 3 (about 13 Hz), not on beats 2 and 4; the upper partials of beat 4 split into pairs a constant 10.8 Hz apart (a modulation, not detuned oscillators, whose spacing would grow with the harmonic) |

Our line: a sawtooth through a fixed `.lpf(800)`, no filter motion, no modulation, every note
rounded to the key.

## Changes

1. **Tuning and the chromatic note** (`bassgrid.py`, `bass.py`, `schema.py`). The grid keeps each
   step's fundamental in Hz beside its midi (pyin's median over the step's voiced frames, or the
   spectrum's reading). `transcribe_bass` estimates the clip's tuning as the median, over the loud
   steps, of each step's offset in cents from the nearest semitone (`Analysis.tuning_cents`), and
   rounds every step after removing it. The key snap then applies only to a step whose corrected
   pitch is still more than `SNAP_CENTS = 35` from a semitone (an ambiguous reading), never to a
   clear chromatic note: on 48:50 beat 3 becomes `e3`. The Rip tab analysis line gains
   `· tuning −35 cents` when the offset is 10 cents or more either way.
2. **A measured filter** (`bass.py`, `sounds.py`, `generate.py`). `bass_tone` measures, per note, the
   85% spectral rolloff over the first 25 ms (`open_hz`) and over the hold (`hold_hz`), and the time
   from the onset for the rolloff to settle within a quarter octave of the hold (`close_ms`); medians
   over the notes. `choose_sounds` writes `.lpf(hold_hz)` (rounded to 10 Hz, at least 100) instead of
   the fixed value, and when `open_hz` is at least an octave above the hold, `.lpenv(octaves)`
   (`log2(open/hold)`, one decimal) `.lpdecay(close_ms)` `.lpsustain(0)`, so the filter opens at the
   attack and closes to the hold the way the stem does. The sawtooth/triangle/sine choice by harmonic
   ratio is unchanged.
3. **The wobble as a tremolo** (`bass.py`, `sounds.py`, `generate.py`). `bass_tone` also measures,
   on each note's hold, the full-band RMS envelope on 5 ms frames; the strongest periodic rate
   between 5 and 20 Hz and that component's peak-to-trough depth in dB. When at least half the notes
   carry a component of `WOBBLE_DB = 3` dB or more, the clip gets `wobble_hz` (median rate) and
   `wobble_db` (median depth), and `choose_sounds` writes `.tremolo(rate).tremolodepth(depth)` with
   depth `1 - 10 ** (-wobble_db / 20)` (a 6 dB swing is 0.5). Found while building: on this clip no
   note carries one. Measured properly (the hold's 25% to 65%, 5 ms frames), the strongest periodic
   component on each note swings 2 to 4 dB at a rate that differs from note to note (7, 10, 8 Hz),
   and the 8 to 12 dB spread inside a hold is the filter still closing. The earlier 5 to 10 dB
   "wobble" was that closing and the gate seen through coarser frames. So the 48:50 lines get no
   tremolo; the machinery stays for a clip that does carry one, pinned by a synthetic 9 Hz, 6 dB test.
   The "shaking quaver" is most likely the filter's own motion, which change 2 now writes.

## Non-goals

- No per-note filter or tremolo; one clip-wide setting each, as for the gate.
- No global retuning of the written notes (Strudel plays at 440); the tuning is reported, not applied.
- The amplitude gate from the previous round stays as it is.

## Goldens

- `solomun2`: beat 3 becomes `e3`; the lines become
  `.lpf(450).lpenv(3.2).lpdecay(0.07).lpsustain(0).attack(0.021).clip(0.63).release(0.035)`; no
  tremolo. `tuning_cents` reads −9, not the −35 the spectrum shows: the grid's Hz come from pyin at
  a 0.2-semitone resolution, so each step's offset is quantised to 20-cent bins and the median lands
  on the nearest one. Good enough to keep E3 as E3 (a quarter tone from D#); the readout is coarse.
- `solomun` (36:40): the loop and its pitch classes unchanged; `.lpf(430)` from the measured hold
  instead of the fixed 800, no envelope (its opening settles in 40 ms: an onset click).
- `build`: synthetic, flat spectrum, a 10 ms ramp whose click read as a 3-octave opening closing in
  20 ms, which is why `choose_sounds` requires `FILTER_ENV_MIN_CLOSE_MS = 50`: `.lpf(430)`, no
  envelope, no tremolo.
