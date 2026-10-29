# Re-strike: a letter key is heard at once on the line it changes

Tom said on 2026-10-28 that letter keys are "starting to lag". The key path measured fast: 15 to 18 ms median
from keydown to the evaluated pattern in WebKit, with no drift over 400 presses. The lag is in when the change
reaches the speakers. Press to the first changed note, on the Solomun 36:40 rip with quantise `now`:

| Line | Median | Max |
|---|---|---|
| drums, claps, bass | 0.38 to 0.58 s | 0.73 s |
| hats | 0.5 to 0.9 s | 1.1 s |
| melody | 0.7 to 1.4 s | 2.1 s |
| chords | 1.0 to 1.65 s | 2.1 s |

There are two causes:

- **Notes already playing never change.** A mute, a method such as `.crush` or `.phaser`, or any edit
  reaches only notes that start after the new pattern is live. A chord lasts a bar (1.86 s at 129 bpm), so the
  old chord rings on for most of it.
- **A fixed floor of about 0.25 s on every press.** The evaluation takes about 50 ms; the clock has already
  handed superdough every note up to about 150 ms ahead in the old form; and a trigger runs 50 ms late.

Tom chose to re-strike first and trim the floor after. He skipped the design questions ("skip questions and
go"), so every call below is mine and marked as such.

## Goal

When a key flush changes a line on a playing deck, that line is heard in its new form within about the
trigger lead (30 ms), not at its next note:

- notes of the line already handed over in the old form but not yet started are taken back and played in
  the new form at their own times;
- a long pitched note of the line that is ringing (a chord, a held melody or bass note) is cut and struck
  again in the new form at once, for the rest of its length;
- a mute silences the line's ringing long notes and its handed-over notes at once; an unmute strikes the
  line's current long notes at once.

## Non-goals

- Lines with no label (`$:`, a bare expression): they cannot be told apart, so they are left as now.
- Changes that do not come from a key flush: Update, Play, typing, a cue's immediate append. Those keep
  Strudel's behaviour.
- Reverb and delay tails already in a bus: they die away naturally, as a real mixer's would.
- The rest of the floor (the evaluation and the trigger lead). That is the follow-up Tom put second.

## Anti-goals

- No double hits: a note must never sound in both its old and its new form.
- No flams or truncated hits on drums: a percussive hit that is already sounding is left alone.
- Unchanged lines must not be touched, re-triggered or cut.

## How it works

1. **superdough reports the voice.** A pnpm patch (`patches/superdough@1.3.0.patch`, in `dist/index.mjs` and
   `superdough.mjs`) makes `superdough()` resolve to `{ post }`, the voice's last per-voice GainNode. Every
   path out of a voice (dry, reverb send, delay send) goes through `post`, so ramping its gain to 0 silences
   the voice. A voice superdough skips still resolves to undefined. This is the same discipline as the
   `@strudel/core` patch: a superdough bump must re-apply it.
2. **Each hap knows its line.** A hap's `context.locations` are offsets of its mini-notation in the evaluated
   code. The deck keeps the `patternLines` of the code that produced the live pattern (swapped in
   `editPattern`, just before Cyclist takes the new pattern), so a hap's first location gives its line's label.
   My call: a hap with no locations (a line built with no mini-notation) is not tracked.
3. **The deck tracks voices.** The deck's `defaultOutput` wraps `webaudioOutput`: for each hap it records the
   label, start and end (s), the hap's heard length in cycles (after `.clip`, `.legato` and `.duration`, as Cyclist plays it), whether it is pitched (`note` or `freq` in its value)
   and the `post` node once superdough resolves. Voices are dropped once they have ended or been cut, so a second press cannot raise a voice the first one is fading.
4. **The flush says which lines changed.** `KeyController.flush` compares the pattern lines before and after
   its jobs by label: a line whose text or mute changed, or that came or went. It passes those labels to
   `deck.evaluate(false, labels)`.
5. **After that evaluation, the deck re-strikes.** Only when it succeeded, the deck is playing and some labels
   changed. With `t0 = now + 30 ms` and `end` = the cycle Cyclist had queried up to when the new pattern took
   over:
   - **cut** each tracked voice of a changed line that starts at or after `t0`, and each ringing one that is
     long (see below). A cut ramps `post.gain` to 0 over 8 ms from `t0`.
   - **play** from the new pattern, for the changed lines only: each onset in `[t0, end)` at its own time,
     and each long note spanning `t0` from `t0` for the rest of its length.
   Onsets from `end` on come from Cyclist's next query as usual, so nothing is doubled.
6. **Long, my call:** pitched, at least 1/8 cycle long, and at least 1/16 cycle left at `t0`. Drums and hats
   (no `note`) are never re-struck mid-hit; a 3/16 melody note or a bar-long chord is. The constants are named
   in the code so they are easy to tune by ear.

My call: this applies to every key flush, not only to letters, so snapshots, fills and Go get the same
treatment on the lines they change. Fills and Go land on the bar, where most notes are handed over but not
yet started, so they gain the take-back without re-striking much.

## Known limits

- A voice superdough has not resolved by `t0` (a sample still loading) is not cut, and its new form also
  plays. A sample that is already loaded resolves at once.
- A re-struck note starts from its sample's attack, as a re-pressed key on a synth would.
- `hap.context.onTrigger` (pattern-level trigger hooks) is not called for re-struck haps; only the audio is. A hap whose
  hook replaces the audio (`dominantTrigger`, as `.midi()` does) is not re-struck at all.
- Note lengths in the plan are the heard ones (`hap.duration`): a re-struck note keeps its clip, and a clipped chord
  that is already silent is not struck again.

## Testing

- Unit tests cover the hap-to-line lookup, the changed-labels comparison, the re-strike plan (cuts and plays,
  long and short, mute and unmute, nothing outside the changed lines, no onset at or past `end`), and the
  flush passing the changed labels.
- A WebKit probe against the dev server measures press to the first changed sound per line, before and after.

## Measured

Same probe and rip after the change, with the probe's audio muted: 6 presses per key at random bar phase, quantise
`now`. "Heard" is press to the first cut or new-form note on that line.

| Line | Before (median) | After (median) | After (max) |
|---|---|---|---|
| chords | 1.0 to 1.65 s | 0.05 s | 0.05 s |
| melody | 0.7 to 1.4 s | 0.05 to 0.18 s | 0.47 s |
| bass | 0.38 to 0.58 s | 0.05 to 0.26 s | 0.38 s |
| hats | 0.5 to 0.9 s | 0.05 to 0.2 s | 0.58 s |
| drums, claps | 0.38 to 0.58 s | 0.05 to 0.33 s | 0.52 s |

No old-form note that was handed over went uncut (no doubles), and no drum hit was re-struck. Short lines still wait
for their next hit when nothing of theirs is pending, which is where the larger numbers come from. The key path
stayed at 11 to 18 ms.
