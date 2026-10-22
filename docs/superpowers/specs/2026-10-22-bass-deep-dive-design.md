# Bass deep dive: the note the pitch gate dropped, and the pluck the sawtooth does not play

Date: 2026-10-22. Follows `2026-10-22-sparse-loop-design.md`. Tom, listening to the 48:50 Solomun bass
against the rip: "feels like there's a decay or reverb/echo thing going on each note". Measured on
the stem (per-16th levels, per-note decay, harmonic spectra, cross-correlation at a beat's lag, the
drum stem at the same steps): no echo and no reverb, but two things the rip gets wrong. Tom:
"this is the kind of iterative feedback and redesign I want".

## What the stem plays, every bar

| beat | note | what the stem does | what we wrote |
|---|---|---|---|
| 1 | d#2 | starts on the 2nd 16th, full level, gone by the end of the 3rd | `d#2@2` (right) |
| 2 | d#1 | three 16ths, slow decay, 20 dB down by the end | `d#1@3` (right) |
| 3 | d#3 | three 16ths at full level, 40 dB down inside the 4th | `d#3@3` (right) |
| 4 | d#2 | three 16ths, as loud as beat 3, in all five bars | `~` (wrong) |

Every note is a pluck: 12 dB down 110 to 160 ms after its peak, 20 dB down by 130 to 230 ms, clean
silence between notes. Our line plays a sawtooth at one level for the whole `@2` or `@3` and stops.

## Change 1: a spectral fallback for a loud step the pitch tracker calls unvoiced (`bassgrid.py`)

Beat 4's D#2 has the strongest fundamental in the bar (77.5 Hz, harmonics at 0.48, 0.22, 0.23), yet
pyin reads it as D#1 at a voiced probability of 0.01 to 0.09 (an octave-down trough, under the gate),
so the step is a rest in most bars and a one-16th stray in the others, which the loop finder drops.

- `bass_grid` keeps pyin as the primary reading. A step within `HPS_LOUD = 0.4` (8 dB) of the clip's
  loudest step whose pyin reading is not confident (fewer than `VOICED_SHARE` voiced frames, or a
  median voiced probability under `PYIN_CONFIDENT = 0.3`) gets a second opinion from a harmonic
  product spectrum (three harmonics) of the step and half a step either side, at least 200 ms,
  limited to `FMIN`..`FMAX`; the fundamental is re-read from where its harmonics peak, so a short
  window's lobe at the bottom of the range does not pull C1 down to B0. The second opinion is taken
  when pyin heard nothing, or when pyin's pitch is an octave under it and that sub-octave's third
  harmonic is not a real partial (`HPS_SUPPORT = 0.3` of the strongest bin: a missing fundamental
  keeps pyin's reading, YIN's double-period error does not). A candidate that is not a partial
  (`HPS_PARTIAL = 0.2`), or whose half is a partial under `FMIN`, is refused. `snap_to_key` and the
  register fold apply afterwards as for any step.
- Found while building: a window reaching a whole step either side takes in the next step's kick,
  whose bleed lifts the sub-octave partial from 0.11 to 0.29 of the peak and swings the reading
  down; quiet steps (tails 15 dB down) must not get a second opinion or the spectrum names notes for
  them. Hence the loudness gate and the half-step window.
- The 36:40 golden's loop line is unchanged. Six steps of its grid move an octave up to G2 (step 15
  of bars 6 to 9 and step 1 of bars 8 and 9, all in the build, all loud, where pyin was unsure):
  consistent with the loop's own `g2` on step 15, and the `_bass2` line follows.
- On 48:50: beat 4 reads D#2 on step 12 in every bar and step 13 keeps the tracker's D#1 (the same
  pitch class, which is what the loop writes; step 14 is 18 dB down, under the loudness gate) and the loop becomes `[~ d#2@2 ~] [d#1@3 ~] [d#3@3 ~] [d#2@2 ~ ~]`; the bass match
  rises from 0.79 to 0.92.

## Change 2: a measured amplitude envelope on the bass lines (`bass.py`, `sounds.py`, `generate.py`)

Found at review: measured with 46 ms frames at the service's 44.1 kHz (the first build's frames were
half that and read the ripple of a low note as decay), the stem's notes are not plucks but gates: held
within 2 dB for half to three quarters of their written length, then cut by 20 dB in about 40 ms. So
the envelope written is a gate, not decay and sustain.

- `bass_envelope(y, sr, notes, grid) -> BassEnvelope | None` in `bass.py`, beside `harmonic_ratio`:
  for each transcribed note, the RMS envelope (46 ms frames, so a low note's ripple does not read as
  decay) over the note's own span; `attack_ms` the time from the note's onset (20 dB under its peak)
  to its peak, on a 6 ms-frame envelope, since the long frame's own rise reads as a 46 ms attack and
  the grid line sits tens of milliseconds before a real onset; `decay_ms` the time from the peak to
  12 dB below it, capped at the note's end; `end_db` the level a frame before the note's end,
  relative to its peak. The envelope is the median of each over the notes; None with no notes.
  `Analysis` carries it as `bass_envelope`.
- The measurement (`MeasuredEnvelope`): on the 46 ms RMS envelope of each note's span, the onset is
  the first moment within 20 dB of the peak, the hold runs from there to the last moment within 3 dB
  of it, the attack is the rise between the two and the fall the time from the hold's end to 20 dB
  down, each less the window's own smear (0.49 of the frame); `end_db` the level a frame before the
  end; `hold_share` the hold over the written length. Medians over the notes.
- `choose_sounds` writes a gate (`StrudelEnvelope`) when the median note has fallen `GATE_DB = 6`
  dB or more by its end: `attack` in seconds (at least 0.005), `clip` the hold share (None when at
  least 0.9: the transcription already writes a cut note as its hold), `release` the fall in seconds
  (at least 0.01). A held bass (the 36:40 clip, 1.4 dB down at the end) gets None.
- `generate` appends `.attack(a).clip(c).release(r)` (clip only when set) to the `bass:` line and the
  `_bass2:` line, values to three decimals. The Rip tab needs nothing; `ripApi.ts` mirrors the fields.

## Non-goals

- No reverb, delay or release modelling: the stem shows none. No per-note envelopes (beat 2 decays
  about twice as slowly as the others; one clip-wide envelope is the emulation, Tom tweaks).
- The tracker's E3 reading of beat 3 (the spectrum says D#3; the key snap writes D#3 either way) is
  noted, not changed.

## Goldens

- `solomun2`: the grid gains beat 4; the loop gains `[d#2@2 ~ ~]`; the lines gain
  `.attack(0.021).clip(0.63).release(0.035)`. The variation (`_bass2`) stays the C# and F of bars 4
  and 5.
- `solomun`: unchanged grid and loop; whether its lines gain an envelope is what the measurement says
  (its handover note calls the g1 pairs held with no dip), regenerated with that reason.
- `build`: the synthetic notes have 10 ms ramps and no decay, so no envelope.

## Decided

- The fallback is a harmonic product spectrum, three harmonics, on a two-step window; pyin stays
  primary and the threshold is a median voiced probability of 0.3.
- Gate threshold 6 dB at the note's end; attack floor 5 ms, release floor 10 ms; no clip when the
  hold is at least 0.9 of the note.
- The envelope is one per clip, written on both bass lines.
