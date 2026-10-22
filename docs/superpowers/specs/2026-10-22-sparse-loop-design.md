# Sparse loops: containment instead of ratio agreement, the variation from every bar

Date: 2026-10-22. Amends `2026-10-20-bass-loop-design.md` (the loop finder, `service/algorip/loop.py`)
after the second Solomun clip, 48:50 to 49:00 (129 bpm, D# minor, 5 bars), came out as five bars
written verbatim with no loop. Tom: "surely your bass line can be refactored? do some research on how
a loop can be identified and pinpointed over a 10 second clip", then "build it. make all decisions
yourself".

## What the clip plays and what went wrong

Every bar's beats 1 to 3 are the same three D# onsets; beat 4 varies (a D# on step 12 or 13, or
nothing) and bars 4 and 5 add a C# in beat 2 and an F in beat 4. The finder votes a three-onset
template, then keeps as core only bars agreeing on 80% of the steps either side occupies; one extra
onset in a three-onset bar is 75%, so four of five bars are rejected, one core bar is under the
minimum of two, and `find_loop` returns None. The ratio was tuned on nine-onset bars (36:40), where
one stray is 10%; on a sparse line the same yardstick throws the loop away.

Ten seconds is five bars, so only periods 1 and 2 can be voted on; that limit stays. The vote itself
is the right tool (a step-grid special case of the self-similarity lag search); the distance is wrong.

## The changes (all in `loop.py`, with the bass writer and the goldens following)

1. **Containment.** `agreement(bar, template)` becomes the share of the *template's* steps the bar
   plays with the same value (1.0 for an empty template). Extra steps in the bar no longer count
   against it: a bar is core when it plays what the loop plays. `LOOP_AGREE` stays 0.8, so a bar
   missing one of three template steps is still not core.
2. **An all-empty template is not a loop.** A period whose templates are all empty is skipped, so
   a voice that never repeats still falls through to None (the verbatim path) rather than to "a
   loop of silence". Drums keep their verbatim golden behaviour.
3. **The variation comes from every bar, per bar.** The layer (`Loop.extra`) is now one dict per
   clip bar: the bar's starts and sounding steps beyond its phase template, core bars included
   (a stray in a core bar is still heard). `extra_bars` is the range of bars with any; `extra` is
   None when the total over the clip is under `LAYER_MIN_STEPS = 4` (one stray is not a variation).
   The layer is no longer searched for its own loop: on this clip the extras' majority (a lone D#
   on step 13) would have hidden the C# and F build. It is written verbatim, like the drum fills,
   through `cycle`, so a repeating variation still reduces to its period in the notation.
4. **The writer.** `bass._layer_notes` reads each phase from its own bar; the comment above `_bass2:`
   says "a variation" rather than "a build"; `match_with_layer` is unchanged in meaning.

## Consequences on the goldens (regenerated deliberately, checked by eye)

- `solomun` (36:40): the loop is unchanged (its core bars contain the template). Its `_bass2` becomes
  the five build bars written out as a cycle instead of one voted bar, and `match_with_layer` rises.
- `solomun2` (48:50), new, from the cached stems through `bass_fixture.py`: the loop
  `[~ d#2@2 ~] [d#1@3 ~] [d#2@3 ~] ~` plus a five-bar `_bass2` variation.
- `build` (synthetic): its build bars were identical, so the layer reduces to the same one bar.
- Drum goldens: containment may admit more bars to a voice's core; whatever the vote then says is
  regenerated with that reason. `_has_empty_phase` and the fills threshold are untouched.

## Decided

- Containment at 0.8; the layer threshold is a total of four steps over the clip, not per bar, so a
  one-step real note (bar 2's lone D#) is kept once the clip has a variation at all.
- Shortest period first, as before: this clip reads as one bar plus variation, not as a two-bar
  alternation of beat 4.
- Open for Tom's ear: bars 4 and 5's C# cuts the held D# in the stem; the written layer sounds both.
