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
   step's fundamental in Hz beside its midi. pyin's bins are 0.2 semitones wide and start at `FMIN`,
   so they never sit on a semitone (an in-tune clip read +11); each pitched step's Hz is therefore
   re-read from its own spectrum (an 8192-point FFT over the step and half a step either side, the
   peak interpolated and the first three harmonics' peaks averaged), and kept only when it agrees
   with pyin's within `EXACT_TRUST_CENTS = 20` (on retriggered 16ths the smeared peak reads 27 cents
   sharp, which would otherwise pass as a clear note). `transcribe_bass` estimates the clip's tuning
   as the median, over the pitched steps, of each step's offset in cents from the nearest semitone
   (`Analysis.tuning_cents`); past `TUNING_WRAP_CENTS = 30` the offset is read both ways round the
   semitone (a record 40 cents sharp could be 60 flat of the next note) and the reading keeping more
   steps in the key wins, so a pitched-up record stays on its notes. Every step is rounded after the
   tuning is removed; the key snap then applies only to a step still more than `SNAP_CENTS = 35`
   from a semitone (an ambiguous reading), never to a clear chromatic note: on 48:50 beat 3 becomes
   `e3`. Starts are recomputed from the grid's retrigger flags plus every change of pitch class in
   the retuned midi, so a boundary the raw rounding split can merge again. The Rip tab analysis
   line gains `· tuning −35 cents` when the offset is 10 cents or more either way.
2. **A measured filter** (`bass.py`, `sounds.py`, `generate.py`). `bass_tone` measures, per note, the
   85% spectral rolloff over the two 10 ms frames from the note's onset (`open_hz`; the onset is the
   first frame within 6 dB of the note's loudest, since the grid line sits tens of milliseconds before
   the sound and the gap holds only bleed, whose broadband noise read as a three-octave opening in
   the first build), over the later part of its sounding frames (`hold_hz`, 60% to 90% of them, after
   the close and before the cut), and the time from the onset for the rolloff to settle within a
   quarter octave of the hold (`close_ms`); medians over the notes. `choose_sounds` writes `.lpf(hold_hz)` (rounded to 10 Hz, at least 100) instead of
   the fixed value, and when `open_hz` is at least an octave above the hold, `.lpenv(octaves)`
   (`log2(open/hold)`, one decimal) `.lpdecay(close_ms)` `.lpsustain(0)`, so the filter opens at the
   attack and closes to the hold the way the stem does. The sawtooth/triangle/sine choice by harmonic
   ratio is unchanged.
3. **The wobble as a tremolo** (`bass.py`, `sounds.py`, `generate.py`). `bass_tone` also measures,
   on each note's hold, the full-band RMS envelope on 5 ms frames; the strongest periodic rate
   between 5 and 20 Hz and that component's peak-to-trough depth in dB. When at least half the notes
   carry a component of `WOBBLE_DB = 3` dB or more, the clip gets `wobble_hz` (median rate) and
   `wobble_db` (median depth), and `choose_sounds` writes `.tremolo(rate).tremolodepth(depth)` with
   depth `1 - 10 ** (-wobble_db / 20)` (a 6 dB swing is 0.5). The hold's own slope (a closing filter,
   a decay) is removed by a linear fit before the wobble is read, so a pluck is not a tremolo, and a
   span under one cycle of 5 Hz cannot name a rate. Found while building: on this clip no note
   carries one. Measured properly (the hold's 25% to 65%, 5 ms frames), the strongest periodic
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

- `solomun2`: beat 3 becomes `e3`; the line is
  `[~ d#2@2 ~] [d#1@3 ~] [e3@3 ~] [d#2@2 ~ ~]` with
  `.lpf(240).lpenv(1.7).lpdecay(0.075).lpsustain(0).attack(0.021).clip(0.57).release(0.037)`; no
  tremolo; match 0.96. `tuning_cents` reads −18 (the spectrum's own reading is nearer −35; the
  per-step read is held within 20 cents of pyin's bins, which sit at −29 and −9 there). Found at
  review and confirmed on the stem: the `c#1` the earlier goldens wrote in bars 4 and 5 was the old
  key snap's invention. The tracker reads that step at 37.8 Hz, halfway between C#1 and D1 and 50
  cents under the D#1 before it: a D#1 gliding flat at its end. Rounded to D1 and snapped, it became
  C#1; retuned it is D#1. The lone `f1` pickup on step 14 is a one-step stray, so the `_bass2` line
  goes. For Tom's ear.
- `solomun` (36:40): the loop and its pitch classes unchanged; `.lpf(370)` from the measured hold
  instead of the fixed 800, no envelope (its opening is under an octave and settles in 40 ms).
- `build`: synthetic, in tune, flat spectrum: tuning 0, `.lpf(430)`, no envelope, no tremolo. Its
  10 ms ramp's click read as a 3-octave opening when the opening was read from the grid line; read
  from the onset it is gone, and `FILTER_ENV_MIN_CLOSE_MS = 50` stays as a second guard.
