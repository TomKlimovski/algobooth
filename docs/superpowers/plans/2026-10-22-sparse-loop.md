# Sparse loops: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The bass loop finder recognises a loop in sparse bars with a varying beat, and writes the variation per bar as the muted `_bass2:` line; the 48:50 Solomun clip becomes a golden.

**Spec:** `docs/superpowers/specs/2026-10-22-sparse-loop-design.md`

## Global Constraints
- Suites: `cd service && uv run pytest -q`; `pnpm exec vitest run --clearCache && pnpm exec vitest run`.
- Goldens regenerated only as the spec says, each with its reason in the commit.
- Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus
- A bar missing a template step is still not core (dropout). Task 1.
- One stray step in one bar gives no layer; four steps over the clip do. Task 1.
- A voice with hits in one bar only still returns None (verbatim), not a loop of silence. Task 1.
- The written `_bass2` cycle has one phase per clip bar and `expand` lays it over the bars correctly, so `match_with_layer` is computed on the right bars. Task 2.
- The 36:40 bass loop line is byte-identical after the change. Task 3.

### Task 1: `loop.py`
- Tests first in `test_loop.py`: containment (`agreement({0:1,4:1},{0:1,8:1}) == 0.5`; `agreement({0:1,4:1,9:1},{0:1,4:1}) == 1.0`); the 48:50 shape (five bars, beats 1–3 shared, beat 4 varying) finds period 1 with the three-step template, all five bars core, `extra` one dict per bar with the beat-4 material, `extra_bars == (0, 4)`; a single stray gives `extra is None`; an all-empty template is skipped (`find_loop([{0: 1}, {}, {}, {}])` is None); the dropout case replaces the drifting case; existing layer tests updated to per-bar extras.
- Implement: `agreement` containment; the all-empty guard; `_layer` over every bar without the loop search; remove `LAYER_PERIODS`. Commit.

### Task 2: `bass.py`, `generate.py`
- `_layer_notes(bg, bars: list[int], extra)` reads phase `i` from bar `bars[i]`; `choose_bass_loop` passes `list(range(grid.bars))`. The `_bass2` comment reads "(a variation)". Tests in `test_bass.py`/`test_generate.py` updated. Commit.

### Task 3: goldens
- `cd service && uv run python scripts/bass_fixture.py stems ~/Algobooth/cache/stems/6d44d581d8ad286f solomun --title "Solomun – Live at Alexandra Palace, London (2026) (Official Film)" --start 2200 --end 2220` and the same for `3dd127e18e1f4e87 solomun2 --start 2930 --end 2940`; regenerate the other `.strudel` goldens through `test_golden`'s flow if they changed. Add `solomun2` to `test_generate.py`'s parametrisation and `test_fixtures.py`. Read every diff by eye. Run both suites (`--clearCache` first). Commit.

### Task 4: docs
- README bass paragraph, `service/README.md` loop line, handover (clip, cache hash, counts). Commit.
