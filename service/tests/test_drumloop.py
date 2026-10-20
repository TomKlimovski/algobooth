from pathlib import Path

import pytest

from algorip.drumloop import drum_loops, voice_loop
from algorip.schema import Analysis

GOLDEN = Path(__file__).parent / "golden"
HOUSE = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())

FOUR = {0, 4, 8, 12}
OFF = {2, 6, 10, 14}


def analysis(drums: dict[str, list[tuple[int, int]]], bars: int) -> Analysis:
    return HOUSE.model_copy(update={"drums": drums, "bars": bars})


def test_a_one_bar_loop_with_a_fill_bar():
    v = voice_loop([FOUR] * 3 + [{0, 4, 8, 10}])
    assert v.period == 1 and v.templates == [FOUR]
    assert v.fills == [set(), set(), set(), {10}]


def test_a_stray_hit_in_a_core_bar_is_a_fill_too():
    bars = [OFF] * 8
    bars[1] = OFF | {11}
    v = voice_loop(bars)
    assert v.templates == [OFF] and v.fills[1] == {11} and all(not f for i, f in enumerate(v.fills) if i != 1)


def test_a_phrase_end_fill_becomes_fills_every_fourth_bar():
    claps = [{4, 12}] * 8
    claps[3] = claps[7] = {4, 12, 14}
    v = voice_loop(claps)
    assert v.period == 1 and v.templates == [{4, 12}]
    assert [bool(f) for f in v.fills] == [False, False, False, True] * 2 and v.fills[3] == {14}


def test_an_alternation_is_a_two_bar_loop():
    v = voice_loop([{0, 10}, {0, 6}] * 2)
    assert v.period == 2 and v.templates == [{0, 10}, {0, 6}] and not any(v.fills)


def test_an_empty_phase_is_not_a_loop_for_a_drum_voice():
    # open hats on bars 0, 4 and 8 only, and nothing elsewhere: period 4 would vote a template with
    # three empty phases; the voice has no regular part, and every hit is a fill
    bars = [set() for _ in range(9)]
    for b in (0, 4, 8):
        bars[b] = OFF
    v = voice_loop(bars)
    assert v.period == 1 and v.templates == [set()]
    assert v.fills[0] == OFF and v.fills[4] == OFF and v.fills[8] == OFF and not v.fills[1]


def test_no_repetition_is_verbatim_and_a_one_bar_clip_too():
    bars = [{0}, {2}, {4}, {6}]
    v = voice_loop(bars)
    assert v.period == 4 and v.templates == bars and not any(v.fills)
    one = voice_loop([FOUR])
    assert one.period == 1 and one.templates == [FOUR] and one.fills == [set()]


def test_drum_loops_over_an_analysis():
    a = analysis(drums={"bd": [(b, s) for b in range(4) for s in FOUR] + [(3, 10)], "sd": [(b, s) for b in range(4) for s in (4, 12)], "hh": [], "oh": []}, bars=4)
    d = drum_loops(a)
    assert set(d.voices) == {"bd", "sd"}
    assert d.fill_bars == (4, 4)
    assert d.match == pytest.approx(round(2 * 24 / (24 + 25), 2))   # 24 played, 25 classified
    assert drum_loops(analysis(drums={}, bars=4)).voices == {} and drum_loops(analysis(drums={}, bars=4)).match == 1.0


def test_hits_off_the_clip_are_ignored():
    drums = {"bd": [(b, s) for b in range(4) for s in FOUR] + [(3, 10)]}
    stray = {"bd": drums["bd"] + [(4, 2), (-1, 6)], "oh": [(9, 2)]}
    assert drum_loops(analysis(drums=stray, bars=4)) == drum_loops(analysis(drums=drums, bars=4))
