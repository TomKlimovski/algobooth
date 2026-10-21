# Drum loop fills, second pass: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drum voice whose loop has an empty phase gets no main line (all its hits are fills), and a bar's stray hits make the `_fills:` line only when there are at least three of them over the looped voices.

**Architecture:** Two rule changes inside `service/algorip/drumloop.py` (`voice_loop` loses its one-bar-vote fallback; `drum_loops` applies a threshold to the fills of looped voices before computing `fill_bars`). `generate.py` and the pipeline do not change. The Solomun and `build` goldens are regenerated and the READMEs' two sentences follow.

**Tech Stack:** Python 3.11, pytest, `uv`; vitest for the golden guard.

**Spec:** `docs/superpowers/specs/2026-10-21-drum-loop-fills-design.md` (amends `2026-10-21-drum-loop-design.md`).

## Global Constraints

- Service suite: `cd service && uv run pytest -q`; app suite: `pnpm exec vitest run` (run `pnpm exec vitest run --clearCache` first after a golden changes).
- `house`, `drums_only`, `sustain`, `breaks` goldens stay byte-identical.
- The bass (`bassgrid.py`, `bass.py`, `loop.py`) is not touched.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing else.

## Review Focus

- A voice with no regular part and a clip whose only other voice has no strays: `fill_bars` must still cover that voice's bars (the threshold must not drop a no-loop voice). Pinned in Task 2.
- A bar where two looped voices stray with one and two hits (sum 3) is kept; one voice with two hits alone is dropped. Pinned in Task 2.
- `match` after the threshold still counts dropped strays as unplayed (the number must not rise when the fills line gets shorter). Pinned in Task 2.
- `find_loop` returning `None` (verbatim) still yields no fills and a full main line, not "no regular part". Pinned in Task 1.
- The `_fills:` comment's bar range matches the kept bars after the threshold, so the vitest guard (`roundtrip.test.ts`, the fills case) passes on the regenerated Solomun golden. Verified in Task 3.

---

### Task 1: An empty phase means no regular part

**Files:**
- Modify: `service/algorip/drumloop.py` (`voice_loop`, the module docstring's last paragraph)
- Test: `service/tests/test_drumloop.py`

**Interfaces:**
- Produces: `voice_loop(bars: list[set[int]]) -> VoiceLoop` unchanged in signature; a found loop with an empty phase now returns `VoiceLoop(period=1, templates=[set()], fills=bars as sets)`.

- [ ] **Step 1: Rewrite the Solomun hats test to the new rule**

Replace `test_a_loop_with_an_empty_phase_falls_back_to_the_one_bar_vote` with:

```python
def test_a_loop_with_an_empty_phase_has_no_regular_part():
    # Solomun's open hats: a period-4 vote leaves a silent phase; the voice is not written as a loop
    bars = [{1, 9, 15}, {1, 7, 9, 15}, {1, 7, 9, 15}, {1, 7, 9}, {1}, set(), {7, 9, 15}, {1, 7, 9, 15}, {1, 9, 15}]
    v = voice_loop(bars)
    assert v.period == 1 and v.templates == [set()]
    assert v.fills == bars
```

`test_an_empty_phase_is_not_a_loop_for_a_drum_voice` and `test_no_repetition_is_verbatim_and_a_one_bar_clip_too` stay as they are (the first already expects all-fills; the second pins the verbatim path).

- [ ] **Step 2: Run the test to see it fail**

Run: `cd service && uv run pytest -q tests/test_drumloop.py -k empty_phase_has_no_regular_part`
Expected: FAIL, `v.templates == [{1, 7, 9, 15}]`.

- [ ] **Step 3: Drop the one-bar-vote fallback in `voice_loop`**

When `_has_empty_phase(found, bars)` is true, return `_loop(1, [set()], bars)`. Remove the now-unused `vote` import. Update the module docstring's last paragraph: an empty phase means the voice has no regular part and every hit is a fill; the one-bar vote is no longer tried.

- [ ] **Step 4: Run the drumloop tests**

Run: `cd service && uv run pytest -q tests/test_drumloop.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add service/algorip/drumloop.py service/tests/test_drumloop.py
git commit -m "A drum voice with an empty phase has no regular part"
```

(The `test_generate.py` golden for Solomun fails from here until Task 3; that is expected.)

---

### Task 2: The fills threshold

**Files:**
- Modify: `service/algorip/drumloop.py` (`drum_loops`, a new constant)
- Test: `service/tests/test_drumloop.py`

**Interfaces:**
- Produces: `FILL_MIN_HITS: int = 3` (module constant). `drum_loops(a) -> DrumLoops` unchanged in signature; for voices with any non-empty template, `fills[b]` is emptied when the sum over those voices of `len(fills[b])` is below `FILL_MIN_HITS`. Voices with all-empty templates keep every fill.

- [ ] **Step 1: Write the failing tests**

```python
from algorip.drumloop import FILL_MIN_HITS

def test_a_bar_needs_three_strays_over_the_looped_voices_to_be_a_fill():
    assert FILL_MIN_HITS == 3
    bd = [(b, s) for b in range(4) for s in FOUR] + [(1, 2), (1, 3)]            # two strays in bar 2
    sd = [(b, s) for b in range(4) for s in (4, 12)] + [(1, 14), (3, 14), (3, 15)]  # one in bar 2, two in bar 4
    d = drum_loops(analysis(drums={"bd": bd, "sd": sd, "hh": [], "oh": []}, bars=4))
    assert d.voices["bd"].fills == [set(), {2, 3}, set(), set()]   # bar 2: 2 + 1 = 3, kept
    assert d.voices["sd"].fills == [set(), {14}, set(), set()]     # bar 4: 0 + 2 = 2, dropped
    assert d.fill_bars == (2, 2)


def test_dropped_strays_still_count_as_unplayed():
    bd = [(b, s) for b in range(4) for s in FOUR] + [(3, 10)]
    d = drum_loops(analysis(drums={"bd": bd, "sd": [], "hh": [], "oh": []}, bars=4))
    assert d.voices["bd"].fills == [set()] * 4 and d.fill_bars is None
    assert d.match == pytest.approx(round(2 * 16 / (16 + 17), 2))


def test_a_voice_with_no_regular_part_keeps_every_hit_as_a_fill():
    bd = [(b, s) for b in range(9) for s in FOUR]
    oh = [(b, s) for b in (0, 4, 8) for s in (6,)]   # one hit, every fourth bar: period 4 with empty phases
    d = drum_loops(analysis(drums={"bd": bd, "sd": [], "hh": [], "oh": oh}, bars=9))
    assert d.voices["oh"].templates == [set()]
    assert [bool(f) for f in d.voices["oh"].fills] == [True, False, False, False, True, False, False, False, True]
    assert d.fill_bars == (1, 9)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd service && uv run pytest -q tests/test_drumloop.py -k "three_strays or dropped_strays or keeps_every_hit"`
Expected: FAIL (`FILL_MIN_HITS` import error).

- [ ] **Step 3: Implement the threshold in `drum_loops`**

Add `FILL_MIN_HITS = 3` with a comment: set on Solomun, where the kick and clap stray 4, 2, 1, 2, 1, 2, 2, 1, 1 times per bar; 3 keeps the bar-1 pickup only. After all voices are looped, for each bar `b`: `strays = sum(len(v.fills[b]) for v in voices.values() if any(v.templates))`; when `strays < FILL_MIN_HITS`, set `v.fills[b] = set()` for those looped voices. Compute `fill_bars` after that. `played` and `heard` are untouched, so `match` is unchanged.

- [ ] **Step 4: Fix `test_drum_loops_over_an_analysis`**

It has one stray (`(3, 10)`), which the threshold now drops: change its expectation to `d.fill_bars is None`; its `match` assertion stays as it is.

- [ ] **Step 5: Run the drumloop tests**

Run: `cd service && uv run pytest -q tests/test_drumloop.py`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add service/algorip/drumloop.py service/tests/test_drumloop.py
git commit -m "A bar's strays make a fill only from three hits over the looped voices"
```

---

### Task 3: Generator tests, goldens and READMEs

**Files:**
- Modify: `service/tests/test_generate.py`, `service/tests/golden/solomun.strudel`, `service/tests/golden/build.strudel`, `README.md:32,45`, `service/README.md:90`, `docs/superpowers/specs/2026-10-21-drum-loop-design.md` (one line pointing at the amendment)

- [ ] **Step 1: Make `test_drum_lines_write_the_loop_and_a_muted_fills_line` cross the threshold**

Its strays are one per bar today. Change the snare's extras to `[(3, 13), (3, 14), (3, 15), (7, 14)]` and the hat's to `[(1, 5)]`, so bar 4 has three snare strays (kept) and bars 2 and 8 have one each (dropped). Expected lines become:

```python
        f'drums: s("bd*4, [~ {s.snare_name}]*2").bank("{s.drum_bank}")',
        f'hats: s("hh*8").bank("{s.drum_bank}")',
        "// bars 4–4 add these hits (a fill): remove the underscore to hear them",
        f'_fills: s("<~ ~ ~ [~ ~ ~ [~ {s.snare_name} {s.snare_name} {s.snare_name}]] ~ ~ ~ ~>").bank("{s.drum_bank}")',
```

Check the exact `bar_mini` output for `{13, 14, 15}` by running it; adjust the literal to what `bar_mini` writes if it differs, keeping the test's intent (bar 4 only, snare only).

- [ ] **Step 2: Run the generate tests to see which fail**

Run: `cd service && uv run pytest -q tests/test_generate.py`
Expected: `test_golden[solomun]`, `test_golden[build]` and the rewritten test fail; `test_a_voice_with_no_regular_part_lives_only_in_fills` passes (its open hats have one-hit bars, kept as a no-loop voice).

- [ ] **Step 3: Regenerate the two goldens**

Run from `service/`:

```bash
uv run python -c "
from pathlib import Path
from algorip.generate import generate
from algorip.schema import Analysis
from algorip.sounds import choose_sounds
G = Path('tests/golden')
for name, title, start, end in [('solomun', 'Solomun – Live at Alexandra Palace, London (2026) (Official Film)', 2200, 2220), ('build', 'Build', 0, 16)]:
    a = Analysis.model_validate_json((G / f'{name}.analysis.json').read_text())
    (G / f'{name}.strudel').write_text(generate(a, choose_sounds(a), title=title, start=start, end=end))
"
git diff service/tests/golden
```

Expected diff: `solomun.strudel` loses its `hats:` line; its `_fills:` comment names bars 1–9 (open hats play to bar 9) and the line carries a kick part and a clap part for bar 1 only plus an open-hat part over the nine bars. `build.strudel` loses its `// bars 1–1` comment and `_fills:` line; nothing else changes. Read both by eye; if anything else moved, stop and investigate before committing.

- [ ] **Step 4: Run the full service suite**

Run: `cd service && uv run pytest -q`
Expected: all pass (240 before this work; count may differ by the tests added above).

- [ ] **Step 5: Run the app's golden guards**

Run: `pnpm exec vitest run --clearCache && pnpm exec vitest run`
Expected: all pass, including the `_fills:` bars case in `app/src/rip/roundtrip.test.ts` for `solomun`.

- [ ] **Step 6: Update the documentation sentences**

- `README.md:32`: `_fills:` holds "the fills: bars where the drum loops miss at least three hits, each in its own bar, and any drum voice that has no steady loop".
- `README.md:45`: after "Hits outside the loops go to the muted `_fills:` line", add "when a bar has three or more of them; a voice with no steady loop is written there whole."
- `service/README.md:90`: replace "that voice falls back to its one-bar vote" with "that voice has no main line and all its hits are fills; a bar's strays over the looped voices are written only from `FILL_MIN_HITS` (3) hits".
- `docs/superpowers/specs/2026-10-21-drum-loop-design.md`: under the title, one line: "Amended by `2026-10-21-drum-loop-fills-design.md` (empty-phase rule, fills threshold)."

- [ ] **Step 7: Commit**

```bash
git add service/tests/test_generate.py service/tests/golden/solomun.strudel service/tests/golden/build.strudel README.md service/README.md docs/superpowers/specs/2026-10-21-drum-loop-design.md
git commit -m "Solomun and build goldens under the no-regular-part rule and the fills threshold"
```
