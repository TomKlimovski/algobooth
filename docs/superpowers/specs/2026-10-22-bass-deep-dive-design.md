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

- `bass_grid` keeps pyin as the primary reading. For a step whose level is above the RMS floor but
  whose pyin reading is not confident (fewer than `VOICED_SHARE` voiced frames, or a median voiced
  probability under `PYIN_CONFIDENT = 0.3`), the pitch comes from a harmonic product spectrum of the
  audio from half a step before the step to half a step after it (232 ms at 129 bpm, so a semitone
  at 77 Hz is resolved once three harmonics are multiplied), limited to `FMIN`..`FMAX`, rounded to a
  semitone. `snap_to_key` and the register fold apply afterwards as for any step.
- A step that is confident in pyin is unchanged; the 36:40 golden's grid must not change.
- Expected on 48:50: beat 4 reads D#2 on steps 12 to 14 in every bar and the loop becomes
  `[~ d#2@2 ~] [d#1@3 ~] [d#3@3 ~] [d#2@3 ~]`.

## Change 2: a measured amplitude envelope on the bass lines (`bass.py`, `sounds.py`, `generate.py`)

- `bass_envelope(y, sr, notes, grid) -> BassEnvelope | None` in `bass.py`, beside `harmonic_ratio`:
  for each transcribed note, the short RMS envelope over the note's own span; `attack_ms` the time
  from the note's start to its peak; `decay_ms` the time from the peak to 12 dB below it, capped at
  the note's end; `end_db` the level at the note's end relative to its peak. The envelope is the
  median of each over the notes; None with no notes. `Analysis` carries it as `bass_envelope`.
- `choose_sounds` writes an envelope when the median note has fallen `PLUCK_DB = 6` dB or more by
  its end: `SoundChoice.bass_envelope = {attack, decay, sustain}` with attack in seconds (at least
  0.005), decay in seconds, sustain the end level as a linear gain (`10 ** (end_db / 20)`, at most
  0.5). A held bass (the 36:40 clip's `g1@2`, if its notes do not fall by their end) gets None.
- `generate` appends `.attack(a).decay(d).sustain(s)` to the `bass:` line and the `_bass2:` line
  when the envelope is set, values to three decimals. The Rip tab needs nothing; `ripApi.ts` mirrors
  the two new fields.

## Non-goals

- No reverb, delay or release modelling: the stem shows none. No per-note envelopes (beat 2 decays
  about twice as slowly as the others; one clip-wide envelope is the emulation, Tom tweaks).
- The tracker's E3 reading of beat 3 (the spectrum says D#3; the key snap writes D#3 either way) is
  noted, not changed.

## Goldens

- `solomun2`: the grid gains beat 4; the loop gains `[d#2@3 ~]`; the lines gain the envelope. The
  variation (`_bass2`) is expected to stay the C# and F of bars 4 and 5.
- `solomun`: unchanged grid and loop; whether its lines gain an envelope is what the measurement says
  (its handover note calls the g1 pairs held with no dip), regenerated with that reason.
- `build`: the synthetic notes have 10 ms ramps and no decay, so no envelope.

## Decided

- The fallback is a harmonic product spectrum, three harmonics, on a two-step window; pyin stays
  primary and the threshold is a median voiced probability of 0.3.
- Pluck threshold 6 dB at the note's end; sustain capped at 0.5; attack floor 5 ms.
- The envelope is one per clip, written on both bass lines.
