# Drum loop, second pass: no faked hats line, a threshold on fills, bass held notes stay

Date: 2026-10-21. Amends `2026-10-21-drum-loop-design.md` (built) after Tom's decisions on the three
open questions in `docs/handover-2026-10-21.md`. Everything here is in `service/algorip/drumloop.py`,
`generate.py`, the goldens and their tests.

## Tom's decisions

1. **Bass held versus retriggered**: "I don't know enough to make a decision, you do it." Decided
   below: held stays, no code change.
2. **Hats**: "move to fills". A voice whose loop has an empty phase gets no main line; all its hits are
   fills.
3. **Fills length**: "yes to threshold". A bar's stray hits make a fill only when there are enough of
   them.

## 1. Bass: held notes stay (decided, no change)

On the Solomun stem the `g1@2` steps show no energy dip at the step edge (the handover's note from the
bassgrid work), and the sustained candidate won the writer's candidate search at the same match as the
retriggered one, so the shorter notation was chosen by the existing rule. There is no evidence for a
retrigger; the rule in `bassgrid.py` stays as it is. If Tom later hears two hits on a clip, that is a new
observation and the retrigger threshold is the lever. Nothing in this design touches the bass.

## 2. A voice with an empty phase has no regular part

Today, `voice_loop` falls back to the one-bar majority vote when `find_loop`'s result has an empty
phase (Solomun's open hats: period 4 with a silent bar, then a one-bar vote that writes
`[~ oh ~ ~] [~ ~ ~ oh] ...`). That line is a guess the track does not play.

New rule: when the found loop has an empty phase, the voice has **no regular part**: `templates` are
all empty, and every hit of the voice is a fill at its bar position. The one-bar vote fallback goes.
`find_loop` returning `None` (nothing repeats, clip too short) is unchanged: the bars verbatim.

Consequence on Solomun: no `hats:` line; the open hats appear in `_fills:` as their own part, in
every bar they play. For the record, the clip's open hats are 3 or 4 per bar in seven of the nine
bars, one hit in bar 5 and none in bar 6 (1-based); the empty phase comes from those two bars. The
one-bar vote `[~ oh ~ ~] [~ ~ ~ oh] [~ oh ~ ~] [~ ~ ~ oh]` covered every hit with no strays, so it was
a plausible loop with two bars missing rather than an invention. Tom chose fills knowing the hats
were the question; this note is so a later reader knows what the data looked like.

## 3. A threshold on fills

Today every stray hit from every bar goes to `_fills:`; on Solomun the claps stray in 8 of 9 bars,
one to three hits each, and the line is longer than the loop it decorates.

New rule, in `drum_loops`:

- For voices **with a loop**, a bar's stray hits (hits minus that phase's template) are a fill only
  when the bar's stray count, **summed over the looped voices**, is at least `FILL_MIN_HITS = 3`.
  Below that, the bar's strays are dropped from the fills line. They still count as unplayed in
  `match`, so the "% of hits" number stays honest.
- For voices **without a regular part** (part 2), every hit is a fill regardless of the threshold:
  there is no loop they deviate from, and dropping them would lose the part.
- `fill_bars` is the range of bars with any fill after the threshold.

`FILL_MIN_HITS` is a module constant with a comment saying it was set on Solomun. Measured with
today's `drum_loops` on `solomun.analysis.json`, the bars there have 4, 2, 1, 2, 1, 2, 2, 1, 1 strays
over kick and clap, so at 3 the fills line keeps only bar 1 of the claps and kicks (a four-hit
pickup), plus the open hats in every bar they play. At 2 it would keep five of nine bars, which is
hardly shorter than today, so 3 is the value. If bar 1 alone reads as too little by ear, the constant
is the knob. A per-voice threshold was considered and rejected because a voice with two strays in a
bar never qualifies on its own while two voices straying together is audibly a fill.

## 4. Written code

`generate.drum_lines` is unchanged in shape: a voice with empty templates is skipped on the main
line (it already is, by `any(loop.templates)`), and its fills part is written from `loop.fills`. The
comment line stays `// bars lo–hi add these hits (a fill): remove the underscore to hear them`.

## 5. Goldens and tests

- `solomun.strudel` is regenerated: no `hats:` line, a shorter `_fills:` carrying the open hats and the
  claps and kicks of bar 1 only. The golden `analysis.json` files do not carry `drum_summary` (it is
  computed in the pipeline), so they do not change.
- `house`, `drums_only`, `sustain` stay byte-identical. `breaks` and `build` are regenerated only if the
  threshold removes a fill there (`build` has one stray closed hat in one bar: under the threshold, so
  its `_fills:` line goes and its match is unchanged); each regeneration is committed with that reason.
- Unit tests in `test_drumloop.py`: a voice with an empty phase has empty templates and all hits as
  fills; a bar with two strays over the looped voices is dropped, with three kept; a no-regular-part
  voice keeps a one-hit bar; `match` counts dropped strays as unplayed.
- The vitest guard that every golden's `_fills:` line plays only in its bars still passes.
- The Rip tab wording for a voice set with no regular part is unchanged (the parked "drums loop 9 bars"
  oddity stays parked).

## Left to the builder

- Whether `FILL_MIN_HITS` lives in `drumloop.py` or the pipeline's tunables; `drumloop.py` is fine.
- Exact test literals.
