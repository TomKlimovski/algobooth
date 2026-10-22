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
2. **An all-empty template is not a loop.** A period whose templates are all empty is skipped, and
   so is a phase whose template is empty while that phase's bars have steps, or that no bar contains.
   A voice that never repeats returns None: for the bass that is the bar-by-bar fallback, for a drum
   voice over more than one bar it is "no regular part" (no main line, every hit a fill, as the fills
   design wanted for a voice with no steady loop); a one-bar clip is its own loop. The drum-only
   `_has_empty_phase` fallback is gone, since `find_loop` now refuses those loops itself.
2a. **The cleanest bars vote the template.** Found while building: with build bars admitted to the
   core by containment, a build longer than the loop section outvotes it (five build bars with the
   root on step 8 against four clean bars put step 8 in the loop). So the second vote is taken by
   each phase's core bars that add the least beyond the first vote, at least half of them. The loop
   is the pattern as the track states it, not as its busiest bars play it. The first vote stays a
   vote over every bar: a step most bars play is in the loop and the bars lacking it are dropouts,
   so a clip whose build bars outnumber its clean bars reads the build as the loop (the majority
   decides; the reviewer's "rip started a bar later" case is a limit, not a bug). Only when that
   vote settles on no loop does a vote over the sparsest half seed a second try, kept when a
   majority of bars contain it (that is how the 36:40 open hats become a one-bar loop).
2b. **A longer period must earn its length.** Containment alone makes everything period 1 (whatever
   the bars share is the loop, the rest variation), which turns a two-bar alternation into a one-bar
   loop with an alternating variation. So each candidate period's loop is scored by the share of the
   steps it explains (template steps a bar lacks count against it, so a hat every fourth bar is not
   read as every second bar with dropouts), and a longer period replaces a shorter one only when (a)
   it explains at least `RESIDUAL_GAIN = 0.5` of what the shorter leaves unexplained, so a one-note
   alternation still counts, and (b) its phases do not merely add to the shorter loop in a minority of
   phases: that shape is a phrase-end fill, the drum design's `<loop loop loop fill>` anti-goal, and
   stays a one-bar loop plus a variation. A phase that drops something the shorter loop claims is a
   correction and does count.
3. **The variation comes from every bar, per bar.** The layer (`Loop.extra`) is now one dict per
   clip bar: the bar's starts and sounding steps beyond its phase template, core bars included
   (a stray in a core bar is still heard). `extra_bars` is the range of bars with any; `extra` is
   a bar adding fewer than `VARIATION_MIN_STEPS = 2` adds a stray, which is dropped, as a drum bar
   under the fills threshold is; None when the total over the clip is under `LAYER_MIN_STEPS = 4`.
   When every adding bar contains one short loop of its own, voted at the bars' own phases of the
   clip so it is written where they are (periods 1, 2, 4), that loop is the variation: the synthetic
   build stays `[~ a1 a1 a1] a1*4 ~ ~` and this clip's C# and F are one bar. When they differ (the
   36:40 build fills in gradually) the variation is one phase per clip bar, verbatim, like the drum
   fills, through `cycle`.
4. **The writer.** `bass._layer_notes` reads each phase from its own bar; the comment above `_bass2:`
   says "a variation" rather than "a build"; `match_with_layer` is unchanged in meaning.

## Consequences on the goldens (regenerated deliberately, checked by eye)

- `solomun` (36:40): the loop is unchanged (its core bars contain the template). Its `_bass2` becomes
  the five build bars written out as a cycle instead of one voted bar, and `match_with_layer` rises.
- `solomun2` (48:50), new, from the cached stems through `bass_fixture.py`: the loop
  `[~ d#2@2 ~] [d#1@3 ~] [d#3@3 ~] ~` (the `d#3` is the tracker's reading in every bar: a possible
  octave slip for Tom's ear; the loop path applies no median octave fold, and the match is
  pitch-class only so it cannot see one) plus a one-bar `_bass2` variation, `~ [~ ~ c#1 ~] ~ [~ ~ f1 ~]`,
  for bars 4 to 5; the alternating beat-4 D# is a one-step stray and is dropped.
- `build` (synthetic): its build bars are identical, so the variation is the same one bar as before.
- Drum goldens: the 36:40 open hats become a one-bar loop (`[~ oh ~ ~] ~ [~ oh ~ ~] [~ ~ ~ oh]`) with
  the step-7 hits and bar 7's kick and clap as fills, where Tom had chosen fills over the old one-bar
  guess; that is for his ear. The fills threshold is untouched.

## Decided

- Containment at 0.8, the cleanest-half vote, the residual gain of 0.5 with the minority-additions
  refusal; a per-bar variation minimum of two steps and a clip total of four. A one-step note (bar 2's
  lone D#) is a stray and is dropped, by the same rule the drum fills use.
- Shortest period first, as before: this clip reads as one bar plus variation, not as a two-bar
  alternation of beat 4.
- Open for Tom's ear: bars 4 and 5's C# cuts the held D# in the stem; the written layer sounds both.
