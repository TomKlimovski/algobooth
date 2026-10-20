# Drum loop: the drum and hat lines through the loop finder, fills as a muted line

Date: 2026-10-21. Extends `2026-10-20-bass-loop-design.md` (built; `service/algorip/loop.py` is the loop
finder it describes) to the drum voices. Principle, from Tom: generated code is as modular as possible —
the simplest loop on each part's line, anything that varies as its own muted line.

## Intent

The `drums:` and `hats:` lines should be the loop the track plays, found the way the bass loop is, with
the bars that differ offered as one muted `_fills:` line. Today the drum writer uses `mini.consensus`,
which demands that every bar agree with its template: on the Solomun clip the claps vary, so the
`drums:` line is nine bars written out verbatim and the `hats:` line a wall of open hats.

## Goals

- `drums:` (kick and snare) and `hats:` (closed and open hat) are each a loop found by `loop.find_loop`,
  per voice, with the tolerance the bass has: deviating bars neither veto the loop nor pollute it.
- The hits the core loop does not play in the deviating bars are written as one muted `_fills:` line
  carrying every drum voice, same bank, with a comment naming the bars. A fill that happens once in the
  clip is still offered, at its position in the clip.
- The Rip tab shows how much of the classified drum hits the loops account for.
- The drum writer's own consensus (`voice_mini` over `mini.consensus`) is replaced by the loop finder. `notes_mini`
  (melody, and the bass fallback) keeps `mini.consensus` untouched; unifying it is later work.

## Non-goals and anti-goals

- No new audio analysis: the drum classifier's hits (`Analysis.drums`) are the input and the only truth.
  The drum number is agreement with those hits, which is weaker than the bass match (checked against the
  stem itself); the UI label says "hits" so it is not mistaken for the same thing.
- Bass, chords and melody are untouched.
- Anti-goal: a fill folded into the loop to be "more faithful" (`<loop loop loop fill>`). Variation is
  always the muted line.

## Constraints

- The three old goldens whose bars already agree (`house`, `drums_only`, `sustain`) stay byte-identical.
  `breaks` and `build` may change only as this design says; `solomun` changes (that is the point).
- `generate` stays a pure function of `Analysis`; the loop is recomputed from `Analysis.drums` by a
  deterministic function, so nothing but a small summary for the UI is added to the wire type.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.

## The parts

### 1. Drum loops (`service/algorip/drumloop.py`)

```python
VOICE_LINES = {"drums": ("bd", "sd"), "hats": ("hh", "oh")}

@dataclass
class VoiceLoop:
    period: int
    templates: list[set[int]]      # steps per phase
    fills: list[set[int]]          # one set per clip bar: the bar's hits the loop does not play there (every bar, core or not)

@dataclass
class DrumLoops:
    voices: dict[str, VoiceLoop]   # by analysis voice name; voices with no hits are absent
    fill_bars: tuple[int, int] | None   # 1-based inclusive range of bars with any fill, over all voices
    match: float                   # see below

def drum_loops(a: Analysis) -> DrumLoops
```

- Per voice: bars as `dict[int, bool]` (step → True) into `find_loop(bars)`. A found loop gives
  `templates` (its phases) and, for every bar, `fills[bar] = hits − template[bar % period]`: a stray
  extra hit in a core bar (which is core at 80% agreement) goes to the fills line too, so the main line
  is exactly the loop and nothing the classifier heard is lost. Hits the template plays that a bar
  lacks are ignored. No loop (the clip too short, or nothing repeats): `period = len(bars)`,
  `templates` the bars as heard, `fills` all empty — the verbatim line, as today.
- An empty phase is not a loop for a drum voice: when a found loop has a phase template with no hits
  while the voice has hits in bars of that phase (Solomun's open hats come out as period 4 with a silent
  bar), the voice is retried with only the shorter periods; if period 1 itself votes an empty template,
  the voice has no regular part: it is left off the main line and all its hits are fills. This rule lives
  in `drumloop.py`, not in `loop.py`, so the bass is untouched.
- A voice's layer from `find_loop` (`Loop.extra`) is not used: drum fills are written per bar at their
  own position (part 2), which keeps a one-off fill and keeps a phrase-end fill in its bar.
- `match`: over all voices and bars, hits the loops play (template expanded over the bars) against the
  classified hits: F1 of the two hit sets, rounded to 2 decimals; 1.0 when every bar agrees, 0.0 with no hits.

### 2. Written code (`generate.py`)

- `drums:` and `hats:` as today, except each voice's mini-notation comes from its `VoiceLoop.templates`
  through `cycle([bar_mini(name, t) for t in templates])`, so a one-bar loop is one bar of notation.
- When `fill_bars` is not None: a comment and one muted line directly after the `hats:` line (or after
  `drums:` when there is no hats line):
  `// bars 4–4 add these hits (a fill): remove the underscore to hear them` and
  `_fills: s("<...>, <...>").bank("...")`, one comma-separated part per voice that has any fill, each
  part a cycle over the clip's bars: `bar_mini(name, fills[b])` for every bar `b`, through `cycle`
  (so an empty bar is `~`, and a fill recurring every four bars reduces to a four-bar cycle). Voices
  are named as on their main lines (the snare as `s.snare_name`).
- The bass line's comment style and the `_bass2` convention are unchanged.

### 3. Analysis and the Rip tab

- `Analysis` gains `drum_summary: DrumSummary | None` with `period: int` (the longest period among the
  voices), `match: float` and `fill_bars: tuple[int, int] | None`, computed in `_analyse` from
  `drum_loops`. `ripApi.ts` mirrors it.
- The Rip tab analysis line gains `· drums loop 1 bar · 92% of hits` before the bass part; omitted when
  `drum_summary` is null.

### 4. Removal

- `voice_mini` goes. `mini.consensus` and its fill guard stay for `notes_mini` (melody and the bass
  fallback), whose behaviour does not change in this work; their tests stay in `test_mini.py`.

### 5. Goldens and tests

- `solomun.strudel` is regenerated from its analysis by the existing `test_golden` flow (its
  `analysis.json` does not change except for `drum_summary`); the expected drums line is a one-bar
  loop with `bd*4` and the clap pattern the core bars share, and a `_fills:` line for the rest.
- `breaks` (4 bars, a kick fill in bar 2 and 4 today written as a two-bar cycle): with periods 1 and 2
  both possible on 4 bars, `find_loop` tries period 1 first; whether the kick becomes a one-bar loop
  plus a `_fills:` line or stays a two-bar cycle is decided by the finder's vote, and the golden is
  regenerated to whatever it says, checked by eye for sense and committed with that reason. `build`
  has one stray closed-hat hit in a core bar, so it gains a `_fills:` line and its match drops under
  1.0; that is the every-bar rule working and the golden is regenerated with that reason.
- Unit tests for `drum_loops` on hand-made hit sets: a one-bar loop with one fill bar; a four-bar
  phrase whose last bar always fills (period 4 found on 8 bars, no fills); a clip with no repetition
  (verbatim, match 1.0 by definition); a silent voice.
- A vitest check that every golden with a `_fills:` line evaluates and plays something in its fill bar.

## Decided for the builder

- `_fills:` is one line for all drum voices, not `_drums2:` and `_hats2:`.
- Fills are taken from every bar, not only the deviating ones (a stray hit in a core bar is still a hit).
- Melody and the bass fallback are not touched; `mini.consensus` stays for them.
- A drum voice's loop may not have an empty phase (rule in part 1).
- A one-off fill is written at its bar position over the clip's length; no phrase inference.
- The drum number is hit agreement (F1), labelled "of hits" in the UI.

## Left to the builder

- Whether `drum_loops` caches anything; it is cheap.
- Exact test literals, as long as they pin the behaviours above.
